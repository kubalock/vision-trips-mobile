<?php
declare(strict_types=1);

namespace VisionTrips\Frontend;

use VisionTrips\Domain\Stage;
use VisionTrips\Domain\Theme;
use VisionTrips\Domain\Trip;
use VisionTrips\Security\Access;
use VisionTrips\Security\Token;
use VisionTrips\Settings;
use VisionTrips\Support\Dates;

final class TripPage
{
    /** True when the page was built from the last saved copy because Vision could not be reached. */
    public bool $stale = false;
    /** True for a link shared with a fellow traveller: no payments, invoices, acceptance or preferences. */
    public bool $traveller = false;

    public function __construct(private Trip $trip, private string $token, private int $level, private bool $isAgent = false)
    {
    }

    /** @return array<string,mixed> */
    public function viewModel(bool $preview = false): array
    {
        $trip = $this->trip;
        $brand = $trip->brand;
        $spec = Theme::spec($trip->theme);
        $accent = $brand->colour !== '' ? $brand->colour : '#1F4F6E';
        $verified = $this->level >= Access::LEVEL_KNOWLEDGE || $this->isAgent;
        $now = Dates::now();
        $urls = [
            'self'      => Token::url($this->token),
            'ics'       => Token::url($this->token, 'ics'),
            'docs'      => Token::url($this->token, 'documents'),
            'confirmation' => Token::url($this->token, 'documents/confirmation'),
            'invoice'   => Token::url($this->token, 'documents/invoice'),
            'atol'      => Token::url($this->token, 'documents/atol'),
            'receipts'  => Token::url($this->token, 'documents/receipts'),
            'letter'    => Token::url($this->token, 'documents/letter'),
            'portal'    => Settings::bool('portal_enabled') ? add_query_arg('m', $trip->base, home_url('/' . trim((string) Settings::get('portal_page_slug', 'my-trips'), '/') . '/')) : '',
            'rest'      => rest_url('vision/v1/'),
        ];
        return [
            'trip'      => $trip,
            'brand'     => $brand,
            'stage'     => $trip->stage,
            'token'     => $this->token,
            'level'     => $this->level,
            'verified'  => $verified,
            'isAgent'   => $this->isAgent,
            'theme'     => $trip->theme,
            'spec'      => $spec,
            'accent'    => $accent,
            'fontsUrl'  => Theme::fontsUrl($trip->theme, $brand->fontDisplay, $brand->fontBody),
            'displayFont' => $brand->fontDisplay !== '' ? $brand->fontDisplay : $spec['family'],
            'bodyFont'  => $brand->fontBody !== '' ? $brand->fontBody : 'Instrument Sans',
            'urls'      => $urls,
            'preview'   => $preview,
            'async'     => !$preview,
            'now'       => $now,
            'copy'      => self::copy($trip, $verified),
            'checklist' => $trip->checklist($verified),
            'showDob'   => Settings::bool('show_dob') && $verified,
            'quoteAccept' => Settings::bool('quote_accept_enabled') && $trip->stage === Stage::QUOTE && !$this->isAgent,
            'customPay' => Settings::bool('allow_custom_payments') && $brand->mintAllowCustom && $brand->mintConfigured && $trip->isLive() && $trip->balance > 0.009,
            'weather'   => Settings::bool('weather_enabled'),
            'flightsOn' => (string) Settings::get('flight_provider', 'off') !== 'off',
            'placesOn'  => trim((string) Settings::get('google_places_key', '')) !== '',
            'widgetyOn' => trim((string) Settings::get('widgety_app_id', '')) !== '',
            'legalText' => (string) Settings::get('legal_footer_text', 'Vision by The Travel Network Group'),
            'ideasOn'   => Settings::bool('ideas_enabled'),
            'aiNotes'   => Settings::bool('ai_travel_notes') && trim((string) Settings::get('ai_api_key', '')) !== '',
            'isWpAdmin' => \VisionTrips\Support\Provenance::isAdmin(),
            'stale'     => $this->stale,
            'traveller' => $this->traveller,
            'nonce'     => wp_create_nonce('wp_rest'),
        ];
    }

    /** Other open quotations for the same customer (compare card). @return array<int,array<string,mixed>> */
    private function siblings(bool $preview): array
    {
        $trip = $this->trip;
        if ($preview || !Settings::module('compare') || !$trip->isQuote() || $trip->customerEmail === '') {
            return [];
        }
        $key = $trip->base . '|' . strtolower($trip->customerEmail) . '|' . $trip->id;
        $cached = \VisionTrips\Support\Cache::get('siblings', $key);
        if (is_array($cached)) {
            return $cached;
        }
        $out = [];
        try {
            $repo = new \VisionTrips\Airtable\BookingRepository(new \VisionTrips\Airtable\Client());
            foreach ($repo->findByEmail($trip->base, $trip->customerEmail) as $t) {
                if ($t['id'] === $trip->id || strcasecmp($t['status'], 'Quotation') !== 0) {
                    continue;
                }
                $created = Dates::parse($t['created'] ?? null);
                if ($created && $created < Dates::now()->modify('-90 days')) {
                    continue;
                }
                $t['url'] = Token::urlFor($trip->base, $t['id']);
                $out[] = $t;
            }
        } catch (\Throwable $e) {
            \VisionTrips\Support\Log::warning('Sibling quotations failed', ['error' => $e->getMessage()]);
        }
        $out = array_slice($out, 0, 3);
        \VisionTrips\Support\Cache::set('siblings', $key, $out, 10 * MINUTE_IN_SECONDS);
        return $out;
    }

    public function render(bool $preview = false): string
    {
        $withLink = count(array_filter($this->trip->payments, static fn ($p) => $p->link !== ''));
        $due = count(array_filter($this->trip->payments, static fn ($p) => $p->isCustomerPayment() && !$p->isPaid()));
        \VisionTrips\Support\Provenance::note('Payments', 'Vision', count($this->trip->payments) . ' rows · ' . $due . ' due · ' . $withLink . ' with a Payment Link URL · Mint on-demand: ' . ($this->trip->brand->mintConfigured && preg_match('/^BK\./', $this->trip->mintBookingId) ? 'ready' : 'not configured for this brand/booking'), true);
        return View::render('trip/page', $this->viewModel($preview));
    }

    /**
     * Stage-specific copy in the member's register. Keep sentences short; the hero is the loudest thing on the page.
     * @return array<string,string>
     */
    public static function copy(Trip $trip, bool $verified): array
    {
        $tone = $trip->brand->tone;
        $first = $trip->leadFirstName();
        $greet = $first !== '' ? ($tone === 'formal' ? 'Dear ' . $first : 'Hi ' . $first) : ($tone === 'formal' ? 'Good day' : 'Hello');
        $days = $trip->daysToGo();
        $dest = $trip->destinationSummary();
        $quoteDaysLeft = $trip->quoteExpiry ? Dates::daysBetween(Dates::now(), $trip->quoteExpiry) : null;
        $c = ['greeting' => $greet, 'kicker' => '', 'headline' => $trip->name, 'sub' => '', 'cta' => '', 'cta2' => ''];
        $accepted = isset($_COOKIE['vtr_acc_' . substr(md5($trip->base . $trip->id), 0, 12)]);
        switch ($trip->stage) {
            case Stage::QUOTE:
                if ($accepted) {
                    $c['kicker'] = 'Thank you — we\'re confirming your booking';
                    $c['sub'] = 'We have your acceptance and are confirming each part of the trip with the suppliers. You\'ll have your written confirmation shortly.';
                    $c['cta'] = '';
                    $c['cta2'] = 'Ask a question';
                    break;
                }
                $c['kicker'] = 'Your quotation';
                $c['sub'] = $trip->quoteExpiry ? 'Prepared for you by ' . $trip->brand->name . '. Price held until ' . Dates::long($trip->quoteExpiry) . ($quoteDaysLeft !== null && $quoteDaysLeft >= 0 && $quoteDaysLeft <= 7 ? ' — ' . ($quoteDaysLeft === 0 ? 'last day today' : $quoteDaysLeft . ' day' . ($quoteDaysLeft === 1 ? '' : 's') . ' left') : '') . '.' : 'Prepared for you by ' . $trip->brand->name . '. Prices and availability can change, so let us know soon if you would like to go ahead.';
                $c['cta'] = 'Accept and pay deposit';
                $c['cta2'] = 'Ask a question';
                break;
            case Stage::QUOTE_EXPIRED:
                $c['kicker'] = 'This quotation has expired';
                $c['sub'] = 'Prices and availability may have changed since ' . Dates::long($trip->quoteExpiry) . '. We would be glad to refresh it for you.';
                $c['cta'] = 'Ask for an updated quote';
                break;
            case Stage::CLOSED:
                $c['kicker'] = 'This quotation is now closed';
                $c['sub'] = 'It is no longer available to book online. If you are still thinking about this trip, just get in touch and we will pick it back up.';
                $c['cta'] = 'Start a new enquiry';
                break;
            case Stage::CANCELLED:
                $c['kicker'] = 'This booking was cancelled';
                $c['sub'] = ($trip->cancelDate ? 'Cancelled on ' . Dates::long($trip->cancelDate) . '. ' : '') . 'Your payment records and documents remain available below.';
                $c['cta'] = 'Plan something new';
                break;
            case Stage::CONFIRMED:
                $c['kicker'] = 'Booking confirmed';
                $c['sub'] = 'We are finalising your travel dates. Everything we have so far is below.';
                break;
            case Stage::COUNTDOWN:
                $c['kicker'] = match ($tone) { 'formal' => 'Your booking is confirmed', 'casual' => 'It\'s booked!', default => 'Confirmed and counting down' };
                $c['sub'] = $dest !== '' ? $dest . ', ' . $trip->dateRange() : $trip->dateRange();
                $c['cta'] = 'Add to calendar';
                break;
            case Stage::PREP:
                $c['kicker'] = $days === 1 ? 'You leave tomorrow' : $days . ' days to go';
                $c['sub'] = 'Nearly there. Your checklist and documents are ready below.';
                $c['cta'] = 'Open my documents';
                break;
            case Stage::DEPARTURE:
                $c['kicker'] = 'Today is the day';
                $c['sub'] = $trip->hasFlight() ? 'Live flight status, your first night and who to call if you need us.' : 'Your first day, step by step.';
                break;
            case Stage::TRAVELLING:
                $c['kicker'] = 'You are away';
                $c['sub'] = 'Day ' . max(1, (Dates::daysBetween($trip->departs, Dates::now()) ?? 0) + 1) . ' of ' . max(1, $trip->duration + 1) . ($trip->returns ? '. Home on ' . Dates::long($trip->returns) . '.' : '.');
                break;
            case Stage::RETURNING:
                $c['kicker'] = 'Heading home today';
                $c['sub'] = 'Safe travels. Your return journey is below.';
                break;
            case Stage::HOME:
                $c['kicker'] = 'Welcome home';
                $c['sub'] = 'We hope ' . ($dest !== '' ? $dest : 'your trip') . ' was everything you wanted. We would love to hear how it went.';
                $c['cta'] = 'Leave a review';
                $c['cta2'] = 'Plan the next one';
                break;
            case Stage::PAST:
                $c['kicker'] = 'A trip to remember';
                $c['sub'] = ($dest !== '' ? $dest . ', ' : '') . $trip->dateRange() . '.';
                $c['cta'] = 'Plan the next one';
                break;
        }
        if ($trip->surprise && $trip->isLive()) {
            $c['headline'] = 'A surprise is on its way';
            $c['sub'] = 'The details of this trip are being kept under wraps. ' . ($days !== null && $days > 0 ? $days . ' days to go.' : '');
        }
        return $c;
    }
}
