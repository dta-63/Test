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

# Idempotency guard for the rest of the setup.
if wp --allow-root option get pimp_demo_ready 2>/dev/null | grep -q 1; then
  echo "[init:$SLUG] already initialised, skipping."
  exit 0
fi

echo "[init:$SLUG] installing WooCommerce..."
wp --allow-root plugin install woocommerce --activate
wp --allow-root plugin activate pimp-cart || true

# Skip Woo setup wizard and seed store.
wp --allow-root option update woocommerce_store_address "1 rue de la Démo"
wp --allow-root option update woocommerce_store_city "Paris"
wp --allow-root option update woocommerce_default_country "FR"
wp --allow-root option update woocommerce_currency "EUR"
wp --allow-root option update woocommerce_onboarding_profile '{"completed":true}' --format=json || true
wp --allow-root option update woocommerce_task_list_hidden yes
wp --allow-root transient delete _wc_activation_redirect || true

# Shop / Cart / Checkout pages
wp --allow-root wc --user=admin tool run install_pages 2>/dev/null || true

echo "[init:$SLUG] seeding products for catalog: $CATALOG"
if [ "$CATALOG" = "fashion" ]; then
  wp --allow-root wc --user=admin product create --name="Veste en jean" --type=simple --regular_price=89.00 --description="Coupe droite, denim bleu, indémodable."
  wp --allow-root wc --user=admin product create --name="T-shirt graphique" --type=simple --regular_price=29.00 --description="Coton bio, imprimé exclusif."
  wp --allow-root wc --user=admin product create --name="Sneakers blanches" --type=simple --regular_price=119.00 --description="Minimalistes, cuir pleine fleur."
  wp --allow-root wc --user=admin product create --name="Sac en toile" --type=simple --regular_price=49.00 --description="Tote bag grand format, lin recyclé."
  wp --allow-root wc --user=admin product create --name="Écharpe laine" --type=simple --regular_price=39.00 --description="Laine mérinos, teinte tabac."
else
  wp --allow-root wc --user=admin product create --name="Casque audio sans fil" --type=simple --regular_price=199.00 --description="Réduction de bruit active, 30h d'autonomie."
  wp --allow-root wc --user=admin product create --name="Clavier mécanique 75%" --type=simple --regular_price=149.00 --description="Switches linéaires, rétroéclairage RGB."
  wp --allow-root wc --user=admin product create --name="Souris ergonomique" --type=simple --regular_price=79.00 --description="Capteur 8000 DPI, molette horizontale."
  wp --allow-root wc --user=admin product create --name="Moniteur 27\" 4K" --type=simple --regular_price=499.00 --description="Dalle IPS, USB-C 90W."
  wp --allow-root wc --user=admin product create --name="Webcam 1080p" --type=simple --regular_price=89.00 --description="Autofocus, micro stéréo intégré."
fi

# Per-site styling via Customizer + custom CSS mirroring accent colour.
CSS=".site-header, .woocommerce-store-notice { background: ${ACCENT} !important; color: #fff !important; }
a.button, button.button, .woocommerce a.button, .woocommerce button.button.alt, .woocommerce #respond input#submit.alt { background: ${ACCENT} !important; color: #fff !important; }
.woocommerce-product-gallery { border: 2px solid ${ACCENT}; padding: 4px; }
.price { color: ${ACCENT} !important; font-weight: 700 !important; }
body { font-family: $( [ "$CATALOG" = "fashion" ] && echo 'Georgia, serif' || echo 'system-ui, sans-serif' ); }"

wp --allow-root theme activate twentytwentyfour || true
wp --allow-root option update blogname "$TITLE"
wp --allow-root option update blogdescription "Démo e-commerce ($CATALOG) connectée à Pimp"

# Store the CSS in an option consumed by the mu-plugin.
wp --allow-root option update pimp_site_accent "$ACCENT"
wp --allow-root option update pimp_site_custom_css "$CSS"

# Seed a WooCommerce REST API key used by Pimp to create orders on this site.
# WC stores consumer_key hashed via hash_hmac('sha256', $key, 'wc-api') and
# consumer_secret in clear (it's a shared secret, not a password).
# We insert a fixed key so the Pimp backend can authenticate deterministically.
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

# Pretty permalinks are required for /wp-json/wc/v3/* to work.
wp --allow-root rewrite structure '/%postname%/' --hard

wp --allow-root option update pimp_demo_ready 1

echo "[init:$SLUG] done. Admin: http://${SLUG}.localhost/wp-admin (admin / admin)"
