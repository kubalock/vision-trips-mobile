<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Http;
use VisionTrips\Support\Log;
use VisionTrips\Support\Str;

/**
 * Widgety (ocean / river / expedition cruise + touring content).
 *
 * Authentication is by app_id + token query parameters. The API version is negotiated with the
 * Accept header (configurable in wp-admin → Vision Trips → Integrations). Endpoint paths are configurable too,
 * because Widgety's holiday/cruise lookup differs between accounts — verify against developer.widgety.co.uk.
 *
 * Everything is cached for 7 days; responses are normalised into a small, stable shape so templates never see raw payloads.
 */
final class Widgety
{
    private string $baseUrl;
    /** @var array<int,array{app_id:string,token:string}> */
    private array $credentials = [];

    public function __construct()
    {
        $this->baseUrl = rtrim((string) Settings::get('widgety_base_url', 'https://www.widgety.co.uk'), '/');
        foreach ([['widgety_app_id', 'widgety_token'], ['widgety_app_id_2', 'widgety_token_2']] as [$idKey, $tokenKey]) {
            $id = trim((string) Settings::get($idKey, ''));
            $token = trim((string) Settings::get($tokenKey, ''));
            if ($id !== '' && $token !== '') {
                $this->credentials[] = ['app_id' => $id, 'token' => $token];
            }
        }
    }

    public function configured(): bool
    {
        return $this->credentials !== [];
    }

    /** Ship profile by Widgety ship id/slug or by name. @return array<string,mixed>|null */
    public function ship(string $idOrSlug, string $name = ''): ?array
    {
        if (!$this->configured()) {
            return null;
        }
        $key = 'ship|' . ($idOrSlug !== '' ? $idOrSlug : Str::slug($name));
        $cached = Cache::get('widgety', $key);
        if (is_array($cached)) {
            return $cached;
        }
        $candidates = [];
        if ($idOrSlug !== '') {
            $candidates[] = $idOrSlug;
        }
        if ($name !== '') {
            $slug = Str::slug($name);
            $candidates[] = $slug;
            $candidates[] = str_replace('-', '', $slug);
            if (str_starts_with($slug, 'the-')) {
                $candidates[] = substr($slug, 4);
            }
        }
        $path = (string) Settings::get('widgety_ship_path', '/api/ships/{slug}.json');
        foreach (array_unique($candidates) as $slug) {
            $url = $this->baseUrl . str_replace('{slug}', rawurlencode($slug), $path);
            $payload = $this->get($url, [
                'profile_image_geometry' => '400x', 'cover_image_geometry' => '1600x', 'images_geometry' => '1200x',
                'deckplan_images_geometry' => '1600x', 'accomodation_type_images_geometry' => '1000x', 'dining_option_images_geometry' => '1000x',
            ]);
            if ($payload) {
                $ship = $this->normaliseShip($payload, $name);
                Cache::set('widgety', $key, $ship, WEEK_IN_SECONDS);
                return $ship;
            }
        }
        Log::info('Widgety ship not found', ['slug' => $idOrSlug, 'name' => $name]);
        Cache::negative('widgety', $key, 30 * MINUTE_IN_SECONDS);
        return null;
    }

    /** Holiday / sailing by operator voyage code (the "Voyage Code" on the Vision element). @return array<string,mixed>|null */
    public function holidayByReference(string $reference): ?array
    {
        $reference = trim($reference);
        if (!$this->configured() || $reference === '') {
            return null;
        }
        $cached = Cache::get('widgety', 'holiday|' . $reference);
        if (is_array($cached)) {
            return isset($cached['missing']) ? null : $cached;
        }
        $path = (string) Settings::get('widgety_holiday_lookup', '/api/cruises.json?reference={ref}');
        $url = $this->baseUrl . str_replace('{ref}', rawurlencode($reference), $path);
        $payload = $this->get($url, ['images_geometry' => '1200x']);
        $holiday = $payload ? $this->normaliseHoliday($payload, $reference) : null;
        if ($holiday) {
            Cache::set('widgety', 'holiday|' . $reference, $holiday, WEEK_IN_SECONDS);
            return $holiday;
        }
        Cache::negative('widgety', 'holiday|' . $reference, 30 * MINUTE_IN_SECONDS);
        return null;
    }

    /**
     * Destination / port content by name (images, description, country). Tries the configured lookup path and
     * picks the best name match. @return array{name:string,country:string,text:string,images:string[]}|null
     */
    public function destination(string $name): ?array
    {
        $name = trim($name);
        if (!$this->configured() || $name === '') {
            return null;
        }
        $key = 'dest|' . Str::slug($name);
        $cached = Cache::get('widgety', $key);
        if (is_array($cached)) {
            return isset($cached['missing']) ? null : $cached;
        }
        $path = (string) Settings::get('widgety_destination_lookup', '/api/ports.json?search={name}');
        $payload = $this->get($this->baseUrl . str_replace('{name}', rawurlencode($name), $path), ['images_geometry' => '1400x']);
        $rows = $payload ? self::rows($payload) : [];
        if (!$rows && is_array($payload) && isset($payload['title'])) {
            $rows = [$payload];
        }
        $want = Str::slug($name);
        $best = null;
        $bestScore = 0;
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $title = Str::slug(Str::clean($row['title'] ?? $row['name'] ?? ''));
            $score = $title === $want ? 3 : (str_starts_with($title, $want) || str_starts_with($want, $title) ? 2 : (str_contains($title, $want) ? 1 : 0));
            if ($score > $bestScore) {
                $best = $row;
                $bestScore = $score;
            }
        }
        if (!$best) {
            Cache::negative('widgety', $key, DAY_IN_SECONDS);
            return null;
        }
        $images = [];
        foreach (['image_href', 'image', 'cover_image_href', 'profile_image_href'] as $k) {
            $u = self::url($best[$k] ?? null);
            if ($u !== '') {
                $images[] = $u;
            }
        }
        foreach (['images', 'gallery', 'photos'] as $gk) {
            foreach ((array) ($best[$gk] ?? []) as $node) {
                $u = self::url($node);
                if ($u !== '') {
                    $images[] = $u;
                }
            }
        }
        $out = [
            'name'    => Str::clean($best['title'] ?? $best['name'] ?? $name),
            'country' => Str::clean(is_array($best['country'] ?? null) ? ($best['country']['title'] ?? $best['country']['name'] ?? '') : ($best['country'] ?? '')),
            'text'    => Str::richText(Str::clean($best['description'] ?? $best['introduction'] ?? $best['overview'] ?? '')),
            'images'  => array_values(array_unique($images)),
        ];
        Cache::set('widgety', $key, $out, WEEK_IN_SECONDS);
        return $out;
    }

    /**
     * Destination / port content by name (images + description). Tries the port lookup then the destination lookup;
     * both paths are settings because they differ per Widgety account.
     * @return array{name:string,country:string,description:string,images:string[]}|null
     */
    public function place(string $name, string $country = ''): ?array
    {
        $name = trim($name);
        if (!$this->configured() || $name === '') {
            return null;
        }
        $key = 'place|' . Str::slug($name) . '|' . Str::slug($country);
        $cached = Cache::get('widgety', $key);
        if (is_array($cached)) {
            return isset($cached['missing']) ? null : $cached;
        }
        foreach (['widgety_place_lookup', 'widgety_destination_lookup'] as $settingKey) {
            $path = (string) Settings::get($settingKey, '');
            if ($path === '') {
                continue;
            }
            $url = $this->baseUrl . str_replace('{name}', rawurlencode($name), $path);
            $payload = $this->get($url, ['images_geometry' => '1400x']);
            if (!$payload) {
                continue;
            }
            $rows = self::rows($payload) ?: (isset($payload['title']) || isset($payload['name']) ? [$payload] : []);
            $best = null;
            $target = Str::slug($name);
            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }
                $rowName = Str::clean($row['title'] ?? $row['name'] ?? '');
                $slug = Str::slug($rowName);
                if ($slug === $target || str_starts_with($slug, $target . '-') || str_starts_with($target, $slug . '-')) {
                    $rowCountry = Str::clean(is_array($row['country'] ?? null) ? ($row['country']['title'] ?? $row['country']['name'] ?? '') : ($row['country'] ?? ''));
                    if ($country === '' || $rowCountry === '' || Str::slug($rowCountry) === Str::slug($country)) {
                        $best = $row;
                        break;
                    }
                    $best = $best ?? $row;
                }
            }
            if ($best) {
                $images = [];
                foreach (['image_href', 'image', 'cover_image_href', 'cover_image', 'profile_image_href'] as $k) {
                    $u = self::url($best[$k] ?? null);
                    if ($u !== '') {
                        $images[] = $u;
                    }
                }
                foreach (['images', 'gallery', 'photos'] as $gk) {
                    foreach ((array) ($best[$gk] ?? []) as $node) {
                        $u = self::url($node);
                        if ($u !== '') {
                            $images[] = $u;
                        }
                    }
                }
                $place = [
                    'name'        => Str::clean($best['title'] ?? $best['name'] ?? $name),
                    'country'     => Str::clean(is_array($best['country'] ?? null) ? ($best['country']['title'] ?? '') : ($best['country'] ?? $country)),
                    'description' => Str::richText(Str::clean($best['description'] ?? $best['introduction'] ?? $best['overview'] ?? $best['teaser'] ?? '')),
                    'images'      => array_values(array_unique($images)),
                ];
                Cache::set('widgety', $key, $place, WEEK_IN_SECONDS);
                return $place;
            }
        }
        Cache::negative('widgety', $key, 30 * MINUTE_IN_SECONDS);
        return null;
    }

    /** @return array<string,mixed>|null */
    private function get(string $url, array $extra = []): ?array
    {
        foreach ($this->credentials as $cred) {
            $sep = str_contains($url, '?') ? '&' : '?';
            $full = $url . $sep . http_build_query(array_merge(['app_id' => $cred['app_id'], 'token' => $cred['token']], $extra));
            $res = Http::getJson($full, ['Accept' => (string) Settings::get('widgety_accept_header', 'application/json')], 15, 1);
            if ($res['ok'] && is_array($res['data'])) {
                return $res['data'];
            }
            if (!in_array($res['status'], [401, 403, 404], true)) {
                Log::warning('Widgety request failed', ['status' => $res['status'], 'error' => $res['error']]);
            }
        }
        return null;
    }

    private static function url(mixed $v): string
    {
        if (is_string($v)) {
            return $v;
        }
        if (is_array($v)) {
            foreach (['href', 'url', 'src', 'large', 'original'] as $k) {
                if (!empty($v[$k]) && is_string($v[$k])) {
                    return $v[$k];
                }
            }
            foreach ($v as $item) {
                $u = self::url($item);
                if ($u !== '') {
                    return $u;
                }
            }
        }
        return '';
    }

    /** @return array<int,array<string,mixed>> */
    private static function rows(mixed $section): array
    {
        if (!is_array($section)) {
            return [];
        }
        foreach (['items', 'records', 'results', 'data'] as $k) {
            if (!empty($section[$k]) && is_array($section[$k])) {
                return $section[$k];
            }
        }
        return isset($section[0]) && is_array($section[0]) ? $section : [];
    }

    /** @return array<string,mixed> */
    private function normaliseShip(array $payload, string $fallbackName): array
    {
        $s = is_array($payload['ship'] ?? null) ? $payload['ship'] : $payload;
        $section = function (string ...$keys) use ($s): array {
            foreach ($keys as $k) {
                if (!empty($s[$k])) {
                    $out = [];
                    foreach (self::rows($s[$k]) as $row) {
                        if (!is_array($row)) {
                            continue;
                        }
                        $images = [];
                        foreach (['image_href', 'image', 'cover_image_href', 'profile_image_href', 'photo'] as $ik) {
                            $u = self::url($row[$ik] ?? null);
                            if ($u !== '') {
                                $images[] = $u;
                            }
                        }
                        foreach (['images', 'gallery', 'unique_feature_images'] as $gk) {
                            foreach ((array) ($row[$gk] ?? []) as $node) {
                                $u = self::url($node);
                                if ($u !== '') {
                                    $images[] = $u;
                                }
                            }
                        }
                        $out[] = [
                            'name'   => Str::clean($row['title'] ?? $row['name'] ?? ''),
                            'text'   => Str::richText(Str::clean($row['description'] ?? $row['introduction'] ?? $row['overview'] ?? '')),
                            'images' => array_values(array_unique($images)),
                            'video'  => Str::clean($row['video_url'] ?? $row['video_href'] ?? ''),
                        ];
                    }
                    return $out;
                }
            }
            return [];
        };
        $facts = [];
        foreach (['ship_class' => 'Class', 'style' => 'Style', 'size' => 'Size', 'launch_year' => 'Launched', 'refit_year' => 'Refurbished', 'gross_tonnage' => 'Tonnage', 'length' => 'Length (m)', 'capacity' => 'Guests', 'crew' => 'Crew', 'crew_count' => 'Crew', 'decks' => 'Decks', 'deck_count' => 'Decks', 'cabins' => 'Cabins', 'cabin_count' => 'Cabins', 'language' => 'Language', 'currency' => 'Onboard currency'] as $k => $label) {
            $v = Str::clean($s[$k] ?? '');
            if ($v !== '' && !isset($facts[$label])) {
                $facts[$label] = ucwords(str_replace('_', ' ', $v));
            }
        }
        return [
            'name'     => Str::clean($s['title'] ?? $s['name'] ?? '') ?: $fallbackName,
            'operator' => Str::clean(is_array($s['operator'] ?? null) ? ($s['operator']['title'] ?? $s['operator']['name'] ?? '') : ($s['operator'] ?? '')),
            'teaser'   => Str::richText(Str::clean($s['teaser'] ?? '')),
            'intro'    => Str::richText(Str::clean($s['introduction'] ?? '')),
            'cover'    => self::url($s['cover_image_href'] ?? $s['cover_image'] ?? null),
            'profile'  => self::url($s['profile_image_href'] ?? $s['profile_image'] ?? null),
            'video'    => Str::clean($s['video_url'] ?? ''),
            'facts'    => $facts,
            'sections' => [
                'Accommodation'   => $section('accommodation_types', 'accomodation_types'),
                'Dining'          => $section('dining_options'),
                'Entertainment'   => $section('entertainment_types'),
                'Enrichment'      => $section('enrichment_types'),
                'Health & fitness' => $section('health_fitness_types'),
                'Kids & teens'    => $section('kids_and_teens_types'),
                'Deck plans'      => $section('deckplans'),
                'Useful to know'  => $section('useful_types'),
            ],
        ];
    }

    /** @return array<string,mixed>|null */
    private function normaliseHoliday(array $payload, string $reference): ?array
    {
        $rows = self::rows($payload);
        $h = $rows[0] ?? (is_array($payload['cruise'] ?? null) ? $payload['cruise'] : (is_array($payload['holiday'] ?? null) ? $payload['holiday'] : $payload));
        if (!is_array($h) || !$h) {
            return null;
        }
        // Prefer an exact reference match when several rows come back.
        foreach ($rows as $row) {
            foreach (['reference', 'code', 'voyage_code', 'cruise_code', 'holiday_reference'] as $k) {
                if (isset($row[$k]) && strcasecmp(trim((string) $row[$k]), $reference) === 0) {
                    $h = $row;
                    break 2;
                }
            }
        }
        $days = [];
        $itin = $h['itinerary'] ?? $h['itineraries'] ?? $h['days'] ?? $h['ports'] ?? [];
        $i = 0;
        foreach (self::rows($itin) ?: (array) $itin as $row) {
            if (!is_array($row)) {
                continue;
            }
            $i++;
            $port = is_array($row['port'] ?? null) ? ($row['port']['title'] ?? $row['port']['name'] ?? '') : ($row['port'] ?? $row['title'] ?? $row['name'] ?? $row['location'] ?? '');
            $port = Str::clean($port);
            if ($port === '') {
                continue;
            }
            $days[] = [
                'day'     => (string) ($row['day'] ?? $row['day_number'] ?? $i),
                'date'    => Str::clean($row['date'] ?? ''),
                'port'    => $port,
                'country' => Str::clean(is_array($row['port'] ?? null) ? ($row['port']['country'] ?? '') : ($row['country'] ?? '')),
                'arrive'  => Str::clean($row['arrive'] ?? $row['arrival'] ?? $row['arrival_time'] ?? ''),
                'depart'  => Str::clean($row['depart'] ?? $row['departure'] ?? $row['departure_time'] ?? ''),
                'text'    => Str::richText(Str::clean($row['description'] ?? $row['overview'] ?? '')),
                'image'   => self::url($row['image_href'] ?? $row['image'] ?? (is_array($row['port'] ?? null) ? ($row['port']['image_href'] ?? null) : null)),
                'atSea'   => stripos($port, 'at sea') !== false || stripos($port, 'cruising') !== false,
            ];
        }
        $images = [];
        foreach ((array) ($h['images'] ?? $h['gallery'] ?? []) as $node) {
            $u = self::url($node);
            if ($u !== '') {
                $images[] = $u;
            }
        }
        return [
            'reference' => $reference,
            'name'      => Str::clean($h['title'] ?? $h['name'] ?? ''),
            'operator'  => Str::clean(is_array($h['operator'] ?? null) ? ($h['operator']['title'] ?? '') : ($h['operator'] ?? '')),
            'ship'      => Str::clean(is_array($h['ship'] ?? null) ? ($h['ship']['title'] ?? $h['ship']['name'] ?? '') : ($h['ship'] ?? '')),
            'nights'    => (int) ($h['nights'] ?? $h['duration'] ?? 0),
            'starts'    => Str::clean($h['start_date'] ?? $h['starts'] ?? $h['departure_date'] ?? ''),
            'ends'      => Str::clean($h['end_date'] ?? $h['ends'] ?? ''),
            'description' => Str::richText(Str::clean($h['description'] ?? $h['introduction'] ?? '')),
            'highlights'  => Str::richText(Str::clean($h['highlights'] ?? '')),
            'included'    => Str::richText(Str::clean($h['whats_included'] ?? $h['included'] ?? '')),
            'images'    => array_values(array_unique($images)),
            'days'      => $days,
        ];
    }
}
