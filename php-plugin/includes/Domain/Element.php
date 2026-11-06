<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use DateTimeImmutable;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Support\Arr;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Str;

/**
 * A normalised "Bookings [Elements]" record. Typed essentials are read explicitly; anything else the
 * member has made visible in Field Studio lands in $details.
 */
final class Element
{
    public string $id = '';
    public string $kind = 'misc';        // flight|stay|cruise|transfer|carhire|parking|train|attraction|misc
    public string $typeLabel = '';
    public string $title = '';
    public string $status = '';
    public bool $cancelled = false;
    public bool $onRequest = false;
    public ?DateTimeImmutable $start = null;
    public ?DateTimeImmutable $end = null;
    public string $startTime = '';
    public string $endTime = '';
    public string $from = '';
    public string $to = '';
    public string $fromCode = '';
    public string $toCode = '';
    public string $fromCountry = '';
    public string $toCountry = '';
    public string $carrier = '';
    public string $carrierCode = '';
    public string $flightNo = '';
    public string $flightClass = '';
    public string $direction = '';
    public string $pnr = '';
    public bool $arrivesNextDay = false;
    public string $supplier = '';
    public string $supplierRef = '';
    public string $supplierLegalUrl = '';
    public string $supplierLogo = '';
    public string $carrierLogo = '';
    public string $operatorLogo = '';
    public bool $supplierHidden = false;
    public bool $package = false;
    public string $address = '';
    public string $rating = '';
    public int $nights = 0;
    /** @var string[] */
    public array $rooms = [];
    /** @var array<int,array<string,string>> */
    public array $cabins = [];
    /** @var array<int,array<string,string>> */
    public array $passengers = [];
    public string $cruiseLine = '';
    public string $cruiseName = '';
    public string $ship = '';
    public string $shipRecordId = '';
    public string $widgetyShipId = '';
    public string $shipCover = '';
    public string $voyageCode = '';
    public string $departPort = '';
    public string $disembarkPort = '';
    /** @var array<int,array{day:string,port:string,arrive:string,depart:string,atSea:bool}> */
    public array $ports = [];
    public string $onboardCredit = '';
    /** @var array<string,string> */
    public array $car = [];
    /** @var array<string,string> */
    public array $train = [];
    public string $pickupInstructions = '';
    public string $dropoffInstructions = '';
    public string $furtherInfo = '';
    public string $importantInfo = '';
    public string $emergencyName = '';
    public string $emergencyPhone = '';
    /** @var array<int,array{url:string,thumb:string,name:string}> */
    public array $images = [];
    /** @var array<int,array{url:string,name:string,type:string}> */
    public array $docs = [];
    public string $termsUrl = '';
    /** @var array<int,array{label:string,value:string,long:bool}> */
    public array $details = [];
    public string $locationName = '';
    public ?float $lat = null;
    public ?float $lng = null;
    public string $manualSort = '';
    public int $position = 0;
    public bool $confirmationReceived = false;
    public bool $ticketsReceived = false;
    public string $atolNo = '';
    /** @var array<string,mixed> */
    public array $raw = [];

    /**
     * @param array<string,mixed> $record
     * @param array<string,mixed> $ctx  ['names'=>id=>name, 'suppliers'=>id=>fields, 'airports'=>id=>fields, 'airlines'=>..., 'rooms'=>..., 'cabins'=>..., 'passengers'=>..., 'ships'=>..., 'locations'=>..., 'itinerary'=>..., 'visibility'=>Field Studio config, 'hideSuppliers'=>bool, 'schemaTypes'=>name=>type]
     */
    public static function fromRecord(array $record, array $ctx, int $position = 0): self
    {
        $e = new self();
        $f = $record['fields'] ?? [];
        $names = $ctx['names'] ?? [];
        $g = static fn (string $k) => FieldMap::pick($f, 'element', $k);
        $resolve = static function (mixed $v) use ($names): string {
            $ids = Arr::recordIds($v);
            if ($ids) {
                $out = [];
                foreach ($ids as $id) {
                    if (isset($names[$id]) && $names[$id] !== '') {
                        $out[] = $names[$id];
                    }
                }
                return implode(', ', $out);
            }
            return Str::clean($v);
        };

        $e->id = (string) ($record['id'] ?? '');
        $e->position = $position;
        $e->raw = $f;
        $e->typeLabel = Str::clean($g('type')) ?: 'Trip item';
        $e->kind = self::kindFor($e->typeLabel);
        $e->status = Str::clean($g('status'));
        $e->cancelled = strcasecmp($e->status, 'Cancelled') === 0;
        $e->onRequest = preg_match('/on (request|hold)/i', $e->status) === 1;
        $e->start = Dates::parse($g('start'));
        $e->end = Dates::parse($g('end'));
        $isTimed = in_array($e->kind, ['flight', 'train', 'transfer'], true);
        $e->startTime = Dates::time($isTimed ? ($g('depart_time') ?? $g('start_time')) : ($g('start_time') ?? $g('depart_time')));
        $e->endTime = Dates::time($isTimed ? ($g('arrive_time') ?? $g('end_time')) : ($g('end_time') ?? $g('arrive_time')));
        $e->from = $resolve($g('from'));
        $e->to = $resolve($g('to'));
        $e->fromCode = strtoupper(Str::clean($g('from_code')));
        $e->toCode = strtoupper(Str::clean($g('to_code')));
        foreach (['from' => 'from', 'to' => 'to'] as $side => $key) {
            $ids = Arr::recordIds($g($key));
            if ($ids && isset($ctx['airports'][$ids[0]])) {
                $af = $ctx['airports'][$ids[0]];
                $code = strtoupper(Str::clean(FieldMap::pick($af, 'airport', 'iata')));
                if ($side === 'from' && $e->fromCode === '') { $e->fromCode = $code; }
                if ($side === 'to' && $e->toCode === '') { $e->toCode = $code; }
                $country = strtoupper(Str::clean(FieldMap::pick($af, 'airport', 'country')));
                if ($side === 'from') { $e->fromCountry = $country; } else { $e->toCountry = $country; }
            }
        }
        $e->carrier = $resolve($g('carrier'));
        $carrierIds = Arr::recordIds($g('carrier'));
        if ($carrierIds && isset($ctx['airlines'][$carrierIds[0]])) {
            $e->carrierCode = strtoupper(Str::clean(FieldMap::pick($ctx['airlines'][$carrierIds[0]], 'airline', 'iata')));
        }
        if ($e->carrierCode === '') {
            $e->carrierCode = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', Str::clean($g('iata'))));
        }
        if ($carrierIds && isset($ctx['airlines'][$carrierIds[0]])) {
            $logo = Arr::images(Arr::pick($ctx['airlines'][$carrierIds[0]], ['Logo', 'Airline Logo', 'logo']));
            $e->carrierLogo = $logo[0]['url'] ?? '';
        }
        $e->flightNo = strtoupper(str_replace(' ', '', Str::clean($g('flight_no'))));
        if ($e->carrierCode === '' && preg_match('/^([A-Z0-9]{2})\d{1,4}[A-Z]?$/', $e->flightNo, $m)) {
            $e->carrierCode = $m[1];
        }
        if ($e->carrierLogo === '' && preg_match('/^[A-Z0-9]{2}$/', $e->carrierCode)) {
            $e->carrierLogo = 'https://pics.avs.io/240/80/' . rawurlencode($e->carrierCode) . '@2x.png';
        }
        $e->flightClass = Str::clean($g('flight_class'));
        $e->direction = Str::clean($g('direction'));
        $e->pnr = Str::clean($g('pnr'));
        if ($e->kind === 'flight' && $e->start && $e->end) {
            $diff = Dates::daysBetween($e->start, $e->end);
            $e->arrivesNextDay = $diff === 1;
        }

        // Supplier
        $supplierIds = Arr::recordIds($g('supplier'));
        $e->supplier = $resolve($g('supplier'));
        if ($supplierIds && isset($ctx['suppliers'][$supplierIds[0]])) {
            $sf = $ctx['suppliers'][$supplierIds[0]];
            $e->supplierLegalUrl = Str::clean(FieldMap::pick($sf, 'supplier', 'legal_url'));
            $logo = Arr::images(FieldMap::pick($sf, 'supplier', 'logo'));
            $e->supplierLogo = $logo[0]['thumb'] ?? '';
        }
        $e->supplierRef = Str::clean($g('supplier_ref'));
        $e->supplierHidden = !empty($ctx['hideSuppliers']) || Arr::truthy($g('hide_supplier'));
        $e->package = Arr::truthy($g('package'));
        $e->atolNo = Str::clean(Arr::first($g('atol_no')));
        $e->termsUrl = Str::clean(Arr::first($g('terms_url')));
        $e->confirmationReceived = Arr::truthy($g('confirmation_received'));
        $e->ticketsReceived = Arr::truthy($g('tickets_received'));

        // Stay
        $e->address = Str::clean($g('address'));
        $e->rating = Str::clean(Arr::first($g('rating')));
        $e->nights = (int) Arr::number($g('nights'));
        if ($e->nights === 0 && $e->kind === 'stay' && $e->start && $e->end) {
            $e->nights = max(0, (int) Dates::daysBetween($e->start, $e->end));
        }
        foreach (Arr::recordIds($g('rooms')) as $rid) {
            if (isset($ctx['rooms'][$rid])) {
                $rf = $ctx['rooms'][$rid];
                $type = Str::clean(FieldMap::pick($rf, 'room', 'type'));
                $board = Str::clean(FieldMap::pick($rf, 'room', 'board'));
                $view = Str::clean(FieldMap::pick($rf, 'room', 'view'));
                $label = trim($type . ($view !== '' ? ', ' . $view : '') . ($board !== '' ? ' (' . $board . ')' : ''));
                if ($label !== '') {
                    $e->rooms[] = $label;
                }
            }
        }
        foreach (Arr::recordIds($g('cabins')) as $cid) {
            if (isset($ctx['cabins'][$cid])) {
                $cf = $ctx['cabins'][$cid];
                $cabin = [];
                foreach (['name' => 'Cabin', 'grade' => 'Grade', 'number' => 'Number', 'deck' => 'Deck', 'side' => 'Side', 'position' => 'Position', 'bed' => 'Bed', 'seating' => 'Dining seating', 'table' => 'Table', 'dining' => 'Dining'] as $k => $label) {
                    $v = Str::clean(FieldMap::pick($cf, 'cabin', $k));
                    if ($v !== '') {
                        $cabin[$label] = $v;
                    }
                }
                if ($cabin) {
                    $e->cabins[] = $cabin;
                }
            }
        }
        foreach (Arr::recordIds($g('passengers')) as $pid) {
            if (isset($ctx['passengers'][$pid])) {
                $pf = $ctx['passengers'][$pid];
                $row = ['name' => Str::clean(FieldMap::pick($pf, 'passenger', 'name'))];
                if ($row['name'] === '') {
                    continue;
                }
                foreach (['pnr' => 'Booking ref', 'class' => 'Class', 'seat' => 'Seat', 'cabin_bag' => 'Cabin bag', 'checked_bag' => 'Checked bag', 'extras' => 'Extras', 'meal' => 'Meal', 'ssr' => 'Assistance'] as $k => $label) {
                    $v = Str::clean(FieldMap::pick($pf, 'passenger', $k));
                    if ($v !== '') {
                        $row[$label] = $v;
                    }
                }
                $e->passengers[] = $row;
            }
        }

        // Cruise
        $e->cruiseLine = $resolve($g('cruise_line'));
        foreach (Arr::recordIds($g('cruise_line')) as $opId) {
            if (isset($ctx['operators'][$opId])) {
                $logo = Arr::images(Arr::pick($ctx['operators'][$opId], ['Logo', 'logo', 'Profile Image', 'profile_image']));
                $e->operatorLogo = $logo[0]['url'] ?? '';
                break;
            }
        }
        $e->cruiseName = Str::clean($g('cruise_name'));
        $shipIds = Arr::recordIds($g('cruise_ship'));
        $e->ship = $resolve($g('cruise_ship'));
        if ($shipIds) {
            $e->shipRecordId = $shipIds[0];
            if (isset($ctx['ships'][$shipIds[0]])) {
                $shf = $ctx['ships'][$shipIds[0]];
                $e->widgetyShipId = Str::clean(FieldMap::pick($shf, 'ship', 'widgety_id'));
                $cover = Arr::images(FieldMap::pick($shf, 'ship', 'cover'));
                $e->shipCover = $cover[0]['url'] ?? '';
            }
        }
        $e->voyageCode = Str::clean($g('voyage_code'));
        if ($e->kind === 'cruise') {
            $e->departPort = $e->from;
            $e->disembarkPort = $e->to;
        }
        $credit = Arr::number($g('onboard_credit'));
        if ($credit > 0) {
            $e->onboardCredit = Str::money($credit, Str::clean($g('onboard_credit_currency')) ?: 'USD');
        }
        foreach (Arr::recordIds($g('visiting_ports')) as $iid) {
            if (isset($ctx['itinerary'][$iid])) {
                $itf = $ctx['itinerary'][$iid];
                $port = $resolve(FieldMap::pick($itf, 'cruise_itin', 'port'));
                if ($port === '') {
                    $port = Str::clean(FieldMap::pick($itf, 'cruise_itin', 'port_text'));
                }
                if ($port === '') {
                    continue;
                }
                $e->ports[] = [
                    'day'    => Str::clean(FieldMap::pick($itf, 'cruise_itin', 'day')),
                    'port'   => $port,
                    'arrive' => self::portTime(FieldMap::pick($itf, 'cruise_itin', 'arrive')),
                    'depart' => self::portTime(FieldMap::pick($itf, 'cruise_itin', 'depart')),
                    'atSea'  => stripos($port, 'at sea') !== false,
                ];
            }
        }
        usort($e->ports, static fn ($a, $b) => ((int) $a['day']) <=> ((int) $b['day']));

        // Car / parking / train
        foreach (['car_parking_name' => 'Car park', 'car_parking_code' => 'Booking code', 'car_make' => 'Make', 'car_model' => 'Model', 'car_reg' => 'Registration', 'car_type' => 'Car type', 'vehicle_type' => 'Vehicle', 'child_seats' => 'Child seats'] as $k => $label) {
            $v = Str::clean($g($k));
            if ($v !== '') {
                $e->car[$label] = $v;
            }
        }
        foreach (['train_name' => 'Train', 'carriage_class' => 'Class', 'seat_numbers' => 'Seats'] as $k => $label) {
            $v = Str::clean($g($k));
            if ($v !== '') {
                $e->train[$label] = $v;
            }
        }

        $e->pickupInstructions = Str::richText(Str::clean($g('pickup_instructions')));
        $e->dropoffInstructions = Str::richText(Str::clean($g('dropoff_instructions')));
        $e->furtherInfo = Str::richText(Str::clean($g('further_info')));
        $e->importantInfo = Str::richText(Str::clean($g('important_info')));
        $e->emergencyName = Str::clean($g('emergency_name'));
        $e->emergencyPhone = Str::clean($g('emergency_phone'));
        foreach (Arr::images($g('images')) as $img) {
            $e->images[] = ['url' => $img['url'], 'thumb' => $img['thumb'], 'name' => $img['name']];
        }
        foreach (Arr::attachments($g('docs')) as $doc) {
            $e->docs[] = ['url' => (string) $doc['url'], 'name' => (string) ($doc['filename'] ?? 'Document'), 'type' => (string) ($doc['type'] ?? '')];
        }
        $e->manualSort = Str::clean(Arr::first($g('manual_sort')));

        // Location (for maps/weather)
        $locIds = Arr::recordIds($g('location'));
        if ($locIds && isset($ctx['locations'][$locIds[0]])) {
            $lf = $ctx['locations'][$locIds[0]];
            $e->locationName = Str::clean(FieldMap::pick($lf, 'location', 'name'));
            $lat = FieldMap::pick($lf, 'location', 'lat');
            $lng = FieldMap::pick($lf, 'location', 'lng');
            if (is_numeric(Arr::first($lat)) && is_numeric(Arr::first($lng))) {
                $e->lat = (float) Arr::first($lat);
                $e->lng = (float) Arr::first($lng);
            }
        }

        // Title
        $e->title = self::titleFor($e, $f, $resolve);

        // Field Studio extras
        $e->details = self::extras($f, $ctx, $resolve);

        return $e;
    }

    public static function kindFor(string $type): string
    {
        $t = strtolower($type);
        return match (true) {
            str_contains($t, 'flight') => 'flight',
            str_contains($t, 'accom') || str_contains($t, 'hotel') || str_contains($t, 'villa') => 'stay',
            str_contains($t, 'cruise') => 'cruise',
            str_contains($t, 'transfer') => 'transfer',
            str_contains($t, 'car hire') || str_contains($t, 'car rental') => 'carhire',
            str_contains($t, 'parking') => 'parking',
            str_contains($t, 'train') || str_contains($t, 'rail') => 'train',
            str_contains($t, 'attraction') || str_contains($t, 'excursion') || str_contains($t, 'tour') => 'attraction',
            default => 'misc',
        };
    }

    /** Vision's element heading is a formula like "Annabelle — 7 nights" or "Transfer (2 pax)": keep only the name part. */
    public static function cleanHeading(string $h): string
    {
        $h = (string) preg_replace('/\s*[—–-]\s*\d+\s*nights?\s*$/iu', '', $h);
        $h = (string) preg_replace('/\s*\(\s*\d+\s*(nights?|pax|passengers?|guests?)\s*\)\s*$/iu', '', $h);
        $h = (string) preg_replace('/\s*[—–-]\s*\d{1,2}\s+[A-Z][a-z]{2}(\s+\d{4})?\s*$/u', '', $h);
        return trim($h, " \t—–-:");
    }

    private static function titleFor(self $e, array $f, callable $resolve): string
    {
        $g = static fn (string $k) => FieldMap::pick($f, 'element', $k);
        switch ($e->kind) {
            case 'flight':
                if ($e->from !== '' || $e->to !== '') {
                    return trim(($e->from ?: 'Flight') . ' to ' . ($e->to ?: 'destination'));
                }
                break;
            case 'stay':
                $name = $resolve($g('accommodation'));
                if ($name !== '') {
                    return $name;
                }
                break;
            case 'cruise':
                if ($e->cruiseName !== '') {
                    return $e->cruiseName;
                }
                if ($e->ship !== '') {
                    return $e->ship;
                }
                break;
            case 'carhire':
                $car = trim(($e->car['Make'] ?? '') . ' ' . ($e->car['Model'] ?? ''));
                return $car !== '' ? $car . ' car hire' : 'Car hire' . ($e->from !== '' ? ' from ' . $e->from : '');
            case 'parking':
                return ($e->car['Car park'] ?? '') !== '' ? $e->car['Car park'] : 'Airport parking';
            case 'train':
                if ($e->from !== '' || $e->to !== '') {
                    return trim(($e->from ?: 'Train') . ' to ' . ($e->to ?: 'destination'));
                }
                break;
            case 'transfer':
                if ($e->from !== '' || $e->to !== '') {
                    return 'Transfer: ' . trim(($e->from ?: '') . ' to ' . ($e->to ?: ''));
                }
                break;
            case 'attraction':
            case 'misc':
                $name = Str::clean($g('event_name')) ?: Str::clean($g('misc_name'));
                if ($name !== '') {
                    return $name;
                }
                break;
        }
        $heading = self::cleanHeading(Str::clean($g('heading')));
        if ($heading !== '' && !preg_match('/^rec[a-zA-Z0-9]{14}$/', $heading)) {
            return $heading;
        }
        return $e->typeLabel;
    }

    /**
     * Fields not consumed by typed rendering, filtered by Field Studio visibility.
     * @return array<int,array{label:string,value:string,long:bool}>
     */
    private static function extras(array $f, array $ctx, callable $resolve): array
    {
        $consumed = FieldMap::consumed('element');
        $visibility = $ctx['visibility'][FieldMap::table('elements')] ?? [];
        $types = $ctx['schemaTypes'] ?? [];
        $rows = [];
        foreach ($f as $name => $value) {
            $nk = Arr::normKey((string) $name);
            if (isset($consumed[$nk])) {
                continue;
            }
            if (FieldMap::isFinancial((string) $name, (string) ($types[$name] ?? ''))) {
                continue; // locked: never shown to customers, whatever Field Studio says
            }
            $rule = $visibility[$name] ?? null;
            $visible = $rule !== null ? !empty($rule['show']) : FieldMap::defaultVisible((string) $name, (string) ($types[$name] ?? ''));
            if (!$visible) {
                continue;
            }
            $scalar = is_scalar($value) ? trim((string) $value) : null;
            if ($scalar !== null && ($scalar === '' || $scalar === '0' || $scalar === '0.00' || $scalar === 'false')) {
                continue;
            }
            $pretty = $resolve($value);
            if ($pretty === '' || preg_match('/\b(net|gross|commission|vat|profit|margin)\b/i', $pretty) || preg_match('/^[£$€]\s?\d|\d+(\.\d{1,2})?\s?(GBP|EUR|USD)\b|^\d+(\.\d+)?\s?%$/i', $pretty) || preg_match('/\b(rec|usr)[a-zA-Z0-9]{14}\b/', $pretty)) {
                continue;
            }
            $label = $rule['label'] ?? (string) $name;
            $rows[] = [
                'label' => (string) $label,
                'value' => Str::richText($pretty),
                'long'  => mb_strlen(strip_tags($pretty)) > 120 || str_contains($pretty, "\n"),
                'order' => (int) ($rule['order'] ?? 500),
            ];
        }
        usort($rows, static fn ($a, $b) => $a['order'] <=> $b['order']);
        return array_map(static fn ($r) => ['label' => $r['label'], 'value' => $r['value'], 'long' => $r['long']], $rows);
    }

    private static function portTime(mixed $value): string
    {
        $d = Dates::parse($value);
        if (!$d) {
            return Dates::time($value);
        }
        return $d->format('H:i') === '00:00' ? '' : $d->format('H:i');
    }

    /** Compact card title: flights become their route codes, transfers their vehicle. */
    public function shortTitle(): string
    {
        return match ($this->kind) {
            'flight' => ($this->fromCode !== '' ? $this->fromCode : $this->from) . ' – ' . ($this->toCode !== '' ? $this->toCode : $this->to),
            'transfer' => ($this->car['Vehicle'] ?? '') !== '' ? $this->car['Vehicle'] : 'Transfer',
            default => $this->title,
        };
    }

    /** One supporting line for compact lists. */
    public function subtitle(): string
    {
        return match ($this->kind) {
            'flight' => trim(($this->carrier !== '' ? $this->carrier . ' ' : '') . $this->flightNo . ($this->from !== '' ? ' · ' . $this->from . ' to ' . $this->to : '')),
            'transfer', 'train' => trim(($this->from ?: '') . ($this->to !== '' ? ' to ' . $this->to : '')),
            default => $this->from,
        };
    }

    public function dateLabel(): string
    {
        if (!$this->start) {
            return '';
        }
        if ($this->kind === 'stay' || $this->kind === 'cruise') {
            return Dates::range($this->start, $this->end);
        }
        return $this->start->format('D j M');
    }

    public function timeLabel(): string
    {
        $parts = [];
        if ($this->startTime !== '') {
            $parts[] = $this->startTime;
        }
        if ($this->endTime !== '' && in_array($this->kind, ['flight', 'train', 'transfer'], true)) {
            $parts[] = $this->endTime . ($this->arrivesNextDay ? ' (+1)' : '');
        }
        return implode(' – ', $parts);
    }

    public function isFlightTrackable(): bool
    {
        return $this->kind === 'flight' && $this->flightNo !== '' && $this->start !== null && preg_match('/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/', $this->flightNo) === 1;
    }

    public function searchQueryForPlaces(): string
    {
        // A generic title ("Accommodation", "Hotel") can only be looked up safely with an address.
        if (preg_match('/^(accommodation|hotel|stay|room|apartment|villa|resort)s?$/i', trim($this->title)) && $this->address === '') {
            return '';
        }
        if ($this->kind !== 'stay') {
            return '';
        }
        $q = $this->title;
        if ($this->address !== '') {
            $q .= ', ' . $this->address;
        } elseif ($this->locationName !== '') {
            $q .= ', ' . $this->locationName;
        }
        return $q;
    }
}
