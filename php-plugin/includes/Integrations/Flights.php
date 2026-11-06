<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Http;
use VisionTrips\Support\Log;
use VisionTrips\Support\Str;

/**
 * Live flight status for departure day. Providers:
 *  - aerodatabox (RapidAPI; free tier available; includes gates, terminals, delays)
 *  - aviationstack (free tier available; basic status)
 * Only called inside the configured window around departure; cached for 3 minutes.
 */
final class Flights
{
    private string $provider;
    private string $key;

    public function __construct()
    {
        $this->provider = (string) Settings::get('flight_provider', 'aerodatabox');
        $this->key = trim((string) Settings::get('flight_api_key', ''));
    }

    public function configured(): bool
    {
        return $this->key !== '' && in_array($this->provider, ['aerodatabox', 'aviationstack'], true);
    }

    /**
     * @return array{status:string,statusLabel:string,depScheduled:string,depActual:string,depTerminal:string,depGate:string,arrScheduled:string,arrActual:string,arrTerminal:string,arrGate:string,baggage:string,aircraft:string,delayMinutes:int,updated:string}|null
     */
    public function status(string $flightNo, string $dateIso): ?array
    {
        $flightNo = strtoupper((string) preg_replace('/\s+/', '', $flightNo));
        if (!$this->configured() || $flightNo === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateIso)) {
            return null;
        }
        $cacheId = $this->provider . '|' . $flightNo . '|' . $dateIso;
        $cached = Cache::get('flights', $cacheId);
        if (is_array($cached)) {
            return isset($cached['missing']) ? null : $cached;
        }
        $result = $this->provider === 'aerodatabox' ? $this->aeroDataBox($flightNo, $dateIso) : $this->aviationStack($flightNo, $dateIso);
        if ($result) {
            Cache::set('flights', $cacheId, $result, 2 * MINUTE_IN_SECONDS);
        } else {
            Cache::negative('flights', $cacheId, 10 * MINUTE_IN_SECONDS);
        }
        return $result;
    }

    private function aeroDataBox(string $flightNo, string $date): ?array
    {
        $url = 'https://aerodatabox.p.rapidapi.com/flights/number/' . rawurlencode($flightNo) . '/' . $date . '?withAircraftImage=false&withLocation=false';
        $res = Http::getJson($url, ['x-rapidapi-key' => $this->key, 'x-rapidapi-host' => 'aerodatabox.p.rapidapi.com'], 12, 0);
        if (!$res['ok'] || !is_array($res['data']) || !$res['data']) {
            if ($res['status'] !== 404) {
                Log::warning('AeroDataBox failed', ['status' => $res['status'], 'error' => $res['error']]);
            }
            return null;
        }
        $f = $res['data'][0] ?? null;
        if (!is_array($f)) {
            return null;
        }
        $dep = $f['departure'] ?? [];
        $arr = $f['arrival'] ?? [];
        $status = Str::clean($f['status'] ?? 'Unknown');
        $schedDep = $dep['scheduledTime']['local'] ?? '';
        $revDep = $dep['revisedTime']['local'] ?? ($dep['runwayTime']['local'] ?? '');
        $delay = 0;
        if ($schedDep && $revDep) {
            $delay = (int) round((strtotime($revDep) - strtotime($schedDep)) / 60);
        }
        return [
            'status'       => self::normaliseStatus($status, $delay),
            'statusLabel'  => $status,
            'depScheduled' => self::clock($schedDep),
            'depActual'    => self::clock($revDep),
            'depTerminal'  => Str::clean($dep['terminal'] ?? ''),
            'depGate'      => Str::clean($dep['gate'] ?? ''),
            'arrScheduled' => self::clock($arr['scheduledTime']['local'] ?? ''),
            'arrActual'    => self::clock($arr['revisedTime']['local'] ?? ($arr['predictedTime']['local'] ?? '')),
            'arrTerminal'  => Str::clean($arr['terminal'] ?? ''),
            'arrGate'      => Str::clean($arr['gate'] ?? ''),
            'baggage'      => Str::clean($arr['baggageBelt'] ?? ''),
            'aircraft'     => Str::clean($f['aircraft']['model'] ?? ''),
            'delayMinutes' => $delay,
            'updated'      => gmdate('H:i'),
        ];
    }

    private function aviationStack(string $flightNo, string $date): ?array
    {
        $url = 'https://api.aviationstack.com/v1/flights?access_key=' . rawurlencode($this->key) . '&flight_iata=' . rawurlencode($flightNo) . '&flight_date=' . $date . '&limit=1';
        $res = Http::getJson($url, [], 12, 0);
        $f = $res['data']['data'][0] ?? null;
        if (!$res['ok'] || !is_array($f)) {
            return null;
        }
        $dep = $f['departure'] ?? [];
        $arr = $f['arrival'] ?? [];
        $delay = (int) ($dep['delay'] ?? 0);
        $status = Str::clean($f['flight_status'] ?? 'unknown');
        return [
            'status'       => self::normaliseStatus($status, $delay),
            'statusLabel'  => ucfirst($status),
            'depScheduled' => self::clock($dep['scheduled'] ?? ''),
            'depActual'    => self::clock($dep['estimated'] ?? $dep['actual'] ?? ''),
            'depTerminal'  => Str::clean($dep['terminal'] ?? ''),
            'depGate'      => Str::clean($dep['gate'] ?? ''),
            'arrScheduled' => self::clock($arr['scheduled'] ?? ''),
            'arrActual'    => self::clock($arr['estimated'] ?? $arr['actual'] ?? ''),
            'arrTerminal'  => Str::clean($arr['terminal'] ?? ''),
            'arrGate'      => Str::clean($arr['gate'] ?? ''),
            'baggage'      => Str::clean($arr['baggage'] ?? ''),
            'aircraft'     => Str::clean($f['aircraft']['iata'] ?? ''),
            'delayMinutes' => $delay,
            'updated'      => gmdate('H:i'),
        ];
    }

    private static function clock(mixed $iso): string
    {
        $s = (string) $iso;
        if ($s === '') {
            return '';
        }
        // AeroDataBox local times look like "2027-05-06 10:40+01:00"; AviationStack like "2027-05-06T10:40:00+00:00".
        if (preg_match('/[T ](\d{2}:\d{2})/', $s, $m)) {
            return $m[1];
        }
        return '';
    }

    /**
     * Provider status → phase. AeroDataBox: Unknown, Expected, EnRoute, CheckIn, Boarding, GateClosed, Departed,
     * Delayed, Approaching, Arrived, Canceled, Diverted, CanceledUncertain. AviationStack: scheduled, active,
     * landed, cancelled, incident, diverted. Every phase is shown — the more a customer can see, the better.
     */
    public static function normaliseStatus(string $status, int $delay): string
    {
        $s = strtolower((string) preg_replace('/[^a-z]/i', '', $status));
        if (str_contains($s, 'cancel')) {
            return 'cancelled';
        }
        if (str_contains($s, 'divert') || str_contains($s, 'incident')) {
            return 'diverted';
        }
        if (str_contains($s, 'arrived') || str_contains($s, 'landed')) {
            return 'arrived';
        }
        if (str_contains($s, 'approach')) {
            return 'approaching';
        }
        if (str_contains($s, 'enroute') || str_contains($s, 'active') || str_contains($s, 'airborne') || str_contains($s, 'inflight') || str_contains($s, 'inair')) {
            return 'en_route';
        }
        if (str_contains($s, 'departed') || str_contains($s, 'takenoff') || str_contains($s, 'takeoff')) {
            return 'departed';
        }
        if (str_contains($s, 'gateclosed') || str_contains($s, 'closed')) {
            return 'gate_closed';
        }
        if (str_contains($s, 'boarding')) {
            return 'boarding';
        }
        if (str_contains($s, 'gate')) {
            return 'go_to_gate';
        }
        if (str_contains($s, 'checkin')) {
            return 'checkin';
        }
        if ($delay >= 15 || str_contains($s, 'delay')) {
            return 'delayed';
        }
        if (str_contains($s, 'expected') || str_contains($s, 'scheduled') || str_contains($s, 'ontime')) {
            return 'on_time';
        }
        return 'unknown';
    }

    public static function statusCopy(string $status, int $delay): string
    {
        return match ($status) {
            'checkin'     => 'Check-in open',
            'on_time'     => 'On time',
            'delayed'     => 'Delayed' . ($delay > 0 ? ' by ' . $delay . ' min' : ''),
            'go_to_gate'  => 'Go to gate',
            'boarding'    => 'Boarding',
            'gate_closed' => 'Gate closed',
            'departed'    => 'Departed',
            'en_route'    => 'In the air',
            'approaching' => 'Approaching — landing soon',
            'arrived'     => 'Landed',
            'cancelled'   => 'Cancelled — contact your travel agent',
            'diverted'    => 'Diverted — contact your travel agent',
            default       => 'Scheduled',
        };
    }
}
