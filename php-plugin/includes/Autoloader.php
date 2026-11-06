<?php
declare(strict_types=1);

namespace VisionTrips;

/**
 * Minimal PSR-4 autoloader for the VisionTrips namespace (no Composer dependency).
 */
final class Autoloader
{
    public static function register(string $baseDir): void
    {
        $baseDir = rtrim($baseDir, '/\\') . DIRECTORY_SEPARATOR;
        spl_autoload_register(static function (string $class) use ($baseDir): void {
            $prefix = 'VisionTrips\\';
            if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
                return;
            }
            $relative = substr($class, strlen($prefix));
            $file = $baseDir . str_replace('\\', DIRECTORY_SEPARATOR, $relative) . '.php';
            if (is_file($file)) {
                require_once $file;
            }
        });
    }
}
