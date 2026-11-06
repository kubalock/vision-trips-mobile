<?php
declare(strict_types=1);

namespace VisionTrips\Support;

/**
 * Thin wrapper over the WordPress HTTP API with JSON decoding, retries on 429/5xx and parallel requests.
 */
final class Http
{
    /** When true, no network call is made: integrations answer from cache or report a miss (used to render warm sections inline). */
    public static bool $cacheOnly = false;
    public static bool $missed = false;

    private static function deferred(string $url = ''): array
    {
        self::$missed = true;
        Provenance::request('DEFERRED', self::label($url), 0, 0, true, 'cache-only render: live lookup deferred to the browser');
        return ['ok' => false, 'status' => 0, 'data' => null, 'body' => '', 'error' => 'deferred (cache-only render)'];
    }

    /** Endpoint label safe for logs: host + path, no query string (keys and tokens live there). */
    public static function label(string $url): string
    {
        $p = parse_url($url);
        return (string) ($p['host'] ?? '') . (string) ($p['path'] ?? '');
    }

    private static function record(string $method, string $url, array $result, float $started): void
    {
        $ms = (int) round((microtime(true) - $started) * 1000);
        $label = self::label($url);
        Provenance::request($method, $label, $result['status'], $ms, $result['ok'], $result['error']);
        if (!$result['ok']) {
            Log::warning('HTTP ' . $method . ' failed', ['endpoint' => $label, 'status' => $result['status'], 'error' => $result['error'], 'ms' => $ms]);
        }
    }

    /**
     * @param array<string,string> $headers
     * @return array{ok:bool,status:int,data:mixed,body:string,error:string}
     */
    public static function getJson(string $url, array $headers = [], int $timeout = 20, int $retries = 2): array
    {
        if (self::$cacheOnly) {
            return self::deferred($url);
        }
        $attempt = 0;
        $started = microtime(true);
        do {
            $resp = wp_remote_get($url, ['headers' => $headers, 'timeout' => $timeout, 'sslverify' => true, 'redirection' => 3]);
            $result = self::normalise($resp);
            if ($result['ok'] || !in_array($result['status'], [429, 500, 502, 503, 504], true) || $attempt >= $retries) {
                self::record('GET', $url, $result, $started);
            }
            if ($result['ok'] || !in_array($result['status'], [429, 500, 502, 503, 504], true)) {
                return $result;
            }
            $attempt++;
            if ($attempt <= $retries) {
                usleep((int) (250000 * $attempt));
            }
        } while ($attempt <= $retries);
        return $result;
    }

    /**
     * @param array<string,string> $headers
     * @return array{ok:bool,status:int,data:mixed,body:string,error:string}
     */
    public static function sendJson(string $method, string $url, mixed $payload, array $headers = [], int $timeout = 25): array
    {
        $headers = array_merge(['Content-Type' => 'application/json', 'Accept' => 'application/json'], $headers);
        if (self::$cacheOnly) {
            return self::deferred($url);
        }
        $started = microtime(true);
        $resp = wp_remote_request($url, [
            'method'  => strtoupper($method),
            'headers' => $headers,
            'timeout' => $timeout,
            'body'    => $payload === null ? null : wp_json_encode($payload),
            'sslverify' => true,
        ]);
        $result = self::normalise($resp);
        self::record(strtoupper($method), $url, $result, $started);
        return $result;
    }

    /**
     * Run several GET requests in parallel (WP Requests library); returns results keyed like $requests.
     *
     * @param array<string,array{url:string,headers?:array<string,string>}> $requests
     * @return array<string,array{ok:bool,status:int,data:mixed,body:string,error:string}>
     */
    public static function multiGet(array $requests, int $timeout = 20): array
    {
        $results = [];
        if (!$requests) {
            return $results;
        }
        if (self::$cacheOnly) {
            foreach ($requests as $key => $req) {
                $results[$key] = self::deferred((string) ($req['url'] ?? ''));
            }
            return $results;
        }
        if (class_exists('\WpOrg\Requests\Requests') && count($requests) > 1) {
            $batch = [];
            foreach ($requests as $key => $req) {
                $batch[$key] = [
                    'url'     => $req['url'],
                    'headers' => $req['headers'] ?? [],
                    'type'    => \WpOrg\Requests\Requests::GET,
                    'options' => ['timeout' => $timeout, 'verify' => true],
                ];
            }
            try {
                $started = microtime(true);
                $responses = \WpOrg\Requests\Requests::request_multiple($batch, ['timeout' => $timeout]);
                foreach ($responses as $key => $resp) {
                    if ($resp instanceof \WpOrg\Requests\Response) {
                        $results[$key] = self::fromRaw((int) $resp->status_code, (string) $resp->body);
                    } elseif ($resp instanceof \Throwable) {
                        $results[$key] = ['ok' => false, 'status' => 0, 'data' => null, 'body' => '', 'error' => $resp->getMessage()];
                    } else {
                        $results[$key] = ['ok' => false, 'status' => 0, 'data' => null, 'body' => '', 'error' => 'unknown'];
                    }
                }
                foreach ($results as $key => $r) {
                    self::record('GET', $requests[$key]['url'], $r, $started);
                }
                // Retry failures sequentially (handles 429 bursts from Airtable).
                foreach ($results as $key => $r) {
                    if (!$r['ok'] && in_array($r['status'], [0, 429, 500, 502, 503], true)) {
                        usleep(300000);
                        $results[$key] = self::getJson($requests[$key]['url'], $requests[$key]['headers'] ?? [], $timeout, 1);
                    }
                }
                return $results;
            } catch (\Throwable $e) {
                Log::warning('multiGet fell back to sequential', ['error' => $e->getMessage()]);
            }
        }
        foreach ($requests as $key => $req) {
            $results[$key] = self::getJson($req['url'], $req['headers'] ?? [], $timeout);
        }
        return $results;
    }

    private static function normalise(mixed $resp): array
    {
        if (is_wp_error($resp)) {
            return ['ok' => false, 'status' => 0, 'data' => null, 'body' => '', 'error' => $resp->get_error_message()];
        }
        return self::fromRaw((int) wp_remote_retrieve_response_code($resp), (string) wp_remote_retrieve_body($resp));
    }

    private static function fromRaw(int $status, string $body): array
    {
        $data = json_decode($body, true);
        $ok = $status >= 200 && $status < 300;
        $error = '';
        if (!$ok) {
            $error = 'HTTP ' . $status;
            if (is_array($data) && isset($data['error'])) {
                $error .= ' ' . (is_array($data['error']) ? ($data['error']['message'] ?? $data['error']['type'] ?? '') : (string) $data['error']);
            }
        }
        return ['ok' => $ok, 'status' => $status, 'data' => $data, 'body' => $body, 'error' => $error];
    }
}
