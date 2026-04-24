<?php
/**
 * Plugin Name: Pimp WC HTTP Auth
 * Description: Accept WooCommerce REST Basic/query-string auth over plain HTTP
 *              when the request carries the X-Pimp-Request header. Dev only.
 */

if (
    !empty($_SERVER['HTTP_X_PIMP_REQUEST']) &&
    isset($_SERVER['REQUEST_URI']) &&
    strpos($_SERVER['REQUEST_URI'], '/wp-json/wc/') !== false
) {
    $_SERVER['HTTPS'] = 'on';
}
