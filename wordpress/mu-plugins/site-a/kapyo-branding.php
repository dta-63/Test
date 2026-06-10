<?php
/**
 * Plugin Name: Kapyo Site Branding
 * Description: Injects per-site custom CSS stored in the `kapyo_site_custom_css` option.
 */

add_action('wp_head', function () {
    $css = get_option('kapyo_site_custom_css', '');
    if ($css) {
        echo "<style id=\"kapyo-site-branding\">\n" . wp_strip_all_tags($css) . "\n</style>\n";
    }
}, 100);
