<?php
/**
 * REST endpoints exposed under /wp-json/pimp/v1.
 *
 * Auth: HMAC-SHA256 of `{timestamp}\n{method}\n{path}\n{sha256(body)}` with
 * the shared site key (PIMP_SITE_KEY). This is the Pimp -> shop direction
 * of the bidirectional S2S authentication described in the spec.
 */

if (!defined('ABSPATH')) { exit; }

final class Pimp_REST {

    public static function boot(): void {
        add_action('rest_api_init', [__CLASS__, 'register']);
    }

    public static function register(): void {
        register_rest_route('pimp/v1', '/active-products', [
            'methods'             => 'POST',
            'permission_callback' => [__CLASS__, 'verify'],
            'callback'            => [__CLASS__, 'active_products'],
        ]);

        register_rest_route('pimp/v1', '/cart/preview', [
            'methods'             => 'POST',
            'permission_callback' => [__CLASS__, 'verify'],
            'callback'            => [__CLASS__, 'cart_preview'],
        ]);
    }

    public static function verify(WP_REST_Request $req): bool {
        if (!defined('PIMP_SITE_KEY') || !PIMP_SITE_KEY) return false;
        $ts  = $req->get_header('x_pimp_timestamp');
        $sig = $req->get_header('x_pimp_signature');
        if (!$ts || !$sig) return false;
        if (abs(time() - (int) $ts) > 300) return false;

        $method = $req->get_method();
        $path   = '/wp-json' . $req->get_route();
        $body   = $req->get_body();
        $digest = hash('sha256', $body !== null ? $body : '');
        $msg    = "{$ts}\n{$method}\n{$path}\n{$digest}";
        $expect = hash_hmac('sha256', $msg, PIMP_SITE_KEY);
        return hash_equals($expect, $sig);
    }

    public static function active_products(WP_REST_Request $req): WP_REST_Response {
        $params = $req->get_json_params() ?: [];
        // `replace` (full set) is used by Pimp's reconciliation loop. When
        // present, it overrides touch/forget and resets the table to the
        // exact set Pimp considers active.
        if (array_key_exists('replace', $params) && is_array($params['replace'])) {
            Pimp_Storage::replace_all($params['replace']);
            return new WP_REST_Response(['ok' => true, 'mode' => 'replace', 'count' => count($params['replace'])], 200);
        }
        $touch  = is_array($params['touch']  ?? null) ? $params['touch']  : [];
        $forget = is_array($params['forget'] ?? null) ? $params['forget'] : [];
        Pimp_Storage::touch($touch);
        Pimp_Storage::forget($forget);
        return new WP_REST_Response(['ok' => true], 200);
    }

    public static function cart_preview(WP_REST_Request $req): WP_REST_Response {
        if (!class_exists('WC_Cart')) {
            return new WP_REST_Response(['error' => 'WooCommerce not loaded'], 503);
        }
        $params     = $req->get_json_params() ?: [];
        $line_items = is_array($params['line_items'] ?? null) ? $params['line_items'] : [];
        $billing    = is_array($params['billing']    ?? null) ? $params['billing']    : [];
        $shipping   = is_array($params['shipping']   ?? null) ? $params['shipping']   : [];

        if (!WC()->session)  WC()->initialize_session();
        if (!WC()->customer) WC()->initialize_customer();
        $customer = WC()->customer;
        if ($shipping) {
            $customer->set_shipping_country($shipping['country']  ?? 'FR');
            $customer->set_shipping_postcode($shipping['postcode'] ?? '');
            $customer->set_shipping_city($shipping['city']        ?? '');
            $customer->set_shipping_address_1($shipping['address_1'] ?? '');
        }
        if ($billing) {
            $customer->set_billing_country($billing['country']  ?? 'FR');
            $customer->set_billing_postcode($billing['postcode'] ?? '');
            $customer->set_billing_email($billing['email']      ?? '');
        }

        $cart = new WC_Cart();
        $cart->empty_cart();
        $items_out = [];
        $all_available = true;

        foreach ($line_items as $li) {
            $pid = isset($li['product_id']) ? (int) $li['product_id'] : 0;
            $vid = isset($li['variation_id']) ? (int) $li['variation_id'] : 0;
            $qty = isset($li['quantity']) ? max(1, (int) $li['quantity']) : 1;
            if ($pid <= 0) continue;

            $effective_id = $vid > 0 ? $vid : $pid;
            $product = wc_get_product($effective_id);

            $available = false;
            $reason = null;
            if (!$product) {
                $reason = 'unknown_product';
            } elseif (!$product->is_purchasable()) {
                $reason = 'not_purchasable';
            } elseif (!$product->is_in_stock()) {
                $reason = 'out_of_stock';
            } elseif ($product->managing_stock() && $product->get_stock_quantity() !== null && $product->get_stock_quantity() < $qty) {
                $reason = 'insufficient_stock';
            } else {
                $available = true;
            }

            if ($available) {
                if ($vid > 0) {
                    $cart->add_to_cart($pid, $qty, $vid);
                } else {
                    $cart->add_to_cart($pid, $qty);
                }
            } else {
                $all_available = false;
            }

            $items_out[] = [
                'product_id'   => $pid,
                'variation_id' => $vid > 0 ? $vid : null,
                'name'         => $product ? $product->get_name() : '',
                'quantity'     => $qty,
                'unit_price'   => $product ? (float) $product->get_price() : 0.0,
                'subtotal'     => $product && $available ? (float) $product->get_price() * $qty : 0.0,
                'available'    => $available,
                'reason'       => $reason,
                'stock_left'   => $product && $product->managing_stock() ? (int) ($product->get_stock_quantity() ?? 0) : null,
            ];
        }
        $cart->calculate_totals();

        $response = [
            'currency'         => get_woocommerce_currency(),
            'items'            => $items_out,
            'subtotal'         => (float) $cart->get_subtotal(),
            'discount_total'   => (float) $cart->get_discount_total(),
            'shipping_total'   => (float) $cart->get_shipping_total(),
            'tax_total'        => (float) $cart->get_total_tax(),
            'total'            => (float) wc_format_decimal($cart->get_total('edit'), 2),
            'coupons_applied'  => array_values($cart->get_applied_coupons()),
            'all_available'    => $all_available,
        ];
        $cart->empty_cart();
        return new WP_REST_Response($response, 200);
    }
}
