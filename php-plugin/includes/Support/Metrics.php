<?php
declare(strict_types=1);

namespace VisionTrips\Support;

use VisionTrips\Settings;

/**
 * Counts every outbound API call per provider per day, with AI token usage, and estimates cost from editable unit
 * prices (APIs bill in USD; a GBP rate is applied for the summary). Nothing here is ever shown to customers.
 */
final class Metrics
{
    private const OPTION = 'vision_trips_metrics';
    private const KEEP_DAYS = 92;

    public const PROVIDERS = [
        'airtable'      => 'Airtable (Vision)',
        'places_search' => 'Google Places — text search',
        'places_photo'  => 'Google Places — photo download',
        'anthropic'     => 'AI (Anthropic) — requests',
        'aerodatabox'   => 'AeroDataBox flight status',
        'aviationstack' => 'AviationStack flight status',
        'widgety'       => 'Widgety',
        'openmeteo'     => 'Open-Meteo weather',
        'avs_logo'      => 'Airline logos (pics.avs.io)',
        'other'         => 'Other',
    ];

    /** Default unit prices in USD; editable in wp-admin → Costs. */
    public const DEFAULT_PRICES = [
        'places_search' => 0.032,   // per text search (Pro SKU)
        'places_photo'  => 0.007,   // per photo download
        'aerodatabox'   => 0.002,   // per status call (tiered on RapidAPI)
        'aviationstack' => 0.0,
        'anthropic_in'  => 3.0,     // per million input tokens
        'anthropic_out' => 15.0,    // per million output tokens
        'anthropic_search' => 0.01, // per web search
        'widgety'       => 0.0,
        'openmeteo'     => 0.0,
        'airtable'      => 0.0,
        'avs_logo'      => 0.0,
        'other'         => 0.0,
    ];

    public static function providerFor(string $url): string
    {
        $h = strtolower((string) parse_url($url, PHP_URL_HOST));
        $p = strtolower((string) parse_url($url, PHP_URL_PATH));
        return match (true) {
            str_contains($h, 'airtable') => 'airtable',
            str_contains($h, 'places.googleapis') && str_contains($p, '/media') => 'places_photo',
            str_contains($h, 'places.googleapis') => 'places_search',
            str_contains($h, 'anthropic') => 'anthropic',
            str_contains($h, 'aerodatabox') => 'aerodatabox',
            str_contains($h, 'aviationstack') => 'aviationstack',
            str_contains($h, 'widgety') => 'widgety',
            str_contains($h, 'open-meteo') => 'openmeteo',
            str_contains($h, 'avs.io') => 'avs_logo',
            default => 'other',
        };
    }

    /** @param array<string,int> $extra e.g. ['anthropic_in' => 1200, 'anthropic_out' => 300, 'anthropic_search' => 2] */
    public static function hit(string $provider, int $n = 1, array $extra = []): void
    {
        $all = get_option(self::OPTION, []);
        $all = is_array($all) ? $all : [];
        $day = gmdate('Y-m-d');
        $all[$day] = is_array($all[$day] ?? null) ? $all[$day] : [];
        $all[$day][$provider] = (int) ($all[$day][$provider] ?? 0) + $n;
        foreach ($extra as $k => $v) {
            $all[$day][$k] = (int) ($all[$day][$k] ?? 0) + (int) $v;
        }
        if (count($all) > self::KEEP_DAYS) {
            ksort($all);
            $all = array_slice($all, -self::KEEP_DAYS, null, true);
        }
        update_option(self::OPTION, $all, false);
    }

    public static function fromRequest(string $url): void
    {
        self::hit(self::providerFor($url));
    }

    /** @return array<string,float> */
    public static function prices(): array
    {
        $custom = (array) Settings::get('cost_prices', []);
        $out = self::DEFAULT_PRICES;
        foreach ($custom as $k => $v) {
            if (isset($out[$k]) && is_numeric($v)) {
                $out[$k] = (float) $v;
            }
        }
        return $out;
    }

    /**
     * Totals for the last N days (today inclusive). @return array{counts:array<string,int>,tokens:array{in:int,out:int,search:int},cost_usd:array<string,float>,total_usd:float}
     */
    public static function window(int $days): array
    {
        $all = get_option(self::OPTION, []);
        $all = is_array($all) ? $all : [];
        $from = gmdate('Y-m-d', time() - ($days - 1) * DAY_IN_SECONDS);
        $counts = [];
        $tok = ['in' => 0, 'out' => 0, 'search' => 0];
        foreach ($all as $day => $row) {
            if ($day < $from || !is_array($row)) {
                continue;
            }
            foreach ($row as $k => $v) {
                if ($k === 'anthropic_in') {
                    $tok['in'] += (int) $v;
                } elseif ($k === 'anthropic_out') {
                    $tok['out'] += (int) $v;
                } elseif ($k === 'anthropic_search') {
                    $tok['search'] += (int) $v;
                } else {
                    $counts[$k] = (int) ($counts[$k] ?? 0) + (int) $v;
                }
            }
        }
        $p = self::prices();
        $cost = [];
        foreach (self::PROVIDERS as $k => $label) {
            $cost[$k] = $k === 'anthropic'
                ? $tok['in'] / 1000000 * $p['anthropic_in'] + $tok['out'] / 1000000 * $p['anthropic_out'] + $tok['search'] * $p['anthropic_search']
                : (int) ($counts[$k] ?? 0) * (float) ($p[$k] ?? 0);
        }
        return ['counts' => $counts, 'tokens' => $tok, 'cost_usd' => $cost, 'total_usd' => array_sum($cost)];
    }

    public static function clear(): void
    {
        delete_option(self::OPTION);
    }
}
