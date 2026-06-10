# Kapyo — guide pour agents

Panier unifié multi-boutiques. Deux familles de storefronts (WooCommerce et
Shopify) alimentent un panier unique par utilisateur ; SSO **Auth0**, paiement
unique **Stripe**, prix recalculés par le moteur natif de chaque boutique, suivi
de commandes temps réel, dashboard B2B.

Ce fichier est le point d'entrée. Chaque service a son propre `AGENTS.md` avec
les règles détaillées — **lis-le avant de modifier ce service**.

## Carte du dépôt

| Chemin | Quoi | Guide |
| --- | --- | --- |
| `kapyo-backend/` | API FastAPI + SQLAlchemy + Auth0, **architecture hexagonale** | [`kapyo-backend/AGENTS.md`](kapyo-backend/AGENTS.md) |
| `kapyo-frontend/` | SaaS Angular 18 (panier, checkout, B2B) | [`kapyo-frontend/AGENTS.md`](kapyo-frontend/AGENTS.md) |
| `wordpress/` | Plugin `kapyo-cart` (bouton + REST + webhooks), mu-plugins par site, seed | [`wordpress/AGENTS.md`](wordpress/AGENTS.md) |
| `docker-compose.yml`, `Makefile` | Orchestration locale (Traefik, Postgres, 2× WP/Woo) | — |
| `.env.example` | Toute la configuration (Auth0, Stripe, sites, Shopify) | — |

## Modèle multi-plateforme (le concept central)

Un **site** (`site-a`, `site-b`, `site-c`, …) est servi par **une plateforme** :
`woocommerce` ou `shopify`, choisie par `SHOP_<X>_PLATFORM`. Le backend masque
totalement cette différence derrière le port `ShopPlatform` (voir le guide
backend). Côté storefront :

- **WooCommerce** : plugin `wordpress/plugins/kapyo-cart` (bouton « Ajouter à mon
  panier Kapyo », REST `wp-json/kapyo/v1/*`, webhooks signés HMAC `X-Kapyo-*`).
- **Shopify** : app custom Shopify (token Admin API). Le backend appelle l'Admin
  GraphQL ; les webhooks Shopify natifs arrivent sur
  `/api/webhooks/shopify/{site_id}` (HMAC `X-Shopify-Hmac-Sha256`). Le bouton
  côté boutique se fait via une *theme app extension* (à fournir dans l'app Shopify).

## Commandes

```bash
make up      # build + démarre toute la stack (1er run : ~2-3 min)
make down    # arrête
make clean   # arrête + supprime les volumes (reset total — obligatoire après le renommage)
make logs    # suit les logs
make ps      # liste les conteneurs
```

URLs : SaaS `http://kapyo.localhost`, API `http://api.kapyo.localhost/docs`,
boutiques WooCommerce `http://shop-a.localhost` / `http://shop-b.localhost`.

## Conventions transverses

- **Nom du produit** : `Kapyo` (TitleCase), `kapyo` (slugs, env minuscules), `KAPYO`
  (constantes/PHP). Jamais « pimp » — c'était l'ancien nom, le renommage est total.
- **Identifiants génériques** : un nom de champ ne doit pas trahir une plateforme.
  C'est `external_order_id`, pas `woo_order_id`. Idem pour tout nouveau champ.
- **Sécurité d'abord** : ne supprime jamais une vérification de signature (HMAC site,
  webhook Shopify, JWT Auth0, idempotence Stripe) sans comprendre l'invariant qu'elle protège — ils sont documentés au point d'usage.
- **Secrets** : seulement via env (`.env`, jamais commité). `.env.example` est la doc de référence des variables.
- **Frontière vs cœur** : Pydantic/REST aux bords, dataclasses du domaine au centre. Voir le guide backend.

## État connu / garde-fous

- Le renommage `pimp → kapyo` a été **cassant** : tables SQL `kapyo_*`, en-têtes
  `X-Kapyo-*`, hostnames `*.kapyo.localhost`, claims `https://kapyo/...`. Toute
  donnée/volume antérieur est incompatible → `make clean && make up`, et reconfigurer
  Auth0 (audience `https://api.kapyo.localhost`, callbacks `http://kapyo.localhost`).
- Le hosts local doit contenir : `127.0.0.1 kapyo.localhost api.kapyo.localhost shop-a.localhost shop-b.localhost` (`make hosts`).
- La cible Shopify (`site-c`) reste **inactive** tant que `SHOP_C_SHOPIFY_DOMAIN` /
  `SHOP_C_SHOPIFY_ADMIN_TOKEN` ne sont pas renseignés — le démarrage par défaut reste WooCommerce-only.
