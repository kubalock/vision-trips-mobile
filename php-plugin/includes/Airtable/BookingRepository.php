<?php
declare(strict_types=1);

namespace VisionTrips\Airtable;

use VisionTrips\Domain\Brand;
use VisionTrips\Domain\Element;
use VisionTrips\Domain\Payment;
use VisionTrips\Domain\Protection;
use VisionTrips\Domain\Stage;
use VisionTrips\Domain\Theme;
use VisionTrips\Domain\Traveller;
use VisionTrips\Domain\Trip;
use VisionTrips\Settings;
use VisionTrips\Support\Arr;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Log;
use VisionTrips\Support\Str;

/**
 * Loads everything for one booking. Three round-trips to Airtable (booking → first-level links → second-level links),
 * each wave fetched in parallel. The raw graph is cached briefly so repeat loads and REST calls are instant.
 */
final class BookingRepository
{
    public function __construct(private Client $client)
    {
    }

    /** True when the last load served a stale copy because Vision could not be reached in time. */
    public bool $servedStale = false;
    /** True when the last load failed outright with no copy to fall back on (the caller shows a retrying page). */
    public bool $unavailable = false;

    public function load(string $base, string $recordId, bool $fresh = false): ?Trip
    {
        $this->servedStale = false;
        $this->unavailable = false;
        $ttl = max(10, Settings::int('cache_ttl_booking', 60));
        $key = $base . '|' . $recordId;
        $hit = !$fresh && Cache::get('graph', $key) !== null;
        $graph = Cache::remember('graph', $key, $ttl, fn () => $this->fetchGraph($base, $recordId), $fresh);
        $how = $hit ? 'served from cache' : 'fetched live';
        if (!is_array($graph) || empty($graph['booking'])) {
            // Vision slow, rate-limited or down: fall back to the last good copy (kept for 3 days).
            $stale = Cache::get('graph-stale', $key);
            if (is_array($stale) && !empty($stale['booking']) && !$this->client->lastWasNotFound()) {
                $graph = $stale;
                $this->servedStale = true;
                $how = 'Vision unavailable (' . $this->client->lastError() . ') — showing the copy saved ' . gmdate('D H:i', (int) ($stale['fetched_at'] ?? 0)) . ' UTC';
            } else {
                $this->unavailable = !$this->client->lastWasNotFound();
                return null;
            }
        } elseif (!$hit) {
            Cache::set('graph-stale', $key, $graph, 3 * DAY_IN_SECONDS);
        }
        \VisionTrips\Support\Provenance::note('Booking, brand, travellers, itinerary, payments', 'Airtable (Vision)', $how . ', ' . count($graph['w2']['elements'] ?? []) . ' elements · ' . count($graph['w2']['payments'] ?? []) . ' payments · fetched ' . gmdate('H:i:s', (int) ($graph['fetched_at'] ?? time())) . ' UTC', !$this->servedStale);
        return $this->build($base, $graph);
    }

    /** Build a Trip from an already-fetched graph (tests, previews, imports). @param array<string,mixed> $graph */
    public function fromGraph(string $base, array $graph): Trip
    {
        return $this->build($base, $graph);
    }

    public function invalidate(string $base, string $recordId): void
    {
        Cache::delete('graph', $base . '|' . $recordId);
        Cache::delete('graph-stale', $base . '|' . $recordId);
    }

    /** @return array<string,mixed>|null */
    private function fetchGraph(string $base, string $recordId): ?array
    {
        $t = static fn (string $k) => FieldMap::table($k);
        $booking = $this->client->record($base, $t('bookings'), $recordId);
        if (!$booking) {
            return null;
        }
        $bf = $booking['fields'] ?? [];
        $pick = static fn (string $k) => FieldMap::pick($bf, 'booking', $k);

        // Wave 2
        $wave2 = $this->client->byIdsMany($base, [
            'brand'     => ['table' => $t('brands'),    'ids' => Arr::recordIds($pick('brand'))],
            'member'    => ['table' => $t('members'),   'ids' => Arr::recordIds($pick('member'))],
            'customers' => ['table' => $t('customers'), 'ids' => Arr::recordIds($pick('customers'))],
            'people'    => ['table' => $t('people'),    'ids' => Arr::recordIds($pick('people'))],
            'elements'  => ['table' => $t('elements'),  'ids' => Arr::recordIds($pick('elements'))],
            'payments'  => ['table' => $t('payments'),  'ids' => Arr::recordIds($pick('payments'))],
            'upsells'   => ['table' => $t('upsells'),   'ids' => Arr::recordIds($pick('upsells'))],
            'locations' => ['table' => $t('locations'), 'ids' => Arr::recordIds($pick('destinations'))],
            'comms'     => ['table' => $t('comms'),     'ids' => array_slice(Arr::recordIds($pick('communications')), -40)],
        ]);

        // Wave 3: second-level links from elements, brand, payments
        $ids = ['suppliers' => [], 'airports' => [], 'airlines' => [], 'rooms' => [], 'cabins' => [], 'passengers' => [], 'ships' => [], 'itinerary' => [], 'elocations' => [], 'operators' => []];
        foreach ($wave2['elements'] as $el) {
            $ef = $el['fields'] ?? [];
            $g = static fn (string $k) => FieldMap::pick($ef, 'element', $k);
            $ids['suppliers'] = array_merge($ids['suppliers'], Arr::recordIds($g('supplier')));
            $ids['airports'] = array_merge($ids['airports'], Arr::recordIds($g('from')), Arr::recordIds($g('to')));
            $ids['airlines'] = array_merge($ids['airlines'], Arr::recordIds($g('carrier')));
            $ids['rooms'] = array_merge($ids['rooms'], Arr::recordIds($g('rooms')));
            $ids['cabins'] = array_merge($ids['cabins'], Arr::recordIds($g('cabins')));
            $ids['passengers'] = array_merge($ids['passengers'], Arr::recordIds($g('passengers')));
            $ids['ships'] = array_merge($ids['ships'], Arr::recordIds($g('cruise_ship')));
            $ids['itinerary'] = array_merge($ids['itinerary'], Arr::recordIds($g('visiting_ports')));
            $ids['elocations'] = array_merge($ids['elocations'], Arr::recordIds($g('location')));
            $ids['operators'] = array_merge($ids['operators'], Arr::recordIds($g('cruise_line')));
        }
        $templateIds = [];
        $brandF = $wave2['brand'][0]['fields'] ?? [];
        $templateIds = Arr::recordIds(FieldMap::pick($brandF, 'brand', 'templates'));
        $methodIds = [];
        foreach ($wave2['payments'] as $p) {
            $methodIds = array_merge($methodIds, Arr::recordIds(FieldMap::pick($p['fields'] ?? [], 'payment', 'method')));
        }
        $leadSupplierIds = Arr::recordIds($pick('lead_supplier'));

        $wave3 = $this->client->byIdsMany($base, [
            'suppliers'  => ['table' => $t('suppliers'), 'ids' => array_merge($ids['suppliers'], $leadSupplierIds)],
            'airports'   => ['table' => $t('airports'),  'ids' => $ids['airports']],
            'airlines'   => ['table' => $t('airlines'),  'ids' => $ids['airlines']],
            'rooms'      => ['table' => $t('rooms'),     'ids' => $ids['rooms']],
            'cabins'     => ['table' => $t('cabins'),    'ids' => $ids['cabins']],
            'passengers' => ['table' => $t('passengers'), 'ids' => $ids['passengers']],
            'ships'      => ['table' => $t('ships'),     'ids' => $ids['ships']],
            'itinerary'  => ['table' => $t('cruise_itin'), 'ids' => $ids['itinerary']],
            'elocations' => ['table' => $t('locations'), 'ids' => $ids['elocations']],
            'operators'  => ['table' => $t('operators'), 'ids' => $ids['operators']],
            'templates'  => ['table' => $t('brand_templates'), 'ids' => $templateIds],
            'methods'    => ['table' => 'Payment Setup', 'ids' => $methodIds],
        ]);

        // Ports inside cruise itinerary rows link to CMS [Locations]
        $portIds = [];
        foreach ($wave3['itinerary'] as $row) {
            $portIds = array_merge($portIds, Arr::recordIds(FieldMap::pick($row['fields'] ?? [], 'cruise_itin', 'port')));
        }
        $ports = $portIds ? $this->client->byIds($base, $t('locations'), array_values(array_unique($portIds))) : [];

        return [
            'fetched_at' => time(),
            'booking'    => $booking,
            'w2'         => $wave2,
            'w3'         => $wave3,
            'ports'      => $ports,
        ];
    }

    /** @param array<string,mixed> $graph */
    private function build(string $base, array $graph): Trip
    {
        $booking = $graph['booking'];
        $bf = $booking['fields'] ?? [];
        $w2 = $graph['w2'];
        $w3 = $graph['w3'];
        $pick = static fn (string $k) => FieldMap::pick($bf, 'booking', $k);

        $trip = new Trip();
        $trip->base = $base;
        $trip->id = (string) $booking['id'];
        $trip->raw = $bf;
        $trip->ref = Str::clean(Arr::first($pick('ref'))) ?: $trip->id;
        $trip->name = Str::clean($pick('name')) ?: 'Your trip';
        if ($trip->name === $trip->ref) {
            $trip->name = 'Your trip';
        }
        $trip->status = Str::clean($pick('status')) ?: 'Quotation';
        $trip->tags = Arr::strings($pick('tags'));
        $trip->holidayTypes = Arr::strings($pick('holiday_types'));
        $trip->sector = Str::clean($pick('sector'));
        $trip->travellerType = Str::clean($pick('traveller_type'));
        $trip->departs = Dates::parse($pick('departs'));
        $trip->returns = Dates::parse($pick('returns'));
        $trip->duration = (int) Arr::number($pick('duration'));
        if ($trip->duration === 0 && $trip->departs && $trip->returns) {
            $trip->duration = max(0, (int) Dates::daysBetween($trip->departs, $trip->returns));
        }
        $trip->countries = Arr::strings($pick('countries'));
        $trip->quoteExpiry = Dates::parse($pick('quote_expiry'));
        $trip->bookingDate = Dates::parse($pick('booking_date'));
        $trip->createdAt = Dates::parse($pick('created'));
        $trip->lastModified = Dates::parse($pick('last_modified'));
        $trip->cancelDate = Dates::parse($pick('cancel_date'));
        $trip->cancelReason = Str::clean($pick('cancel_reason'));
        $trip->surprise = Arr::truthy($pick('surprise')) && Settings::bool('surprise_mode');
        $trip->giftVoucher = Arr::truthy($pick('gift_voucher'));
        $trip->groupBooking = Arr::truthy($pick('group'));
        $trip->enable2fa = Arr::truthy($pick('enable_2fa'));
        $includeMsg = $pick('include_message');
        $msg = Str::clean($pick('personal_message'));
        $trip->agentName = Str::clean(Arr::first($pick('agent')));
        $trip->tripOverview = Str::richText(Str::clean(Arr::first($pick('trip_overview'))));
        foreach (Arr::images($pick('hero')) as $img) {
            $trip->heroImages[] = ['url' => $img['url'], 'thumb' => $img['thumb']];
        }
        foreach (Arr::images($pick('gallery')) as $img) {
            $trip->heroImages[] = ['url' => $img['url'], 'thumb' => $img['thumb']];
        }
        $trip->oohLink = Str::clean(Arr::first($pick('ooh_link')));
        $trip->oohEmail = Str::clean(Arr::first($pick('ooh_email')));
        $trip->emergencyPhone = Str::clean(Arr::first($pick('emergency_phone')));
        $trip->mintBookingId = Str::clean($pick('mint_booking_id'));
        $trip->totalPax = (int) Arr::number($pick('total_pax'));
        $trip->unknownPax = (int) Arr::number($pick('unknown_pax'));
        $trip->atolSelect = Str::clean($pick('atol'));
        $trip->atolNo = Str::clean(Arr::first($pick('atol_no')));
        $trip->supplierTicketsReceived = Arr::truthy($pick('supplier_tickets'));
        $trip->supplierConfirmationsReceived = Arr::truthy($pick('supplier_confirmations'));
        $trip->customerEmail = Str::clean(Arr::first($pick('customer_email')));
        $trip->customerPhone = Str::clean(Arr::first($pick('customer_phone')));
        $trip->customerPostcode = Str::clean(Arr::first($pick('customer_postcode')));

        // Money
        $trip->currency = strtoupper(Str::clean(Arr::first($pick('currency')))) ?: 'GBP';
        $trip->total = Arr::number($pick('total'));
        $trip->totalInclResort = Arr::number($pick('total_incl_resort'));
        $trip->paid = Arr::number($pick('paid'));
        $trip->balance = Arr::number($pick('balance'));
        $trip->nextDueAmount = Arr::number($pick('next_due_amount'));
        $trip->nextDueDate = Dates::parse($pick('next_due_date'));
        $trip->balanceDueDate = Dates::parse($pick('balance_due'));
        $trip->finalSupplierDue = Dates::parse($pick('final_supplier_due'));
        $trip->altCurrency = Arr::truthy($pick('alt_currency'));
        $trip->altCurrencyType = strtoupper(Str::clean($pick('alt_currency_type')));
        if ($trip->altCurrency && in_array($trip->altCurrencyType, ['USD', 'EUR'], true)) {
            $trip->altAmount = Arr::number($pick($trip->altCurrencyType === 'USD' ? 'usd_amount' : 'eur_amount'));
        }

        // Brand + member
        $trip->brand = Brand::fromRecords($w2['brand'][0] ?? [], $w2['member'][0] ?? []);
        foreach ($w3['templates'] as $tpl) {
            $tf = $tpl['fields'] ?? [];
            $type = Str::clean(FieldMap::pick($tf, 'brand_template', 'type'));
            $letter = Str::clean(FieldMap::pick($tf, 'brand_template', 'letter'));
            if ($letter !== '' && ($type === '' || strcasecmp($type, 'Letter') === 0)) {
                $trip->brand->letterTemplates[] = ['id' => (string) $tpl['id'], 'name' => Str::clean(FieldMap::pick($tf, 'brand_template', 'name')) ?: 'Letter'];
            }
        }

        // Travellers
        foreach ($w2['customers'] as $c) {
            $lead = Traveller::fromCustomer($c);
            if ($lead->name !== '') {
                $trip->lead = $lead;
                break;
            }
        }
        foreach ($w2['people'] as $p) {
            $tr = Traveller::fromPerson($p);
            if ($tr->name === '') {
                continue;
            }
            if ($trip->lead && strcasecmp($tr->name, $trip->lead->name) === 0) {
                $tr->isLead = true;
                $trip->lead = $tr;
            }
            $trip->travellers[] = $tr;
        }
        if (!$trip->lead && $trip->travellers) {
            $trip->lead = $trip->travellers[0];
            $trip->lead->isLead = true;
        }
        // Personalised message: built once the agent's name and the lead's first name are known, so a member's own
        // greeting and sign-off can be stripped in favour of the designed ones.
        if ($includeMsg === null || Arr::truthy($includeMsg)) {
            $m = Str::messageHtml($msg, $trip->agentName, $trip->leadFirstName());
            $trip->personalMessage = $m['html'];
            $trip->personalMessageLong = $m['long'];
        } else {
            $trip->personalMessage = '';
        }
        if (!$trip->totalPax) {
            $trip->totalPax = count($trip->travellers) + $trip->unknownPax;
        }

        // Name cache for all linked records
        $names = [];
        $indexNames = static function (array $records, array $fieldCandidates) use (&$names): void {
            foreach ($records as $r) {
                $f = $r['fields'] ?? [];
                $n = Str::clean(Arr::first(Arr::pick($f, $fieldCandidates)));
                if ($n !== '') {
                    $names[$r['id']] = $n;
                }
            }
        };
        $indexNames($w3['suppliers'], FieldMap::candidates('supplier', 'name'));
        $indexNames($w3['airports'], FieldMap::candidates('airport', 'name'));
        $indexNames($w3['airlines'], FieldMap::candidates('airline', 'name'));
        $indexNames($w3['ships'], FieldMap::candidates('ship', 'name'));
        $indexNames($w3['operators'], ['Name', 'Operator', 'Title']);
        $indexNames($w3['elocations'], FieldMap::candidates('location', 'name'));
        $indexNames($w2['locations'], FieldMap::candidates('location', 'name'));
        $indexNames($graph['ports'], FieldMap::candidates('location', 'name'));
        $indexNames($w3['methods'], ['Name', 'Method', 'Payment Method', 'Title']);
        $indexNames($w2['people'], FieldMap::candidates('person', 'name'));
        $indexNames($w3['passengers'], FieldMap::candidates('passenger', 'name'));
        $indexNames($w2['elements'], ['Trip Element Heading', 'Name']);

        $byId = static function (array $records): array {
            $out = [];
            foreach ($records as $r) {
                $out[$r['id']] = $r['fields'] ?? [];
            }
            return $out;
        };

        // Lead supplier
        foreach (Arr::recordIds($pick('lead_supplier')) as $lsId) {
            if (isset($names[$lsId])) {
                $trip->leadSupplierName = $names[$lsId];
                break;
            }
        }
        if ($trip->leadSupplierName === '') {
            $trip->leadSupplierName = Str::clean(Arr::first($pick('lead_supplier')));
        }

        // Elements
        $hideSuppliers = false;
        $hasFlight = false;
        foreach ($w2['elements'] as $el) {
            $type = Str::clean(FieldMap::pick($el['fields'] ?? [], 'element', 'type'));
            $status = Str::clean(FieldMap::pick($el['fields'] ?? [], 'element', 'status'));
            if (strcasecmp($status, 'Cancelled') !== 0 && Element::kindFor($type) === 'flight') {
                $hasFlight = true;
            }
        }
        $trip->licensing = Str::clean($pick('licensing'));
        foreach (['confirmation', 'reconfirmed', 'documents', 'predeparture', 'followup'] as $task) {
            $trip->tasks[$task] = Arr::truthy($pick('task_' . $task));
        }
        $trip->protection = Protection::build($trip->atolSelect, $hasFlight, $trip->brand, $trip->atolNo, $trip->leadSupplierName, Arr::truthy($pick('use_global_atol')), $trip->licensing);
        $trip->stage = Stage::resolve($trip->status, $trip->departs, $trip->returns, $trip->quoteExpiry);
        $hideSuppliers = $trip->protection->hideSuppliers || ($trip->isQuote() && Settings::bool('hide_suppliers_on_quotation'));

        $ctx = [
            'names'       => $names,
            'suppliers'   => $byId($w3['suppliers']),
            'airports'    => $byId($w3['airports']),
            'airlines'    => $byId($w3['airlines']),
            'rooms'       => $byId($w3['rooms']),
            'cabins'      => $byId($w3['cabins']),
            'passengers'  => $byId($w3['passengers']),
            'ships'       => $byId($w3['ships']),
            'operators'   => $byId($w3['operators']),
            'itinerary'   => $byId($w3['itinerary']),
            'locations'   => $byId(array_merge($w3['elocations'], $w2['locations'])),
            'hideSuppliers' => $hideSuppliers,
            'visibility'  => (array) Settings::get('fields', []),
            'schemaTypes' => $this->schemaTypes($base, FieldMap::table('elements')),
        ];
        foreach ($w2['elements'] as $i => $el) {
            $trip->elements[] = Element::fromRecord($el, $ctx, $i);
        }

        // Payments
        foreach ($w2['payments'] as $p) {
            $trip->payments[] = Payment::fromRecord($p, $names);
        }
        if ($trip->paid <= 0 && $trip->payments) {
            $sum = 0.0;
            foreach ($trip->payments as $p) {
                if ($p->isPaid() && $p->isCustomerPayment()) {
                    $sum += $p->amount;
                }
            }
            $trip->paid = $sum;
        }
        if ($trip->balance <= 0 && $trip->total > 0) {
            $trip->balance = max(0, $trip->total - $trip->paid);
        }

        // Messages sent to the customer (only those actually sent, never test sends)
        foreach (($w2['comms'] ?? []) as $c) {
            $cf = $c['fields'] ?? [];
            $g = static fn (string $k) => FieldMap::pick($cf, 'comm', $k);
            $status = strtolower(Str::clean($g('status')));
            if (!Arr::truthy($g('sent')) && $status !== 'success') {
                continue;
            }
            if (Arr::truthy($g('self_only'))) {
                continue;
            }
            $subject = Str::clean(Arr::first($g('subject')));
            $name = Str::clean($g('name'));
            if ($subject === '') {
                $subject = (string) preg_replace('/\s*\((Email|SMS|Custom Email)\)\s*$/i', '', $name);
            }
            $content = Str::clean(Arr::first($g('content')));
            $content = (string) preg_replace('/\{\{\s*[^}]*\}\}/', '', $content);
            $img = Arr::images($g('image'));
            $trip->messages[] = [
                'id'      => (string) $c['id'],
                'date'    => Dates::parse($g('date')),
                'subject' => $subject !== '' ? $subject : 'Message from us',
                'type'    => stripos(Str::clean($g('type')), 'sms') !== false ? 'SMS' : 'Email',
                'content' => Str::richText($content),
                'image'   => $img[0]['thumb'] ?? '',
            ];
        }
        usort($trip->messages, static fn ($a, $b) => ($b['date']?->getTimestamp() ?? 0) <=> ($a['date']?->getTimestamp() ?? 0));

        // Upsells
        foreach ($w2['upsells'] as $u) {
            $uf = $u['fields'] ?? [];
            $img = Arr::images(FieldMap::pick($uf, 'upsell', 'image'));
            $trip->upsells[] = [
                'name'     => Str::clean(FieldMap::pick($uf, 'upsell', 'name')) ?: 'Optional extra',
                'info'     => Str::richText(Str::clean(FieldMap::pick($uf, 'upsell', 'info'))),
                'image'    => $img[0]['thumb'] ?? '',
                'supplier' => Str::clean(FieldMap::pick($uf, 'upsell', 'supplier')),
            ];
        }

        // Destinations (booking-level, plus element locations not already present)
        $seen = [];
        $primaryIds = array_flip(array_map(static fn ($l) => (string) $l['id'], $w2['locations']));
        foreach (array_merge($w2['locations'], $w3['elocations']) as $loc) {
            $lf = $loc['fields'] ?? [];
            $name = Str::clean(FieldMap::pick($lf, 'location', 'name'));
            if ($name === '' || isset($seen[strtolower($name)])) {
                continue;
            }
            $seen[strtolower($name)] = true;
            $img = Arr::images(FieldMap::pick($lf, 'location', 'image'));
            $lat = Arr::first(FieldMap::pick($lf, 'location', 'lat'));
            $lng = Arr::first(FieldMap::pick($lf, 'location', 'lng'));
            $trip->destinations[] = [
                'id'          => (string) $loc['id'],
                'name'        => $name,
                'country'     => Str::clean(FieldMap::pick($lf, 'location', 'country')),
                'overview'    => Str::richText(Str::clean(FieldMap::pick($lf, 'location', 'overview'))),
                'attractions' => Str::richText(Str::clean(FieldMap::pick($lf, 'location', 'attractions'))),
                'practical'   => Str::richText(Str::clean(FieldMap::pick($lf, 'location', 'practical'))),
                'culture'     => Str::richText(Str::clean(FieldMap::pick($lf, 'location', 'culture'))),
                'fcdo'        => Str::richText(Str::clean(FieldMap::pick($lf, 'location', 'fcdo'))),
                'image'       => $img[0]['url'] ?? '',
                'lat'         => is_numeric($lat) ? (float) $lat : null,
                'lng'         => is_numeric($lng) ? (float) $lng : null,
                'primary'     => isset($primaryIds[(string) $loc['id']]),
            ];
        }

        $trip->theme = Theme::resolve($trip->tags, $trip->holidayTypes, $trip->sector, Str::clean(FieldMap::pick($w2['brand'][0]['fields'] ?? [], 'brand', 'theme')), $trip->brand->tone);
        return $trip;
    }

    /** Field name => type for a table, from the cached schema only (never fetched during a page load). */
    private function schemaTypes(string $base, string $table): array
    {
        $ref = (string) Settings::get('airtable_reference_base', '') ?: $base;
        $tables = Cache::get('schema', $ref);
        if (!is_array($tables)) {
            return [];
        }
        foreach ($tables as $t) {
            if (($t['name'] ?? '') === $table) {
                $out = [];
                foreach (($t['fields'] ?? []) as $f) {
                    $out[(string) $f['name']] = (string) ($f['type'] ?? '');
                }
                return $out;
            }
        }
        return [];
    }

    /** Customer records matching an email (primary or secondary). @return array<int,array<string,mixed>> */
    public function findCustomers(string $base, string $email): array
    {
        $email = strtolower(trim($email));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return [];
        }
        $safe = str_replace(["'", '\\'], ['\\\'', '\\\\'], $email);
        return $this->client->find($base, FieldMap::table('customers'), "OR(LOWER({Primary Email})='{$safe}',LOWER({Secondary Email})='{$safe}')", [], 10);
    }

    /**
     * Marketing preferences for an email, merged across matching customer records.
     * @return array{email:bool,sms:bool,post:bool,airports:string[],months:string[],ids:string[]}
     */
    public function preferences(string $base, string $email): array
    {
        $out = ['email' => false, 'sms' => false, 'post' => false, 'airports' => [], 'months' => [], 'ids' => []];
        foreach ($this->findCustomers($base, $email) as $c) {
            $f = $c['fields'] ?? [];
            $out['ids'][] = (string) $c['id'];
            $out['email'] = $out['email'] || (Arr::truthy(FieldMap::pick($f, 'customer', 'mkt_email')) && !Arr::truthy(FieldMap::pick($f, 'customer', 'mkt_email_unsub')));
            $out['sms'] = $out['sms'] || Arr::truthy(FieldMap::pick($f, 'customer', 'mkt_sms'));
            $out['post'] = $out['post'] || Arr::truthy(FieldMap::pick($f, 'customer', 'mkt_post'));
            $out['airports'] = array_values(array_unique(array_merge($out['airports'], Arr::strings(FieldMap::pick($f, 'customer', 'pref_airports')))));
            $out['months'] = array_values(array_unique(array_merge($out['months'], Arr::strings(FieldMap::pick($f, 'customer', 'pref_months')))));
        }
        return $out;
    }

    /**
     * Write preferences back to every matching customer record. @param string[] $airports @param string[] $months
     * @return array{ok:bool,updated:int}
     */
    public function savePreferences(string $base, string $email, bool $emailOn, bool $smsOn, bool $postOn, array $airports, array $months): array
    {
        $fields = [
            FieldMap::candidates('customer', 'mkt_email')[0] => $emailOn,
            FieldMap::candidates('customer', 'mkt_email_unsub')[0] => !$emailOn,
            FieldMap::candidates('customer', 'mkt_sms')[0] => $smsOn,
            FieldMap::candidates('customer', 'mkt_post')[0] => $postOn,
            FieldMap::candidates('customer', 'pref_airports')[0] => array_values($airports),
            FieldMap::candidates('customer', 'pref_months')[0] => array_values($months),
        ];
        $updated = 0;
        $customers = $this->findCustomers($base, $email);
        foreach ($customers as $c) {
            if ($this->client->patch($base, FieldMap::table('customers'), (string) $c['id'], $fields)) {
                $updated++;
                $this->client->comment($base, FieldMap::table('customers'), (string) $c['id'], sprintf('⚙️ Marketing preferences updated by the customer via My Trips — %s UTC · email %s · SMS %s · post %s · airports: %s · months: %s', gmdate('D j M Y H:i'), $emailOn ? 'yes' : 'no', $smsOn ? 'yes' : 'no', $postOn ? 'yes' : 'no', $airports ? implode(', ', $airports) : '—', $months ? implode(', ', $months) : '—'));
            }
        }
        return ['ok' => $updated > 0 && $updated === count($customers), 'updated' => $updated];
    }

    /** Select options for a Customers field from the cached schema (reference base), else a sensible default list. @return string[] */
    public function customerOptions(string $base, string $logical, array $fallback): array
    {
        $ref = (string) Settings::get('airtable_reference_base', '') ?: $base;
        $tables = Cache::get('schema', $ref);
        $field = FieldMap::candidates('customer', $logical)[0] ?? '';
        if (is_array($tables)) {
            foreach ($tables as $t) {
                if (($t['name'] ?? '') !== FieldMap::table('customers')) {
                    continue;
                }
                foreach (($t['fields'] ?? []) as $f) {
                    if (($f['name'] ?? '') === $field && !empty($f['options']['choices'])) {
                        return array_values(array_filter(array_map(static fn ($c) => (string) ($c['name'] ?? ''), $f['options']['choices'])));
                    }
                }
            }
        }
        return $fallback;
    }

    /**
     * Portal: find bookings for a customer email within a member base.
     * @return array<int,array{id:string,ref:string,name:string,status:string,departs:string,returns:string}>
     */
    public function findByEmail(string $base, string $email): array
    {
        $email = strtolower(trim($email));
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return [];
        }
        $t = static fn (string $k) => FieldMap::table($k);
        $safe = str_replace(["'", '\\'], ['\\\'', '\\\\'], $email);
        $formula = "OR(LOWER({Primary Email})='{$safe}',LOWER({Secondary Email})='{$safe}')";
        $customers = $this->client->find($base, $t('customers'), $formula, ['Full Name', 'Trips', 'Primary Email'], 20);
        $tripIds = [];
        foreach ($customers as $c) {
            $tripIds = array_merge($tripIds, Arr::recordIds(FieldMap::pick($c['fields'] ?? [], 'customer', 'trips')));
        }
        if (!$tripIds) {
            return [];
        }
        $records = $this->client->byIds($base, $t('bookings'), array_values(array_unique($tripIds)), ['Booking Reference', 'Trip Name', 'Status', 'Departure Date', 'Return Date', 'Tags', 'Hero Image', 'Soft Delete']);
        $out = [];
        foreach ($records as $r) {
            $f = $r['fields'] ?? [];
            if (Arr::truthy($f['Soft Delete'] ?? false)) {
                continue;
            }
            $hero = Arr::images($f['Hero Image'] ?? null);
            $out[] = [
                'id'      => (string) $r['id'],
                'ref'     => Str::clean(Arr::first($f['Booking Reference'] ?? '')),
                'name'    => Str::clean($f['Trip Name'] ?? '') ?: 'Trip',
                'status'  => Str::clean($f['Status'] ?? ''),
                'departs' => Dates::iso($f['Departure Date'] ?? null),
                'total'   => (float) (Arr::first($f['Total Price'] ?? 0) ?: 0),
                'created' => Dates::iso($f['Created time'] ?? null),
                'returns' => Dates::iso($f['Return Date'] ?? null),
                'tags'    => Arr::strings($f['Tags'] ?? []),
                'image'   => $hero[0]['thumb'] ?? '',
            ];
        }
        usort($out, static fn ($a, $b) => strcmp($b['departs'], $a['departs']));
        return $out;
    }
}
