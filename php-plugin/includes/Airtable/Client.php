<?php
declare(strict_types=1);

namespace VisionTrips\Airtable;

use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Http;
use VisionTrips\Support\Log;

/**
 * Airtable REST client.
 *  - Batches "get by record IDs" into filterByFormula OR() calls (max ~30 ids per request to keep URLs short).
 *  - Fetches independent tables in parallel (Http::multiGet) to keep page loads fast.
 *  - Falls back to the standby PAT automatically on 401/403 so token rotation is zero-downtime.
 */
final class Client
{
    private const API = 'https://api.airtable.com/v0/';
    private const CHUNK = 30;

    private string $token;
    private string $standby;

    public function __construct(?string $token = null)
    {
        $this->token = $token ?? (string) Settings::get('airtable_pat', '');
        $this->standby = (string) Settings::get('airtable_pat_standby', '');
    }

    public function configured(): bool
    {
        return $this->token !== '';
    }

    /** @return array<string,string> */
    private function headers(?string $token = null): array
    {
        return [
            'Authorization' => 'Bearer ' . ($token ?? $this->token),
            'Accept'        => 'application/json',
        ];
    }

    private function url(string $base, string $table, string $path = '', array $query = []): string
    {
        $url = self::API . rawurlencode($base) . '/' . rawurlencode($table) . ($path !== '' ? '/' . rawurlencode($path) : '');
        if ($query) {
            $parts = [];
            foreach ($query as $k => $v) {
                if (is_array($v)) {
                    foreach ($v as $item) {
                        $parts[] = rawurlencode((string) $k) . '%5B%5D=' . rawurlencode((string) $item);
                    }
                } else {
                    $parts[] = rawurlencode((string) $k) . '=' . rawurlencode((string) $v);
                }
            }
            $url .= '?' . implode('&', $parts);
        }
        return $url;
    }

    /** Single GET with standby-token fallback. */
    private string $lastError = '';
    private bool $lastNotFound = false;

    public function lastError(): string
    {
        return $this->lastError;
    }

    public function lastWasNotFound(): bool
    {
        return $this->lastNotFound;
    }

    private function note(array $res): void
    {
        if (!$res['ok']) {
            $this->lastError = $res['status'] === 429 ? 'rate limited' : ($res['status'] === 0 ? 'timeout' : 'HTTP ' . $res['status']);
            $this->lastNotFound = $res['status'] === 404 || $res['status'] === 403;
        } else {
            $this->lastError = '';
            $this->lastNotFound = false;
        }
    }

    /**
     * Keep under Airtable's ~5 requests/second per base: a tiny token bucket in a transient. Waits at most 1.2s.
     */
    public static function budget(string $base, int $units = 1): void
    {
        $key = 'vtr_rl_' . substr(md5($base), 0, 10);
        $now = microtime(true);
        $b = get_transient($key);
        $b = is_array($b) ? $b : ['t' => $now, 'n' => 0];
        if ($now - (float) $b['t'] >= 1.0) {
            $b = ['t' => $now, 'n' => 0];
        }
        if ((int) $b['n'] + $units > 4) {
            $wait = min(1.2, max(0.0, 1.0 - ($now - (float) $b['t'])));
            if ($wait > 0) {
                usleep((int) ($wait * 1000000));
            }
            $b = ['t' => microtime(true), 'n' => 0];
        }
        $b['n'] = (int) $b['n'] + $units;
        set_transient($key, $b, 5);
    }

    private function get(string $url): array
    {
        if (preg_match('#/v0/(app[A-Za-z0-9]{14})/#', $url, $m)) {
            self::budget($m[1]);
        }
        $res = Http::getJson($url, $this->headers());
        if (!$res['ok'] && in_array($res['status'], [401, 403], true) && $this->standby !== '') {
            Log::warning('Airtable auth failed on active PAT, trying standby', ['status' => $res['status']]);
            $res = Http::getJson($url, $this->headers($this->standby));
            if ($res['ok']) {
                $this->token = $this->standby;
            }
        }
        $this->note($res);
        if (!$res['ok']) {
            Log::error('Airtable GET failed', ['status' => $res['status'], 'error' => $res['error'], 'url' => preg_replace('/\?.*/', '', $url)]);
        }
        return $res;
    }

    /** @return array<string,mixed>|null Record ({id, fields}) or null. */
    public function record(string $base, string $table, string $id): ?array
    {
        if (!preg_match('/^rec[A-Za-z0-9]{14}$/', $id)) {
            return null;
        }
        $res = $this->get($this->url($base, $table, $id));
        return $res['ok'] && is_array($res['data']) && isset($res['data']['id']) ? $res['data'] : null;
    }

    /**
     * Fetch records by ID (any count), preserving the order of $ids.
     *
     * @param string[] $ids
     * @param string[] $fields Optional field whitelist (reduces payload size dramatically for wide tables).
     * @return array<int,array<string,mixed>>
     */
    public function byIds(string $base, string $table, array $ids, array $fields = []): array
    {
        $ids = array_values(array_unique(array_filter(array_map('strval', $ids), static fn ($i) => preg_match('/^rec[A-Za-z0-9]{14}$/', $i) === 1)));
        if (!$ids) {
            return [];
        }
        $requests = [];
        foreach (array_chunk($ids, self::CHUNK) as $i => $chunk) {
            $requests['c' . $i] = ['url' => $this->byIdsUrl($base, $table, $chunk, $fields), 'headers' => $this->headers()];
        }
        $records = [];
        foreach ($this->runMulti($requests) as $res) {
            if ($res['ok'] && !empty($res['data']['records'])) {
                foreach ($res['data']['records'] as $r) {
                    $records[$r['id']] = $r;
                }
            }
        }
        $ordered = [];
        foreach ($ids as $id) {
            if (isset($records[$id])) {
                $ordered[] = $records[$id];
            }
        }
        return $ordered;
    }

    /**
     * Fetch several independent "by ids" groups in parallel.
     *
     * @param array<string,array{table:string,ids:string[],fields?:string[]}> $groups
     * @return array<string,array<int,array<string,mixed>>> keyed like $groups
     */
    public function byIdsMany(string $base, array $groups): array
    {
        self::budget($base, max(1, min(4, count(array_filter($groups, static fn ($g) => !empty($g['ids']))))));
        $requests = [];
        $meta = [];
        foreach ($groups as $key => $g) {
            $ids = array_values(array_unique(array_filter(array_map('strval', $g['ids'] ?? []), static fn ($i) => preg_match('/^rec[A-Za-z0-9]{14}$/', $i) === 1)));
            if (!$ids) {
                continue;
            }
            foreach (array_chunk($ids, self::CHUNK) as $i => $chunk) {
                $rk = $key . '#' . $i;
                $requests[$rk] = ['url' => $this->byIdsUrl($base, $g['table'], $chunk, $g['fields'] ?? []), 'headers' => $this->headers()];
                $meta[$rk] = $key;
            }
        }
        $out = [];
        foreach ($groups as $key => $g) {
            $out[$key] = [];
        }
        $found = [];
        foreach ($this->runMulti($requests) as $rk => $res) {
            $key = $meta[$rk];
            if ($res['ok'] && !empty($res['data']['records'])) {
                foreach ($res['data']['records'] as $r) {
                    $found[$key][$r['id']] = $r;
                }
            }
        }
        foreach ($groups as $key => $g) {
            foreach (($g['ids'] ?? []) as $id) {
                if (isset($found[$key][$id])) {
                    $out[$key][] = $found[$key][$id];
                }
            }
        }
        return $out;
    }

    /**
     * List records by formula (paginated).
     *
     * @return array<int,array<string,mixed>>
     */
    public function find(string $base, string $table, string $formula, array $fields = [], int $max = 100): array
    {
        $records = [];
        $offset = null;
        do {
            $query = ['filterByFormula' => $formula, 'pageSize' => min(100, $max)];
            if ($fields) {
                $query['fields'] = $fields;
            }
            if ($offset) {
                $query['offset'] = $offset;
            }
            $res = $this->get($this->url($base, $table, '', $query));
            if (!$res['ok']) {
                break;
            }
            foreach (($res['data']['records'] ?? []) as $r) {
                $records[] = $r;
            }
            $offset = $res['data']['offset'] ?? null;
        } while ($offset && count($records) < $max);
        return $records;
    }

    /** PATCH a single record's fields. Returns true on success. */
    public function patch(string $base, string $table, string $id, array $fields, bool $typecast = true): bool
    {
        $res = Http::sendJson('PATCH', $this->url($base, $table, $id), ['fields' => $fields, 'typecast' => $typecast], $this->headers());
        if (!$res['ok'] && in_array($res['status'], [401, 403], true) && $this->standby !== '') {
            $res = Http::sendJson('PATCH', $this->url($base, $table, $id), ['fields' => $fields, 'typecast' => $typecast], $this->headers($this->standby));
        }
        if (!$res['ok']) {
            Log::error('Airtable PATCH failed', ['status' => $res['status'], 'error' => $res['error'], 'table' => $table]);
        }
        return $res['ok'];
    }

    /** Add a native comment to a record (scope: data.recordComments:write). */
    public function comment(string $base, string $table, string $id, string $text): bool
    {
        if (!preg_match('/^rec[A-Za-z0-9]{14}$/', $id) || trim($text) === '') {
            return false;
        }
        $res = Http::sendJson('POST', $this->url($base, $table, $id) . '/comments', ['text' => mb_substr($text, 0, 1000)], $this->headers(), 15);
        if (!$res['ok'] && in_array($res['status'], [401, 403], true) && $this->standby !== '') {
            $res = Http::sendJson('POST', $this->url($base, $table, $id) . '/comments', ['text' => mb_substr($text, 0, 1000)], $this->headers($this->standby), 15);
        }
        return $res['ok'];
    }

    /** Create a record. Returns the new record id or ''. */
    public function create(string $base, string $table, array $fields, bool $typecast = true): string
    {
        $res = Http::sendJson('POST', $this->url($base, $table), ['fields' => $fields, 'typecast' => $typecast], $this->headers());
        if (!$res['ok']) {
            Log::error('Airtable POST failed', ['status' => $res['status'], 'error' => $res['error'], 'table' => $table]);
            return '';
        }
        return (string) ($res['data']['id'] ?? '');
    }

    /**
     * Base schema from the Metadata API (cached for a day).
     *
     * @return array<int,array<string,mixed>> tables
     */
    public function schema(string $base, bool $fresh = false): array
    {
        $produce = function () use ($base): ?array {
            $res = $this->get(self::API . 'meta/bases/' . rawurlencode($base) . '/tables');
            return $res['ok'] && isset($res['data']['tables']) ? $res['data']['tables'] : null;
        };
        $tables = Cache::remember('schema', $base, DAY_IN_SECONDS, $produce, $fresh);
        return is_array($tables) ? $tables : [];
    }

    /** Validate a token: list bases the token can see. @return array{ok:bool,bases:array<int,array{id:string,name:string}>,error:string} */
    public static function testToken(string $token): array
    {
        $res = Http::getJson(self::API . 'meta/bases', ['Authorization' => 'Bearer ' . $token, 'Accept' => 'application/json'], 15, 0);
        $bases = [];
        foreach (($res['data']['bases'] ?? []) as $b) {
            $bases[] = ['id' => (string) ($b['id'] ?? ''), 'name' => (string) ($b['name'] ?? '')];
        }
        return ['ok' => $res['ok'], 'bases' => $bases, 'error' => $res['error']];
    }

    private function byIdsUrl(string $base, string $table, array $chunk, array $fields): string
    {
        $or = array_map(static fn ($id) => "RECORD_ID()='" . addslashes($id) . "'", $chunk);
        $query = ['filterByFormula' => 'OR(' . implode(',', $or) . ')', 'pageSize' => 100];
        if ($fields) {
            $query['fields'] = array_values($fields);
        }
        return $this->url($base, $table, '', $query);
    }

    /** @param array<string,array{url:string,headers:array<string,string>}> $requests */
    private function runMulti(array $requests): array
    {
        if (!$requests) {
            return [];
        }
        if (count($requests) === 1) {
            $k = array_key_first($requests);
            return [$k => $this->get($requests[$k]['url'])];
        }
        $results = Http::multiGet($requests);
        foreach ($results as $r) {
            if (!$r['ok']) {
                $this->note($r);
                break;
            }
        }
        foreach ($results as $k => $res) {
            if (!$res['ok'] && in_array($res['status'], [401, 403], true) && $this->standby !== '') {
                $results[$k] = Http::getJson($requests[$k]['url'], $this->headers($this->standby));
            }
            if (!$results[$k]['ok']) {
                Log::error('Airtable batch GET failed', ['status' => $results[$k]['status'], 'error' => $results[$k]['error']]);
            }
        }
        return $results;
    }
}
