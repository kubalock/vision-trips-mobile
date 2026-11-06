<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use VisionTrips\Support\Dates;
use VisionTrips\Support\Str;

/**
 * Data for the CAA ATOL Certificate. Journeys are built from flight elements (connections within 24h at the same
 * airport are grouped), UK departure/arrival is detected from airport ISO country codes.
 */
final class Atol
{
    public bool $applies = false;
    public string $packageLabel = 'Package (Single-Contract)';
    public bool $flightOnly = false;
    public bool $multiContract = false;
    public string $protectorName = '';
    public string $issuerName = '';
    public string $atolNumber = '';
    public string $bookingRef = '';
    public string $issueDate = '';
    public int $passengerCount = 0;
    public string $passengerNames = '';
    public string $whatsCovered = '';
    public string $flightDetails = '';
    public string $totalCost = '';
    /** @var array<int,array{type:string,details:string,provider:string,price:string}> */
    public array $parts = [];

    public static function build(Trip $trip): self
    {
        $a = new self();
        $p = $trip->protection;
        $a->applies = $p->atolApplies();
        $select = strtolower($trip->atolSelect);
        $a->flightOnly = str_contains($select, 'flight only');
        $a->multiContract = str_contains($select, 'multi');
        $a->packageLabel = $a->flightOnly ? 'Flight-Only' : ($a->multiContract ? 'Package (Multi-Contract)' : 'Package (Single-Contract)');
        $a->protectorName = $p->holderName ?: ($trip->brand->memberCompany ?: $trip->brand->name);
        $a->issuerName = Protection::isAgent($p->mode) ? ($trip->brand->memberCompany ?: $trip->brand->name) : $a->protectorName;
        if ($p->isIte && Protection::isPrincipal($p->mode)) {
            $a->issuerName = 'Independent Travel Experts Ltd';
        }
        $a->atolNumber = $p->holderNumber;
        $a->bookingRef = $trip->ref;
        $a->bookingRef = (string) preg_replace('/,.*/', '', $a->bookingRef);
        $a->totalCost = $trip->money($trip->total);

        // Passengers
        $names = [];
        $count = $trip->unknownPax;
        foreach ($trip->travellers as $t) {
            $names[] = $t->name . ($t->isInfant ? ' (infant)' : '');
            if (!$t->isInfant) {
                $count++;
            }
        }
        $a->passengerCount = $count;
        $a->passengerNames = implode(', ', $names);

        // Issue date: booking created, or latest flight element creation
        $issue = $trip->firstPaymentDate() ?? $trip->createdAt ?? Dates::now();
        $a->issueDate = $issue->format('d/m/Y');

        // Journeys from flights
        $flights = [];
        foreach ($trip->ofKind('flight') as $f) {
            if (!$f->start) {
                continue;
            }
            $dep = $f->start;
            if ($f->startTime !== '' && preg_match('/^(\d{2}):(\d{2})$/', $f->startTime, $m)) {
                $dep = $dep->setTime((int) $m[1], (int) $m[2]);
            }
            $arr = $f->end ?? $f->start;
            if ($f->endTime !== '' && preg_match('/^(\d{2}):(\d{2})$/', $f->endTime, $m)) {
                $arr = $arr->setTime((int) $m[1], (int) $m[2]);
            }
            $flights[] = ['dep' => $dep, 'arr' => $arr, 'from' => $f->from, 'to' => $f->to, 'fromC' => $f->fromCountry, 'toC' => $f->toCountry, 'carrier' => $f->carrier, 'ref' => $f->supplierRef, 'price' => $f];
        }
        usort($flights, static fn ($x, $y) => $x['dep'] <=> $y['dep']);
        $journeys = [];
        $current = [];
        foreach ($flights as $fl) {
            if ($current) {
                $prev = end($current);
                $gap = ($fl['dep']->getTimestamp() - $prev['arr']->getTimestamp()) / 3600;
                $same = strtolower(trim($prev['to'])) === strtolower(trim($fl['from'])) && $prev['to'] !== '';
                if ($same && $gap >= 0 && $gap <= 24) {
                    $current[] = $fl;
                    continue;
                }
                $journeys[] = $current;
            }
            $current = [$fl];
        }
        if ($current) {
            $journeys[] = $current;
        }
        $isUk = static fn (string $c) => in_array(strtoupper($c), ['GB', 'GBR', 'UK', 'UNITED KINGDOM'], true);
        $segments = [];
        $outbound = $inbound = false;
        foreach ($journeys as $j) {
            $first = reset($j);
            $last = end($j);
            $via = [];
            foreach (array_slice($j, 0, -1) as $leg) {
                if ($leg['to'] !== '') {
                    $via[] = $leg['to'];
                }
            }
            $text = $first['from'] . ' to ' . $last['to'] . ($via ? ' via ' . implode(', ', array_unique($via)) : '');
            $returning = !$isUk($first['fromC']) && $isUk($last['toC']);
            if ($isUk($first['fromC']) && !$isUk($last['toC'])) {
                $outbound = true;
            }
            if ($returning) {
                $inbound = true;
                $text .= ', returning ' . $last['arr']->format('d/m/Y') . ($last['carrier'] !== '' ? ' with ' . $last['carrier'] : '');
            } else {
                $text .= ', departing ' . $first['dep']->format('d/m/Y') . ($first['carrier'] !== '' ? ' with ' . $first['carrier'] : '');
            }
            $segments[] = $text;
        }
        if ($segments) {
            $a->flightDetails = (count($segments) > 1 ? 'Flights from ' : 'Flight from ') . implode('; ', $segments) . '.';
        }
        $countries = $trip->countries;
        $countriesText = count($countries) <= 1 ? (string) ($countries[0] ?? $trip->destinationSummary()) : implode(', ', array_slice($countries, 0, -1)) . ' and ' . end($countries);
        if (!$a->flightOnly && ($trip->hasKind('stay') || $trip->hasKind('cruise') || $trip->hasKind('carhire'))) {
            $a->whatsCovered = 'Package holiday to ' . $countriesText . ' for ' . $trip->duration . ' nights.';
        } elseif ($outbound && $inbound) {
            $a->whatsCovered = 'Return flights to ' . $countriesText . '.';
        } else {
            $a->whatsCovered = 'Flight to ' . $countriesText . '.';
        }

        // Multi-contract parts
        if ($a->multiContract) {
            if ($a->flightDetails !== '') {
                $refs = [];
                foreach ($flights as $fl) {
                    $r = trim(($fl['carrier'] !== '' ? $fl['carrier'] : '') . ($fl['ref'] !== '' ? ', Ref: ' . $fl['ref'] : ''), ', ');
                    if ($r !== '') {
                        $refs[] = $r;
                    }
                }
                $a->parts[] = ['type' => 'Flight', 'details' => $a->flightDetails, 'provider' => implode('; ', array_unique($refs)), 'price' => ''];
            }
            foreach ($trip->activeElements() as $e) {
                if ($e->kind === 'flight') {
                    continue;
                }
                $details = match ($e->kind) {
                    'stay' => 'Stay at ' . $e->title,
                    'carhire' => 'Car hire' . ($e->from !== '' ? ' from ' . $e->from : ''),
                    'cruise' => 'Cruise: ' . $e->title,
                    default => $e->title,
                };
                $a->parts[] = ['type' => $e->typeLabel, 'details' => $details, 'provider' => trim(($e->supplier !== '' ? $e->supplier : '') . ($e->supplierRef !== '' ? ', Ref: ' . $e->supplierRef : ''), ', '), 'price' => ''];
            }
        }
        return $a;
    }
}
