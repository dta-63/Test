<?php
/**
 * Plugin-side storage of products currently present in PIMP carts.
 * The table is filtered against the Woo product hooks so we only push
 * webhooks for products PIMP actually cares about.
 */

if (!defined('ABSPATH')) { exit; }

final class Pimp_Storage {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'pimp_active_products';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        $sql = "CREATE TABLE IF NOT EXISTS {$table} (
            product_id BIGINT UNSIGNED NOT NULL,
            last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (product_id),
            KEY idx_last_seen (last_seen_at)
        ) {$charset};";
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
    }

    public static function touch(array $product_ids): void {
        if (!$product_ids) return;
        global $wpdb;
        $table = self::table();
        $now   = current_time('mysql', true);
        foreach (array_unique(array_map('intval', $product_ids)) as $pid) {
            if ($pid <= 0) continue;
            $wpdb->query($wpdb->prepare(
                "INSERT INTO {$table} (product_id, last_seen_at) VALUES (%d, %s)
                 ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)",
                $pid, $now,
            ));
        }
    }

    public static function forget(array $product_ids): void {
        if (!$product_ids) return;
        global $wpdb;
        $table = self::table();
        $ids   = array_unique(array_map('intval', $product_ids));
        $ids   = array_values(array_filter($ids, fn($i) => $i > 0));
        if (!$ids) return;
        $placeholders = implode(',', array_fill(0, count($ids), '%d'));
        $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE product_id IN ({$placeholders})", $ids));
    }

    public static function is_active(int $product_id): bool {
        global $wpdb;
        $table = self::table();
        $found = $wpdb->get_var($wpdb->prepare("SELECT 1 FROM {$table} WHERE product_id = %d LIMIT 1", $product_id));
        return (bool) $found;
    }
}
