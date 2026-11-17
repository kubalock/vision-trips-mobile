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

// ---- Concierge: safe answer from the booking, an unsafe answer that must become a handoff, and a model handoff
$GLOBALS['vt_options']['vision_trips_settings'] = array_merge((array) ($GLOBALS['vt_options']['vision_trips_settings'] ?? []), ['modules' => ['chat' => true, 'events' => true]]);
\VisionTrips\Settings::setMany(['modules' => ['chat' => true, 'events' => true]]);
$answers = [
    'balance'  => json_encode(['answer' => 'Your balance of £6,135.00 is due by 22 December 2026. You can pay online from the Payments section whenever suits you.', 'handoff' => false, 'reason' => '', 'source' => 'booking']),
    'unsafe'   => json_encode(['answer' => 'Yes — I can confirm a free upgrade to Business Class has been booked for £399 and your refund guaranteed.', 'handoff' => false, 'reason' => '', 'source' => 'general']),
    'handoff'  => json_encode(['answer' => 'Sarah will confirm whether a cot can be added.', 'handoff' => true, 'reason' => 'room request not in the booking', 'source' => 'none']),
];
$GLOBALS['vt_chat_mode'] = 'balance';
$prev = $GLOBALS['vt_http_handler'];
$GLOBALS['vt_http_handler'] = static function (string $method, string $url, array $args) use ($prev, $answers): ?array {
    if (str_contains($url, 'api.anthropic.com')) {
        return ['code' => 200, 'body' => json_encode(['model' => 'claude-sonnet-5-5', 'usage' => ['input_tokens' => 4200, 'output_tokens' => 90], 'content' => [['type' => 'text', 'text' => $answers[$GLOBALS['vt_chat_mode']]]]])];
    }
    return $prev($method, $url, $args);
};
$c = new \VisionTrips\Integrations\Concierge();
$r = $c->ask($trip, 'When is my balance due?');
echo 'concierge safe answer:   ' . (!$r['handoff'] && str_contains($r['answer'], '£6,135.00') ? 'OK' : 'WRONG') . ' — ' . $r['answer'] . "\n";
$GLOBALS['vt_chat_mode'] = 'unsafe';
$r = $c->ask($trip, 'Can I upgrade to business class?');
echo 'concierge unsafe → handoff: ' . ($r['handoff'] && !str_contains($r['answer'], '£399') ? 'OK' : 'WRONG') . ' — ' . $r['answer'] . "\n";
$GLOBALS['vt_chat_mode'] = 'handoff';
$r = $c->ask($trip, 'Can we have a cot in the room?');
echo 'concierge model handoff:  ' . ($r['handoff'] && str_contains($r['answer'], 'passed this to') ? 'OK' : 'WRONG') . ' — ' . $r['answer'] . "\n";
$mails = count($GLOBALS['vt_mail'] ?? []);
echo 'agent notified by email for the two handoffs: ' . ($mails >= 2 ? 'OK' : 'WRONG (' . $mails . ' sent)') . "\n";
$pack = \VisionTrips\Integrations\Concierge::contextPack($trip);
echo 'context pack: ' . strlen($pack) . " chars, mentions balance: " . (str_contains($pack, '6,135.00') ? 'yes' : 'no') . ", no net/commission: " . (preg_match('/\b(net|commission)\b/i', $pack) ? 'LEAK' : 'clean') . "\n";

// ---- Time budget: with no time left, a section still renders (from cache) and asks the browser to re-check
\VisionTrips\Rest\Api::startBudget(-1.0);
\VisionTrips\Rest\Api::$pending = false;
\VisionTrips\Support\Http::$cacheOnly = false;
$html = \VisionTrips\Rest\Api::fragment($trip, 'destinations', $vm);
echo 'budget exhausted: destinations still rendered ' . strlen($html) . ' bytes, pending=' . (\VisionTrips\Rest\Api::$pending ? 'yes' : 'no') . ' → ' . (strlen($html) > 500 && \VisionTrips\Rest\Api::$pending ? 'OK' : 'WRONG') . "\n";
\VisionTrips\Support\Http::$cacheOnly = false;

// ---- Loyalty: a scheme redemption is dropped; a points payment shows as points; the earn line appears
$graph = $fx['graph'];
if (is_array($graph)) {
    $graph['w2']['payments'][] = ['id' => 'recPAYSCHEME00001', 'fields' => ['Amount' => 150, 'Payment Type' => 'Loyalty Redemption', 'Status' => 'Complete']];
    $graph['w2']['payments'][] = ['id' => 'recPAYPOINTS00001', 'fields' => ['Amount' => 25, 'Payment Type' => 'Customer Payment', 'Customer Payment Type' => 'Deposit Payment', 'Status' => 'Complete', 'Payment Complete' => '2026-10-01', 'Method' => ['Loyalty Redemption'], 'Loyalty Transactions' => ['recTX000000000001']]];
    $graph['w3']['loyalty'] = [['id' => 'recTX000000000001', 'fields' => ['Transaction Type' => 'Redeem', 'Points' => -2500, 'Date' => '2026-10-01']]];
    $graph['booking']['fields']['Loyalty Enabled'] = [true];
    $graph['booking']['fields']['Loyalty_Total Points'] = 1240;
    $t2 = (new \VisionTrips\Airtable\BookingRepository(new \VisionTrips\Airtable\Client('demo')))->fromGraph('appX', $graph);
    $hasScheme = false; $pointsRow = null;
    foreach ($t2->payments as $p) { if ($p->id === 'recPAYSCHEME00001') { $hasScheme = true; } if ($p->id === 'recPAYPOINTS00001') { $pointsRow = $p; } }
    echo 'loyalty: scheme row hidden ' . (!$hasScheme ? 'OK' : 'WRONG') . ' · points row ' . ($pointsRow && $pointsRow->isPointsPayment() && $pointsRow->pointsRedeemed === 2500 ? 'OK (' . $pointsRow->pointsLabel() . ')' : 'WRONG') . ' · earns ' . ($t2->loyaltyEnabled && $t2->loyaltyPoints === 1240 ? 'OK' : 'WRONG') . "\n";
}

// ---- Agent @mention in Vision comments
$trip->agentUserId = 'usrTESTAGENT00001';
\VisionTrips\Settings::setMany(['mention_agent' => true, 'mention_agent_views' => false]);
$m = \VisionTrips\Airtable\Audit::mention($trip, 'Question from the customer');
$v = \VisionTrips\Airtable\Audit::mention($trip, 'Page viewed', true);
echo 'mention on actions: ' . (str_starts_with($m, '@[usrTESTAGENT00001] ') ? 'OK' : 'WRONG') . ' · not on views by default: ' . ($v === 'Page viewed' ? 'OK' : 'WRONG') . "\n";

// ---- Airport names, terminals, per-person price
$f = null; foreach ($trip->ofKind('flight') as $x) { $f = $x; break; }
echo 'flight title uses names: ' . ($f && !preg_match('/\b[A-Z]{3} – [A-Z]{3}\b/', $f->shortTitle()) ? 'OK (' . $f->shortTitle() . ')' : 'WRONG') . "\n";
$probe = \VisionTrips\Domain\Element::fromRecord(['id' => 'recPROBE000000001', 'fields' => ['Type' => 'Flight', 'Dep. IATA Code' => 'LHR', 'Arr. IATA Code' => 'DXB', 'Dep. Airport Name' => 'London Heathrow Airport', 'Arr. Airport Name' => 'Dubai International Airport', 'Further Information' => 'Please check in at Terminal 3; arrives Terminal 1.', 'Flight No.' => 'EK6', 'Pick Up Date' => '2027-01-01']], ['names' => [], 'suppliers' => [], 'airports' => [], 'airlines' => [], 'rooms' => [], 'cabins' => [], 'passengers' => [], 'ships' => [], 'itinerary' => [], 'operators' => []]);
echo 'terminals parsed from text: ' . ($probe->fromTerminal === '3' && $probe->toTerminal === '1' ? 'OK' : 'WRONG (' . $probe->fromTerminal . '/' . $probe->toTerminal . ')') . "\n";
echo 'per person: ' . ($trip->perPerson() > 0 && abs($trip->perPerson() * count($trip->travellers) - $trip->total) < 1 ? 'OK (' . $trip->money($trip->perPerson()) . ')' : 'WRONG') . "\n";


// ---- A walkthrough video alone is enough for the note card to render, on a quotation
$g3 = $fx['graph'];
$g3['booking']['fields']['Personalised Message'] = '';
$g3['booking']['fields']['Video Walkthrough'] = [['id' => 'attVID0000000001', 'url' => 'https://dl.airtable.com/x.mp4', 'type' => 'video/mp4', 'filename' => 'walkthrough.mp4', 'thumbnails' => []], ['id' => 'attIMG0000000001', 'url' => 'https://dl.airtable.com/y.jpg', 'type' => 'image/jpeg']];
$t4 = (new \VisionTrips\Airtable\BookingRepository(new \VisionTrips\Airtable\Client('demo')))->fromGraph('appX', $g3);
$t4->brand->about = '';
$vmQ = (new \VisionTrips\Frontend\TripPage($t4, 'tok', \VisionTrips\Security\Access::LEVEL_LINK, false))->viewModel(true);
$noteHtml = \VisionTrips\Frontend\View::render('trip/message', $vmQ);
echo 'walkthrough: video picked (not the photo): ' . ($t4->videoWalkthrough && $t4->videoWalkthrough['type'] === 'video/mp4' ? 'OK' : 'WRONG') . ' · note renders with video only: ' . (str_contains(\VisionTrips\Frontend\View::render('trip/walkthrough', $vmQ), 'data-walk') ? 'OK' : 'WRONG') . "\n";
