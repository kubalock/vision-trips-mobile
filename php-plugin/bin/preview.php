<?php
/**
 * Renders the plugin's templates outside WordPress using fixtures + mocked integrations.
 *   php bin/preview.php [outdir]
 * Produces one HTML per (fixture, stage) plus documents and a gate page, and a demo index with a stage switcher.
 * Also acts as a smoke test: any PHP warning/notice/exception fails the run.
 */
declare(strict_types=1);

error_reporting(E_ALL);
set_error_handler(static function (int $no, string $str, string $file, int $line): bool {
    throw new ErrorException($str, 0, $no, $file, $line);
});

$root = dirname(__DIR__);
require $root . '/bin/stubs/wp.php';
define('VISION_TRIPS_VERSION', '1.0.0-preview');
define('VISION_TRIPS_FILE', $root . '/vision-trips.php');
define('VISION_TRIPS_DIR', $root . '/');
define('VISION_TRIPS_URL', '/vision-trips/');
require $root . '/includes/Autoloader.php';
\VisionTrips\Autoloader::register($root . '/includes');

use VisionTrips\Airtable\BookingRepository;
use VisionTrips\Airtable\Client;
use VisionTrips\Domain\Trip;
use VisionTrips\Frontend\Documents;
use VisionTrips\Frontend\Gate;
use VisionTrips\Frontend\TripPage;
use VisionTrips\Security\Access;
use VisionTrips\Security\Token;
use VisionTrips\Settings;
use VisionTrips\Support\Cache;

$out = $argv[1] ?? ($root . '/../preview');
if (!is_dir($out)) { mkdir($out, 0777, true); }

// Settings that make integrations "configured" so cached mocks are used (no HTTP ever happens: wp_remote_get is stubbed).
Settings::setMany([
    'link_secret' => 'preview-secret', 'api_minting_key' => 'preview-key',
    'google_places_key' => 'demo', 'ai_api_key' => 'demo', 'widgety_app_id' => 'demo', 'widgety_token' => 'demo', 'flight_api_key' => 'demo',
    'flight_provider' => 'aerodatabox', 'allow_custom_payments' => true, 'show_dob' => true,
    'modules' => array_fill_keys(array_keys(Settings::MODULES), true), // the preview shows every module, including the new ones
]);

$imgCache = [];
$img = static function (string $name) use ($root, &$imgCache): string {
    if (isset($imgCache[$name])) {
        return $imgCache[$name];
    }
    if (str_ends_with($name, '.svg')) {
        $svg = match ($name) {
            'newells-logo.svg' => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 64" width="300" height="64"><circle cx="30" cy="32" r="22" fill="#0E6D74"/><path d="M18 36c6-10 18-10 24 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="30" cy="24" r="3" fill="#E8B44C"/><text x="62" y="39" font-family="Georgia,serif" font-size="27" fill="#0E6D74">Newells</text><text x="178" y="39" font-family="Helvetica,Arial,sans-serif" font-size="13" letter-spacing="2" fill="#0E6D74">TRAVEL</text></svg>',
            'ba-logo.svg' => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="240" height="80"><rect width="240" height="80" fill="#fff"/><path d="M14 48c40-30 90-36 140-26l-18 10 72 6-78 12 14 10c-50-6-96-2-130-12z" fill="#2E5C99"/><path d="M44 56c30-16 70-22 120-16l-10 6c-40-2-80 2-110 10z" fill="#E31B23"/><text x="118" y="72" font-family="Helvetica,Arial" font-size="13" fill="#1a2a44">BRITISH AIRWAYS</text></svg>',
            'ms-logo.svg' => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80" width="240" height="80"><rect width="240" height="80" fill="#fff"/><circle cx="40" cy="40" r="24" fill="#C8A951"/><path d="M40 22l8 14-8 20-8-20z" fill="#fff"/><text x="76" y="48" font-family="Helvetica,Arial" font-weight="700" font-size="22" fill="#1A3A6B">EGYPTAIR</text></svg>',
            'hh-logo.svg' => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 64" width="320" height="64"><path d="M8 50 L30 14 L52 50 Z" fill="#D1462F"/><path d="M40 50 L58 26 L76 50 Z" fill="#1E2A38"/><text x="90" y="40" font-family="Helvetica,Arial,sans-serif" font-weight="800" font-size="26" fill="#1E2A38">Harbour&amp;Hill</text></svg>',
            default => '<svg xmlns="http://www.w3.org/2000/svg"/>',
        };
        return $imgCache[$name] = 'data:image/svg+xml;base64,' . base64_encode($svg);
    }
    $path = $root . '/bin/fixtures/img/' . $name;
    return $imgCache[$name] = 'data:image/jpeg;base64,' . base64_encode((string) file_get_contents($path));
};

$fixtures = ['egypt' => require $root . '/bin/fixtures/egypt.php', 'lisbon' => require $root . '/bin/fixtures/lisbon.php'];
$stages = ['quote' => 'Quotation', 'countdown' => 'Confirmed · countdown', 'prep' => 'Final prep (6 days)', 'departure' => 'Departure day', 'travelling' => 'Away', 'home' => 'Welcome home'];
$repo = new BookingRepository(new Client('demo'));
$pages = [];
$errors = 0;

foreach ($fixtures as $fkey => $factory) {
    foreach ($stages as $skey => $slabel) {
        $fx = $factory($skey, $img);
        $trip = $repo->fromGraph('appPREVIEW0000001', $fx['graph']);
        $trip->previewMode = true;
        // Seed caches with mocks so integrations resolve instantly without HTTP.
        foreach ($trip->ofKind('stay') as $e) {
            foreach ($fx['mocks']['places'] as $q => $place) {
                if (strcasecmp($q, $e->searchQueryForPlaces()) === 0) {
                    Cache::set('places', md5(strtolower($q)), $place, 3600);
                }
            }
        }
        foreach ($fx['mocks']['ai'] as $name => $text) {
            foreach ($fx['mocks']['places'] as $q => $place) {
                if ($place['name'] === $name) {
                    foreach ($trip->ofKind('stay') as $e) {
                        if (strcasecmp($q, $e->searchQueryForPlaces()) === 0) {
                            Cache::set('ai', (new \VisionTrips\Integrations\Ai())->placeCacheId($name, $e->locationName ?: $place['address'], '', ['kind' => 'stay']), $text, 3600);
                        }
                    }
                }
            }
        }
        foreach ($fx['mocks']['widgety'] as $k => $v) {
            Cache::set('widgety', $k, $v, 3600);
        }
        foreach ($fx['mocks']['flights'] as $k => $v) {
            Cache::set('flights', $k, $v, 3600);
        }
        foreach (($fx['mocks']['widgety_places'] ?? []) as $k => $v) {
            Cache::set('widgety', $k, $v, 3600);
        }
        foreach (($fx['mocks']['places_any'] ?? []) as $q => $v) {
            Cache::set('places', md5(strtolower($q) . '|any'), $v, 3600);
        }
        foreach (($fx['mocks']['destguides'] ?? []) as $k => $v) {
            Cache::set('ai', md5($k), $v, 3600);
        }
        foreach (($fx['mocks']['guides'] ?? []) as $k => $v) {
            Cache::set('ai', md5($k), $v, 3600);
        }
        $w = $fx['mocks']['weather'];
        Cache::set('weather', 'fc|' . round($w['lat'], 2) . '|' . round($w['lng'], 2), $w['forecast'], 3600);

        $token = Token::mint($trip->base, $trip->id);
        $level = Access::LEVEL_KNOWLEDGE;
        try {
            $page = new TripPage($trip, $token, $level, false);
            $html = $page->render(true);
            $file = $fkey . '-' . $skey . '.html';
            file_put_contents($out . '/' . $file, $html);
            $pages[$fkey][$skey] = ['label' => $slabel, 'file' => $file, 'bytes' => strlen($html), 'theme' => $trip->theme, 'stage' => $trip->stage];
            if ($skey === 'countdown' || $skey === 'departure') {
                // Production path (not preview): warm caches must render external sections inline, no browser call.
                $warm = $page->render(false);
                $inline = preg_match_all('/class="vt-async is-landed"/', $warm);
                $deferred = preg_match_all('/data-loaded="0"/', $warm);
                echo str_pad($fkey . '/' . $skey . ' warm', 20) . " → {$inline} inline, {$deferred} deferred" . PHP_EOL;
                foreach (\VisionTrips\Support\Provenance::requests() as $r) {
                    if ($r['method'] === 'DEFERRED') {
                        echo '      deferred lookup: ' . $r['endpoint'] . PHP_EOL;
                    }
                }
            }
            echo str_pad($fkey . '/' . $skey, 20) . ' → ' . $trip->stage . ' / theme ' . $trip->theme . ' / ' . round(strlen($html) / 1024) . ' KB' . PHP_EOL;
        } catch (Throwable $e) {
            $errors++;
            echo "ERROR {$fkey}/{$skey}: " . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . PHP_EOL;
        }
        // Documents + gate for the countdown stage of each fixture
        if ($skey === 'countdown') {
            try {
                $docs = new Documents($trip, $token, true, $level);
                foreach (['confirmation', 'invoice', 'receipts', 'atol', 'wallet', 'index', 'print'] as $doc) {
                    $html = $docs->render($doc, '');
                    $html = preg_replace('#<link rel="stylesheet" href="/vision-trips/assets/css/documents\.css\?ver=[^"]*">#', '<style>' . str_replace('$', '\\$', file_get_contents($root . '/assets/css/documents.css')) . '</style>', $html);
                    file_put_contents($out . '/' . $fkey . '-doc-' . $doc . '.html', $html);
                    $pages[$fkey]['doc-' . $doc] = ['label' => 'Document: ' . $doc, 'file' => $fkey . '-doc-' . $doc . '.html'];
                }
                $GLOBALS['vt_query'] = [];
                $gate = new Gate($trip, $token);
                $html = $gate->render(Access::LEVEL_KNOWLEDGE);
                $html = preg_replace('#<link rel="stylesheet" href="/vision-trips/assets/css/vision\.css\?ver=[^"]*">#', '<style>' . str_replace('$', '\\$', file_get_contents($root . '/assets/css/vision.css')) . '</style>', $html);
                $html = preg_replace('#<script src="/vision-trips/assets/js/vision\.js\?ver=[^"]*" defer></script>#', '<script>' . str_replace('$', '\\$', file_get_contents($root . '/assets/js/vision.js')) . '</script>', $html);
                file_put_contents($out . '/' . $fkey . '-gate.html', $html);
                $pages[$fkey]['gate'] = ['label' => 'Verification gate', 'file' => $fkey . '-gate.html'];
                // Portal: preferences screen
                $brand = $trip->brand;
                $html = \VisionTrips\Frontend\View::render('portal/page', [
                    'brand' => $brand, 'base' => $trip->base, 'step' => 'prefs', 'error' => '', 'notice' => '', 'email' => $trip->customerEmail, 'trips' => [],
                    'prefs' => ['email' => true, 'sms' => false, 'post' => false, 'airports' => ['London Heathrow Airport', 'Bristol Airport'], 'months' => ['October', 'November', 'March'], 'ids' => []],
                    'airports' => ['Bristol Airport', 'Exeter Airport', 'London Gatwick Airport', 'London Heathrow Airport', 'Manchester Airport', 'Newquay Airport'],
                    'months' => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
                    'nonce' => 'x', 'self' => '#', 'accent' => $brand->colour !== '' ? $brand->colour : '#1F4F6E', 'theme' => 'default', 'spec' => \VisionTrips\Domain\Theme::spec('default'),
                    'fontsUrl' => \VisionTrips\Domain\Theme::fontsUrl('default', $brand->fontDisplay, $brand->fontBody), 'displayFont' => $brand->fontDisplay !== '' ? $brand->fontDisplay : 'Fraunces', 'bodyFont' => $brand->fontBody !== '' ? $brand->fontBody : 'Instrument Sans',
                ]);
                $html = preg_replace('#<link rel="stylesheet" href="/vision-trips/assets/css/vision\.css\?ver=[^"]*">#', '<style>' . str_replace('$', '\\$', file_get_contents($root . '/assets/css/vision.css')) . '</style>', $html);
                $html = preg_replace('#<script src="/vision-trips/assets/js/vision\.js\?ver=[^"]*" defer></script>#', '<script>' . str_replace('$', '\\$', file_get_contents($root . '/assets/js/vision.js')) . '</script>', $html);
                file_put_contents($out . '/' . $fkey . '-portal-prefs.html', $html);
                $pages[$fkey]['portal-prefs'] = ['label' => 'Portal: contact preferences', 'file' => $fkey . '-portal-prefs.html'];
                // Branded email sample
                $email = \VisionTrips\Integrations\Email::render($brand, 'Thank you', 'Thank you, ' . $trip->leadFirstName(), '<p>We have your acceptance for <strong>' . htmlspecialchars($trip->name) . '</strong> (' . htmlspecialchars($trip->ref) . ').</p><p>We are now confirming every part of the trip with the suppliers. Your written confirmation and key information will follow, and your trip page keeps everything in one place.</p>', [['label' => 'View your trip', 'url' => '#']], [['label' => 'Travel dates', 'value' => $trip->dateRange()], ['label' => 'Deposit', 'value' => '£1,200.00'], ['label' => 'Your travel expert', 'value' => $trip->agentName]], 'Your acceptance is recorded.');
                file_put_contents($out . '/' . $fkey . '-email.html', $email);
                $pages[$fkey]['email'] = ['label' => 'Email: acceptance (branded)', 'file' => $fkey . '-email.html'];
                echo str_pad($fkey . '/docs+gate', 20) . ' → ok' . PHP_EOL;
            } catch (Throwable $e) {
                $errors++;
                echo "ERROR {$fkey}/docs: " . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . PHP_EOL;
            }
        }
    }
}
file_put_contents($out . '/manifest.json', json_encode($pages, JSON_PRETTY_PRINT));
echo ($errors ? "FAILED with {$errors} error(s)" : 'All renders OK') . PHP_EOL;
exit($errors ? 1 : 0);
