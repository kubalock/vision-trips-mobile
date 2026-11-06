<?php
declare(strict_types=1);
error_reporting(E_ALL);
set_error_handler(static function (int $no, string $str, string $file, int $line): bool { throw new ErrorException($str, 0, $no, $file, $line); });
$root = dirname(__DIR__);
require $root . '/bin/stubs/wp.php';
define('VISION_TRIPS_VERSION', 'test'); define('VISION_TRIPS_FILE', $root . '/vision-trips.php'); define('VISION_TRIPS_DIR', $root . '/'); define('VISION_TRIPS_URL', '/vision-trips/');
require $root . '/includes/Autoloader.php';
\VisionTrips\Autoloader::register($root . '/includes');
use VisionTrips\Airtable\BookingRepository; use VisionTrips\Airtable\Client; use VisionTrips\Settings; use VisionTrips\Frontend\TripPage; use VisionTrips\Security\Token; use VisionTrips\Security\Access;
Settings::setMany(['link_secret' => 's', 'google_places_key' => 'demo', 'ai_api_key' => 'demo', 'widgety_app_id' => 'demo', 'widgety_token' => 'demo', 'flight_api_key' => 'demo', 'ai_research' => true]);
// Fake transport: realistic payloads for Widgety ports, Places searchText, Anthropic messages
$GLOBALS['vt_http_handler'] = static function (string $method, string $url, array $args): ?array {
    if (str_contains($url, 'widgety') && str_contains($url, 'ports')) {
        return ['code' => 200, 'body' => json_encode(['ports' => [['title' => 'Corralejo', 'country' => ['title' => 'Spain'], 'description' => '<p>Corralejo sits at the northern tip of Fuerteventura, <b>famous</b> for its dunes.</p>', 'image_href' => 'https://img.example/c1.jpg', 'images' => [['href' => 'https://img.example/c2.jpg'], 'https://img.example/c3.jpg']]]])];
    }
    if (str_contains($url, 'widgety')) { return ['code' => 404, 'body' => '{}']; }
    if (str_contains($url, 'places:searchText')) {
        return ['code' => 200, 'body' => json_encode(['places' => [['id' => 'ChIJx', 'displayName' => ['text' => 'Barceló Corralejo Bay - Adults Only'], 'formattedAddress' => 'Av. Grandes Playas, 12, Corralejo, Spain', 'rating' => 4.6, 'userRatingCount' => 3210, 'websiteUri' => 'https://www.barcelo.com', 'internationalPhoneNumber' => '+34 928 536 157', 'editorialSummary' => ['text' => 'Adults-only resort facing the dunes.'], 'googleMapsUri' => 'https://maps.google.com/?cid=1', 'location' => ['latitude' => 28.72, 'longitude' => -13.86], 'types' => ['hotel', 'lodging'], 'priceLevel' => 'PRICE_LEVEL_EXPENSIVE', 'photos' => [['name' => 'places/ChIJx/photos/abc', 'widthPx' => 4000, 'heightPx' => 3000, 'authorAttributions' => [['displayName' => 'Barceló Corralejo Bay - Adults Only']]]], 'reviews' => [['rating' => 5, 'text' => ['text' => 'Wonderful stay.'], 'authorAttribution' => ['displayName' => 'A guest']], ['rating' => 2, 'text' => ['text' => 'Noisy.'], 'authorAttribution' => ['displayName' => 'B']]]]]])];
    }
    if (str_contains($url, 'api.anthropic.com')) {
        $prompt = (string) (json_decode((string) ($args['body'] ?? ''), true)['messages'][0]['content'] ?? '');
        if (str_contains($prompt, 'traveller guide')) {
            return ['code' => 200, 'body' => json_encode(['model' => 'claude-sonnet-5-5', 'content' => [['type' => 'text', 'text' => "Here you go:\n```json\n" . json_encode([['title' => 'Check-in and boarding passes', 'text' => 'Online check-in opens ahead of departure through the airline app; boarding passes can be saved to your phone.'], ['title' => 'Baggage', 'text' => 'Allowances depend on your fare; your booking confirmation shows what is included and your travel agent can add more.']]) . "\n```"]]])];
        }
        return ['code' => 200, 'body' => json_encode(['model' => 'claude-sonnet-5-5', 'content' => [['type' => 'text', 'text' => json_encode(['overview' => 'Corralejo is a relaxed resort town at the top of Fuerteventura.', 'attractions' => 'The dunes of the Parque Natural, the ferry to Lobos island, the old harbour.', 'practical' => 'Euros; buses run along the coast; tipping is modest.', 'culture' => 'Canarian food is simple and generous; papas arrugadas with mojo.'])]]])];
    }
    return null;
};
$img = static fn (string $n) => 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
$factory = require $root . '/bin/fixtures/egypt.php';
$fx = $factory('countdown', $img);
$trip = (new BookingRepository(new Client('demo')))->fromGraph('appX', $fx['graph']);
$page = new TripPage($trip, Token::mint($trip->base, $trip->id), Access::LEVEL_KNOWLEDGE, false);
$vm = (new ReflectionMethod($page, 'viewModel'))->invoke($page, false);
foreach (['destinations', 'stays', 'cruise', 'airline-ba', 'airport-lhr'] as $name) {
    try {
        $html = \VisionTrips\Rest\Api::fragment($trip, $name, $vm);
        echo str_pad($name, 14) . 'OK ' . strlen($html) . " bytes\n";
    } catch (Throwable $e) {
        echo str_pad($name, 14) . 'FATAL ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine() . "\n";
    }
}
// Jobs: drain the queue, then re-render guides to prove they come back populated
for ($i = 0; $i < 12 && \VisionTrips\Support\Jobs::queueLength() > 0; $i++) { delete_transient('vtr_job_lock'); \VisionTrips\Support\Jobs::runNext(); }
foreach (['airline-ba', 'airport-lhr'] as $name) { $html = \VisionTrips\Rest\Api::fragment($trip, $name, $vm); echo str_pad($name . ' (after jobs)', 24) . (strlen($html) > 100 ? 'OK ' : 'EMPTY ') . strlen($html) . " bytes\n"; }
// Jobs: run queue
try { \VisionTrips\Support\Jobs::runNext(); echo "job run OK, queue left: " . \VisionTrips\Support\Jobs::queueLength() . "\n"; } catch (Throwable $e) { echo 'JOB FATAL ' . $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine() . "\n"; }
foreach (\VisionTrips\Support\Provenance::all() as $r) { echo '  ' . $r['section'] . ' | ' . $r['source'] . ' | ' . $r['detail'] . "\n"; }
// A guide with nothing cached must be deferred by the page build (never rendered inline as empty)
$GLOBALS['vt_transients'] = []; $GLOBALS['vt_options']['vision_trips_jobs'] = [];
$html = \VisionTrips\Frontend\View::external('airline-ba', false, fn () => \VisionTrips\Rest\Api::airlineFragment($trip, 'BA', $vm), 'text', 'data-guide="1"');
echo 'cold guide on page build: ' . (str_contains($html, 'data-loaded="0"') ? 'deferred ✓' : 'INLINE (wrong)') . "\n";
