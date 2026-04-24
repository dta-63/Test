<?php
/**
 * Plugin Name: Pimp Cart
 * Description: Ajoute un bouton "Ajouter à mon panier Pimp" sur les pages produit WooCommerce.
 * Version: 0.1.0
 * Requires Plugins: woocommerce
 */

if (!defined('ABSPATH')) {
    exit;
}

final class Pimp_Cart_Plugin {

    public static function boot(): void {
        add_action('woocommerce_after_add_to_cart_button', [__CLASS__, 'render_button']);
        add_action('wp_enqueue_scripts', [__CLASS__, 'enqueue']);
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
            '0.1.0',
            true,
        );
        wp_register_style('pimp-cart', plugins_url('assets/pimp-cart.css', __FILE__), [], '0.1.0');

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
}

Pimp_Cart_Plugin::boot();
