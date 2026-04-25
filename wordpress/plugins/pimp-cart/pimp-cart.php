<?php
/**
 * Plugin Name: Pimp Cart
 * Description: Bouton "Ajouter à mon panier Pimp", S2S sync vers Pimp et REST endpoints Pimp -> shop.
 * Version: 0.2.0
 * Requires Plugins: woocommerce
 */

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/includes/class-pimp-storage.php';
require_once __DIR__ . '/includes/class-pimp-rest.php';

final class Pimp_Cart_Plugin {

    public static function boot(): void {
        register_activation_hook(__FILE__, [Pimp_Storage::class, 'install']);
        // Also run on every load (cheap CREATE TABLE IF NOT EXISTS) so the
        // demo init flow that auto-activates the plugin gets the table.
        add_action('plugins_loaded', [Pimp_Storage::class, 'install']);

        add_action('woocommerce_after_add_to_cart_button', [__CLASS__, 'render_button']);
        add_action('wp_enqueue_scripts', [__CLASS__, 'enqueue']);

        // Filtered product hooks: we only push when the product is currently
        // referenced by an active PIMP cart (cf. spec: filter SQL table).
        add_action('woocommerce_update_product', [__CLASS__, 'on_product_updated'], 20, 1);
        add_action('wp_trash_post',              [__CLASS__, 'on_post_trashed'], 20, 1);
        add_action('before_delete_post',         [__CLASS__, 'on_post_deleted'], 20, 1);

        // Order tracking (status changes) -> Pimp.
        add_action('woocommerce_order_status_changed', [__CLASS__, 'on_order_status_changed'], 20, 4);

        Pimp_REST::boot();
    }

    private static function constants(): array {
        return [
            'api_url'      => defined('PIMP_API_URL') ? PIMP_API_URL : '',
            'site_id'      => defined('PIMP_SITE_ID') ? PIMP_SITE_ID : '',
            'site_key'     => defined('PIMP_SITE_KEY') ? PIMP_SITE_KEY : '',
            'auth0_domain' => defined('PIMP_AUTH0_DOMAIN') ? PIMP_AUTH0_DOMAIN : '',
            'auth0_client' => defined('PIMP_AUTH0_CLIENT_ID') ? PIMP_AUTH0_CLIENT_ID : '',
            'auth0_aud'    => defined('PIMP_AUTH0_AUDIENCE') ? PIMP_AUTH0_AUDIENCE : '',
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

        $timestamp = time();
        $product_id = (string) $product->get_id();
        $signature  = hash_hmac('sha256', "{$c['site_id']}.{$timestamp}.{$product_id}", $c['site_key']);

        $image_id  = $product->get_image_id();
        $image_url = $image_id ? wp_get_attachment_image_url($image_id, 'medium') : '';

        $payload = [
            'product_id'     => $product_id,
            'product_name'   => $product->get_name(),
            'product_url'    => get_permalink($product->get_id()),
            'image_url'      => $image_url ?: null,
            'price'          => (float) $product->get_price(),
            'currency'       => get_woocommerce_currency(),
            'quantity'       => 1,
            'site_id'        => $c['site_id'],
            'site_timestamp' => $timestamp,
            'site_signature' => $signature,
        ];
        ?>
        <button
            type="button"
            class="pimp-add-to-cart button alt"
            data-payload='<?php echo esc_attr(wp_json_encode($payload)); ?>'>
            Ajouter à mon panier Pimp
        </button>
        <span class="pimp-status" aria-live="polite"></span>
        <?php
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
            'pimp-cart',
            plugins_url('assets/pimp-cart.js', __FILE__),
            ['auth0-spa-js'],
            '0.2.0',
            true,
        );
        wp_register_style('pimp-cart', plugins_url('assets/pimp-cart.css', __FILE__), [], '0.2.0');

        wp_localize_script('pimp-cart', 'PIMP_CART_CFG', [
            'apiUrl'       => $c['api_url'],
            'auth0Domain'  => $c['auth0_domain'],
            'auth0Client'  => $c['auth0_client'],
            'auth0Audience'=> $c['auth0_aud'],
            'redirectUri'  => home_url('/'),
        ]);

        wp_enqueue_script('pimp-cart');
        wp_enqueue_style('pimp-cart');
    }

    public static function on_product_updated($product_id): void {
        // Only forward changes for products PIMP is actively tracking.
        if (!Pimp_Storage::is_active((int) $product_id)) {
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
        if (!Pimp_Storage::is_active((int) $post_id)) return;
        self::send_product_webhook('deleted', (string) $post_id, []);
    }

    public static function on_post_deleted($post_id): void {
        if (get_post_type($post_id) !== 'product') return;
        if (!Pimp_Storage::is_active((int) $post_id)) return;
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

Pimp_Cart_Plugin::boot();
