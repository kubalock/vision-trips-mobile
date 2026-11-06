<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use DateTimeImmutable;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Str;

final class Trip
{
    public string $base = '';
    public string $id = '';
    public string $ref = '';
    public string $name = '';
    public string $status = 'Quotation';
    public string $stage = Stage::QUOTE;
    /** @var string[] */
    public array $tags = [];
    /** @var string[] */
    public array $holidayTypes = [];
    public string $sector = '';
    public string $travellerType = '';
    public string $theme = 'default';
    public ?DateTimeImmutable $departs = null;
    public ?DateTimeImmutable $returns = null;
    public int $duration = 0;
    /** @var string[] */
    public array $countries = [];
    /** @var array<int,array{id:string,name:string,country:string,overview:string,attractions:string,practical:string,culture:string,fcdo:string,image:string,lat:?float,lng:?float}> */
    public array $destinations = [];
    public ?Traveller $lead = null;
    /** @var Traveller[] */
    public array $travellers = [];
    /** @var Element[] */
    public array $elements = [];
    /** @var Payment[] */
    public array $payments = [];
    /** @var array<int,array{name:string,info:string,image:string,supplier:string}> */
    public array $upsells = [];
    public Brand $brand;
    public Protection $protection;
    public string $currency = 'GBP';
    public float $total = 0.0;
    public float $totalInclResort = 0.0;
    public float $paid = 0.0;
    public float $balance = 0.0;
    public float $nextDueAmount = 0.0;
    public ?DateTimeImmutable $nextDueDate = null;
    public ?DateTimeImmutable $balanceDueDate = null;
    public ?DateTimeImmutable $finalSupplierDue = null;
    public bool $altCurrency = false;
    public string $altCurrencyType = '';
    public float $altAmount = 0.0;
    public bool $surprise = false;
    public bool $giftVoucher = false;
    public bool $groupBooking = false;
    public bool $enable2fa = false;
    public string $personalMessage = '';
    public bool $personalMessageLong = false;
    public string $agentName = '';
    public string $tripOverview = '';
    /** @var array<int,array{url:string,thumb:string}> */
    public array $heroImages = [];
    public ?DateTimeImmutable $quoteExpiry = null;
    public ?DateTimeImmutable $bookingDate = null;
    public ?DateTimeImmutable $createdAt = null;
    public ?DateTimeImmutable $lastModified = null;
    public ?DateTimeImmutable $cancelDate = null;
    public string $cancelReason = '';
    public string $oohLink = '';
    public string $oohEmail = '';
    public string $emergencyPhone = '';
    public string $mintBookingId = '';
    public int $totalPax = 0;
    public int $unknownPax = 0;
    public string $leadSupplierName = '';
    public string $atolSelect = '';
    public string $licensing = '';
    /** @var array<string,bool> confirmation|reconfirmed|documents|predeparture|followup */
    public array $tasks = [];
    /** @var array<int,array{id:string,date:?DateTimeImmutable,subject:string,type:string,content:string,image:string}> */
    public array $messages = [];
    public string $atolNo = '';
    public bool $supplierTicketsReceived = false;
    public bool $supplierConfirmationsReceived = false;
    public string $customerEmail = '';
    public string $customerPhone = '';
    public string $customerPostcode = '';
    /** @var array<string,mixed> */
    public array $raw = [];
    public bool $previewMode = false;

    public function __construct()
    {
        $this->brand = new Brand();
        $this->protection = new Protection();
    }

    /** Active (not cancelled) elements sorted by date, manual sort, original position. */
    public function activeElements(): array
    {
        $els = array_filter($this->elements, static fn (Element $e) => !$e->cancelled);
        usort($els, static function (Element $a, Element $b): int {
            $ad = $a->start ? (int) $a->start->format('Ymd') : PHP_INT_MAX;
            $bd = $b->start ? (int) $b->start->format('Ymd') : PHP_INT_MAX;
            if ($ad !== $bd) {
                return $ad <=> $bd;
            }
            if ($a->manualSort !== '' && $b->manualSort !== '') {
                if (is_numeric($a->manualSort) && is_numeric($b->manualSort)) {
                    $c = ((float) $a->manualSort) <=> ((float) $b->manualSort);
                } else {
                    $c = strcmp($a->manualSort, $b->manualSort);
                }
                if ($c !== 0) {
                    return $c;
                }
            } elseif ($a->manualSort !== '') {
                return -1;
            } elseif ($b->manualSort !== '') {
                return 1;
            }
            $at = $a->startTime !== '' ? $a->startTime : '99:99';
            $bt = $b->startTime !== '' ? $b->startTime : '99:99';
            if ($at !== $bt) {
                return strcmp($at, $bt);
            }
            return $a->position <=> $b->position;
        });
        return array_values($els);
    }

    /** Elements grouped by start day. @return array<int,array{date:?DateTimeImmutable,label:string,items:Element[]}> */
    public function days(): array
    {
        $groups = [];
        foreach ($this->activeElements() as $e) {
            $key = $e->start ? $e->start->format('Y-m-d') : 'undated';
            if (!isset($groups[$key])) {
                $dayNo = ($e->start && $this->departs) ? (Dates::daysBetween($this->departs, $e->start) ?? 0) + 1 : null;
                $groups[$key] = [
                    'date'  => $e->start,
                    'label' => $e->start ? $e->start->format('l j F') : 'Dates to be confirmed',
                    'day'   => $dayNo,
                    'items' => [],
                ];
            }
            $groups[$key]['items'][] = $e;
        }
        return array_values($groups);
    }

    public function hasKind(string $kind): bool
    {
        foreach ($this->activeElements() as $e) {
            if ($e->kind === $kind) {
                return true;
            }
        }
        return false;
    }

    /** @return Element[] */
    public function ofKind(string $kind): array
    {
        return array_values(array_filter($this->activeElements(), static fn (Element $e) => $e->kind === $kind));
    }

    /** Elements happening on a given day (stays/cruises spanning it included). @return Element[] */
    public function elementsOn(DateTimeImmutable $day): array
    {
        $d = $day->setTime(0, 0, 0);
        $out = [];
        foreach ($this->activeElements() as $e) {
            if (!$e->start) {
                continue;
            }
            $s = $e->start->setTime(0, 0, 0);
            $end = ($e->end ?? $e->start)->setTime(0, 0, 0);
            if ($s <= $d && $end >= $d) {
                $out[] = $e;
            }
        }
        return $out;
    }

    /** @return Element[] */
    public function upcoming(DateTimeImmutable $from, int $limit = 3): array
    {
        $f = $from->setTime(0, 0, 0);
        $out = [];
        foreach ($this->activeElements() as $e) {
            if ($e->start && $e->start->setTime(0, 0, 0) > $f) {
                $out[] = $e;
                if (count($out) >= $limit) {
                    break;
                }
            }
        }
        return $out;
    }

    public function heroImage(): string
    {
        if ($this->heroImages) {
            return $this->heroImages[0]['url'];
        }
        foreach ($this->activeElements() as $e) {
            if ($e->shipCover !== '') {
                return $e->shipCover;
            }
            if ($e->images) {
                return $e->images[0]['url'];
            }
        }
        foreach ($this->destinations as $d) {
            if ($d['image'] !== '') {
                return $d['image'];
            }
        }
        return $this->brand->hero;
    }

    public function daysToGo(): ?int
    {
        return $this->departs ? Dates::daysBetween(Dates::now(), $this->departs) : null;
    }

    public function dateRange(): string
    {
        return Dates::range($this->departs, $this->returns);
    }

    public function isQuote(): bool
    {
        return Stage::isQuote($this->stage);
    }

    public function isLive(): bool
    {
        return Stage::isLive($this->stage);
    }

    /** @return Payment[] */
    public function sortedPayments(): array
    {
        $p = $this->payments;
        usort($p, static function (Payment $a, Payment $b): int {
            $ad = $a->due ? (int) $a->due->format('Ymd') : PHP_INT_MAX;
            $bd = $b->due ? (int) $b->due->format('Ymd') : PHP_INT_MAX;
            return $ad <=> $bd;
        });
        return $p;
    }

    /** Next outstanding customer payment (earliest due). */
    public function nextPayment(): ?Payment
    {
        foreach ($this->sortedPayments() as $p) {
            if ($p->isCustomerPayment() && !$p->isPaid() && !$p->isResort() && $p->amount > 0) {
                return $p;
            }
        }
        return null;
    }

    /** Deposit payment (or first outstanding payment) used by quotation acceptance. */
    public function depositPayment(): ?Payment
    {
        foreach ($this->sortedPayments() as $p) {
            if ($p->isCustomerPayment() && !$p->isPaid() && stripos($p->customerType, 'deposit') !== false && $p->amount > 0) {
                return $p;
            }
        }
        return $this->nextPayment();
    }

    /** Earliest completed customer payment (ATOL certificates are issued when the first payment is taken). */
    public function firstPaymentDate(): ?DateTimeImmutable
    {
        $first = null;
        foreach ($this->payments as $p) {
            if ($p->isPaid() && $p->isCustomerPayment() && $p->completed && ($first === null || $p->completed < $first)) {
                $first = $p->completed;
            }
        }
        return $first;
    }

    /** ATOL certificate is shown once protection applies and money has been taken (or the booking is confirmed). */
    public function atolCertificateAvailable(): bool
    {
        return $this->protection->atolApplies() && (!$this->isQuote() || $this->firstPaymentDate() !== null);
    }

    public function paidPercent(): int
    {
        if ($this->total <= 0) {
            return 0;
        }
        return (int) round(max(0, min(1, $this->paid / $this->total)) * 100);
    }

    public function money(float $amount): string
    {
        return Str::money($amount, $this->currency);
    }

    public function leadFirstName(): string
    {
        return $this->lead ? Str::firstName($this->lead->first ?: $this->lead->name) : '';
    }

    public function anyExplicitPackage(): bool
    {
        foreach ($this->activeElements() as $e) {
            if ($e->package) {
                return true;
            }
        }
        return false;
    }

    public function hasFlight(): bool
    {
        return $this->hasKind('flight');
    }

    public function destinationSummary(): string
    {
        $primary = array_filter($this->destinations, static fn ($d) => !empty($d['primary']));
        $pool = $primary ?: $this->destinations;
        $names = array_values(array_unique(array_filter(array_map(static fn ($d) => $d['name'], $pool))));
        if (!$names) {
            $names = $this->countries;
        }
        if (count($names) > 3) {
            $names = array_slice($names, 0, 3);
        }
        if (count($names) <= 1) {
            return (string) ($names[0] ?? '');
        }
        $last = array_pop($names);
        return implode(', ', $names) . ' and ' . $last;
    }

    /** Flights that should show live status (within window around departure). @return Element[] */
    public function trackableFlights(int $windowHours = 48): array
    {
        $now = Dates::now();
        $out = [];
        foreach ($this->ofKind('flight') as $e) {
            if (!$e->isFlightTrackable() || !$e->start) {
                continue;
            }
            $dep = $e->start;
            if ($e->startTime !== '' && preg_match('/^(\d{2}):(\d{2})$/', $e->startTime, $m)) {
                $dep = $dep->setTime((int) $m[1], (int) $m[2]);
            }
            $diff = ($dep->getTimestamp() - $now->getTimestamp()) / 3600;
            if ($diff <= $windowHours && $diff >= -24) {
                $out[] = $e;
            }
        }
        return $out;
    }

    /** Pre-departure checklist, built from what we actually know. @return array<int,array{key:string,title:string,text:string,done:bool,level:string}> */
    public function checklist(bool $verified): array
    {
        $items = [];
        $next = $this->nextPayment();
        if ($this->balance > 0.009 && $next) {
            $items[] = ['key' => 'balance', 'title' => 'Pay your balance', 'text' => $this->money($this->balance) . ' outstanding' . ($this->balanceDueDate ? ', due ' . Dates::medium($this->balanceDueDate) : ($next->due ? ', next payment due ' . Dates::medium($next->due) : '')) . '.', 'done' => false, 'level' => $next->isOverdue() ? 'alert' : 'todo'];
        } else {
            $items[] = ['key' => 'balance', 'title' => 'Paid in full', 'text' => 'Nothing left to pay to us.', 'done' => true, 'level' => 'done'];
        }
        if ($this->hasFlight()) {
            $short = [];
            foreach ($this->travellers as $t) {
                if ($t->passportShort($this->returns)) {
                    $short[] = $t->first ?: $t->name;
                }
            }
            if ($short && $verified) {
                $items[] = ['key' => 'passport', 'title' => 'Check passport validity', 'text' => implode(', ', $short) . ': the passport on file expires within 6 months of your return. Many countries require more.', 'done' => false, 'level' => 'alert'];
            } else {
                $items[] = ['key' => 'passport', 'title' => 'Passports', 'text' => 'Check every passport is valid for at least 6 months after you return, with a blank page spare.', 'done' => false, 'level' => 'todo'];
            }
            $items[] = ['key' => 'api', 'title' => 'Advance passenger information', 'text' => 'Most airlines ask for passport details before travel. Do this in the airline app once your tickets are issued.', 'done' => false, 'level' => 'todo'];
        }
        $entry = $this->entryRequirementHints();
        if ($entry !== '') {
            $items[] = ['key' => 'entry', 'title' => 'Entry requirements', 'text' => $entry, 'done' => false, 'level' => 'todo'];
        }
        $items[] = ['key' => 'insurance', 'title' => 'Travel insurance', 'text' => 'Make sure your policy covers everyone travelling, your activities and any medical conditions.', 'done' => false, 'level' => 'todo'];
        $items[] = ['key' => 'fcdo', 'title' => 'Official travel advice', 'text' => 'Read the latest FCDO advice for ' . ($this->destinationSummary() ?: 'your destination') . '.', 'done' => false, 'level' => 'todo'];
        return $items;
    }

    /**
     * "What happens next": the member's service steps with their status, so the customer always knows when they'll hear from us.
     * @return array<int,array{key:string,title:string,text:string,done:bool,when:string}>
     */
    public function nextSteps(): array
    {
        $b = $this->brand;
        $first = $this->leadFirstName();
        $casual = $b->tone === 'casual';
        $t = $this->tasks;
        $steps = [];
        $steps[] = ['key' => 'confirmation', 'title' => 'Booking confirmation', 'done' => !empty($t['confirmation']), 'when' => 'Now',
            'text' => !empty($t['confirmation']) ? 'Sent. Your confirmation and key information are in your documents.' : ($casual ? "We're putting your confirmation together and will send it shortly." : 'Your written confirmation will follow shortly.')];
        $balance = $this->balance > 0.009;
        $steps[] = ['key' => 'balance', 'title' => $balance ? 'Balance payment' : 'Paid in full', 'done' => !$balance, 'when' => $this->balanceDueDate ? Dates::medium($this->balanceDueDate) : '',
            'text' => $balance ? 'We\'ll remind you before it\'s due. You can pay online any time from the Payments section.' : 'Nothing more to pay to us. Thank you.'];
        $docsDone = !empty($t['documents']);
        $steps[] = ['key' => 'documents', 'title' => 'Reconfirmation and travel documents', 'done' => $docsDone, 'when' => $this->departs ? Dates::medium($this->departs->modify('-14 days')) : '',
            'text' => $docsDone ? 'Every part of your trip has been reconfirmed with the suppliers and your tickets and travel documents have been issued. They are in your documents section.' : (!empty($t['reconfirmed']) ? 'Your arrangements are reconfirmed with the suppliers; your tickets and travel documents will follow around two weeks before departure.' : 'Around two weeks before you go we reconfirm every part of your trip with the suppliers and send your tickets and travel documents, sooner where suppliers issue early.')];
        $steps[] = ['key' => 'predeparture', 'title' => 'Pre-departure call', 'done' => !empty($t['predeparture']), 'when' => $this->departs ? Dates::medium($this->departs->modify('-3 days')) : '',
            'text' => !empty($t['predeparture']) ? 'Done. Anything else, just call.' : ($casual ? ($first !== '' ? "We'll give you a ring a few days before you go, {$first}, to make sure you have everything." : "We'll give you a ring a few days before you go to make sure you have everything.") : 'We call every customer a few days before departure to run through the final details.')];
        $steps[] = ['key' => 'followup', 'title' => 'How was it?', 'done' => !empty($t['followup']), 'when' => $this->returns ? Dates::medium($this->returns->modify('+5 days')) : '',
            'text' => !empty($t['followup']) ? 'Thank you for talking to us after your trip.' : 'We\'ll be in touch when you\'re home to hear how it went and to look after any feedback.'];
        return $steps;
    }

    /**
     * Ideas that make the trip better (and the sale bigger), chosen from what is not yet on the booking.
     * @return array<int,array{key:string,title:string,text:string,ask:string}>
     */
    public function ideas(): array
    {
        if (!$this->isQuote() && !in_array($this->stage, [Stage::CONFIRMED, Stage::COUNTDOWN, Stage::PREP], true)) {
            return [];
        }
        $ideas = [];
        $hasFlight = $this->hasKind('flight');
        $ukDeparture = false;
        $economy = false;
        foreach ($this->ofKind('flight') as $f) {
            if (in_array($f->fromCountry, ['GB', 'UK', 'GBR'], true)) {
                $ukDeparture = true;
            }
            if ($f->flightClass !== '' && preg_match('/economy|standard|basic/i', $f->flightClass)) {
                $economy = true;
            }
        }
        if ($hasFlight && !$this->hasKind('transfer') && ($this->hasKind('stay') || $this->hasKind('cruise'))) {
            $ideas[] = ['key' => 'transfers', 'title' => 'Private transfers', 'text' => 'Met at arrivals, straight to your door — no queues, no haggling, no taxi-rank roulette.', 'ask' => 'Could you add private transfers to my booking?'];
        }
        if ($hasFlight && $ukDeparture && !$this->hasKind('parking')) {
            $ideas[] = ['key' => 'parking', 'title' => 'Airport parking and lounge', 'text' => 'Park a few minutes from the terminal and start the holiday early with a lounge pass.', 'ask' => 'Can you quote airport parking and a lounge for our departure?'];
        }
        if ($economy) {
            $ideas[] = ['key' => 'upgrade', 'title' => 'Fly in more comfort', 'text' => 'Premium cabins often cost less than you expect, especially on the way out.', 'ask' => 'What would it cost to upgrade our flights to a premium cabin?'];
        }
        if ($this->hasKind('stay') && !$this->hasKind('attraction') && !$this->hasKind('cruise')) {
            $ideas[] = ['key' => 'experiences', 'title' => 'Experiences and days out', 'text' => 'We can pre-book the things that sell out: tours, tables and tickets, with hotel pick-ups where available.', 'ask' => 'Could you suggest some experiences and days out for our trip?'];
        }
        if ($this->hasKind('stay')) {
            $ideas[] = ['key' => 'room', 'title' => 'A better room', 'text' => 'Sea view, higher floor, a suite for the occasion — we can price the options for you.', 'ask' => 'Can you tell me about room upgrade options?'];
        }
        if ($this->hasKind('cruise')) {
            $ideas[] = ['key' => 'cruise-extras', 'title' => 'Drinks, dining and shore excursions', 'text' => 'Pre-booked packages are usually cheaper than buying on board, and excursions sell out early.', 'ask' => 'What drinks, dining and shore excursion packages can we add?'];
        }
        if (!$this->isQuote() && $this->balance > 200 && $this->balanceDueDate && (Dates::daysBetween(Dates::now(), $this->balanceDueDate) ?? 0) > 45) {
            $ideas[] = ['key' => 'instalments', 'title' => 'Spread the cost', 'text' => 'Pay towards your balance whenever suits you: monthly, after payday, any amount. Everything you pay is protected.', 'ask' => 'Could you set me up to pay my balance in instalments?'];
        }
        $ideas[] = ['key' => 'insurance', 'title' => 'Travel insurance sorted', 'text' => 'Cover should start the day you book. We can point you to suitable cover so it is one less thing to think about.', 'ask' => 'Can you help me arrange travel insurance for this trip?'];
        if ($this->duration >= 7 && !$this->isQuote()) {
            $ideas[] = ['key' => 'extend', 'title' => 'Stay a few nights longer', 'text' => 'Two or three extra nights can change the pace of the whole trip. We can check the fares and rates.', 'ask' => 'Could you look at extending our trip by a few nights?'];
        }
        return array_slice($ideas, 0, 5);
    }

    /**
     * Answers to the questions customers most often ring about, computed from the booking.
     * @return array<int,array{q:string,a:string}>
     */
    public function faqs(): array
    {
        $b = $this->brand;
        $out = [];
        if ($this->isQuote()) {
            $dep = $this->depositPayment();
            $out[] = ['q' => 'How do I go ahead?', 'a' => 'Use "Accept and pay deposit". You read the key information and terms, confirm your details' . ($dep ? ', then pay the ' . $dep->money() . ' deposit' : '') . '. We confirm every part of the trip with the suppliers and send your written confirmation.'];
            $out[] = ['q' => 'Is the price guaranteed?', 'a' => $this->quoteExpiry ? 'The price is held until ' . Dates::long($this->quoteExpiry) . '. After that prices and availability can change, so we would re-check before you book.' : 'Prices and availability can change until the booking is made, so let us know soon if you would like to go ahead and we will re-check everything.'];
            $out[] = ['q' => 'Can I change anything first?', 'a' => 'Yes. Nothing is fixed until you accept. Tell us what you would like different (dates, room, flights, extras) and we will send an updated quotation.'];
        } else {
            if ($this->balance > 0.009) {
                $out[] = ['q' => 'When is my balance due?', 'a' => ($this->balanceDueDate ? 'Your balance of ' . $this->money($this->balance) . ' is due by ' . Dates::long($this->balanceDueDate) . '.' : 'Your balance is ' . $this->money($this->balance) . '.') . ' You can pay online from the Payments section at any time, in full or in part.'];
            }
            $out[] = ['q' => 'When will I get my tickets?', 'a' => !empty($this->tasks['documents']) ? 'Your travel documents have been sent. They are also in the Documents section of this page.' : 'Around two weeks before departure we reconfirm everything with the suppliers and send your tickets and travel documents. Some suppliers issue earlier; they appear in Documents as soon as they do.'];
            $out[] = ['q' => 'Can I still add things?', 'a' => 'Usually, yes: transfers, excursions, parking, lounges, upgrades and extra nights. Use "Ask us" on any idea, or send a message; we price it and add it to this booking so it stays protected in the same way.'];
            $out[] = ['q' => 'What if I need to change or cancel?', 'a' => 'Contact us as soon as you can. Changes and cancellations are subject to the booking conditions and supplier charges, which rise closer to departure, so earlier is always cheaper.'];
        }
        $out[] = ['q' => 'Who do I contact if something goes wrong while away?', 'a' => ($b->emergencyPhone !== '' || $this->emergencyPhone !== '' ? 'Our out-of-hours line is ' . ($b->emergencyPhone ?: $this->emergencyPhone) . '. ' : '') . 'For anything on the day, the supplier emergency number is shown on the relevant item in your itinerary. Keep this page bookmarked; it works on your phone abroad.'];
        $out[] = ['q' => 'How is my money protected?', 'a' => $this->protection->summarySentence()];
        return $out;
    }

    /** Light-touch entry requirement hints by country (UK passport holders). */
    public function entryRequirementHints(): string
    {
        $hints = [];
        $c = array_map('strtolower', $this->countries);
        $has = static fn (string $needle) => (bool) array_filter($c, static fn ($x) => str_contains($x, $needle));
        if ($has('united states')) {
            $hints[] = 'USA: apply for an ESTA at least 72 hours before you fly.';
        }
        if ($has('canada')) {
            $hints[] = 'Canada: most UK passport holders need an eTA before flying.';
        }
        if ($has('australia')) {
            $hints[] = 'Australia: apply for an eVisitor visa before travel.';
        }
        if ($has('new zealand')) {
            $hints[] = 'New Zealand: an NZeTA is required before travel.';
        }
        if ($has('india')) {
            $hints[] = 'India: an e-Visa must be approved before you travel.';
        }
        if ($has('türkiye') || $has('turkey')) {
            $hints[] = 'Türkiye: UK passport holders can currently visit visa-free for tourism.';
        }
        if ($has('egypt')) {
            $hints[] = 'Egypt: a visa is required; an e-Visa can be bought online before travel.';
        }
        if ($has('thailand') || $has('viet nam') || $has('vietnam') || $has('sri lanka')) {
            $hints[] = 'Check visa or arrival-card requirements for Asia destinations before you fly.';
        }
        $eu = ['spain', 'france', 'italy', 'greece', 'portugal', 'germany', 'netherlands', 'croatia', 'cyprus', 'malta', 'austria', 'belgium', 'denmark', 'sweden', 'finland', 'norway', 'iceland', 'czechia', 'poland', 'hungary', 'slovenia', 'slovakia', 'estonia', 'latvia', 'lithuania', 'luxembourg', 'switzerland', 'bulgaria', 'romania'];
        foreach ($eu as $country) {
            if ($has($country)) {
                $hints[] = 'Europe: UK passports must be issued less than 10 years before entry and valid 3 months after departure. Check whether ETIAS pre-authorisation is live for your dates.';
                break;
            }
        }
        return implode(' ', array_unique($hints));
    }
}
