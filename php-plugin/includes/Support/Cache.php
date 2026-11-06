<?php
declare(strict_types=1);

namespace VisionTrips\Support;

/**
 * Transient-backed cache with a global generation counter so "Purge everything" is O(1).
 */
final class Cache
{
    private const GEN_OPTION = 'vision_trips_cache_gen';

    public static function key(string $namespace, string $id): string
    {
        $gen = (string) get_option(self::GEN_OPTION, '1') . '|' . (string) get_option(self::GEN_OPTION . '_' . $namespace, '1');
        return 'vtr_' . substr(md5($gen . '|' . $namespace . '|' . $id), 0, 32);
    }

    public static function get(string $namespace, string $id): mixed
    {
        $v = get_transient(self::key($namespace, $id));
        return $v === false ? null : $v;
    }

    /** Remember a "not found" so we don't hammer an API — unless we're rendering from cache only, when nothing was looked up. */
    public static function negative(string $namespace, string $id, int $ttl): void
    {
        if (Http::$cacheOnly) {
            return;
        }
        self::set($namespace, $id, ['missing' => true], $ttl);
    }

    /** Invalidate one namespace (e.g. 'ai' to regenerate all AI copy) without touching the rest. */
    public static function bump(string $namespace): void
    {
        update_option(self::GEN_OPTION . '_' . $namespace, (string) time(), false);
    }

    public static function set(string $namespace, string $id, mixed $value, int $ttl): void
    {
        set_transient(self::key($namespace, $id), $value, max(1, $ttl));
    }

    public static function delete(string $namespace, string $id): void
    {
        delete_transient(self::key($namespace, $id));
    }

    /** @param callable():mixed $producer */
    public static function remember(string $namespace, string $id, int $ttl, callable $producer, bool $fresh = false): mixed
    {
        if (!$fresh) {
            $cached = self::get($namespace, $id);
            if ($cached !== null) {
                return $cached;
            }
        }
        $value = $producer();
        if ($value !== null) {
            self::set($namespace, $id, $value, $ttl);
        }
        return $value;
    }

    public static function purgeAll(): void
    {
        update_option(self::GEN_OPTION, (string) time(), false);
    }
}
