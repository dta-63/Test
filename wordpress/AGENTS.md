# WordPress / WooCommerce — guide agent

Côté WooCommerce, Kapyo s'intègre via le plugin **`kapyo-cart`** (partagé par
toutes les boutiques WP) + des mu-plugins de branding par site. C'est l'un des
*storefronts* du modèle multi-plateforme (l'équivalent Shopify est une app custom ;
voir [`../CLAUDE.md`](../CLAUDE.md)).

## Layout

- `plugins/kapyo-cart/kapyo-cart.php` — bootstrap (`Kapyo_Cart_Plugin`), bouton
  « Ajouter à mon panier Kapyo » (`woocommerce_after_add_to_cart_button`),
  enqueue JS/CSS, AJAX de signature.
- `plugins/kapyo-cart/includes/class-kapyo-rest.php` — REST `wp-json/kapyo/v1/*`
  (`active-products`, `cart/preview`) ; auth HMAC en `permission_callback`.
- `plugins/kapyo-cart/includes/class-kapyo-storage.php` — table `wp_kapyo_active_products`
  (filtrage des hooks produit).
- `plugins/kapyo-cart/assets/kapyo-cart.{js,css}` — front du bouton (lit `KAPYO_CART_CFG`).
- `mu-plugins/site-{a,b}/` — branding + http-auth par boutique.
- `init/setup.sh` — seed wp-cli (produits démo + WooCommerce + clés API).

## Sécurité S2S (ne pas casser)

- **Kapyo → boutique** (REST plugin) : HMAC-SHA256 de
  `{ts}\n{METHOD}\n{path}\n{sha256(body)}` avec `KAPYO_SITE_KEY`, en-têtes
  `X-Kapyo-Timestamp` / `X-Kapyo-Signature`. Fenêtre de 5 min. Vérifié dans
  `Kapyo_REST::verify`. **Doit** rester en miroir de `app/adapters/woocommerce/client.py::sign_s2s`.
- **Boutique → Kapyo** (webhooks add-to-cart / produit / commande) : HMAC partagé
  côté backend (`app/auth.py`). Toute modification du schéma de signature doit être
  appliquée des deux côtés simultanément.
- Constantes injectées par `WORDPRESS_CONFIG_EXTRA` (docker-compose) : `KAPYO_API_URL`,
  `KAPYO_SITE_ID`, `KAPYO_SITE_KEY`, `KAPYO_AUTH0_*`.

## Conventions

- PHP : `final class`, namespace de classes préfixé `Kapyo_`, garde `if (!defined('ABSPATH')) { exit; }`.
- Slug/handle d'enqueue : `kapyo-cart`. Namespace REST : `kapyo/v1`. Table : `wp_kapyo_active_products`.
- Toujours passer par `$wpdb->prepare`. Échapper les sorties (`esc_*`).
- Nommage : **Kapyo** / `kapyo` / `KAPYO` (jamais « pimp »).
- Le plugin est monté en volume (modif à chaud) ; pas de build.

## Appliquer une modif sur une démo déjà lancée

```bash
docker compose run --rm shop-a-init   # ré-exécute les fixups idempotents
docker compose run --rm shop-b-init
# Reset total :
make clean && make up
```
