<?php
/**
 * Plugin Name: Kapyo Cart
 * Description: Bouton "Ajouter à mon panier Kapyo", S2S sync vers Kapyo et REST endpoints Kapyo -> shop.
 * Version: 0.2.0
 * Requires Plugins: woocommerce
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/includes/class-kapyo-storage.php';
require_once __DIR__ . '/includes/class-kapyo-rest.php';

final class Kapyo_Cart_Plugin {

    public static function boot(): void {
        register_activation_hook(__FILE__, [Kapyo_Storage::class, 'install']);
        register_activation_hook(__FILE__, [__CLASS__, 'flush_rewrites']);
        // Also run on every load (cheap CREATE TABLE IF NOT EXISTS) so the
        // demo init flow that auto-activates the plugin gets the table.
        add_action('plugins_loaded', [Kapyo_Storage::class, 'install']);

        // Auth0 callback endpoint: /auth/callback
        add_action('init', [__CLASS__, 'register_auth_rewrite']);
        add_filter('query_vars', [__CLASS__, 'add_query_vars']);
        add_action('template_redirect', [__CLASS__, 'handle_auth_callback']);

        add_action('woocommerce_after_add_to_cart_button', [__CLASS__, 'render_button']);
        add_action('wp_enqueue_scripts', [__CLASS__, 'enqueue']);

        // Filtered product hooks: we only push when the product is currently
        // referenced by an active KAPYO cart (cf. spec: filter SQL table).
        add_action('woocommerce_update_product', [__CLASS__, 'on_product_updated'], 20, 1);
        add_action('wp_trash_post',              [__CLASS__, 'on_post_trashed'], 20, 1);
        add_action('before_delete_post',         [__CLASS__, 'on_post_deleted'], 20, 1);

        // Order tracking (status changes) -> Kapyo.
        add_action('woocommerce_order_status_changed', [__CLASS__, 'on_order_status_changed'], 20, 4);

        // AJAX endpoint that signs the actual quantity + variation chosen by the
        // user at click time (avoids stale render-time signatures and lets the
        // signed payload carry the quantity input + variation_id).
        add_action('wp_ajax_kapyo_sign_add_to_cart',        [__CLASS__, 'ajax_sign']);
        add_action('wp_ajax_nopriv_kapyo_sign_add_to_cart', [__CLASS__, 'ajax_sign']);

        Kapyo_REST::boot();
    }

    public static function register_auth_rewrite(): void {
        add_rewrite_rule('^auth/callback/?$', 'index.php?kapyo_auth_callback=1', 'top');
    }

    public static function add_query_vars(array $vars): array {
        $vars[] = 'kapyo_auth_callback';
        return $vars;
    }

    public static function flush_rewrites(): void {
        self::register_auth_rewrite();
        flush_rewrite_rules();
    }

    /**
     * Serve a minimal Auth0 callback page at /auth/callback.
     * Handles the code exchange then redirects to appState.returnTo (the product page).
     */
    public static function handle_auth_callback(): void {
        if (!get_query_var('kapyo_auth_callback')) {
            return;
        }
        $c = self::constants();
        $domain    = esc_js($c['auth0_domain']);
        $client_id = esc_js($c['auth0_client']);
        $audience  = esc_js($c['auth0_aud']);
        $redirect  = esc_js(home_url('/auth/callback'));
        ?>
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><title>Connexion Kapyo…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#6b7280}</style>
</head>
<body><p>Connexion en cours…</p>
<script src="https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js"></script>
<script>
(async () => {
  try {
    const client = await window.auth0.createAuth0Client({
      domain: '<?php echo $domain; ?>',
      clientId: '<?php echo $client_id; ?>',
      authorizationParams: { redirect_uri: '<?php echo $redirect; ?>', audience: '<?php echo $audience; ?>' },
      cacheLocation: 'localstorage',
      useRefreshTokens: true,
    });
    const { appState } = await client.handleRedirectCallback();
    window.location.replace((appState && appState.returnTo) || '/');
  } catch (e) {
    console.error('[kapyo-cart] auth callback error', e);
    window.location.replace('/');
  }
})();
</script>
</body></html>
        <?php
        exit;
    }

    private static function constants(): array {
        return [
            'api_url'      => defined('KAPYO_API_URL') ? KAPYO_API_URL : '',
            'site_id'      => defined('KAPYO_SITE_ID') ? KAPYO_SITE_ID : '',
            'site_key'     => defined('KAPYO_SITE_KEY') ? KAPYO_SITE_KEY : '',
            'auth0_domain' => defined('KAPYO_AUTH0_DOMAIN') ? KAPYO_AUTH0_DOMAIN : '',
            'auth0_client' => defined('KAPYO_AUTH0_CLIENT_ID') ? KAPYO_AUTH0_CLIENT_ID : '',
            'auth0_aud'    => defined('KAPYO_AUTH0_AUDIENCE') ? KAPYO_AUTH0_AUDIENCE : '',
        ];
    }

    public static function render_button(): void {
        if (!is_product()) {
            return;
        }
        global $product;
        if (!$product instanceof WC_Product) {
            return;
        }

        $c = self::constants();
        if (!$c['api_url'] || !$c['site_id'] || !$c['site_key']) {
            return;
        }

        // The button only carries the product_id; quantity and variation are
        // read from the page at click time and signed via AJAX.
        // Classes mirror WC's own single product button so the theme sizes them identically.
        // kapyo-add-to-cart is kept for JS targeting and CSS overrides.
        $product_id = (string) $product->get_id();
        ?>
        <button
            type="button"
            class="kapyo-add-to-cart single_add_to_cart_button button alt wp-element-button"
            data-product-id="<?php echo esc_attr($product_id); ?>">
            Ajouter à Kapyo
        </button>
        <span class="kapyo-status" aria-live="polite"></span>
        <?php
    }

    public static function ajax_sign(): void {
        $c = self::constants();
        if (!$c['site_id'] || !$c['site_key']) {
            wp_send_json_error(['message' => 'Plugin not configured'], 500);
        }
        $product_id = isset($_POST['product_id']) ? (int) $_POST['product_id'] : 0;
        $variation_id = isset($_POST['variation_id']) ? (int) $_POST['variation_id'] : 0;
        $quantity = isset($_POST['quantity']) ? max(1, min(99, (int) $_POST['quantity'])) : 1;

        $product = wc_get_product($variation_id > 0 ? $variation_id : $product_id);
        if (!$product instanceof WC_Product) {
            wp_send_json_error(['message' => 'Unknown product'], 404);
        }
        if (!$product->is_purchasable() || !$product->is_in_stock()) {
            wp_send_json_error(['message' => 'Produit indisponible'], 409);
        }

        // For variations, get_id() returns the variation id; we want both.
        $effective_pid = $variation_id > 0 ? (string) $variation_id : (string) $product_id;
        $variation_label = '';
        if ($variation_id > 0 && method_exists($product, 'get_attribute_summary')) {
            $variation_label = wc_get_formatted_variation($product, true);
        }

        $image_id = $product->get_image_id();
        if (!$image_id && $product->get_parent_id()) {
            $parent = wc_get_product($product->get_parent_id());
            $image_id = $parent ? $parent->get_image_id() : 0;
        }
        $image_url = $image_id ? wp_get_attachment_image_url($image_id, 'medium') : '';

        $timestamp = time();
        $variation_for_sig = $variation_id > 0 ? (string) $variation_id : '0';
        $msg = "{$c['site_id']}.{$timestamp}.{$product_id}.{$variation_for_sig}.{$quantity}";
        $signature = hash_hmac('sha256', $msg, $c['site_key']);

        wp_send_json_success([
            'product_id'      => (string) $product_id,
            'variation_id'    => $variation_id > 0 ? (string) $variation_id : null,
            'variation_label' => $variation_label ?: null,
            'product_name'    => $product->get_name(),
            'product_url'     => get_permalink($variation_id > 0 ? $product->get_parent_id() : $product_id),
            'image_url'       => $image_url ?: null,
            'price'           => (float) $product->get_price(),
            'currency'        => get_woocommerce_currency(),
            'quantity'        => $quantity,
            'site_id'         => $c['site_id'],
            'site_timestamp'  => $timestamp,
            'site_signature'  => $signature,
        ]);
    }

    public static function enqueue(): void {
        if (!is_product()) {
            return;
        }
        $c = self::constants();
        wp_register_script(
            'auth0-spa-js',
            'https://cdn.auth0.com/js/auth0-spa-js/2.1/auth0-spa-js.production.js',
            [],
            '2.1',
            true,
        );
        wp_register_script(
            'kapyo-cart',
            plugins_url('assets/kapyo-cart.js', __FILE__),
            ['auth0-spa-js'],
            (string) filemtime(__DIR__ . '/assets/kapyo-cart.js'),
            true,
        );
        wp_register_style('kapyo-cart', plugins_url('assets/kapyo-cart.css', __FILE__), [], (string) filemtime(__DIR__ . '/assets/kapyo-cart.css'));

        wp_localize_script('kapyo-cart', 'KAPYO_CART_CFG', [
            'apiUrl'       => $c['api_url'],
            'ajaxUrl'      => admin_url('admin-ajax.php'),
            'siteId'       => $c['site_id'],
            'kapyoUrl'      => 'http://kapyo.localhost',
            'auth0Domain'  => $c['auth0_domain'],
            'auth0Client'  => $c['auth0_client'],
            'auth0Audience'=> $c['auth0_aud'],
            'redirectUri'  => home_url('/'),
        ]);

        wp_enqueue_script('kapyo-cart');
        wp_enqueue_style('kapyo-cart');
    }

    public static function on_product_updated($product_id): void {
        // Only forward changes for products KAPYO is actively tracking.
        if (!Kapyo_Storage::is_active((int) $product_id)) {
            return;
        }
        $product = wc_get_product((int) $product_id);
        if (!$product instanceof WC_Product) {
            return;
        }
        $image_id  = $product->get_image_id();
        $image_url = $image_id ? wp_get_attachment_image_url($image_id, 'medium') : null;

        self::send_product_webhook('updated', (string) $product->get_id(), [
            'product_name' => $product->get_name(),
            'product_url'  => get_permalink($product->get_id()),
            'image_url'    => $image_url ?: null,
            'price'        => (float) $product->get_price(),
            'currency'     => get_woocommerce_currency(),
        ]);
    }

    public static function on_post_trashed($post_id): void {
        if (get_post_type($post_id) !== 'product') return;
        if (!Kapyo_Storage::is_active((int) $post_id)) return;
        self::send_product_webhook('deleted', (string) $post_id, []);
    }

    public static function on_post_deleted($post_id): void {
        if (get_post_type($post_id) !== 'product') return;
        if (!Kapyo_Storage::is_active((int) $post_id)) return;
        self::send_product_webhook('deleted', (string) $post_id, []);
    }

    public static function on_order_status_changed($order_id, $old_status, $new_status, $order): void {
        $c = self::constants();
        if (!$c['api_url'] || !$c['site_id'] || !$c['site_key']) {
            return;
        }
        $woo_order = $order instanceof WC_Order ? $order : wc_get_order($order_id);
        $tracking_number = '';
        $tracking_url = '';
        if ($woo_order) {
            // Common metadata used by shipment tracking plugins.
            $tracking_number = (string) $woo_order->get_meta('_tracking_number');
            $tracking_url = (string) $woo_order->get_meta('_tracking_url');
        }

        $timestamp = time();
        $signature = hash_hmac(
            'sha256',
            "{$c['site_id']}.{$timestamp}.order_status.{$order_id}.{$new_status}",
            $c['site_key'],
        );
        $body = [
            'event'           => 'order_status',
            'site_id'         => $c['site_id'],
            'site_timestamp'  => $timestamp,
            'site_signature'  => $signature,
            'order_id'        => (int) $order_id,
            'old_status'      => (string) $old_status,
            'new_status'      => (string) $new_status,
            'tracking_number' => $tracking_number ?: null,
            'tracking_url'    => $tracking_url ?: null,
        ];
        wp_remote_post($c['api_url'] . '/api/webhooks/order', [
            'method'   => 'POST',
            'timeout'  => 2,
            'blocking' => false,
            'headers'  => ['Content-Type' => 'application/json'],
            'body'     => wp_json_encode($body),
        ]);
    }

    private static function send_product_webhook(string $event, string $product_id, array $extra): void {
        $c = self::constants();
        if (!$c['api_url'] || !$c['site_id'] || !$c['site_key']) {
            return;
        }
        $timestamp = time();
        $signature = hash_hmac(
            'sha256',
            "{$c['site_id']}.{$timestamp}.{$event}.{$product_id}",
            $c['site_key'],
        );
        $body = array_merge($extra, [
            'event'          => $event,
            'product_id'     => $product_id,
            'site_id'        => $c['site_id'],
            'site_timestamp' => $timestamp,
            'site_signature' => $signature,
        ]);

        wp_remote_post($c['api_url'] . '/api/webhooks/product', [
            'method'   => 'POST',
            'timeout'  => 2,
            'blocking' => false,
            'headers'  => ['Content-Type' => 'application/json'],
            'body'     => wp_json_encode($body),
        ]);
    }
}

Kapyo_Cart_Plugin::boot();
