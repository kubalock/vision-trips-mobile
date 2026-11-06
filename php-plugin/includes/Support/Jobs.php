<?php
declare(strict_types=1);

namespace VisionTrips\Support;

use VisionTrips\Integrations\Ai;
use VisionTrips\Settings;

/**
 * Background work (AI copy, which may research for a minute) that must never hold up a customer's page or compete
 * with it for PHP workers.
 *
 *  - Jobs go into a single queue (an option), de-duplicated by cache id.
 *  - Exactly ONE job runs at a time site-wide (a lock), always after a response has been sent, in one worker.
 *  - The queue drains itself: each run hands over to the next via a signed, non-blocking loopback request,
 *    with WP-Cron as the fallback.
 *  - Nothing is queued during a cache-only page build: jobs start from the browser's section requests, so a
 *    page view never triggers a minute of work behind it.
 */
final class Jobs
{
    public const CRON_HOOK = 'vision_trips_job';
    private const QUEUE_OPTION = 'vision_trips_jobs';
    private const LOCK = 'vtr_job_lock';
    private const PENDING_TTL = 15 * MINUTE_IN_SECONDS;
    private const LOCK_TTL = 150;
    private const MAX_QUEUE = 60;

    /** False while a page is being built from cache only. */
    public static bool $allowDispatch = true;
    /** Set when a dispatch was refused during a cache-only build: the section needs the browser pass. */
    public static bool $refused = false;
    private static bool $kickOnShutdown = false;

    public static function pendingKey(string $cacheId): string
    {
        return 'vtr_pending_' . md5($cacheId);
    }

    public static function isPending(string $cacheId): bool
    {
        return (bool) get_transient(self::pendingKey($cacheId));
    }

    /** @return array<int,array{type:string,args:array<string,mixed>,cacheId:string,at:int}> */
    public static function queue(): array
    {
        $q = get_option(self::QUEUE_OPTION, []);
        return is_array($q) ? array_values($q) : [];
    }

    public static function queueLength(): int
    {
        return count(self::queue());
    }

    /** @param array<string,mixed> $args */
    public static function dispatch(string $type, array $args, string $cacheId): bool
    {
        if (!self::$allowDispatch) {
            self::$refused = true;
            return false;
        }
        if (self::isPending($cacheId)) {
            return true;
        }
        $queue = self::queue();
        if (count($queue) >= self::MAX_QUEUE) {
            Log::warning('Job queue full; dropping', ['type' => $type]);
            return false;
        }
        $queue[] = ['type' => $type, 'args' => $args, 'cacheId' => $cacheId, 'at' => time()];
        update_option(self::QUEUE_OPTION, $queue, false);
        set_transient(self::pendingKey($cacheId), time(), self::PENDING_TTL);
        Provenance::note('Background job', 'queued', $type . ' (position ' . count($queue) . ')', true);
        self::kick();
        return true;
    }

    /** Make sure something will drain the queue, without doing it in this request's foreground. */
    public static function kick(): void
    {
        if (get_transient(self::LOCK)) {
            return; // a runner is already going; it hands over when it finishes
        }
        if (function_exists('fastcgi_finish_request')) {
            if (!self::$kickOnShutdown) {
                self::$kickOnShutdown = true;
                add_action('shutdown', [self::class, 'runAfterResponse'], 999);
            }
            return;
        }
        self::loopback();
    }

    /** Shutdown hook: send the response, then run one job and hand over. */
    public static function runAfterResponse(): void
    {
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        }
        self::runNext();
    }

    /** Signed, non-blocking request to our own job endpoint; cron if the host blocks loopbacks. */
    private static function loopback(): void
    {
        $payload = ['exp' => time() + 120, 'nonce' => Crypto::randomToken(8)];
        $json = (string) wp_json_encode($payload);
        $sig = Crypto::hmac($json, (string) Settings::get('link_secret', ''));
        $res = wp_remote_post(rest_url('vision/v1/jobs/run'), [
            'timeout'   => 0.05,
            'blocking'  => false,
            'sslverify' => apply_filters('https_local_ssl_verify', false),
            'headers'   => ['Content-Type' => 'application/json', 'X-Vision-Job' => $sig],
            'body'      => $json,
        ]);
        if (is_wp_error($res) && !wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_single_event(time() + 5, self::CRON_HOOK);
            if (function_exists('spawn_cron')) {
                spawn_cron();
            }
        }
    }

    /** Verify a loopback and run the next job. @return array{ok:bool,error:string} */
    public static function runSigned(string $json, string $sig): array
    {
        if ($sig === '' || !Crypto::equals(Crypto::hmac($json, (string) Settings::get('link_secret', '')), $sig)) {
            return ['ok' => false, 'error' => 'bad signature'];
        }
        $payload = json_decode($json, true);
        if (!is_array($payload) || (int) ($payload['exp'] ?? 0) < time()) {
            return ['ok' => false, 'error' => 'expired'];
        }
        // Answer the loopback immediately; do the work after.
        if (function_exists('fastcgi_finish_request')) {
            add_action('shutdown', [self::class, 'runAfterResponse'], 999);
        } else {
            self::runNext();
        }
        return ['ok' => true, 'error' => ''];
    }

    /** Run exactly one queued job (if the lock is free), then hand over to the next. */
    public static function runNext(): void
    {
        if (get_transient(self::LOCK)) {
            return;
        }
        $queue = self::queue();
        if (!$queue) {
            return;
        }
        set_transient(self::LOCK, time(), self::LOCK_TTL);
        $job = array_shift($queue);
        update_option(self::QUEUE_OPTION, $queue, false);
        ignore_user_abort(true);
        @set_time_limit(self::LOCK_TTL);
        try {
            self::run((string) $job['type'], (array) $job['args'], (string) $job['cacheId']);
        } finally {
            delete_transient(self::LOCK);
        }
        if ($queue) {
            self::loopback();
        }
    }

    /** @param array<string,mixed> $args */
    public static function run(string $type, array $args, string $cacheId): void
    {
        try {
            $ai = new Ai();
            $result = null;
            if ($type === 'place') {
                $result = $ai->placeDescription((string) $args['name'], (string) $args['location'], (array) $args['facts'], (string) $args['tone'], (array) ($args['context'] ?? []));
            } elseif ($type === 'guide') {
                $result = $ai->guide((string) $args['kind'], (string) $args['name'], (string) ($args['code'] ?? ''));
            } elseif ($type === 'events') {
                Events::flush($args);
                $result = 'done';
            } elseif ($type === 'destination') {
                $result = $ai->destinationGuide((string) $args['name'], (string) $args['country'], (array) $args['facts'], (string) $args['tone']);
                $result = ($result['overview'] ?? '') !== '' ? $result : null;
            }
            if ($result === '' || $result === [] || $result === null) {
                // Remember the failure (and why) for an hour so the page falls back instead of saying "writing" forever.
                Cache::set('ai', $cacheId, ['failed' => Ai::$lastError !== '' ? Ai::$lastError : 'no text returned'], HOUR_IN_SECONDS);
            }
        } catch (\Throwable $e) {
            Log::error('Background job failed', ['type' => $type, 'error' => $e->getMessage()]);
            Cache::set('ai', $cacheId, ['failed' => $e->getMessage()], HOUR_IN_SECONDS);
        }
        delete_transient(self::pendingKey($cacheId));
    }
}
