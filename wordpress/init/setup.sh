#!/bin/sh
# Usage: setup.sh <site-slug> <site-title> <accent-color-hex> <catalog: electronics|fashion>
set -e

SLUG="${1:-shop}"
TITLE="${2:-Shop}"
ACCENT="${3:-#7c3aed}"
CATALOG="${4:-electronics}"

# Wait for WordPress files to be installed by the apache container.
for i in $(seq 1 60); do
  if [ -f /var/www/html/wp-settings.php ]; then break; fi
  echo "[init:$SLUG] waiting for WordPress files..."
  sleep 2
done

cd /var/www/html

# Wait for DB and install core if needed.
until wp --allow-root db check >/dev/null 2>&1; do
  echo "[init:$SLUG] waiting for DB..."
  sleep 2
done

if ! wp --allow-root core is-installed 2>/dev/null; then
  echo "[init:$SLUG] installing core..."
  wp --allow-root core install \
    --url="http://${SLUG}.localhost" \
    --title="$TITLE" \
    --admin_user=admin \
    --admin_password=admin \
    --admin_email="admin@${SLUG}.local" \
    --skip-email
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Install a plugin from wordpress.org with a fallback that ignores SSL trust
# (corporate proxies that intercept HTTPS commonly break the default download).
install_plugin_from_org() {
  slug="$1"
  if wp --allow-root plugin is-installed "$slug" 2>/dev/null; then return 0; fi
  echo "[init:$SLUG] downloading plugin '$slug' from wordpress.org..."
  if wp --allow-root plugin install "$slug"; then return 0; fi
  echo "[init:$SLUG] download failed; retrying with --insecure (corp SSL trust workaround)..."
  if wp --allow-root plugin install "$slug" --insecure; then return 0; fi
  echo "[init:$SLUG] !!! could not install '$slug' — check network/proxy/HTTPS trust." >&2
  return 1
}

ensure_woocommerce_active() {
  if wp --allow-root plugin is-active woocommerce 2>/dev/null; then return 0; fi
  if ! install_plugin_from_org woocommerce; then
    return 1
  fi
  echo "[init:$SLUG] activating WooCommerce..."
  wp --allow-root plugin activate woocommerce
}

ensure_pimp_cart_active() {
  # pimp-cart ships in /wp-content/plugins/pimp-cart via a bind mount;
  # `wp plugin activate` is idempotent.
  wp --allow-root plugin activate pimp-cart >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Stage 1A: ensure plugins are installed + active. Idempotent, runs every time.
# This is split out from the heavy seed so that even if a previous run set
# pimp_demo_ready=1 without WC actually being active (e.g. SSL failure), we
# self-heal on next start.
# ---------------------------------------------------------------------------
if ! ensure_woocommerce_active; then
  echo "[init:$SLUG] WooCommerce not active — aborting setup. Fix the network and re-run." >&2
  exit 1
fi
ensure_pimp_cart_active

# ---------------------------------------------------------------------------
# Stage 1B: heavy demo content (one-shot, guarded by pimp_demo_ready).
# ---------------------------------------------------------------------------
if [ "$(wp --allow-root option get pimp_demo_ready 2>/dev/null)" != "1" ]; then
  # Skip Woo setup wizard and seed store.
  wp --allow-root option update woocommerce_store_address "1 rue de la Démo"
  wp --allow-root option update woocommerce_store_city "Paris"
  wp --allow-root option update woocommerce_default_country "FR"
  wp --allow-root option update woocommerce_currency "EUR"
  wp --allow-root option update woocommerce_onboarding_profile '{"completed":true}' --format=json || true
  wp --allow-root option update woocommerce_task_list_hidden yes
  wp --allow-root transient delete _wc_activation_redirect || true

  # Shop / Cart / Checkout / My Account pages
  wp --allow-root wc --user=admin tool run install_pages 2>/dev/null || true

  echo "[init:$SLUG] seeding products for catalog: $CATALOG"
  if [ "$CATALOG" = "fashion" ]; then
    wp --allow-root wc --user=admin product create --name="Veste en jean"      --type=simple --regular_price=89.00  --description="Coupe droite, denim bleu, indémodable."  --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="T-shirt graphique"  --type=simple --regular_price=29.00  --description="Coton bio, imprimé exclusif."           --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Sneakers blanches"  --type=simple --regular_price=119.00 --description="Minimalistes, cuir pleine fleur."       --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Sac en toile"       --type=simple --regular_price=49.00  --description="Tote bag grand format, lin recyclé."     --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Écharpe laine"      --type=simple --regular_price=39.00  --description="Laine mérinos, teinte tabac."           --status=publish --catalog_visibility=visible --manage_stock=false
  else
    wp --allow-root wc --user=admin product create --name="Casque audio sans fil" --type=simple --regular_price=199.00 --description="Réduction de bruit active, 30h d'autonomie." --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Clavier mécanique 75%"  --type=simple --regular_price=149.00 --description="Switches linéaires, rétroéclairage RGB."     --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Souris ergonomique"     --type=simple --regular_price=79.00  --description="Capteur 8000 DPI, molette horizontale."     --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Moniteur 27\" 4K"       --type=simple --regular_price=499.00 --description="Dalle IPS, USB-C 90W."                       --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Webcam 1080p"           --type=simple --regular_price=89.00  --description="Autofocus, micro stéréo intégré."           --status=publish --catalog_visibility=visible --manage_stock=false
  fi

  CSS=".site-header, .woocommerce-store-notice { background: ${ACCENT} !important; color: #fff !important; }
a.button, button.button, .woocommerce a.button, .woocommerce button.button.alt, .woocommerce #respond input#submit.alt { background: ${ACCENT} !important; color: #fff !important; }
.woocommerce-product-gallery { border: 2px solid ${ACCENT}; padding: 4px; }
.price { color: ${ACCENT} !important; font-weight: 700 !important; }
body { font-family: $( [ "$CATALOG" = "fashion" ] && echo 'Georgia, serif' || echo 'system-ui, sans-serif' ); }"

  wp --allow-root option update blogname "$TITLE"
  wp --allow-root option update blogdescription "Démo e-commerce ($CATALOG) connectée à Pimp"
  wp --allow-root option update pimp_site_accent "$ACCENT"
  wp --allow-root option update pimp_site_custom_css "$CSS"

  PIMP_CK="${PIMP_WC_CONSUMER_KEY:-ck_pimp_${SLUG}}"
  PIMP_CS="${PIMP_WC_CONSUMER_SECRET:-cs_pimp_${SLUG}_secret}"
  echo "[init:$SLUG] seeding WooCommerce REST API key for Pimp..."
  wp --allow-root eval "
global \$wpdb;
\$table = \$wpdb->prefix . 'woocommerce_api_keys';
\$key_hash = hash_hmac('sha256', '${PIMP_CK}', 'wc-api');
\$wpdb->delete(\$table, ['description' => 'Pimp checkout']);
\$wpdb->insert(\$table, [
    'user_id'         => 1,
    'description'     => 'Pimp checkout',
    'permissions'     => 'read_write',
    'consumer_key'    => \$key_hash,
    'consumer_secret' => '${PIMP_CS}',
    'truncated_key'   => substr('${PIMP_CK}', -7),
]);
"

  wp --allow-root option update pimp_demo_ready 1
  echo "[init:$SLUG] heavy seed complete."
fi

# ---------------------------------------------------------------------------
# Stage 2: idempotent fixups — always run on container start, safe to repeat.
# ---------------------------------------------------------------------------

# Pretty permalinks: /product/{slug}/, /shop/, /cart/, /my-account/.
# Required for /wp-json/wc/v3/* to resolve too.
wp --allow-root rewrite structure '/%postname%/' --hard >/dev/null 2>&1 || true

# Make sure the WC pages exist (recreate if dropped). Idempotent.
wp --allow-root wc --user=admin tool run install_pages >/dev/null 2>&1 || true

# Force a classic theme. Block themes (twentytwentyfour, etc.) ship a
# front-page.html template that takes precedence over `page_on_front`, so
# setting the WC Shop page as the home page silently does nothing. The
# classic theme twentytwentyone is bundled with WP and renders the
# configured page_on_front normally; WC then overrides with the product
# archive via template_redirect.
wp --allow-root theme activate twentytwentyone >/dev/null 2>&1 \
  || wp --allow-root theme install twentytwentyone --activate >/dev/null 2>&1 \
  || wp --allow-root theme install twentytwentyone --activate --insecure >/dev/null 2>&1 \
  || true

# Set the WooCommerce Shop page as the home page.
SHOP_PAGE_ID=$(wp --allow-root option get woocommerce_shop_page_id 2>/dev/null || echo "")
case "$SHOP_PAGE_ID" in
  ''|*[!0-9]*) SHOP_PAGE_ID=0 ;;
esac
if [ "$SHOP_PAGE_ID" -gt 0 ] 2>/dev/null; then
  wp --allow-root option update show_on_front page
  wp --allow-root option update page_on_front "$SHOP_PAGE_ID"
fi

# Primary menu (Shop / Cart / My account). Classic theme only.
if ! wp --allow-root menu list --fields=name 2>/dev/null | grep -q '^Pimp$'; then
  wp --allow-root menu create "Pimp" >/dev/null 2>&1 || true
fi
CART_PAGE_ID=$(wp --allow-root option get woocommerce_cart_page_id 2>/dev/null || echo 0)
ACCOUNT_PAGE_ID=$(wp --allow-root option get woocommerce_myaccount_page_id 2>/dev/null || echo 0)
[ "$SHOP_PAGE_ID"    -gt 0 ] 2>/dev/null && wp --allow-root menu item add-post Pimp "$SHOP_PAGE_ID"    --title="Boutique"   >/dev/null 2>&1 || true
[ "$CART_PAGE_ID"    -gt 0 ] 2>/dev/null && wp --allow-root menu item add-post Pimp "$CART_PAGE_ID"    --title="Panier"     >/dev/null 2>&1 || true
[ "$ACCOUNT_PAGE_ID" -gt 0 ] 2>/dev/null && wp --allow-root menu item add-post Pimp "$ACCOUNT_PAGE_ID" --title="Mon compte" >/dev/null 2>&1 || true
wp --allow-root menu location assign Pimp primary >/dev/null 2>&1 || true

echo "[init:$SLUG] ready. Boutique: http://${SLUG}.localhost  ·  Admin: http://${SLUG}.localhost/wp-admin (admin / admin)"
