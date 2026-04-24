# Pimp — panier unifié multi-boutiques

Deux boutiques WordPress/WooCommerce et un SaaS Angular + FastAPI qui agrègent
un panier unique par utilisateur, authentification gérée par **Auth0**.

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
# éditer AUTH0_DOMAIN, AUTH0_API_AUDIENCE, AUTH0_SPA_CLIENT_ID
```

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
