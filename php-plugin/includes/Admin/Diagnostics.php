<?php
declare(strict_types=1);

namespace VisionTrips\Admin;

use VisionTrips\Airtable\BookingRepository;
use VisionTrips\Airtable\Client;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Domain\Brand;
use VisionTrips\Frontend\TripPage;
use VisionTrips\Integrations\Ai;
use VisionTrips\Integrations\Email;
use VisionTrips\Integrations\Flights;
use VisionTrips\Integrations\Places;
use VisionTrips\Integrations\Weather;
use VisionTrips\Integrations\Widgety;
use VisionTrips\Security\Access;
use VisionTrips\Security\Token;
use VisionTrips\Settings;
use VisionTrips\Support\Log;

/**
 * "Test everything": one real booking through every integration, with timings and the actual error text.
 * And "Render staging": every staging booking through the full page build, catching anything that throws.
 */
final class Diagnostics
{
    /** @return array<int,array{check:string,ok:bool,ms:int,detail:string}> */
    public static function testEverything(string $base, string $record, bool $writeComment = false, string $emailTo = ''): array
    {
        $rows = [];
        $t = static fn () => microtime(true);
        $row = static function (string $check, bool $ok, float $start, string $detail) use (&$rows): void {
            $rows[] = ['check' => $check, 'ok' => $ok, 'ms' => (int) round((microtime(true) - $start) * 1000), 'detail' => mb_substr($detail, 0, 220)];
        };
        $client = new Client();
        $s = $t();
        if (!$client->configured()) {
            $row('Airtable token', false, $s, 'No token saved');
            return $rows;
        }
        $repo = new BookingRepository($client);
        $trip = null;
        try {
            $trip = $repo->load($base, $record, true);
            $row('Airtable: load booking (3 waves)', $trip !== null, $s, $trip ? $trip->ref . ' · ' . count($trip->elements) . ' elements · ' . count($trip->payments) . ' payments · brand ' . $trip->brand->name : ('not loaded: ' . $client->lastError()));
        } catch (\Throwable $e) {
            $row('Airtable: load booking', false, $s, $e->getMessage());
            return $rows;
        }
        if (!$trip) {
            return $rows;
        }
        // Places
        $s = $t();
        $places = new Places();
        $stay = $trip->ofKind('stay')[0] ?? null;
        if (!$places->configured()) {
            $row('Google Places', false, $s, 'No key');
        } elseif (!$stay) {
            $row('Google Places', true, $s, 'No stay on this booking to look up');
        } else {
            $p = $places->find($stay->searchQueryForPlaces(), $stay->lat, $stay->lng);
            $row('Google Places: ' . $stay->title, $p !== null, $s, $p ? count($p['photos']) . ' photos · rating ' . $p['rating'] . ' · ' . Places::$lastMatch : (Places::$lastMatch ?: 'no result (see log for the API response)'));
        }
        // Widgety
        $s = $t();
        $w = new Widgety();
        $cruise = $trip->ofKind('cruise')[0] ?? null;
        if (!$w->configured()) {
            $row('Widgety', false, $s, 'No app id / token');
        } elseif ($cruise) {
            $ship = $w->ship($cruise->widgetyShipId, $cruise->ship);
            $row('Widgety: ship ' . ($cruise->ship ?: $cruise->widgetyShipId), $ship !== null, $s, $ship ? ($ship['name'] . ' · ' . count($ship['sections']) . ' sections') : 'no ship profile');
        } else {
            $dest = $trip->destinations[0] ?? null;
            $pl = $dest ? $w->place($dest['name'], $dest['country']) : null;
            $row('Widgety: place ' . ($dest['name'] ?? '—'), $dest ? $pl !== null : true, $s, $pl ? count($pl['images']) . ' images' : ($dest ? 'no match (check the lookup paths in Connections)' : 'no destination on this booking'));
        }
        // AI
        $s = $t();
        $ai = new Ai();
        if (!$ai->configured()) {
            $row('AI', false, $s, 'No key');
        } else {
            $r = $ai->test();
            $row('AI: live call', $r['ok'], $s, $r['ok'] ? 'model ' . $r['model'] . ' · ' . $r['message'] : $r['message']);
        }
        // Flights
        $s = $t();
        $fl = new Flights();
        $flight = $trip->ofKind('flight')[0] ?? null;
        if (!$fl->configured()) {
            $row('Flight status', true, $s, 'Not configured (optional)');
        } elseif ($flight) {
            $st = $fl->status($flight->flightNo, $flight->start ? $flight->start->format('Y-m-d') : '');
            $row('Flight status: ' . $flight->flightNo, true, $s, $st ? $st['statusLabel'] : 'no data for that date (normal unless within ~3 days)');
        }
        // Weather
        $s = $t();
        $lat = $stay->lat ?? ($trip->destinations[0]['lat'] ?? null);
        $lng = $stay->lng ?? ($trip->destinations[0]['lng'] ?? null);
        if ($lat !== null && $lng !== null) {
            $f = Weather::forecast((float) $lat, (float) $lng);
            $row('Weather (Open-Meteo)', $f !== null, $s, $f ? $f['label'] . ' ' . $f['temp'] . '°' : 'no forecast');
        } else {
            $row('Weather', true, $s, 'No coordinates on this booking');
        }
        // Mint
        $s = $t();
        $row('Mint readiness', $trip->brand->mintConfigured, $s, $trip->brand->mintConfigured ? ('brand credentials present · booking id ' . ($trip->mintBookingId ?: 'missing')) : 'brand has no Mint API key / business unit');
        // Email
        if ($emailTo !== '' && is_email($emailTo)) {
            $s = $t();
            $ok = Email::send($trip->brand, $emailTo, 'Vision Trips test email', 'Test email', '<p>If you can read this, branded email is working for ' . htmlspecialchars($trip->brand->name) . '.</p>', [['label' => 'Open the booking', 'url' => Token::urlFor($base, $record, '', Token::SCOPE_AGENT, time() + DAY_IN_SECONDS)]]);
            $row('Email to ' . $emailTo, $ok, $s, $ok ? 'sent via wp_mail' : 'wp_mail returned false (check SMTP plugin / logs)');
        }
        // Airtable comment
        if ($writeComment) {
            $s = $t();
            $ok = $client->comment($base, FieldMap::table('bookings'), $record, '🧪 Vision Trips test comment — ' . gmdate('D j M Y H:i') . ' UTC (safe to delete)');
            $row('Airtable comment', $ok, $s, $ok ? 'written' : 'failed — token needs data.recordComments:write');
        }
        // Render
        $s = $t();
        try {
            $page = new TripPage($trip, Token::mint($base, $record), Access::LEVEL_OTP, true);
            $html = $page->render();
            $row('Render trip page', strlen($html) > 20000, $s, round(strlen($html) / 1024) . ' KB · stage ' . $trip->stage . ' · theme ' . $trip->theme . ' · ' . substr_count($html, 'class="vt-section') . ' sections');
        } catch (\Throwable $e) {
            $row('Render trip page', false, $s, get_class($e) . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine());
        }
        return $rows;
    }

    /** @return array<int,array{record:string,ok:bool,ms:int,detail:string}> */
    public static function renderStaging(string $base, array $records): array
    {
        $out = [];
        $client = new Client();
        $repo = new BookingRepository($client);
        foreach ($records as $record) {
            $record = trim($record);
            if (!preg_match('/^rec[A-Za-z0-9]{14}$/', $record)) {
                continue;
            }
            $s = microtime(true);
            try {
                $trip = $repo->load($base, $record, true);
                if (!$trip) {
                    $out[] = ['record' => $record, 'ok' => false, 'ms' => (int) round((microtime(true) - $s) * 1000), 'detail' => 'not loaded: ' . $client->lastError()];
                    continue;
                }
                $html = (new TripPage($trip, Token::mint($base, $record), Access::LEVEL_OTP, true))->render();
                $out[] = ['record' => $record, 'ok' => true, 'ms' => (int) round((microtime(true) - $s) * 1000), 'detail' => $trip->ref . ' · ' . $trip->stage . ' · ' . $trip->theme . ' · ' . round(strlen($html) / 1024) . ' KB'];
            } catch (\Throwable $e) {
                Log::error('Staging render failed', ['record' => $record, 'error' => $e->getMessage()]);
                $out[] = ['record' => $record, 'ok' => false, 'ms' => (int) round((microtime(true) - $s) * 1000), 'detail' => get_class($e) . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine()];
            }
        }
        return $out;
    }

    /** Daily digest of warnings and errors, grouped. Returns true when something was sent. */
    public static function sendDigest(): bool
    {
        if (!Settings::bool('digest_enabled')) {
            return false;
        }
        $since = time() - DAY_IN_SECONDS;
        $groups = [];
        foreach (Log::all() as $entry) {
            $at = strtotime((string) ($entry['t'] ?? '')) ?: 0;
            if (($entry['l'] ?? '') === 'info' || $at < $since) {
                continue;
            }
            $k = ($entry['l'] ?? '') . ': ' . ($entry['m'] ?? '');
            $groups[$k] = ($groups[$k] ?? 0) + 1;
        }
        if (!$groups) {
            return false;
        }
        arsort($groups);
        $to = trim((string) Settings::get('digest_email', '')) ?: (string) get_option('admin_email');
        $brand = new Brand();
        $brand->name = 'Vision Trips';
        $brand->colour = '#1F4F6E';
        $list = '<ul>';
        foreach (array_slice($groups, 0, 30, true) as $k => $n) {
            $list .= '<li><strong>' . (int) $n . '×</strong> ' . htmlspecialchars((string) $k) . '</li>';
        }
        $list .= '</ul>';
        return Email::send($brand, $to, 'Vision Trips: ' . array_sum($groups) . ' warnings/errors in the last 24h', 'Daily health digest', '<p>Grouped by message, most frequent first. Full details are in Vision Trips → Tools &amp; logs.</p>' . $list, [['label' => 'Open Tools & logs', 'url' => admin_url('admin.php?page=vision-trips&tab=tools')]]);
    }
}
