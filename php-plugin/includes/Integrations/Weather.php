<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Http;
use VisionTrips\Support\Str;

/**
 * Destination weather via Open-Meteo (free, no key). Geocodes a place name when we have no coordinates.
 */
final class Weather
{
    public static function enabled(): bool
    {
        return Settings::bool('weather_enabled');
    }

    /** @return array{lat:float,lng:float,name:string}|null */
    public static function geocode(string $place): ?array
    {
        $place = trim($place);
        if ($place === '') {
            return null;
        }
        $cacheId = 'geo|' . md5(strtolower($place));
        $cached = Cache::get('weather', $cacheId);
        if (is_array($cached)) {
            return isset($cached['missing']) ? null : $cached;
        }
        $res = Http::getJson('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=' . rawurlencode($place), [], 8, 0);
        $r = $res['data']['results'][0] ?? null;
        if (!is_array($r)) {
            Cache::negative('weather', $cacheId, DAY_IN_SECONDS);
            return null;
        }
        $out = ['lat' => (float) $r['latitude'], 'lng' => (float) $r['longitude'], 'name' => Str::clean($r['name'] ?? $place)];
        Cache::set('weather', $cacheId, $out, 30 * DAY_IN_SECONDS);
        return $out;
    }

    /**
     * Current conditions + a short daily outlook.
     * @return array{temp:int,code:int,label:string,icon:string,high:int,low:int,days:array<int,array{date:string,high:int,low:int,code:int,icon:string}>}|null
     */
    public static function forecast(float $lat, float $lng): ?array
    {
        if (!self::enabled()) {
            return null;
        }
        $cacheId = 'fc|' . round($lat, 2) . '|' . round($lng, 2);
        $cached = Cache::get('weather', $cacheId);
        if (is_array($cached)) {
            return $cached;
        }
        $url = 'https://api.open-meteo.com/v1/forecast?latitude=' . $lat . '&longitude=' . $lng . '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=6';
        $res = Http::getJson($url, [], 8, 0);
        if (!$res['ok'] || empty($res['data']['current'])) {
            return null;
        }
        $d = $res['data'];
        $days = [];
        foreach ((array) ($d['daily']['time'] ?? []) as $i => $date) {
            $code = (int) ($d['daily']['weather_code'][$i] ?? 0);
            $days[] = ['date' => (string) $date, 'high' => (int) round($d['daily']['temperature_2m_max'][$i] ?? 0), 'low' => (int) round($d['daily']['temperature_2m_min'][$i] ?? 0), 'code' => $code, 'icon' => self::icon($code)];
        }
        $code = (int) ($d['current']['weather_code'] ?? 0);
        $out = [
            'temp'  => (int) round($d['current']['temperature_2m'] ?? 0),
            'code'  => $code,
            'label' => self::label($code),
            'icon'  => self::icon($code),
            'high'  => $days[0]['high'] ?? 0,
            'low'   => $days[0]['low'] ?? 0,
            'days'  => $days,
        ];
        Cache::set('weather', $cacheId, $out, 30 * MINUTE_IN_SECONDS);
        return $out;
    }

    public static function label(int $code): string
    {
        return match (true) {
            $code === 0 => 'Clear',
            $code <= 2 => 'Mostly sunny',
            $code === 3 => 'Overcast',
            $code <= 48 => 'Foggy',
            $code <= 57 => 'Drizzle',
            $code <= 67 => 'Rain',
            $code <= 77 => 'Snow',
            $code <= 82 => 'Showers',
            $code <= 86 => 'Snow showers',
            default => 'Thunderstorms',
        };
    }

    /** Icon key used by the SVG sprite. */
    public static function icon(int $code): string
    {
        return match (true) {
            $code === 0 => 'sun',
            $code <= 2 => 'sun-cloud',
            $code === 3 => 'cloud',
            $code <= 48 => 'fog',
            $code <= 67 => 'rain',
            $code <= 77 => 'snow',
            $code <= 82 => 'rain',
            $code <= 86 => 'snow',
            default => 'storm',
        };
    }
}
