<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Http;
use VisionTrips\Support\Log;
use VisionTrips\Support\Str;

/**
 * Google Places API (New). Finds the accommodation / POI by name + location and returns a compact profile:
 * official-first photos (photos whose author attribution is the business itself), rating, address, website,
 * editorial summary where Google has one, and coordinates for maps/weather.
 */
final class Places
{
    private const SEARCH = 'https://places.googleapis.com/v1/places:searchText';
    private const PHOTO = 'https://places.googleapis.com/v1/';

    private string $key;
    /** Why the last lookup was accepted or rejected (for the admin sources panel). */
    public static string $lastMatch = '';

    public function __construct()
    {
        $this->key = trim((string) Settings::get('google_places_key', ''));
    }

    public function configured(): bool
    {
        return $this->key !== '';
    }

    /**
     * @return array{id:string,name:string,address:string,rating:float,ratings:int,website:string,phone:string,summary:string,mapsUrl:string,lat:float,lng:float,photos:array<int,array{url:string,author:string,official:bool}>,types:string[],reviews:array<int,array{text:string,rating:int,author:string}>}|null
     */
    public function find(string $query, ?float $biasLat = null, ?float $biasLng = null, bool $anyPhotos = false): ?array
    {
        $query = trim($query);
        if (!$this->configured() || $query === '') {
            return null;
        }
        $cacheId = md5(strtolower($query) . ($anyPhotos ? '|any' : ''));
        $cached = Cache::get('places', $cacheId);
        if (is_array($cached)) {
            self::$lastMatch = isset($cached['missing']) ? 'no match (cached)' : 'matched earlier (cached)';
            return isset($cached['missing']) ? null : $cached;
        }
        self::$lastMatch = '';
        $body = [
            'textQuery'    => $query,
            'maxResultCount' => 1,
            'languageCode' => 'en-GB',
        ];
        if ($biasLat !== null && $biasLng !== null) {
            $body['locationBias'] = ['circle' => ['center' => ['latitude' => $biasLat, 'longitude' => $biasLng], 'radius' => 20000.0]];
        }
        $fieldMask = 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.internationalPhoneNumber,places.editorialSummary,places.googleMapsUri,places.location,places.photos,places.types,places.reviews,places.priceLevel';
        $res = Http::sendJson('POST', self::SEARCH, $body, ['X-Goog-Api-Key' => $this->key, 'X-Goog-FieldMask' => $fieldMask], 15);
        if (!$res['ok'] || empty($res['data']['places'][0])) {
            if (!$res['ok']) {
                Log::warning('Places search failed', ['status' => $res['status'], 'error' => $res['error']]);
            }
            // Configuration/auth problems are not cached, so fixing the key takes effect immediately.
            if ($res['ok'] || $res['status'] === 404 || $res['status'] === 200) {
                Cache::negative('places', $cacheId, 30 * MINUTE_IN_SECONDS);
            }
            return null;
        }
        $p = $res['data']['places'][0];
        $name = Str::clean($p['displayName']['text'] ?? '');
        // Never show the wrong hotel: verify the match before trusting photos or reviews.
        $verdict = self::verify($query, $name, Str::clean($p['formattedAddress'] ?? ''), array_map('strval', (array) ($p['types'] ?? [])), (float) ($p['location']['latitude'] ?? 0), (float) ($p['location']['longitude'] ?? 0), $biasLat, $biasLng, !$anyPhotos);
        self::$lastMatch = $verdict['reason'];
        if (!$verdict['ok']) {
            Log::info('Places result rejected', ['query' => $query, 'result' => $name, 'reason' => $verdict['reason']]);
            Cache::negative('places', $cacheId, 30 * MINUTE_IN_SECONDS);
            return null;
        }
        $photos = [];
        $officialOnly = Settings::bool('places_official_only') && !$anyPhotos;
        $max = max(1, Settings::int('places_max_photos', 6));
        foreach ((array) ($p['photos'] ?? []) as $photo) {
            $author = Str::clean($photo['authorAttributions'][0]['displayName'] ?? '');
            $official = $author !== '' && $name !== '' && (stripos($author, $name) !== false || stripos($name, $author) !== false);
            $photos[] = [
                'name'     => (string) $photo['name'],
                'url'      => '',
                'author'   => $author,
                'official' => $official,
            ];
        }
        $officialPhotos = array_values(array_filter($photos, static fn ($x) => $x['official']));
        if ($officialOnly) {
            $photos = $officialPhotos ?: array_slice($photos, 0, 3); // fall back to a few if the business posted none
        } else {
            usort($photos, static fn ($a, $b) => ((int) $b['official']) <=> ((int) $a['official']));
        }
        $photos = array_slice($photos, 0, $max);
        // Keep the photo names; URLs are resolved at render time (local copy when the background job has fetched it).
        foreach ($photos as &$ph) {
            $ph['url'] = self::PHOTO . $ph['name'] . '/media?maxWidthPx=1200&key=' . rawurlencode($this->key);
        }
        unset($ph);
        $reviews = [];
        foreach ((array) ($p['reviews'] ?? []) as $r) {
            $text = Str::clean($r['text']['text'] ?? $r['originalText']['text'] ?? '');
            $rating = (int) ($r['rating'] ?? 0);
            // Only warm, genuinely positive reviews are ever shown to a customer.
            if ($text !== '' && $rating >= 4 && mb_strlen($text) >= 40 && !preg_match('/\b(terrible|awful|worst|dirty|rude|disgusting|scam|never again|avoid|refund|complain)/i', $text)) {
                $reviews[] = ['text' => Str::truncate($text, 220), 'rating' => $rating, 'author' => Str::clean($r['authorAttribution']['displayName'] ?? '')];
            }
        }
        usort($reviews, static fn ($a, $b) => [$b['rating'], mb_strlen($b['text'])] <=> [$a['rating'], mb_strlen($a['text'])]);
        $place = [
            'id'      => (string) ($p['id'] ?? ''),
            'name'    => $name,
            'address' => Str::clean($p['formattedAddress'] ?? ''),
            'rating'  => (float) ($p['rating'] ?? 0),
            'ratings' => (int) ($p['userRatingCount'] ?? 0),
            'website' => Str::clean($p['websiteUri'] ?? ''),
            'phone'   => Str::clean($p['internationalPhoneNumber'] ?? ''),
            'summary' => Str::clean($p['editorialSummary']['text'] ?? ''),
            'mapsUrl' => Str::clean($p['googleMapsUri'] ?? ''),
            'lat'     => (float) ($p['location']['latitude'] ?? 0),
            'lng'     => (float) ($p['location']['longitude'] ?? 0),
            'photos'  => $photos,
            'types'   => array_map('strval', (array) ($p['types'] ?? [])),
            'reviews' => array_slice($reviews, 0, 3),
            'priceLevel' => Str::clean($p['priceLevel'] ?? ''),
        ];
        Cache::set('places', $cacheId, $place, 30 * DAY_IN_SECONDS); // a hotel does not change much in a month
        return $place;
    }

    /**
     * Match confidence between what Vision calls the place and what Google returned.
     * Mode (wp-admin → Connections → Google Places → Match checking): balanced (default) rejects only on strong
     * evidence of the wrong place; strict requires a clear name match and lodging type; off accepts Google's first result.
     * @param string[] $types
     * @return array{ok:bool,reason:string}
     */
    public static function verify(string $query, string $resultName, string $resultAddress, array $types, float $lat, float $lng, ?float $biasLat, ?float $biasLng, bool $expectLodging): array
    {
        $mode = (string) Settings::get('places_match_mode', 'balanced');
        $norm = static function (string $s, bool $stripStop = true): array {
            $s = strtolower(function_exists('remove_accents') ? remove_accents($s) : $s);
            $s = (string) preg_replace('/[^a-z0-9 ]+/', ' ', $s);
            $stop = $stripStop ? ['the', 'hotel', 'hotels', 'resort', 'resorts', 'spa', 'and', 'by', 'of', 'at', 'in', 'a', 'an', 'suites', 'apartments', 'apartment', 'villa', 'villas', 'beach', 'club', 'collection', 'inn', 'lodge', 'palace', 'grand', 'boutique', 'luxury', 'all', 'inclusive'] : [];
            return array_values(array_filter(array_unique(explode(' ', $s)), static fn ($t) => $t !== '' && strlen($t) > 1 && !in_array($t, $stop, true)));
        };
        $qName = (string) preg_replace('/,.*$/', '', $query);
        $q = $norm($qName) ?: $norm($qName, false);
        $r = $norm($resultName) ?: $norm($resultName, false);
        $inter = count(array_intersect($q, $r));
        $score = ($q && $r) ? $inter / max(1, min(count($q), count($r))) : 0.0;
        similar_text(strtolower($qName), strtolower($resultName), $pct);
        $score = max($score, $pct / 100);
        $qf = $norm($qName, false);
        $rf = $norm($resultName, false);
        $scoreFull = ($qf && $rf) ? count(array_intersect($qf, $rf)) / max(1, min(count($qf), count($rf))) : 0.0;
        $addressHit = false;
        foreach ($norm((string) (str_contains($query, ',') ? substr($query, (int) strpos($query, ',')) : ''), false) as $tok) {
            if (strlen($tok) > 3 && stripos($resultAddress, $tok) !== false) {
                $addressHit = true;
            }
        }
        $km = null;
        if ($biasLat !== null && $biasLng !== null && $lat !== 0.0) {
            $km = 6371 * acos(max(-1, min(1, cos(deg2rad($biasLat)) * cos(deg2rad($lat)) * cos(deg2rad($lng) - deg2rad($biasLng)) + sin(deg2rad($biasLat)) * sin(deg2rad($lat)))));
        }
        $lodgingTypes = ['lodging', 'hotel', 'resort_hotel', 'bed_and_breakfast', 'guest_house', 'inn', 'motel', 'hostel', 'extended_stay_hotel', 'cottage', 'villa', 'apartment_complex', 'vacation_rental', 'campground', 'rv_park', 'private_guest_room', 'farmstay', 'japanese_inn'];
        $lodging = !$expectLodging || !$types || (bool) array_intersect($types, $lodgingTypes);
        $reason = sprintf('name %.2f%s%s%s', $score, $addressHit ? ', address ✓' : '', $km !== null ? sprintf(', %.0f km', $km) : '', $expectLodging && $types ? ($lodging ? ', lodging ✓' : ', not lodging') : '');
        if ($mode === 'off') {
            return ['ok' => true, 'reason' => 'accepted (checking off): ' . $reason];
        }
        if ($mode === 'strict') {
            $ok = $lodging && ($km === null || $km <= 40) && ($score >= 0.5 || ($score >= 0.34 && ($addressHit || $km !== null)));
            return ['ok' => $ok, 'reason' => ($ok ? 'matched: ' : 'rejected: ') . $reason];
        }
        // balanced: a clear name match wins; a lodging-typed result needs a fair name match; anything not lodging
        // must match the full name closely; a far-away result needs a near-perfect name.
        if ($km !== null && $km > 150 && $score < 0.8) {
            return ['ok' => false, 'reason' => 'rejected (too far): ' . $reason];
        }
        $ok = $lodging ? $score >= 0.34 : $scoreFull >= 0.75;
        return ['ok' => $ok, 'reason' => ($ok ? 'matched: ' : 'rejected: ') . $reason];
    }

    /** @return array{dir:string,url:string}|null */
    private static function photoStore(): ?array
    {
        if (!Settings::bool('places_cache_photos') || !function_exists('wp_upload_dir')) {
            return null;
        }
        $uploads = wp_upload_dir();
        if (!empty($uploads['error'])) {
            return null;
        }
        return ['dir' => trailingslashit($uploads['basedir']) . 'vision-trips/places/', 'url' => trailingslashit($uploads['baseurl']) . 'vision-trips/places/'];
    }

    /**
     * The URL to show for a photo right now: the local copy if the background job has fetched it, otherwise the
     * direct Places URL while a job is queued to fetch it. Nothing is ever downloaded inside a page or section request.
     * @param array{name?:string,url:string} $photo
     */
    public static function photoSrc(array $photo): string
    {
        $name = (string) ($photo['name'] ?? '');
        $direct = (string) ($photo['url'] ?? '');
        $store = self::photoStore();
        if ($name === '' || $store === null || $direct === '') {
            return $direct;
        }
        $hash = md5($name);
        $file = $store['dir'] . $hash . '.jpg';
        if (is_file($file) && filemtime($file) > time() - 14 * DAY_IN_SECONDS) {
            return $store['url'] . $hash . '.jpg';
        }
        // Not on disk yet: the page links to our own photo endpoint, which fetches from Google on first request
        // (server-side, so API-key restrictions never apply), stores the file and streams it. Images appear at once.
        set_transient('vtr_photo_' . $hash, $direct, 30 * DAY_IN_SECONDS);
        \VisionTrips\Support\Jobs::dispatch('photo', ['name' => $name, 'url' => $direct, 'hash' => $hash], 'photo|' . $hash);
        return home_url('/' . trim((string) Settings::get('trip_page_slug', 'trip'), '/') . '/photo/' . $hash . '.jpg?k=' . self::sig($hash));
    }

    private static function sig(string $hash): string
    {
        return substr(hash_hmac('sha256', 'photo|' . $hash, (string) Settings::get('link_secret', '')), 0, 12);
    }

    /** /trip/photo/{hash}.jpg — serve from disk, or fetch from Google once, store and serve. Never returns. */
    public static function servePhoto(string $hash, string $key): never
    {
        $hash = (string) preg_replace('/[^a-f0-9]/', '', $hash);
        if (strlen($hash) !== 32 || !hash_equals(self::sig($hash), $key)) {
            status_header(404);
            exit;
        }
        $store = self::photoStore();
        $file = $store ? $store['dir'] . $hash . '.jpg' : '';
        if ($file === '' || !is_file($file)) {
            $direct = (string) get_transient('vtr_photo_' . $hash);
            if ($direct === '' || !self::fetchPhoto(['name' => $hash, 'url' => $direct, 'hash' => $hash])) {
                status_header(404);
                header('Cache-Control: no-store');
                exit;
            }
        }
        \VisionTrips\Support\Assets::stream($file, 'image/jpeg', 1209600);
    }

    /** Background or on-demand: download one photo into uploads. @param array<string,mixed> $args */
    public static function fetchPhoto(array $args): bool
    {
        $store = self::photoStore();
        $name = (string) ($args['name'] ?? '');
        $direct = (string) ($args['url'] ?? '');
        if ($store === null || $name === '' || $direct === '') {
            return false;
        }
        $hash = (string) ($args['hash'] ?? md5($name));
        if (is_file($store['dir'] . $hash . '.jpg')) {
            return true;
        }
        if (!is_dir($store['dir'])) {
            wp_mkdir_p($store['dir']);
        }
        $res = wp_remote_get($direct, ['timeout' => 15, 'redirection' => 3]);
        \VisionTrips\Support\Metrics::hit('places_photo');
        if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) !== 200) {
            return false;
        }
        $body = (string) wp_remote_retrieve_body($res);
        $type = (string) wp_remote_retrieve_header($res, 'content-type');
        if ($body === '' || strlen($body) > 4 * 1024 * 1024 || !str_starts_with($type, 'image/')) {
            return false;
        }
        return @file_put_contents($store['dir'] . $hash . '.jpg', $body) !== false;
    }

    /** The agency's own Google rating and review count, by trading name + address, cached a week. @return array{rating:float,count:int,url:string} */
    public function agencyRating(string $name, string $address): array
    {
        $empty = ['rating' => 0.0, 'count' => 0, 'url' => ''];
        if (!$this->configured() || $name === '') {
            return $empty;
        }
        $key = md5('agency|' . strtolower($name) . '|' . strtolower($address));
        $cached = Cache::get('places', $key);
        if (is_array($cached)) {
            return $cached + $empty;
        }
        $res = Http::sendJson('POST', self::SEARCH, ['textQuery' => $name . ($address !== '' ? ', ' . $address : ''), 'maxResultCount' => 1], ['X-Goog-Api-Key' => $this->key, 'X-Goog-FieldMask' => 'places.displayName,places.rating,places.userRatingCount,places.googleMapsUri'], 12);
        $p = $res['ok'] ? ($res['data']['places'][0] ?? null) : null;
        $out = $empty;
        if (is_array($p) && similar_text(strtolower($name), strtolower((string) ($p['displayName']['text'] ?? ''))) / max(1, strlen($name)) > 0.6) {
            $out = ['rating' => (float) ($p['rating'] ?? 0), 'count' => (int) ($p['userRatingCount'] ?? 0), 'url' => (string) ($p['googleMapsUri'] ?? '')];
        }
        Cache::set('places', $key, $out, 7 * DAY_IN_SECONDS);
        return $out;
    }

    /** Maps Embed URL (uses the embed key if set; otherwise the keyless maps.google.com embed). */
    /**
     * A map of the whole route: origin, stops and destination, for trips with two or more places. Needs the Maps Embed
     * key (free); without it there is no route map. @param array<int,array{lat:float,lng:float}> $points
     */
    public static function routeUrl(array $points): string
    {
        $key = trim((string) Settings::get('google_maps_embed_key', ''));
        $points = array_values(array_filter($points, static fn ($p) => isset($p['lat'], $p['lng'])));
        if ($key === '' || count($points) < 2) {
            return '';
        }
        $fmt = static fn (array $p) => round((float) $p['lat'], 5) . ',' . round((float) $p['lng'], 5);
        $origin = $fmt(array_shift($points));
        $dest = $fmt(array_pop($points));
        $way = implode('|', array_map($fmt, array_slice($points, 0, 8)));
        return 'https://www.google.com/maps/embed/v1/directions?key=' . rawurlencode($key) . '&origin=' . rawurlencode($origin) . '&destination=' . rawurlencode($dest) . ($way !== '' ? '&waypoints=' . rawurlencode($way) : '') . '&mode=driving&units=metric';
    }

    public static function embedUrl(string $query, ?float $lat = null, ?float $lng = null, string $placeId = ''): string
    {
        $key = trim((string) Settings::get('google_maps_embed_key', ''));
        if ($key !== '') {
            $q = $placeId !== '' ? 'place_id:' . $placeId : ($lat !== null && $lng !== null ? $lat . ',' . $lng : $query);
            return 'https://www.google.com/maps/embed/v1/place?key=' . rawurlencode($key) . '&q=' . rawurlencode($q) . '&zoom=14';
        }
        $q = $lat !== null && $lng !== null ? $lat . ',' . $lng : $query;
        return 'https://maps.google.com/maps?q=' . rawurlencode($q) . '&z=14&output=embed';
    }

    public static function directionsUrl(string $query, ?float $lat = null, ?float $lng = null): string
    {
        $dest = $lat !== null && $lng !== null ? $lat . ',' . $lng : $query;
        return 'https://www.google.com/maps/dir/?api=1&destination=' . rawurlencode($dest);
    }
}
