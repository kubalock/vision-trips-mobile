<?php
/**
 * Fast self-test of the rules that must never regress: id filtering, financial locks, theme coverage, protection
 * modes per Licensing value, legal notice selection, stage resolution.   php bin/selftest.php
 */
declare(strict_types=1);
$root = dirname(__DIR__);
require $root . '/bin/stubs/wp.php';
define('VISION_TRIPS_DIR', $root . '/');
define('VISION_TRIPS_URL', '/vision-trips/');
define('VISION_TRIPS_VERSION', 'test');
require $root . '/includes/Autoloader.php';
\VisionTrips\Autoloader::register($root . '/includes');
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Domain\Brand;
use VisionTrips\Domain\Protection;
use VisionTrips\Domain\Stage;
use VisionTrips\Domain\Theme;
use VisionTrips\Support\Str;
$fails = 0;
$ok = static function (bool $cond, string $what) use (&$fails): void { echo ($cond ? '  ok   ' : '  FAIL ') . $what . PHP_EOL; if (!$cond) { $fails++; } };

$ok(Str::clean('recABCDEFGHIJKLMN') === '', 'record ids are never displayed');
$leak = '**Note to the travel professional:** Before finalising this text for the client, please be aware that guest reviews are mixed. --- Nestled in Matagorda, the Westwood Inn is a family-owned property with a relaxed feel.';
$ok(\VisionTrips\Integrations\Ai::brochureProblem($leak) !== '', 'brochure gate rejects model commentary');
$ok(\VisionTrips\Integrations\Ai::brochureProblem('Nestled in the small coastal township of Matagorda on the upper Texas Gulf Coast, the Westwood Inn is a family-owned property with a relaxed, characterful feel, close to the seashore and harbour.') === '', 'brochure gate accepts clean copy');
$ok(\VisionTrips\Integrations\Ai::brochureProblem('The hotel is dated and reviews mention cleanliness concerns, but the beach is lovely.') !== '', 'brochure gate rejects negativity');
$ok(str_starts_with(\VisionTrips\Integrations\Ai::extractCopy(['content' => [['type' => 'text', 'text' => 'Searching now.'], ['type' => 'text', 'text' => 'Notes here. <copy>Clean copy about the hotel that is long enough to pass.</copy> Hope this helps!']]]), 'Clean copy'), 'only the <copy> block is used');
$ok(Str::clean('usrABCDEFGHIJKLMN') === '', 'user ids are never displayed');
$ok(Str::clean('"NWG-123"') === 'NWG-123', 'formula quotes stripped');
$ok(str_contains(Str::richText('<p>Hi <b>x</b> **y**</p>'), '<strong>y</strong>'), 'markdown inside HTML handled');
foreach (['MS Total Payments', 'Total Supplements Costs', 'Net', 'Gross', 'Commission', 'Invoice Deposit', 'Supplier Balance Due (Custom)'] as $f) {
    $ok(FieldMap::isFinancial($f) && !FieldMap::defaultVisible($f), "financial field locked: {$f}");
}
$ok(FieldMap::defaultVisible('Board Basis') && !FieldMap::defaultVisible('Comments') && !FieldMap::defaultVisible('Customer Score'), 'allowlist defaults');
$tags = ['Mainstream', 'Beach', 'City', 'Touring & Adventure', 'Ocean Cruise', 'River Cruise', 'Expedition Cruise', 'Rail', 'Coach', 'Ski & Winter Sports', 'Villa & Self-Catering', 'UK & Domestic Break', 'Fly-Drive & Road Trip', 'Safari & Wildlife', 'Disney & Universal', 'Lakes & Mountains', 'Events & Sports', 'Affordable Luxury', 'Premium Luxury', 'Ultra Luxury', 'Activity & Special Interest', 'Short Haul', 'Mid Haul', 'Long Haul', 'Adult Only', 'Flight Only'];
foreach ($tags as $t) {
    $ok(Theme::resolve([$t]) === $t && isset(Theme::THEMES[$t]), "theme for tag: {$t}");
}
$ok(Theme::resolve(['Ocean Cruise', 'Ultra Luxury']) === 'Ultra Luxury', 'priority: luxury tier beats product tag');
$brand = Brand::fromRecords(['id' => 'b', 'fields' => ['Trading Name' => 'X', 'Proposition' => ['Worldchoice Plus']]], ['id' => 'm', 'fields' => ['Company Name' => 'X Ltd', 'Proposition' => 'Worldchoice Plus', 'T-ATOL Enabled' => true, 'T-ATOL Number' => 'T1234']]);
$noAtol = Brand::fromRecords(['id' => 'b', 'fields' => ['Trading Name' => 'Y', 'Proposition' => ['Worldchoice Plus']]], ['id' => 'm', 'fields' => ['Company Name' => 'Y Ltd', 'Proposition' => 'Worldchoice Plus']]);
$p = Protection::build('Single-Contract Package', true, $noAtol, '11694', 'Tour Op Ltd', false, '');
$ok(Protection::isAgent($p->mode) && $p->holderName === 'Tour Op Ltd' && $p->holderNumber === '11694' && $p->retailerOnly, 'member without T-ATOL is retailer; holder is the operator (' . $p->holderLabel() . ')');
$ok($p->trustLabel === '' && !str_contains($p->summarySentence(), 'trust'), 'no trust account claimed without evidence');
$cases = [
    ['Single-Contract Package', 'Single-contract Package (Principal/Package Organiser)', true, 'principal_single_contract', true, false],
    ['Agent of ATOL Holder (Single-Contract)', "Sales of other ATOL holders' packages (Single-Contract)", true, 'agent_single_contract', true, false],
    ['Flight Only', 'Flight sales made as an Airline Ticket Agent', true, 'not_applicable', false, true],
    ['Not Applicable', 'Accommodation only - as principal', false, 'not_applicable', false, false],
    ['Single Contract Package (No Flight)', 'Non-air packages - as principal', false, 'principal_package_no_flight', false, false],
    ['Flight Only', 'Flight-Only sales as agent of other ATOL holders', true, 'agent_flight_only', true, false],
];
foreach ($cases as [$atol, $lic, $flight, $mode, $atolApplies, $ticket]) {
    $p = Protection::build($atol, $flight, $brand, '', 'Tour Op Ltd', false, $lic);
    $ok($p->mode === $mode && $p->atolApplies() === $atolApplies && $p->ticketAgent === $ticket, "protection: {$lic} → {$p->mode}, atol=" . ($p->atolApplies() ? 'yes' : 'no'));
}
$p = Protection::build('Single-Contract Package', true, $brand, '', '', false, '');
$ok($p->holderNumber === 'T1234', 'T-ATOL member uses own ATOL number');
$now = new DateTimeImmutable('2026-11-03', new DateTimeZone('Europe/London'));
$d = static fn (string $s) => new DateTimeImmutable($s, new DateTimeZone('Europe/London'));
$ok(Stage::resolve('Quotation', $d('2027-03-01'), $d('2027-03-12'), $d('2026-11-10'), $now) === Stage::QUOTE, 'stage: quotation');
$ok(Stage::resolve('Quotation', $d('2027-03-01'), $d('2027-03-12'), $d('2026-10-10'), $now) === Stage::QUOTE_EXPIRED, 'stage: expired quotation');
$ok(Stage::resolve('Confirmed', $d('2027-03-01'), $d('2027-03-12'), null, $now) === Stage::COUNTDOWN, 'stage: countdown');
$ok(Stage::resolve('Confirmed', $d('2026-11-09'), $d('2026-11-20'), null, $now) === Stage::PREP, 'stage: prep');
$ok(Stage::resolve('Confirmed', $d('2026-11-03'), $d('2026-11-20'), null, $now) === Stage::DEPARTURE, 'stage: departure day');
$ok(Stage::resolve('Confirmed', $d('2026-10-30'), $d('2026-11-20'), null, $now) === Stage::TRAVELLING, 'stage: travelling');
$ok(Stage::resolve('Confirmed', $d('2026-10-10'), $d('2026-10-25'), null, $now) === Stage::HOME, 'stage: welcome home');
$ok(Stage::resolve('Closed Quotation', null, null, null, $now) === Stage::CLOSED && Stage::resolve('Cancelled', null, null, null, $now) === Stage::CANCELLED, 'stage: closed/cancelled');
echo ($fails ? "FAILED: {$fails}" : 'All checks passed') . PHP_EOL;
exit($fails ? 1 : 0);
