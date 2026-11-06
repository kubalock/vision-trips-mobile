<?php
declare(strict_types=1);

namespace VisionTrips\Support;

/**
 * Fixed-window rate limiting on transients. Keyed by an arbitrary bucket (IP, booking, action).
 */
final class RateLimit
{
    public static function hit(string $bucket, int $max, int $windowSeconds): bool
    {
        $key = 'vtr_rl_' . md5($bucket);
        $data = get_transient($key);
        if (!is_array($data)) {
            set_transient($key, ['c' => 1, 's' => time()], $windowSeconds);
            return true;
        }
        $data['c'] = (int) ($data['c'] ?? 0) + 1;
        $remaining = max(1, $windowSeconds - (time() - (int) ($data['s'] ?? time())));
        set_transient($key, $data, $remaining);
        return $data['c'] <= $max;
    }

    public static function reset(string $bucket): void
    {
        delete_transient('vtr_rl_' . md5($bucket));
    }

    public static function ip(): string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        // Behind a trusted proxy (Cloudflare, load balancer) WordPress may be configured to set REMOTE_ADDR; honour CF-Connecting-IP only if present.
        if (!empty($_SERVER['HTTP_CF_CONNECTING_IP']) && filter_var($_SERVER['HTTP_CF_CONNECTING_IP'], FILTER_VALIDATE_IP)) {
            $ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
        }
        return (string) $ip;
    }
}
