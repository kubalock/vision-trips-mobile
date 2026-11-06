<?php
if (function_exists('wp_clear_scheduled_hook')) {
    wp_clear_scheduled_hook('vision_trips_digest');
    wp_clear_scheduled_hook('vision_trips_job');
}
foreach (['vision_trips_events', 'vision_trips_event_counts', 'vision_trips_ai_feedback', 'vision_trips_jobs'] as $o) {
    delete_option($o);
}
/**
 * Uninstall: remove options and transients. Secrets are deleted too — rotate keys afterwards.
 */
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
global $wpdb;
$options = $wpdb->get_col($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", 'vision_trips_%'));
foreach ((array) $options as $name) {
    delete_option($name);
}
$transients = $wpdb->get_col($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", '_transient_vtr_%', '_transient_timeout_vtr_%'));
foreach ((array) $transients as $name) {
    delete_option($name);
}
