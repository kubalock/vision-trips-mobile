<?php
declare(strict_types=1);

namespace VisionTrips\Support;

/**
 * Records where each piece of customer-facing content came from (Airtable, Widgety, Google Places, AI, flight API,
 * Open-Meteo, cache) so WordPress admins can see a per-section breakdown at the foot of the trip page.
 */
final class Provenance
{
    /** @var array<int,array{section:string,source:string,detail:string,ok:bool}> */
    private static array $rows = [];

    public static function note(string $section, string $source, string $detail = '', bool $ok = true, string $ref = ''): void
    {
        self::$rows[] = ['section' => $section, 'source' => $source, 'detail' => mb_substr($detail, 0, 200), 'ok' => $ok, 'ref' => $ref];
    }

    /** @return array<int,array{section:string,source:string,detail:string,ok:bool}> */
    public static function all(): array
    {
        return self::$rows;
    }

    /** @var array<int,array{method:string,endpoint:string,status:int,ms:int,ok:bool,error:string}> */
    private static array $requests = [];

    public static function request(string $method, string $endpoint, int $status, int $ms, bool $ok, string $error = ''): void
    {
        self::$requests[] = ['method' => $method, 'endpoint' => $endpoint, 'status' => $status, 'ms' => $ms, 'ok' => $ok, 'error' => mb_substr($error, 0, 160)];
    }

    /** @return array<int,array{method:string,endpoint:string,status:int,ms:int,ok:bool,error:string}> */
    public static function requests(): array
    {
        return self::$requests;
    }

    /** Position marker, so rows written during a cache-only attempt can be discarded. @return array{int,int} */
    public static function mark(): array
    {
        return [count(self::$rows), count(self::$requests)];
    }

    /** @param array{int,int} $mark */
    public static function rollback(array $mark): void
    {
        self::$rows = array_slice(self::$rows, 0, $mark[0]);
        self::$requests = array_slice(self::$requests, 0, $mark[1]);
    }

    public static function reset(): void
    {
        self::$rows = [];
        self::$requests = [];
    }

    public static function isAdmin(): bool
    {
        return function_exists('is_user_logged_in') && is_user_logged_in() && function_exists('current_user_can') && current_user_can('manage_options');
    }
}
