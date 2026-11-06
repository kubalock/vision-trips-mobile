<?php
declare(strict_types=1);

namespace VisionTrips;

use VisionTrips\Admin\Admin;
use VisionTrips\Frontend\Router;
use VisionTrips\Rest\Api;
use VisionTrips\Security\Token;

final class Plugin
{
    private static ?Plugin $instance = null;
    private bool $booted = false;

    public static function instance(): self
    {
        return self::$instance ??= new self();
    }

    public function boot(): void
    {
        if ($this->booted) {
            return;
        }
        $this->booted = true;
        Settings::ensureSecrets();
        (new Router())->register();
        (new Api())->register();
        if (is_admin()) {
            (new Admin())->register();
        }
        add_action('init', [$this, 'maybeFlushRewrites'], 20);
        add_filter('vision_trips/trip_url', static fn (string $url, string $base, string $record) => Token::urlFor($base, $record), 10, 3);
        add_filter('wp_mail_from_name', [$this, 'mailFromName'], 5);
        add_action(\VisionTrips\Support\Jobs::CRON_HOOK, [\VisionTrips\Support\Jobs::class, 'runNext'], 10, 0);
        add_action('vision_trips_digest', [\VisionTrips\Admin\Diagnostics::class, 'sendDigest']);
        // One-off: AI copy written before the brochure gate existed must be regenerated.
        if (version_compare((string) get_option('vision_trips_ai_gate_version', '0'), '1.7.1', '<')) {
            \VisionTrips\Support\Cache::bump('ai');
            delete_option('vision_trips_jobs');
            update_option('vision_trips_ai_gate_version', '1.7.1', false);
        }
        if (!wp_next_scheduled('vision_trips_digest')) {
            wp_schedule_event((int) strtotime('tomorrow 07:00'), 'daily', 'vision_trips_digest');
        }
    }

    /** Version string for an asset: plugin version + file mtime, so every update busts browser and service-worker caches. */
    public static function assetVersion(string $relative): string
    {
        $file = VISION_TRIPS_DIR . $relative;
        return VISION_TRIPS_VERSION . '.' . (is_file($file) ? (string) filemtime($file) : '0');
    }

    public static function activate(): void
    {
        Settings::ensureSecrets();
        update_option('vision_trips_flush', '1', false);
        if (!wp_next_scheduled('vision_trips_daily')) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'vision_trips_daily');
        }
    }

    public static function deactivate(): void
    {
        wp_clear_scheduled_hook('vision_trips_daily');
        flush_rewrite_rules();
    }

    public function maybeFlushRewrites(): void
    {
        if (get_option('vision_trips_flush') === '1') {
            delete_option('vision_trips_flush');
            flush_rewrite_rules();
        }
    }

    /** Transactional mail from the plugin keeps the site's from-name unless it is the WordPress default. */
    public function mailFromName(string $name): string
    {
        return $name === 'WordPress' ? get_bloginfo('name') : $name;
    }
}
