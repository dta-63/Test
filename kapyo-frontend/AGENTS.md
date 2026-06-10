# Frontend Kapyo — guide agent

SaaS Angular 18, **standalone components** (templates inline). Panier unifié,
checkout Stripe, espace B2B, notifications temps réel. Auth via
`@auth0/auth0-angular`. Build servi par nginx derrière Traefik.

## Architecture (organisation par type / couches)

```
src/
├── main.ts                  # bootstrap → AppComponent + appConfig
├── styles.scss              # styles globaux
└── app/
    ├── app.component.ts     # shell racine : header + <router-outlet>
    ├── app.config.ts        # providers racine (router, HttpClient, Auth0)
    ├── app.routes.ts        # table de routes
    ├── core/                # transverse, chargé une fois        →  @core/*
    │   ├── env.ts           # config runtime (window.__kapyo_env__) + isAuth0Configured()
    │   └── guards/
    │       └── b2b.guard.ts # CanActivate B2B
    ├── models/              # DTO du contrat API (types purs)      →  @models/*
    │   ├── user.model.ts        cart.model.ts      checkout.model.ts
    │   ├── b2b.model.ts         config.model.ts    notification.model.ts
    ├── services/            # accès API (HttpClient) + infra        →  @services/*
    │   ├── account.service.ts   b2b.service.ts     cart.service.ts
    │   ├── checkout.service.ts   me.service.ts      stripe.service.ts
    │   ├── public-config.service.ts   notifications.service.ts
    │   └── websocket.service.ts
    ├── state/              # « contexts » → stores d'état (signals) →  @state/*
    │   └── cart.store.ts
    ├── pages/              # vues ROUTÉES (1 par entrée de routes)  →  @pages/*
    │   ├── account.component.ts      cart.component.ts
    │   ├── b2b-dashboard.component.ts  auth-callback.component.ts
    └── components/         # UI NON routée, réutilisable / embarquée →  @components/*
        ├── checkout-dialog.component.ts
        └── b2b-order-detail.component.ts
```

Les `→ @alias/*` sont les **alias de chemins** déclarés dans
`tsconfig.json#compilerOptions.paths` (hérités par `tsconfig.app.json`).

> **« contexts » en Angular** : il n'y a pas de Context API comme en React.
> L'équivalent est un **service d'état fourni en racine** (`providedIn: 'root'`)
> exposant des **signals** — c'est le rôle de `state/`. `cart.store.ts` est le
> store du panier ; les composants le lisent/mutent, il appelle les services.

### Règle de dépendance (sens des imports)

```
pages ─┐
        ├─▶ components ─┐
        │               ├─▶ state ──▶ services ──▶ core ─┐
        └───────────────┴─▶ services ──▶ core            ├─▶ models
app.routes ─▶ pages, guards     app.component ─▶ services (shell)
            (toutes les couches peuvent dépendre de models)
```

- `models/` ne contient que des `interface`/`type` purs — **aucun import** (à part d'autres models). C'est une feuille, comme `core/`.
- `core/` n'importe que des libs (+ éventuellement `models/`). Feuille.
- `services/` importe `core/` (env) et `models/` (types de retour) ; **jamais** un composant ni un store.
- `state/` (stores) orchestre des `services/` ; **jamais** l'inverse (un service ne connaît pas un store).
- `components/` et `pages/` consomment `state/`, `services/` et `models/`.
- `pages/` = routé ; `components/` = embarqué. Si une vue apparaît dans `app.routes.ts`, c'est une **page**, sinon un **component**.

À ne pas faire :
- importer un composant depuis un `service` ou un `store` → inversion de dépendance.
- mettre un appel `HttpClient` dans un composant → ça vit dans un `service`.
- dupliquer l'état du panier dans un composant → source unique = `state/cart.store.ts`.
- définir une `interface` de contrat API dans un service → elle vit dans `models/` (un service **importe** ses types, ne les déclare pas).

## Où ajouter quoi

| Besoin | Emplacement | Suffixe |
| --- | --- | --- |
| Nouvelle vue accessible par URL | `pages/` + entrée dans `app.routes.ts` | `*.component.ts` |
| Bloc UI réutilisé / modal | `components/` | `*.component.ts` |
| Appel à l'API backend | `services/` | `*.service.ts` |
| État partagé entre vues | `state/` | `*.store.ts` |
| Garde de route | `core/guards/` | `*.guard.ts` |
| Config/constante transverse | `core/` | — |
| DTO du contrat API / type partagé | `models/` (`@models/*`) | `*.model.ts` |

Les DTO du contrat API (miroir des schemas Pydantic backend) vivent dans
`models/`, **groupés par domaine** (`user`, `cart`, `checkout`, `b2b`, `config`,
`notification`). Un service **importe** ses types depuis `@models/...` et
n'en déclare aucun. Les types purement internes au SDK (ex. les wrappers
`StripeElements` de `stripe.service.ts`) restent avec leur service — `models/`
est réservé au **contrat de données**, pas aux typings d'implémentation.

## Conventions

- **Standalone partout** : pas de NgModule. `imports: [...]` au niveau du composant.
- **Signals** pour l'état (stores, état local de composant) ; RxJS pour les flux HTTP/WS. Reste cohérent avec le voisin.
- **Token frais** : avant toute requête authentifiée ou (re)connexion WebSocket, récupérer le token via `getAccessTokenSilently()` (refresh-token Auth0). Le WS est reconnecté avec un token frais — ne jamais rejouer un token périmé (cf. `services/websocket.service.ts`).
- **Contrat API** : les types TS miroir des schemas backend. Champs génériques côté backend → génériques ici : `external_order_id` / `external_order_number`, **jamais** `woo_*`.
- **Pas de secret** dans le bundle : seules les valeurs publiques transitent par `__kapyo_env__` / `GET /api/config/public` (clé publishable Stripe, TTL panier).
- **Multi-devises** : ne jamais sommer des devises différentes ; respecter `currency_mismatch` renvoyé par `/api/cart/preview`.
- **Imports via alias** : utilise les alias `@core` / `@models` / `@services` / `@state` / `@pages` / `@components` (déclarés dans `tsconfig.json#paths`) plutôt que des chemins relatifs profonds. Un import inter-dossiers s'écrit `import { CartView } from '@models/cart.model';`, jamais `../../models/...`. Seuls les imports **dans le même dossier** ou à la racine (`./app.routes`) restent relatifs.
- Nommage produit : **Kapyo** (jamais « pimp »).

## Flux de données type (ajout au panier → checkout)

1. `pages/cart.component.ts` lit `state/cart.store.ts` (signals).
2. Le store appelle `services/cart.service.ts` (HTTP) et `services/websocket.service.ts` (push temps réel).
3. Au checkout : `components/checkout-dialog.component.ts` → `services/checkout.service.ts` + `services/stripe.service.ts`.
4. `services/notifications.service.ts` centralise les toasts (TTL panier, statut commande) émis par le WS.

## Lancer

```bash
# Build conteneurisé (args Auth0 injectés au build) :
docker compose up -d --build kapyo-frontend
# Dev local pointant l'API dockerisée :
cd kapyo-frontend && npx ng serve            # vise http://api.kapyo.localhost
# Vérif rapide hors node (résolution des imports relatifs) :
#   voir le check python dans l'historique d'archi — ng build reste la vérité.
```

Si « rien ne se passe au login » : le bundle a été buildé avec des placeholders
(`.env` vide) → une bannière jaune s'affiche. Renseigne Auth0 dans `.env` et
rebuild `kapyo-frontend` + `kapyo-backend`.
