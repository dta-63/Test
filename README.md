# Pimp — panier unifié multi-boutiques

Deux boutiques WordPress/WooCommerce et un SaaS Angular + FastAPI qui agrègent
un panier unique par utilisateur, authentification gérée par **Auth0**, paiement
unique via **Stripe**, prix recalculés via les moteurs natifs des boutiques,
suivi de commandes en temps réel, dashboard B2B.

## Cartographie cahier des charges → implémentation

| Spec | Implémentation |
| --- | --- |
| Bouton "Ajouter à mon panier PIMP" sur les pages produit | `wordpress/plugins/pimp-cart` — hook `woocommerce_after_add_to_cart_button` |
| SSO utilisateur (IdP centralisé, sessions cross-domain) | Auth0 SPA flow (PKCE) côté SaaS *et* dans le plugin (auth0-spa-js, `cacheLocation: localstorage` + `useRefreshTokens`) |
| S2S bidirectionnel | **Site → Pimp** : HMAC SHA256 sur les webhooks (clé partagée par site) ; **Pimp → Site** : (a) WC REST API consumer key/secret pour les commandes, (b) HMAC SHA256 custom sur `/wp-json/pimp/v1/*` |
| Application du prix de la boutique (WC_Cart) | `POST /api/cart/preview` (Pimp) → `POST /wp-json/pimp/v1/cart/preview` (plugin) qui instancie `WC_Cart`, calcule subtotal / discount / shipping / tax / total |
| Filtrage hooks via table SQL des produits actifs | Table `wp_pimp_active_products` ; hooks produit court-circuités si le produit n'est pas dans la table ; Pimp envoie touch/forget via `/wp-json/pimp/v1/active-products` à chaque add/remove/checkout |
| TTL du panier (configurable) | `CART_TTL_SECONDS` env (par défaut 7 jours), `CartItem.expires_at`, purge à la lecture du panier + notification aux shops + push WS `cart.items_expired` (toast frontend) |
| Réconciliation active-products | `ACTIVE_PRODUCTS_RECONCILE_SECONDS` env (par défaut 1h). Tâche `asyncio` lancée par le `lifespan` FastAPI : agrège tous les `(site, product_id)` en panier et appelle `/wp-json/pimp/v1/active-products {replace: [...]}` sur chaque shop pour resynchroniser la table SQL plugin |
| Re-check stock au checkout | `/pimp/v1/cart/preview` retourne `available + reason + stock_left` par item ; `/api/payment/intent` retourne `409 items_unavailable` si une indisponibilité est détectée ; le dialog frontend bloque le paiement et liste les articles concernés |
| Currency mismatch | Si les shops retournent des devises mélangées, `/api/payment/intent` retourne `409 currency_mismatch` ; `/api/cart/preview` expose `currency_mismatch: true` pour permettre au SPA d'avertir l'utilisateur sans planter |
| Re-connect WebSocket avec token frais | À chaque reconnexion, `WebSocketService` rappelle `getAccessTokenSilently()` (refresh-token Auth0) avant d'ouvrir la socket — le token périmé après 1h n'est plus rejoué |
| "Déjà dans le panier" sur la fiche produit | Au chargement de la page produit, le JS plugin appelle `GET /api/cart` (silent auth) et bascule le bouton sur l'état `data-in-cart="1"` (vert) avec un lien vers le SaaS Pimp si le produit y est déjà |
| Création des commandes via API marchande | `POST /wp-json/wc/v3/orders` avec billing + shipping + line_items + transaction_id (cf. spec) |
| Suivi des commandes (statut, tracking) | Hook `woocommerce_order_status_changed` → `POST /api/webhooks/order` (HMAC) → mise à jour `PimpOrder.status` + push WS `order.status_changed` (+ tracking_number / tracking_url) |
| Paiement unique via PSP | **Stripe Payment Intent** — `POST /api/payment/intent` interroge chaque shop (`/wp-json/pimp/v1/cart/preview`), persiste un `PaymentSnapshot` (billing/shipping + breakdown par site), crée le PI sur le grand-total ; `POST /api/payment/confirm` est idempotent (clé = PI id, retour caché du résultat sur retry), vérifie `status=succeeded` + `intent.amount == snapshot.amount`, puis crée chaque commande WC avec `shipping_lines = [{ total: <preview.shipping_total> }]` pour que le total WC matche le montant Stripe ; `set_paid: true`, `transaction_id: <charge_id>` |
| Variations & quantité produit | Le bouton plugin n'embarque que `product_id` ; au clic JS lit la quantité (`input.qty`) et `variation_id` du formulaire WC, demande une signature fraîche à `wp_ajax_pimp_sign_add_to_cart` (HMAC sur `{site_id}.{ts}.{product_id}.{variation_id}.{quantity}`), puis POST vers Pimp. Couvre les produits variables et les quantités multiples sans staleness HMAC. |
| Dashboard / suivi B2B | `/api/b2b/dashboard` + page Angular `/b2b` — KPIs avec delta période précédente, filtres période (7/30/90/12m/all) et boutique, sparkline, top produits, tableau commandes paginé + recherche, modal détail commande, export CSV |

## Architecture

```
┌──────────────┐   Auth0 SPA flow (PKCE)    ┌───────────────────┐
│  Shop A (WP) │ ─────────────────────────► │                   │
│  WooCommerce │                            │   Pimp API        │
│  + plugin    │ ──── POST /cart/items ───► │  (FastAPI + JWT)  │
└──────────────┘                            │                   │
                                            │   PostgreSQL      │
┌──────────────┐                            │                   │
│  Shop B (WP) │ ─────────────────────────► │                   │
│  + plugin    │                            └─────────┬─────────┘
└──────────────┘                                      │
                                                      ▼
                                         ┌──────────────────────┐
                                         │   Pimp SaaS (Angular)│
                                         │   GET /cart          │
                                         └──────────────────────┘
```

Traefik route les sous-domaines `*.localhost` vers les services.

## Authentification

Deux couches, chacune nécessaire :

1. **Auth0 (qui est l'utilisateur)** — flow SPA PKCE depuis l'Angular *et*
   depuis le JS du plugin WordPress. Le token d'accès est présenté en
   `Authorization: Bearer` à l'API Pimp, qui le valide contre les JWKS
   Auth0 (issuer + audience).
2. **HMAC site (quelle boutique)** — à chaque clic sur "Ajouter à mon panier
   Pimp", PHP signe `{site_id}.{timestamp}.{product_id}` avec `SITE_X_KEY`.
   L'API rejette les signatures invalides ou les timestamps > 5 min.
   Sans cela, un utilisateur authentifié pourrait forger un POST en
   prétendant venir de Shop A.

## Démarrage

### 1. Créer un tenant Auth0 (gratuit)

- **API** : Identifier `https://api.pimp.localhost` (c'est l'audience)
- **Application SPA** : récupérer le *Client ID*
  - Allowed Callback URLs : `http://pimp.localhost, http://shop-a.localhost, http://shop-b.localhost`
  - Allowed Logout URLs et Allowed Web Origins : les trois mêmes URL

### 2. Configurer `.env`

```bash
cp .env.example .env
# Auth0 (obligatoire)
#   AUTH0_DOMAIN, AUTH0_API_AUDIENCE, AUTH0_SPA_CLIENT_ID
# Stripe (optionnel mais recommandé pour le paiement unifié)
#   STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY (clés de test)
# B2B (optionnel)
#   B2B_EMAILS=alice@example.com
```

Sans clés Stripe, le checkout retombe en mode "commandes en attente de paiement"
(le marchand traite manuellement).

### 3. Ajouter les hosts locaux

```
127.0.0.1 pimp.localhost api.pimp.localhost shop-a.localhost shop-b.localhost
```

`make hosts` affiche cette ligne.

### 4. Lancer

```bash
make up
```

C'est la commande unique. Elle :

- build les images backend/frontend,
- démarre Traefik, Postgres, 2× MariaDB, 2× WordPress,
- seed automatiquement WooCommerce avec des produits de démo,
- applique un style différent à chaque site (bleu / electronics, rose / fashion).

Premier démarrage : ~2-3 min (WP + Woo + seed).

## URLs

| Service           | URL                                | Compte              |
| ----------------- | ---------------------------------- | ------------------- |
| Pimp SaaS         | http://pimp.localhost              | via Auth0           |
| Pimp API (OpenAPI)| http://api.pimp.localhost/docs     | -                   |
| Shop A            | http://shop-a.localhost            | admin / admin       |
| Shop B            | http://shop-b.localhost            | admin / admin       |
| Traefik dashboard | http://localhost:8080              | -                   |

## Parcours utilisateur

1. Ouvrir `http://shop-a.localhost`, choisir un produit.
2. Cliquer sur **Ajouter à mon panier Pimp** (bouton violet).
3. Auth0 redirige vers la page de login, puis revient sur la fiche produit.
4. Le produit est envoyé vers Pimp et confirmé.
5. Répéter sur `http://shop-b.localhost`.
6. Ouvrir `http://pimp.localhost`, se connecter (même compte Auth0).
7. Les articles des deux boutiques apparaissent dans un panier unique.
8. Cliquer **Valider ma commande** → renseigner les adresses → payer via Stripe
   (carte test `4242 4242 4242 4242`, n'importe quelle date future, n'importe
   quel CVC).
9. Pimp crée une commande sur chaque boutique, marquée `processing` avec le
   `transaction_id` Stripe.

## Espace B2B

Accessible aux utilisateurs identifiés comme B2B (cf. § Configuration B2B).
Un lien `B2B` apparaît dans le header du SaaS quand le compte est éligible.

### Indicateurs

- **KPIs** : nombre de commandes, CA, panier moyen, boutiques actives. Les deux
  premiers affichent un delta `+X%` ou `-X%` vs la période précédente
  équivalente (sauf en mode "Tout").
- **Sparkline** dimensionnée à la période sélectionnée (7j / 30j / 90j ; 12m
  condense en 90 cellules).
- **Répartition par boutique** : barres horizontales colorées Shop A / Shop B.
- **Statuts** : compteur par statut WooCommerce (`pending`, `processing`,
  `completed`, `cancelled`, `refunded`...).
- **Top 5 produits** (par quantité vendue, sur la période + le filtre site).
- **Tableau commandes** : 50 par page, recherche full-text sur n° de commande,
  email et nom de client, ligne cliquable → modal détail.

### Filtres

| Contrôle | Effet |
| --- | --- |
| Période (`7j` / `30j` / `90j` / `12m` / `Tout`) | Filtre toutes les agrégations + redimensionne la série temporelle |
| Boutique (`Toutes` / `Shop A` / `Shop B`) | Filtre KPIs, top produits, tableau commandes |
| Recherche | Filtre uniquement le tableau commandes (debounce 250 ms, ILIKE sur n°/email/nom) |

Chaque changement de filtre relance le dashboard ; la pagination revient à 0.

### Détail d'une commande

Clic sur une ligne → modal avec :
- Boutique, statut (pill colorée), date
- Nom + email client, total
- Liste des articles (nom, ID produit, quantité, prix unitaire, sous-total)
- Lien direct vers `/wp-admin/post.php?post=X&action=edit` sur le shop concerné

### Export CSV

Bouton **Exporter CSV** à droite de la barre de recherche. Le téléchargement
respecte les filtres actifs (période, boutique, recherche) ; le CSV utilise
`;` comme séparateur (compatible Excel FR) et est nommé
`pimp-orders-<période>-<site>.csv`.

### Endpoints B2B

| Méthode | URL | Rôle |
| --- | --- | --- |
| `GET` | `/api/b2b/dashboard?period=&site=` | KPIs, séries, top, dernières commandes |
| `GET` | `/api/b2b/orders?period=&site=&q=&status=&limit=&offset=` | Liste paginée |
| `GET` | `/api/b2b/orders/{id}` | Détail commande + line items |
| `GET` | `/api/b2b/orders.csv?period=&site=&q=` | Export CSV |

Tous protégés par `require_b2b` (JWT scope `b2b:read` ou rôle `b2b` ou email
dans `B2B_EMAILS`).

### Configuration B2B

Trois moyens d'accorder l'accès, dans l'ordre de priorité :

1. **Auth0 RBAC (recommandé en prod)** : activer RBAC sur l'API,
   créer la permission `b2b:read`, l'assigner à un rôle, assigner le rôle aux
   utilisateurs, activer "Add Permissions in the Access Token".
2. **Custom claim Auth0 Action** : émettre `https://pimp/roles` contenant
   `"b2b"` dans l'access token.
3. **Allowlist email (démo)** : `B2B_EMAILS=alice@example.com,bob@company.fr`
   dans `.env`.

## Développement

- Backend: `pimp-backend/app/` — hot reload : `docker compose exec pimp-backend uvicorn app.main:app --reload --host 0.0.0.0`
- Frontend: `pimp-frontend/src/` — pour le dev, lancer `npx ng serve` localement pointant vers `http://api.pimp.localhost`
- Plugin: `wordpress/plugins/pimp-cart/` — modifié à chaud (volume monté)

## Commandes

```bash
make up       # lance tout
make down     # arrête
make clean    # arrête + supprime volumes (reset total)
make logs     # suit les logs
make ps       # liste les containers
```

## Structure

```
.
├── docker-compose.yml
├── Makefile
├── .env.example
├── pimp-backend/          # FastAPI + SQLAlchemy + Auth0 JWT
├── pimp-frontend/         # Angular 18 + auth0-angular
└── wordpress/
    ├── plugins/pimp-cart/ # plugin partagé Shop A & B
    ├── mu-plugins/        # must-use branding par site
    └── init/setup.sh      # wp-cli seed (products + styling)
```
