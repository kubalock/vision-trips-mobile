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
                'url'      => self::PHOTO . $photo['name'] . '/media?maxWidthPx=1400&key=' . rawurlencode($this->key),
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
        Cache::set('places', $cacheId, $place, 14 * DAY_IN_SECONDS);
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

    /** Maps Embed URL (uses the embed key if set; otherwise the keyless maps.google.com embed). */
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
