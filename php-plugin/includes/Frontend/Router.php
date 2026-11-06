<?php
declare(strict_types=1);

namespace VisionTrips\Frontend;

use VisionTrips\Airtable\BookingRepository;
use VisionTrips\Airtable\Client;
use VisionTrips\Domain\Trip;
use VisionTrips\Security\Access;
use VisionTrips\Security\Token;
use VisionTrips\Settings;
use VisionTrips\Support\Log;
use VisionTrips\Support\RateLimit;

/**
 * URL space:
 *   /trip/{token}/                       the experience
 *   /trip/{token}/documents/{doc}/{arg}  confirmation | invoice | receipt/{paymentId} | atol | letter | print
 *   /trip/{token}/ics/                   calendar export
 *   /my-trips/?m={baseId}               customer portal (email + code)
 *   legacy: any URL with ?member=app…&booking=rec… → tokenised redirect (old Airtable formula links keep working)
 */
final class Router
{
    public function register(): void
    {
        add_action('init', [$this, 'rewrites']);
        add_filter('query_vars', [$this, 'queryVars']);
        add_action('template_redirect', [$this, 'dispatch'], 0);
        add_action('template_redirect', [$this, 'legacyRedirect'], 1);
        foreach (['vision_trip', 'TTNGBOOKING_V2', 'TTNG_GEMINI_PRINT', 'TTNG_ATOL_CERTIFICATE', 'TTNG_GEMINI_INVOICE', 'TTNG_BASIC_BOOKING', 'airtable_letter'] as $tag) {
            add_shortcode($tag, [$this, 'legacyShortcode']);
        }
    }

    public function rewrites(): void
    {
        $slug = preg_quote(trim((string) Settings::get('trip_page_slug', 'trip'), '/'), '#');
        $portal = preg_quote(trim((string) Settings::get('portal_page_slug', 'my-trips'), '/'), '#');
        add_rewrite_rule('^' . $slug . '/([^/]+)/(documents|ics|accept)/?([^/]*)/?([^/]*)/?$', 'index.php?vision_trip=$matches[1]&vision_view=$matches[2]&vision_doc=$matches[3]&vision_arg=$matches[4]', 'top');
        add_rewrite_rule('^' . $slug . '/sw\.js$', 'index.php?vision_trip=sw.js', 'top');
        add_rewrite_rule('^' . $slug . '/([^/]+)/?$', 'index.php?vision_trip=$matches[1]', 'top');
        add_rewrite_rule('^' . $slug . '/?$', 'index.php?vision_trip=_', 'top');
        add_rewrite_rule('^' . $portal . '/?$', 'index.php?vision_portal=1', 'top');
    }

    /** @param string[] $vars */
    public function queryVars(array $vars): array
    {
        return array_merge($vars, ['vision_trip', 'vision_view', 'vision_doc', 'vision_arg', 'vision_portal']);
    }

    public static function noCache(): void
    {
        if (!defined('DONOTCACHEPAGE')) {
            define('DONOTCACHEPAGE', true);
        }
        if (!defined('DONOTCACHEOBJECT')) {
            define('DONOTCACHEOBJECT', true);
        }
        nocache_headers();
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('X-Robots-Tag: noindex, nofollow, noarchive');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: SAMEORIGIN');
        if (Settings::bool('csp_enabled')) {
            header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self'; frame-src https://www.google.com https://maps.google.com https://www.youtube.com https://player.vimeo.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'");
        }
    }

    /** Old links: ?member=app…&booking=rec… anywhere → /trip/{token}/ (+ document view when the old page implies one). */
    public function legacyRedirect(): void
    {
        if (get_query_var('vision_trip') || get_query_var('vision_portal')) {
            return;
        }
        $base = isset($_GET['member']) ? preg_replace('/[^A-Za-z0-9]/', '', (string) $_GET['member']) : '';
        $record = isset($_GET['booking']) ? preg_replace('/[^A-Za-z0-9]/', '', (string) $_GET['booking']) : '';
        if (!preg_match('/^app[A-Za-z0-9]{14}$/', $base) || !preg_match('/^rec[A-Za-z0-9]{14}$/', $record)) {
            return;
        }
        $path = self::legacyPathFor((string) ($_SERVER['REQUEST_URI'] ?? ''));
        $scope = Token::SCOPE_CUSTOMER;
        $expires = 0;
        $agentKey = substr(hash('sha256', 'agent|' . (string) Settings::get('api_minting_key', '')), 0, 24);
        if (isset($_GET['k']) && is_string($_GET['k']) && hash_equals($agentKey, (string) $_GET['k'])) {
            $scope = Token::SCOPE_AGENT;
            $expires = time() + DAY_IN_SECONDS;
        }
        $url = Token::urlFor($base, $record, $path, $scope, $expires, $scope === Token::SCOPE_CUSTOMER);
        if (isset($_GET['comm']) && preg_match('/^rec[A-Za-z0-9]{14}$/', (string) $_GET['comm'])) {
            $url = add_query_arg('comm', (string) $_GET['comm'], $url);
        }
        self::noCache();
        wp_safe_redirect($url, 302);
        exit;
    }

    private static function legacyPathFor(string $uri): string
    {
        $path = strtolower((string) parse_url($uri, PHP_URL_PATH));
        return match (true) {
            str_contains($path, 'atol') => 'documents/atol',
            str_contains($path, 'invoice') => 'documents/invoice',
            str_contains($path, 'letter') => 'documents/letter',
            str_contains($path, 'printtrip') || str_contains($path, 'print') => 'documents/confirmation',
            str_contains($path, 'frontfile') || str_contains($path, 'front-file') => 'documents/print',
            str_contains($path, 'payments') => 'documents/receipts',
            default => '',
        };
    }

    public function legacyShortcode(array $atts = [], ?string $content = null, string $tag = ''): string
    {
        // Pages that still carry the old shortcodes just need the redirect above; render a quiet fallback.
        return '<p class="vt-legacy">Loading your trip…</p>';
    }

    public function dispatch(): void
    {
        $portal = get_query_var('vision_portal');
        $tokenRaw = get_query_var('vision_trip');
        if ($portal) {
            self::noCache();
            (new Portal())->handle();
            exit;
        }
        if ($tokenRaw === '' || $tokenRaw === null) {
            return;
        }
        if ($tokenRaw === 'sw.js') {
            $this->serviceWorker();
        }
        if ($tokenRaw === 'accessibility') {
            self::noCache();
            $texts = \VisionTrips\Domain\Legal::texts();
            echo View::render('states/plain', ['title' => 'Accessibility statement', 'message' => (string) ($texts['accessibility']['text'] ?? ''), 'status' => 200]);
            exit;
        }
        self::noCache();
        if ($tokenRaw === '_') {
            $this->plain(404, 'Trip not found', 'That link is incomplete. Please use the link your travel agent sent you.');
        }
        $token = Token::parse((string) $tokenRaw);
        if (!$token) {
            Log::warning('Invalid trip token', ['ip' => RateLimit::ip()]);
            $this->plain(404, 'Link not recognised', 'This link has expired or is not valid. Please ask your travel agent for a new one.');
        }
        if (!RateLimit::hit('page|' . RateLimit::ip(), 120, MINUTE_IN_SECONDS)) {
            $this->plain(429, 'Slow down', 'Too many requests. Please try again in a minute.');
        }
        $client = new Client();
        if (!$client->configured()) {
            $this->plain(503, 'Not configured', 'This site is not connected to Vision yet.');
        }
        $repo = new BookingRepository($client);
        $fresh = $token['scope'] === Token::SCOPE_AGENT && isset($_GET['fresh']);
        $trip = $repo->load($token['base'], $token['record'], $fresh);
        if ($trip === null && $repo->unavailable) {
            status_header(503);
            header('Content-Type: text/html; charset=UTF-8');
            header('Retry-After: 10');
            header('X-Vision-State: loading');
            echo View::render('states/loading', []);
            exit;
        }
        if (!$trip) {
            $this->plain(404, 'Trip not found', 'We could not find this trip. Please contact your travel agent.');
        }

        if (isset($_GET['signout'])) {
            Access::revoke($trip->base, $trip->id);
            wp_safe_redirect(Token::url((string) $tokenRaw), 303);
            exit;
        }
        $view = (string) get_query_var('vision_view');
        $doc = (string) get_query_var('vision_doc');
        $arg = (string) get_query_var('vision_arg');
        $level = Access::currentLevel($trip->base, $trip->id);
        $required = !empty($token['traveller']) ? Access::LEVEL_LINK : Access::requiredLevel($trip, !$token['legacy'], $token['scope']);
        $isAgent = $token['scope'] === Token::SCOPE_AGENT;

        // Gate (POST handling + render)
        if ($level < $required) {
            $gate = new Gate($trip, (string) $tokenRaw);
            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                $gate->handlePost();
                $level = Access::currentLevel($trip->base, $trip->id);
            }
            if ($level < $required) {
                echo $gate->render($required);
                exit;
            }
        }

        if ($view === 'ics') {
            if (!Settings::bool('ics_enabled')) {
                $this->plain(404, 'Not available', 'Calendar export is switched off.');
            }
            header('Content-Type: text/calendar; charset=UTF-8');
            header('Content-Disposition: attachment; filename="' . sanitize_file_name($trip->ref ?: 'trip') . '.ics"');
            echo \VisionTrips\Integrations\Ics::build($trip);
            exit;
        }
        if ($view === 'documents') {
            echo (new Documents($trip, (string) $tokenRaw, $isAgent, $level))->render($doc, $arg);
            exit;
        }
        header('X-Vision-State: ' . ($repo->servedStale ? 'stale' : 'ok'));
        $page = new TripPage($trip, (string) $tokenRaw, $level, $isAgent);
        $page->stale = $repo->servedStale;
        $page->traveller = !empty($token['traveller']);
        echo $page->render();
        // Send the page first; the Airtable comment is written after the customer has their response.
        if (function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        } else {
            flush();
        }
        \VisionTrips\Airtable\Audit::viewed($trip, $level, $token['scope']);
        exit;
    }

    /** The service worker: network-first for trip pages, cache-first for assets and fonts, so a saved trip opens with no signal. */
    private function serviceWorker(): never
    {
        header('Content-Type: application/javascript; charset=UTF-8');
        header('Cache-Control: no-cache');
        header('Service-Worker-Allowed: /');
        $cssV = \VisionTrips\Plugin::assetVersion('assets/css/vision.css');
        $jsV = \VisionTrips\Plugin::assetVersion('assets/js/vision.js');
        $v = 'vt-' . md5($cssV . $jsV);
        $assets = wp_json_encode([VISION_TRIPS_URL . 'assets/css/vision.css?ver=' . $cssV, VISION_TRIPS_URL . 'assets/js/vision.js?ver=' . $jsV]);
        echo <<<JS
const CACHE = '{$v}';
const ASSETS = {$assets};
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const isAsset = url.origin === location.origin && url.pathname.indexOf('/assets/') !== -1;
  const isPage = url.origin === location.origin && req.mode === 'navigate';
  if (isFont || isAsset) {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
  } else if (isPage) {
    e.respondWith(fetch(req).then(res => { if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; }).catch(() => caches.match(req)));
  }
});
JS;
        exit;
    }

    private function plain(int $status, string $title, string $message): never
    {
        status_header($status);
        header('Content-Type: text/html; charset=UTF-8');
        echo View::render('states/plain', ['title' => $title, 'message' => $message, 'status' => $status]);
        exit;
    }

    /** Accessor used by REST controllers to load + authorise a trip from a token. @return array{trip:Trip,token:array,level:int}|null */
    public static function resolve(string $tokenRaw): ?array
    {
        $token = Token::parse($tokenRaw);
        if (!$token) {
            return null;
        }
        $repo = new BookingRepository(new Client());
        $trip = $repo->load($token['base'], $token['record']);
        if (!$trip) {
            return null;
        }
        $level = Access::currentLevel($trip->base, $trip->id);
        if ($level < Access::requiredLevel($trip, !$token['legacy'], $token['scope'])) {
            return null;
        }
        return ['trip' => $trip, 'token' => $token, 'level' => $level];
    }
}
