#!/bin/sh
# Usage: setup.sh <site-slug> <site-title> <accent-color-hex> <catalog: fashion-a|fashion-b>
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

# Set locale to French (install language pack if needed, curl fallback for corp SSL).
wp --allow-root option update WPLANG fr_FR 2>/dev/null || true
if ! wp --allow-root language core is-installed fr_FR 2>/dev/null; then
  wp --allow-root language core install fr_FR 2>/dev/null \
    || wp --allow-root language core install fr_FR --allow-root 2>/dev/null \
    || true
fi
wp --allow-root site switch-language fr_FR 2>/dev/null || true
if wp --allow-root plugin is-active woocommerce 2>/dev/null; then
  wp --allow-root language plugin install woocommerce fr_FR 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Self-heal WordPress core when the image is bumped past the persisted volume.
# Volumes outlive image upgrades (the wordpress image's docker-entrypoint
# refuses to overwrite an existing wp-includes), so a fresh `wordpress:6.8`
# image still serves files from a `wordpress:6.6` volume. WooCommerce 9.x
# refuses to install on WP < 6.8, hence this step.
# ---------------------------------------------------------------------------
WP_VER=$(wp --allow-root core version 2>/dev/null | awk -F. '{printf "%d%02d%02d", $1, $2, $3}')
if [ "${WP_VER:-0}" -lt 60800 ] 2>/dev/null; then
  echo "[init:$SLUG] WP files on volume are $(wp --allow-root core version 2>/dev/null) — upgrading core..."
  wp --allow-root core update --insecure 2>/dev/null \
    || wp --allow-root core update 2>/dev/null \
    || echo "[init:$SLUG] !!! WP core update failed; check network/proxy" >&2
  wp --allow-root core update-db 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Inject Pimp constants into wp-config.php if missing.
# WORDPRESS_CONFIG_EXTRA is only written by the apache image's docker-entrypoint
# on first volume initialisation — it is silently skipped when the volume already
# exists. We patch wp-config.php directly so the plugin always finds its constants.
# ---------------------------------------------------------------------------
if ! grep -q 'PIMP_API_URL' /var/www/html/wp-config.php 2>/dev/null; then
  echo "[init:$SLUG] injecting Pimp constants into wp-config.php..."
  SITE_KEY="${PIMP_WC_CONSUMER_KEY:-${SLUG}-secret}"
  sed -i "s|/\* That's all|define('PIMP_API_URL', 'http://api.pimp.localhost');\ndefine('PIMP_SITE_ID', '${SLUG}');\ndefine('PIMP_SITE_KEY', '${SITE_KEY}');\n/* That's all|" /var/www/html/wp-config.php
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Install a plugin from wordpress.org with a curl -k fallback that bypasses
# corporate SSL inspection (WP-CLI's --insecure flag is not always sufficient).
install_plugin_from_org() {
  slug="$1"
  if wp --allow-root plugin is-installed "$slug" 2>/dev/null; then return 0; fi
  echo "[init:$SLUG] downloading plugin '$slug' from wordpress.org..."

  # Try the standard install first.
  if wp --allow-root plugin install "$slug" 2>/dev/null; then return 0; fi

  # Fallback: download via curl (ignores SSL) then install from local zip.
  echo "[init:$SLUG] standard download failed; using curl -k fallback..."
  TMPZIP="/tmp/${slug}.zip"
  if curl -skL "https://downloads.wordpress.org/plugin/${slug}.zip" -o "$TMPZIP" \
      && [ -s "$TMPZIP" ]; then
    if wp --allow-root plugin install "$TMPZIP" 2>/dev/null; then
      rm -f "$TMPZIP"
      return 0
    fi
  fi

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
# Reset the flag if products are missing (e.g. previous run failed mid-seed).
# ---------------------------------------------------------------------------
PRODUCT_COUNT=$(wp --allow-root post list --post_type=product --post_status=publish --format=count 2>/dev/null || echo 0)
if [ "${PRODUCT_COUNT:-0}" -eq 0 ] && [ "$(wp --allow-root option get pimp_demo_ready 2>/dev/null)" = "1" ]; then
  echo "[init:$SLUG] pimp_demo_ready=1 but no products found — resetting for re-seed."
  wp --allow-root option delete pimp_demo_ready 2>/dev/null || true
fi

if [ "$(wp --allow-root option get pimp_demo_ready 2>/dev/null)" != "1" ]; then
  # Skip Woo setup wizard and seed store.
  wp --allow-root option update woocommerce_store_address "1 rue de la Démo"
  wp --allow-root option update woocommerce_store_city "Paris"
  wp --allow-root option update woocommerce_default_country "FR"
  wp --allow-root option update woocommerce_currency "EUR"
  wp --allow-root option update woocommerce_onboarding_profile '{"completed":true}' --format=json || true
  wp --allow-root option update woocommerce_task_list_hidden yes
  wp --allow-root transient delete _wc_activation_redirect || true

  # Créer les pages WC fonctionnelles (Cart/Checkout/MyAccount/Shop)
  wp --allow-root wc --user=admin tool run install_pages 2>/dev/null || true

  # Masquer Cart, Checkout, My Account du menu et des listings
  for PAGE_SLUG in cart checkout my-account; do
    PAGE_ID=$(wp --allow-root post list --post_type=page --name="$PAGE_SLUG" --field=ID 2>/dev/null | head -1 || echo "")
    if [ -n "$PAGE_ID" ] && [ "$PAGE_ID" -gt 0 ] 2>/dev/null; then
      wp --allow-root post meta update "$PAGE_ID" _wp_page_exclude_from_list 1 >/dev/null 2>&1 || true
    fi
  done

  echo "[init:$SLUG] seeding products for catalog: $CATALOG"
  if [ "$CATALOG" = "fashion-a" ]; then
    # Maison Lumière — womenswear & accessoires
    wp --allow-root wc --user=admin product create --name="Robe midi fleurie"       --type=simple --regular_price=95.00  --description="Tissu léger viscose, imprimé fleuri printemps-été."           --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Blazer oversized lin"    --type=simple --regular_price=135.00 --description="Coupe ample, lin naturel non traité, col cranté."              --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Chemisier en soie"       --type=simple --regular_price=79.00  --description="Soie lavable, col V, coloris ivoire."                      --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Jupe portefeuille"       --type=simple --regular_price=65.00  --description="Taille haute, imprimé léopard discret."                   --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Sac baguette cuir"       --type=simple --regular_price=189.00 --description="Cuir grainé, bandoulière amovible, fermoir doré."            --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Mules à talons"          --type=simple --regular_price=110.00 --description="Daim nude, talon carré 6 cm, bout carré."                  --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Trench camel"            --type=simple --regular_price=220.00 --description="Coton gabardine, ceinturé, double boutonnage."              --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Pull col roulé cachemire" --type=simple --regular_price=145.00 --description="80% cachemire, col roulé, coloris crème."                 --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Pantalon tailleur"        --type=simple --regular_price=98.00  --description="Coupe cigarette, tissu crêpe, coloris noir."              --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Bottines chelsea"         --type=simple --regular_price=165.00 --description="Cuir pleine fleur, élastiques côtelés, semelle crêpe."    --status=publish --catalog_visibility=visible --manage_stock=false
  else
    # Urban Drop — streetwear & sneakers
    wp --allow-root wc --user=admin product create --name="Hoodie oversize"          --type=simple --regular_price=89.00  --description="Molleton 380 g/m², broderie chest logo, coloris charbon."  --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Cargo pants beige"        --type=simple --regular_price=119.00 --description="Coton ripstop, 8 poches, fit tapered, beige sable."        --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Tee oversized wash"       --type=simple --regular_price=45.00  --description="Coton 240 g/m², effet used, sérigraphie vintage."         --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Sneakers low retro"       --type=simple --regular_price=149.00 --description="Cuir synthétique, semelle vulcanisée, coloris blanc/gum." --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Bucket hat brodé"         --type=simple --regular_price=39.00  --description="Coton non traité, logo brodé face, coloris noir."         --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Bomber satin"             --type=simple --regular_price=175.00 --description="Satin polyester, doublure contrastée, patch dos."          --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Jogger tech fleece"       --type=simple --regular_price=79.00  --description="Polyester technique, taille élastique, coupe slim."       --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Veste coach nylon"        --type=simple --regular_price=129.00 --description="Nylon ripstop, poches zippées, col officier."             --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Shorts cargo"             --type=simple --regular_price=65.00  --description="Coton brossé, longueur mi-cuisse, 6 poches, kaki."       --status=publish --catalog_visibility=visible --manage_stock=false
    wp --allow-root wc --user=admin product create --name="Casquette 6 panneaux"     --type=simple --regular_price=35.00  --description="Twill coton, logo brodé, réglable Strapback."           --status=publish --catalog_visibility=visible --manage_stock=false
  fi

  CSS=".woocommerce-store-notice { display: none !important; }
.price { color: ${ACCENT} !important; font-weight: 700; }
.woocommerce a.button.alt, .woocommerce button.button.alt, .woocommerce input.button.alt,
.woocommerce #respond input#submit.alt { background-color: ${ACCENT} !important; }"

  # Supprimer la Sample Page par défaut de WordPress
  SAMPLE_ID=$(wp --allow-root post list --post_type=page --post_status=publish --name='sample-page' --field=ID 2>/dev/null | head -1 || echo "")
  [ -n "$SAMPLE_ID" ] && wp --allow-root post delete "$SAMPLE_ID" --force >/dev/null 2>&1 || true

  wp --allow-root option update blogname "$TITLE"
  wp --allow-root option update blogdescription "Mode & Style"
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
# Write the .htaccess directly — wp rewrite flush --hard runs as the cli user
# who may not have write permission on the Apache-owned volume in all setups.
HTACCESS=/var/www/html/.htaccess
if ! grep -q 'RewriteEngine' "$HTACCESS" 2>/dev/null; then
  printf '# BEGIN WordPress\n<IfModule mod_rewrite.c>\nRewriteEngine On\nRewriteBase /\nRewriteRule ^index\\.php$ - [L]\nRewriteCond %%{REQUEST_FILENAME} !-f\nRewriteCond %%{REQUEST_FILENAME} !-d\nRewriteRule . /index.php [L]\n</IfModule>\n# END WordPress\n' > "$HTACCESS"
  echo "[init:$SLUG] .htaccess written."
fi
wp --allow-root rewrite structure '/%postname%/' 2>/dev/null || true

# Make sure the WC pages exist (recreate if dropped). Idempotent.
wp --allow-root wc --user=admin tool run install_pages >/dev/null 2>&1 || true

# With block themes (twentytwentyfour), WooCommerce registers an archive-product
# template and hooks template_redirect so the shop page renders the product archive.
# Set it as the front page so the homepage shows the boutique.
SHOP_PAGE_ID=$(wp --allow-root option get woocommerce_shop_page_id 2>/dev/null || echo 0)
case "$SHOP_PAGE_ID" in ''|*[!0-9]*) SHOP_PAGE_ID=0 ;; esac
if [ "$SHOP_PAGE_ID" -gt 0 ] 2>/dev/null; then
  wp --allow-root option update show_on_front page
  wp --allow-root option update page_on_front "$SHOP_PAGE_ID"
fi

# Disable WooCommerce "Coming Soon" mode — WC 9.4+ enables it by default on new installs.
wp --allow-root option update woocommerce_coming_soon no 2>/dev/null || true
wp --allow-root option update woocommerce_store_pages_only no 2>/dev/null || true

# Block themes store navigation in a wp_navigation post — wp_nav_menu() is unused.
# Rebuild the navigation to contain only the Boutique link and strip out the
# WooCommerce pages (Cart, Checkout, My Account) that WC auto-inserts.
wp --allow-root eval "
\$navs = get_posts(['post_type' => 'wp_navigation', 'posts_per_page' => -1, 'post_status' => ['publish','draft']]);
\$shop_id  = (int) get_option('woocommerce_shop_page_id');
\$shop_url = \$shop_id ? get_permalink(\$shop_id) : '/shop/';
\$block = '<!-- wp:navigation-link {\"label\":\"Boutique\",\"url\":\"' . esc_url(\$shop_url) . '\",\"title\":\"Boutique\",\"kind\":\"post-type\",\"isTopLevelLink\":true} /-->';
if (\$navs) {
    foreach (\$navs as \$nav) {
        wp_update_post(['ID' => \$nav->ID, 'post_content' => \$block, 'post_status' => 'publish']);
    }
} else {
    wp_insert_post(['post_type' => 'wp_navigation', 'post_title' => 'Navigation', 'post_content' => \$block, 'post_status' => 'publish']);
}
echo 'Navigation updated.' . PHP_EOL;
" 2>/dev/null || true

echo "[init:$SLUG] ready. Boutique: http://${SLUG}.localhost  ·  Admin: http://${SLUG}.localhost/wp-admin (admin / admin)"
