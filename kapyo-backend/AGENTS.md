# Backend Kapyo — guide agent (architecture hexagonale)

FastAPI + SQLAlchemy + Auth0. Ce service agrège un panier unique multi-boutiques
et exécute le paiement unifié. Il intègre **plusieurs plateformes e-commerce**
(WooCommerce, Shopify, …) derrière une seule interface.

> Si tu ne lis qu'une chose : le cœur applicatif ne connaît **aucune** plateforme.
> Il parle au port `ShopPlatform`. Ajouter une plateforme = un adapter + une
> entrée de registry. Aucune modification d'un use case ou d'un router.

## Les couches (hexagonal / ports & adapters)

```
            inbound adapters                core                 outbound adapters
        ┌──────────────────────┐   ┌────────────────────┐   ┌────────────────────────┐
HTTP ──▶│ app/routers/*.py     │──▶│ app/application/*  │──▶│ app/adapters/woocommerce│──▶ WC REST + plugin
WS   ──▶│ app/routers/ws.py    │   │ (use cases)        │   │ app/adapters/shopify    │──▶ Shopify Admin API
webhook▶│ routers/*webhooks*   │   │   dépend de ▼      │   │ app/adapters/...        │
        └──────────────────────┘   │ app/ports/*        │◀──┘ (implémentent les ports)
                                    │ app/domain/*       │
                                    └────────────────────┘
                                       registry: app/platforms.py (composition root)
```

| Couche | Dossier | Rôle | Peut importer |
| --- | --- | --- | --- |
| **domain** | `app/domain/` | Types métier purs (dataclasses, enums). Aucune dépendance framework. | rien (stdlib) |
| **ports** | `app/ports/` | Interfaces (`Protocol`) que le cœur exige. | `domain` |
| **application** | `app/application/` | Use cases : orchestration multi-boutiques, normalisation des erreurs. | `domain`, `ports`, `platforms` |
| **adapters (out)** | `app/adapters/<platform>/` | Implémentent les ports pour une plateforme concrète. Seul endroit avec du JSON WC/Shopify, de l'auth spécifique, des endpoints. | `domain`, `ports`, `config` |
| **adapters (in)** | `app/routers/` | FastAPI : HTTP/WS/webhooks, persistance, mapping schemas Pydantic. | tout |
| **composition root** | `app/platforms.py` | Câble `site_id → adapter` selon la config. | adapters, config, ports |
| **persistence** | `app/models.py`, `app/database.py` | SQLAlchemy. Détail d'infra. | `domain` |

### La règle de dépendance (à ne jamais enfreindre)

Les flèches d'import pointent **vers le centre** :

- `domain` n'importe personne d'autre que la stdlib.
- `ports` n'importe que `domain`.
- `application` n'importe que `domain`, `ports`, et le registry `platforms`.
- un **adapter** peut importer `domain`/`ports`/`config`, **jamais** un router ni un autre adapter.
- un **router** est le seul endroit qui touche à la fois la base, les websockets et le cœur.

Interdits qui doivent te faire reculer :
- `from ..adapters.woocommerce import ...` dans un router ou un use case → **non**.
  Passe par `get_platform(site_id)` qui renvoie un `ShopPlatform`.
- `import httpx` / un payload `wp-json` / `gid://shopify` hors d'un dossier `adapters/` → **non**.
- une `class` SQLAlchemy importée dans `domain/` ou `application/` → **non**.

## Le port central : `ShopPlatform`

`app/ports/shop_platform.py`. Tout ce que Kapyo fait *vers* une boutique :

- `cart_preview(line_items, billing, shipping) -> CartPreview` — prix autoritatif
  calculé par le moteur de la boutique elle-même.
- `create_order(line_items, billing, *, shipping, shipping_total, customer_note,
  transaction_id, paid) -> OrderResult`.
- `notify_active_products(touch, forget)` / `replace_active_products(ids)` —
  spécifique WooCommerce ; **no-op** sur les plateformes sans ce concept (Shopify).

Les échecs remontent en `ShopPlatformError(status, detail)` — jamais une exception
httpx ou une erreur WC brute ne doit fuir vers un router.

## Ajouter une plateforme (recette)

1. `app/adapters/<platform>/platform.py` : une classe qui **satisfait structurellement**
   `ShopPlatform` (attributs `site_id`, `platform`, `host` + les 4 méthodes async).
   Mets le transport bas niveau dans un `client.py` voisin.
2. `app/domain/shop.py` : ajoute la valeur à l'enum `Platform`.
3. `app/config.py` : ajoute les champs d'env (`ShopConfig`) + le câblage dans
   `_shop_config` / `shops`.
4. `app/platforms.py` : une branche dans `_build`.
5. Webhooks entrants spécifiques (auth différente) : un router dédié
   (cf. `routers/shopify_webhooks.py`), inclus dans `main.py`.

Aucun fichier de `application/` ne change. C'est le test que l'archi tient.

## Ajouter un use case

Mets l'orchestration dans `app/application/<nom>_service.py` (fonctions async qui
prennent des `domain` et renvoient des `domain`/dataclasses de résultat). Le router
fait : valider l'entrée → construire les `LineItem` depuis la persistance → appeler
le use case → mapper vers les schemas Pydantic → persister. Garde la logique
multi-boutiques **hors** du router.

## Conventions de code

- Python 3.11+, `from __future__ import annotations`, typage complet (PEP 604 `X | None`).
- Async pour tout I/O réseau (`httpx.AsyncClient`). Pas d'appel bloquant dans une coroutine.
- Pydantic = frontière HTTP uniquement (`app/schemas.py`). Le cœur parle `dataclasses` du domaine.
- Argent : `float` arrondi à 2 décimales dans le domaine ; minor units (int) seulement à la frontière Stripe.
- Erreurs : un adapter lève `ShopPlatformError` ; un use case l'attrape et renvoie un résultat structuré ; un router mappe vers `HTTPException`.
- Commentaires : explique le *pourquoi* (invariants, sécurité, idempotence), pas le *quoi*. Suis la densité existante.

## Sécurité (ne pas régresser)

- **Entrant add-to-cart** : HMAC partagé par site (`assert_site_signature`, `app/auth.py`). Uniforme quelle que soit la plateforme.
- **Entrant webhooks WooCommerce** : HMAC `X-Kapyo-*` (plugin). **Shopify** : HMAC `X-Shopify-Hmac-Sha256` sur le corps brut (`app/adapters/shopify/webhook.py`).
- **Sortant** : WC = consumer key/secret + HMAC S2S ; Shopify = `X-Shopify-Access-Token`.
- JWT Auth0 validés contre les JWKS (`app/auth.py`). Le claim namespacé est `https://kapyo/...`.
- Idempotence paiement : `PaymentSnapshot` clé = PaymentIntent id ; un re-`confirm` renvoie le résultat caché sans recréer de commande.

## Lancer / vérifier

```bash
# Depuis la racine du repo :
make up                                            # build + run toute la stack
docker compose exec kapyo-backend \
  uvicorn app.main:app --reload --host 0.0.0.0     # hot reload backend
docker compose logs -f kapyo-backend

# Sans Docker (syntaxe + graphe d'imports, sans deps lourdes) :
python3 -m compileall -q app
```

Pas de suite de tests à ce stade — si tu en ajoutes, vise les use cases
(`application/`) avec des doubles de `ShopPlatform`, c'est là que la valeur est et
c'est trivial à mocker grâce au port.

## Pièges connus

- `models.py` utilise des noms génériques (`external_order_id`, `external_order_number`) — **pas** `woo_*`. Une commande peut venir de n'importe quelle plateforme.
- Le renommage `pimp → kapyo` a été total et **cassant** (tables SQL `kapyo_*`, en-têtes `X-Kapyo-*`, claim `https://kapyo/...`). Un volume Postgres d'avant le renommage est incompatible : `make clean && make up`.
- `Date.now`-style : la réconciliation tourne dans le `lifespan` ; un site Shopify renvoie des no-op sur active-products, c'est voulu.
