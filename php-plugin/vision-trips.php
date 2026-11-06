<?php
/**
 * Plugin Name:       Vision Trips
 * Plugin URI:        https://thetravelnetworkgroup.co.uk
 * Description:       The customer-facing trip experience for Vision by The Travel Network Group. Quotations, bookings, travel documents, payments and a customer portal — branded for every member, powered by Airtable, Widgety, Google Places and more.
 * Version:           1.7.4
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            The Travel Network Group
 * Text Domain:       vision-trips
 * License:           Proprietary
 */

if (!defined('ABSPATH')) {
    exit;
}

define('VISION_TRIPS_VERSION', '1.7.4');
define('VISION_TRIPS_FILE', __FILE__);
define('VISION_TRIPS_DIR', plugin_dir_path(__FILE__));
define('VISION_TRIPS_URL', plugin_dir_url(__FILE__));

require_once VISION_TRIPS_DIR . 'includes/Autoloader.php';
\VisionTrips\Autoloader::register(VISION_TRIPS_DIR . 'includes');

register_activation_hook(__FILE__, ['\VisionTrips\Plugin', 'activate']);
register_deactivation_hook(__FILE__, ['\VisionTrips\Plugin', 'deactivate']);

add_action('plugins_loaded', static function (): void {
    \VisionTrips\Plugin::instance()->boot();
});
