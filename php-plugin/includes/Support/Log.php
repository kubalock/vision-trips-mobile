<?php
declare(strict_types=1);

namespace VisionTrips\Support;

/**
 * Lightweight ring-buffer log stored in an option (last 300 entries) plus error_log passthrough.
 * Never logs secrets or full customer records; callers pass short context arrays.
 */
final class Log
{
    private const OPTION = 'vision_trips_log';
    private const MAX = 300;

    public static function write(string $level, string $message, array $context = []): void
    {
        $entry = [
            't'   => gmdate('c'),
            'l'   => $level,
            'm'   => mb_substr($message, 0, 500),
            'c'   => self::sanitise($context),
        ];
        $log = get_option(self::OPTION, []);
        if (!is_array($log)) {
            $log = [];
        }
        $log[] = $entry;
        if (count($log) > self::MAX) {
            $log = array_slice($log, -self::MAX);
        }
        update_option(self::OPTION, $log, false);
        if (in_array($level, ['error', 'warning'], true) && (defined('WP_DEBUG') && WP_DEBUG)) {
            error_log('[vision-trips][' . $level . '] ' . $message . ' ' . wp_json_encode($entry['c']));
        }
    }

    public static function info(string $m, array $c = []): void { self::write('info', $m, $c); }
    public static function warning(string $m, array $c = []): void { if (!Http::$cacheOnly) { self::write('warning', $m, $c); } }
    public static function error(string $m, array $c = []): void { self::write('error', $m, $c); }

    /** @return array<int,array<string,mixed>> */
    public static function all(): array
    {
        $log = get_option(self::OPTION, []);
        return is_array($log) ? array_reverse($log) : [];
    }

    public static function clear(): void
    {
        delete_option(self::OPTION);
    }

    private static function sanitise(array $context): array
    {
        $out = [];
        foreach ($context as $k => $v) {
            $key = (string) $k;
            if (preg_match('/(pat|token|secret|key|password|authorization)/i', $key)) {
                $out[$key] = '[redacted]';
                continue;
            }
            if (is_scalar($v) || $v === null) {
                $out[$key] = is_string($v) ? mb_substr($v, 0, 300) : $v;
            } else {
                $out[$key] = mb_substr((string) wp_json_encode($v), 0, 300);
            }
        }
        return $out;
    }
}
