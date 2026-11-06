<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use VisionTrips\Settings;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Str;

/**
 * Consumer-law layer. Generates, from the booking data:
 *  - the pre-contract "key information" the PTR 2018 (reg 5) expect before a package is bound
 *  - the applicable standard notice (package / linked travel arrangement / not ATOL protected)
 *  - price, payment, cancellation, insurance, entry and assistance statements
 * Texts live in config/legal.php and can be edited in wp-admin → Legal. They are summaries with links to the
 * statutory wording and must be reviewed by TTNG compliance.
 */
final class Legal
{
    /** @return array<string,array{label:string,text:string}> */
    public static function texts(): array
    {
        $defaults = require VISION_TRIPS_DIR . 'config/legal.php';
        $custom = (array) Settings::get('legal_texts', []);
        foreach ($custom as $k => $v) {
            if (isset($defaults[$k]) && is_string($v) && trim($v) !== '') {
                $defaults[$k]['text'] = $v;
            }
        }
        return $defaults;
    }

    /** One text with placeholders merged, as safe HTML paragraphs. */
    public static function text(string $key, Trip $trip): string
    {
        $t = self::texts()[$key]['text'] ?? '';
        if ($t === '' || ($key === 'trust_statement' && $trip->protection->trustLabel === '')) {
            return '';
        }
        $p = $trip->protection;
        $b = $trip->brand;
        $member = $b->memberCompany ?: $b->name;
        $map = [
            '{organiser}'  => $p->organiserName ?: $member,
            '{retailer}'   => $member,
            '{member}'     => $member,
            '{atol}'       => $p->holderLabel() !== '' ? $p->holderLabel() : 'the ATOL scheme',
            '{protection}' => $p->protectionEntity(),
            '{regulator}'  => $p->atolApplies() ? 'the Civil Aviation Authority, www.caa.co.uk' : 'the relevant protection provider',
        ];
        return Str::richText(strtr($t, $map));
    }

    /** Which statutory notice applies to this booking. @return array{key:string,title:string,html:string}|null */
    public static function notice(Trip $trip): ?array
    {
        $p = $trip->protection;
        if ($p->ticketAgent) {
            return ['key' => 'ticket_agent', 'title' => 'About this flight', 'html' => self::text('ticket_agent', $trip)];
        }
        if ($p->isPackage()) {
            return ['key' => 'ptr_package', 'title' => 'Your rights: this is a package', 'html' => self::text('ptr_package', $trip)];
        }
        if ($p->contractType === 'agent_services' && count(array_unique(array_map(static fn (Element $e) => $e->kind, $trip->activeElements()))) > 1 && Settings::bool('lta_notice')) {
            return ['key' => 'lta_notice', 'title' => 'Your rights: separate bookings', 'html' => self::text('lta_notice', $trip)];
        }
        return null;
    }

    /**
     * Pre-contract key information, built from the data. @return array<int,array{label:string,text:string}>
     */
    public static function keyInformation(Trip $trip): array
    {
        $b = $trip->brand;
        $p = $trip->protection;
        $rows = [];
        $dest = $trip->destinationSummary();
        $rows[] = ['label' => 'Destination and dates', 'text' => trim(($dest !== '' ? $dest . '. ' : '') . ($trip->departs ? Dates::long($trip->departs) . ' to ' . Dates::long($trip->returns) : 'Dates to be confirmed') . ($trip->duration ? ' (' . $trip->duration . ' nights).' : '.'))];
        $transport = [];
        foreach ($trip->activeElements() as $e) {
            if (in_array($e->kind, ['flight', 'train', 'transfer', 'cruise', 'carhire'], true)) {
                $line = match ($e->kind) {
                    'flight' => 'Flight ' . trim(($e->carrier !== '' ? $e->carrier . ' ' : '') . $e->flightNo) . ($e->flightClass !== '' ? ' (' . $e->flightClass . ')' : '') . ': ' . $e->from . ' to ' . $e->to . ($e->start ? ', ' . Dates::medium($e->start) : '') . ($e->startTime !== '' ? ' ' . $e->startTime : '') . ($e->endTime !== '' ? ' arriving ' . $e->endTime . ($e->arrivesNextDay ? ' next day' : '') : ''),
                    'cruise' => 'Cruise: ' . $e->title . ($e->ship !== '' ? ' aboard ' . $e->ship : '') . ', ' . Dates::range($e->start, $e->end) . ($e->departPort !== '' ? ', from ' . $e->departPort : '') . ($e->disembarkPort !== '' ? ' to ' . $e->disembarkPort : ''),
                    'carhire' => 'Car hire: ' . $e->title . ', ' . Dates::range($e->start, $e->end) . ($e->from !== '' ? ', collect ' . $e->from : ''),
                    default => \VisionTrips\Frontend\View::kindLabel($e->kind) . ': ' . trim($e->from . ' to ' . $e->to, ' to') . ($e->start ? ', ' . Dates::medium($e->start) : '') . ($e->startTime !== '' ? ' ' . $e->startTime : ''),
                };
                $transport[] = $line;
            }
        }
        if ($transport) {
            $rows[] = ['label' => 'Transport', 'text' => implode('; ', $transport) . '. Times are provisional until tickets are issued and will be confirmed on your travel documents.'];
        }
        $stays = [];
        foreach ($trip->ofKind('stay') as $e) {
            $stays[] = $e->title . ($e->rating !== '' ? ' (' . $e->rating . ' star)' : '') . ($e->address !== '' ? ', ' . $e->address : '') . ': ' . Dates::range($e->start, $e->end) . ($e->nights ? ', ' . $e->nights . ' night' . ($e->nights === 1 ? '' : 's') : '') . ($e->rooms ? ', ' . implode('; ', $e->rooms) : '');
        }
        foreach ($trip->ofKind('cruise') as $e) {
            if ($e->cabins) {
                $stays[] = 'Cabin on ' . ($e->ship ?: $e->title) . ': ' . implode('; ', array_map(static fn ($c) => implode(', ', array_map(static fn ($k, $v) => $k . ' ' . $v, array_keys($c), $c)), $e->cabins));
            }
        }
        if ($stays) {
            $rows[] = ['label' => 'Accommodation and meals', 'text' => implode('. ', $stays) . '. Star ratings are the supplier\'s own unless stated.'];
        }
        $extras = [];
        foreach ($trip->activeElements() as $e) {
            if (in_array($e->kind, ['attraction', 'misc', 'parking'], true)) {
                $extras[] = $e->title . ($e->start ? ' (' . Dates::medium($e->start) . ')' : '');
            }
        }
        if ($extras) {
            $rows[] = ['label' => 'Also included', 'text' => implode('; ', $extras) . '.'];
        }
        $pax = $trip->totalPax ?: count($trip->travellers);
        $rows[] = ['label' => 'Travellers', 'text' => ($pax ? $pax . ' traveller' . ($pax === 1 ? '' : 's') : 'Travellers to be confirmed') . ($trip->travellers ? ': ' . implode(', ', array_map(static fn ($t) => $t->name, $trip->travellers)) : '') . '. Services are provided in English unless stated. Arrangements are not provided as part of a group unless stated.'];
        $price = 'Total price ' . $trip->money($trip->total) . ' including all taxes and charges known at the time of booking.';
        if ($trip->totalInclResort > 0 && abs($trip->totalInclResort - $trip->total) > 0.01) {
            $price .= ' Local payments of ' . $trip->money($trip->totalInclResort - $trip->total) . ' are collected by suppliers during your trip, making the total cost of the trip ' . $trip->money($trip->totalInclResort) . '.';
        }
        $sched = [];
        foreach ($trip->sortedPayments() as $pay) {
            if ($pay->isCustomerPayment() && $pay->amount > 0) {
                $sched[] = $pay->money() . ' ' . strtolower($pay->label()) . ($pay->isPaid() ? ' (received)' : ($pay->due ? ' due ' . Dates::medium($pay->due) : ''));
            }
        }
        if ($sched) {
            $price .= ' Payments: ' . implode('; ', $sched) . '.';
        }
        $rows[] = ['label' => 'Price and payment', 'text' => $price];
        $who = ($p->organiserName !== '' && $p->organiserName !== ($b->memberCompany ?: $b->name)) ? 'Package organiser: ' . $p->organiserName . '. Retailer: ' : 'Organiser and retailer: ';
        $who .= ($b->memberCompany ?: $b->name) . ($b->name !== '' && $b->name !== $b->memberCompany ? ' trading as ' . $b->name : '') . ($b->memberOffice ? ', ' . implode(', ', $b->memberOffice) : '') . '.';
        $contact = array_filter([$b->phone, $b->email]);
        if ($contact) {
            $who .= ' Contact: ' . implode(', ', $contact) . '.';
        }
        $rows[] = ['label' => 'Who you are contracting with', 'text' => $who];
        $rows[] = ['label' => 'Financial protection', 'text' => $p->summarySentence()];
        $rows[] = ['label' => 'Cancellation', 'text' => strip_tags(self::text('cancellation', $trip))];
        $rows[] = ['label' => 'Passports, visas and health', 'text' => strip_tags(self::text('entry_health', $trip)) . ($trip->entryRequirementHints() !== '' ? ' ' . $trip->entryRequirementHints() : '')];
        $rows[] = ['label' => 'Insurance', 'text' => strip_tags(self::text('insurance', $trip))];
        $rows[] = ['label' => 'Special requirements', 'text' => strip_tags(self::text('assistance', $trip))];
        return $rows;
    }

    /** Key information as HTML (dl). */
    public static function keyInformationHtml(Trip $trip): string
    {
        $h = '<dl class="vt-kv vt-kv--stack">';
        foreach (self::keyInformation($trip) as $row) {
            $h .= '<div><dt>' . htmlspecialchars($row['label'], ENT_QUOTES, 'UTF-8') . '</dt><dd>' . htmlspecialchars($row['text'], ENT_QUOTES, 'UTF-8') . '</dd></div>';
        }
        return $h . '</dl>';
    }
}
