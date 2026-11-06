<?php
declare(strict_types=1);

namespace VisionTrips\Rest;

use VisionTrips\Airtable\Audit;
use VisionTrips\Airtable\BookingRepository;
use VisionTrips\Airtable\Client;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Domain\Stage;
use VisionTrips\Domain\Trip;
use VisionTrips\Frontend\Router;
use VisionTrips\Frontend\TripPage;
use VisionTrips\Frontend\View;
use VisionTrips\Integrations\Ai;
use VisionTrips\Integrations\Flights;
use VisionTrips\Integrations\Mint;
use VisionTrips\Integrations\Places;
use VisionTrips\Integrations\Weather;
use VisionTrips\Integrations\Widgety;
use VisionTrips\Security\Access;
use VisionTrips\Security\Token;
use VisionTrips\Settings;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Log;
use VisionTrips\Support\Provenance;
use VisionTrips\Support\RateLimit;
use VisionTrips\Support\Str;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class Api
{
    public const NS = 'vision/v1';
    /** Set by fragment builders when AI copy is still being written in the background. */
    public static bool $pending = false;

    public function register(): void
    {
        add_action('rest_api_init', function (): void {
            register_rest_route(self::NS, '/trip/(?P<token>[^/]+)/section/(?P<name>[a-z0-9\-]+)', ['methods' => 'GET', 'callback' => [$this, 'section'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/trip/(?P<token>[^/]+)/accept', ['methods' => 'POST', 'callback' => [$this, 'accept'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/trip/(?P<token>[^/]+)/pay', ['methods' => 'POST', 'callback' => [$this, 'pay'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/trip/(?P<token>[^/]+)/question', ['methods' => 'POST', 'callback' => [$this, 'question'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/links/mint', ['methods' => 'POST', 'callback' => [$this, 'mintLink'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/cache/purge', ['methods' => 'POST', 'callback' => [$this, 'purge'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/jobs/run', ['methods' => 'POST', 'callback' => [$this, 'runJob'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/trip/(?P<token>[^/]+)/events', ['methods' => 'POST', 'callback' => [$this, 'events'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/ai/feedback', ['methods' => 'POST', 'callback' => [$this, 'aiFeedback'], 'permission_callback' => static fn () => current_user_can('manage_options')]);
            register_rest_route(self::NS, '/notify', ['methods' => 'POST', 'callback' => [$this, 'notify'], 'permission_callback' => '__return_true']);
            register_rest_route(self::NS, '/trip/(?P<token>[^/]+)/share', ['methods' => 'POST', 'callback' => [$this, 'share'], 'permission_callback' => '__return_true']);
        });
    }

    /** @return array{trip:Trip,token:array,level:int}|WP_Error */
    private function auth(WP_REST_Request $req, int $perMinute = 60): array|WP_Error
    {
        if (!RateLimit::hit('rest|' . RateLimit::ip(), $perMinute, MINUTE_IN_SECONDS)) {
            return new WP_Error('rate_limited', 'Too many requests.', ['status' => 429]);
        }
        $resolved = Router::resolve((string) $req['token']);
        if (!$resolved) {
            return new WP_Error('forbidden', 'This link is not valid or needs verification.', ['status' => 403]);
        }
        return $resolved;
    }

    /** HTML fragments for sections that are slow or third-party (Places, Widgety, flights, weather). */
    public function section(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $auth = $this->auth($req, 120);
        if ($auth instanceof WP_Error) {
            return $auth;
        }
        $trip = $auth['trip'];
        $name = (string) $req['name'];
        $page = new TripPage($trip, (string) $req['token'], $auth['level'], $auth['token']['scope'] === Token::SCOPE_AGENT);
        $vm = $page->viewModel();
        Provenance::reset();
        self::$pending = false;
        @set_time_limit(60);
        $html = self::fragment($trip, $name, $vm);
        if (\VisionTrips\Support\Jobs::queueLength() > 0) {
            \VisionTrips\Support\Jobs::kick(); // runs one job after this response if no runner is active
        }
        $payload = ['html' => $html, 'pending' => self::$pending];
        if (Provenance::isAdmin()) {
            $payload['provenance'] = Provenance::all();
        }
        $res = new WP_REST_Response($payload);
        $res->header('Cache-Control', 'no-store');
        return $res;
    }

    /** Route a section name to its builder. @param array<string,mixed> $vm */
    public static function fragment(Trip $trip, string $name, array $vm): string
    {
        if (preg_match('/^airline-([a-z0-9]{2})$/', $name, $m)) {
            return self::airlineFragment($trip, strtoupper($m[1]), $vm);
        }
        if (preg_match('/^airport-([a-z]{3})$/', $name, $m)) {
            return self::airportFragment($trip, strtoupper($m[1]), $vm);
        }
        return match ($name) {
            'stays'        => self::staysFragment($trip, $vm),
            'cruise'       => self::cruiseFragment($trip, $vm),
            'flights'      => self::flightsFragment($trip, $vm),
            'weather'      => self::weatherFragment($trip, $vm),
            'destinations' => self::destinationsFragment($trip, $vm),
            default        => '',
        };
    }

    /** Destination profiles: Widgety images/text → Google Places photos/summary → AI → Vision CMS fallback. @param array<string,mixed> $vm */
    public static function destinationsFragment(Trip $trip, array $vm): string
    {
        $w = new Widgety();
        $places = new Places();
        $ai = new Ai();
        $cards = [];
        foreach ($trip->destinations as $d) {
            if (empty($d['primary']) && $d['image'] === '' && $d['overview'] === '') {
                continue;
            }
            $wp = $w->configured() ? $w->place($d['name'], $d['country']) : null;
            $gp = $places->configured() ? $places->find($d['name'] . ($d['country'] !== '' ? ', ' . $d['country'] : ''), $d['lat'], $d['lng'], true) : null;
            $images = [];
            foreach ((array) ($wp['images'] ?? []) as $u) {
                $images[] = ['url' => $u, 'source' => 'Widgety'];
            }
            foreach ((array) ($gp['photos'] ?? []) as $ph) {
                if (count($images) >= 8) {
                    break;
                }
                $images[] = ['url' => $ph['url'], 'source' => 'Google'];
            }
            if (!$images && $d['image'] !== '') {
                $images[] = ['url' => $d['image'], 'source' => 'Vision'];
            }
            $text = (string) ($wp['description'] ?? '');
            $textSource = $text !== '' ? 'Widgety' : '';
            if ($text === '' && $ai->configured()) {
                $facts = ['Country' => $d['country'], 'Editorial summary' => $gp['summary'] ?? '', 'Known for' => strip_tags($d['attractions']), 'Practical' => strip_tags($d['practical']), 'Trip dates' => $trip->dateRange()];
                $gen = $ai->placeDescriptionAsync($d['name'], $d['country'], $facts, $trip->brand->tone, ['kind' => 'destination', 'dates' => $trip->dateRange(), 'travellerType' => $trip->travellerType, 'tags' => $trip->tags]);
                if ($gen['text'] !== '') {
                    $text = '<p>' . htmlspecialchars($gen['text'], ENT_QUOTES, 'UTF-8') . '</p>';
                    $textSource = 'AI (researched; grounded in Google Places + Vision facts)';
                } elseif ($gen['pending']) {
                    self::$pending = true;
                    $textSource = 'AI (writing in the background)';
                }
            }
            if ($text === '' && !empty($gp['summary'])) {
                $text = '<p>' . htmlspecialchars((string) $gp['summary'], ENT_QUOTES, 'UTF-8') . '</p>';
                $textSource = 'Google Places editorial summary';
            }
            if ($text === '' && $d['overview'] !== '') {
                $text = $d['overview'];
                $textSource = 'Vision CMS';
            }
            // The four sections the page always offers: Vision CMS text first, then an AI guide (researched, cached)
            // so a destination with nothing in Vision and no Widgety entry is still fully covered.
            $sections = ['attractions' => ['html' => $d['attractions'], 'source' => $d['attractions'] !== '' ? 'Vision CMS' : ''], 'practical' => ['html' => $d['practical'], 'source' => $d['practical'] !== '' ? 'Vision CMS' : ''], 'culture' => ['html' => $d['culture'], 'source' => $d['culture'] !== '' ? 'Vision CMS' : '']];
            $needGuide = $text === '' || $sections['attractions']['html'] === '' || $sections['practical']['html'] === '' || $sections['culture']['html'] === '';
            $guidePending = false;
            if ($needGuide && $ai->configured()) {
                $g = $ai->destinationGuideAsync($d['name'], $d['country'] ?: ($trip->countries[0] ?? ''), ['Google summary' => $gp['summary'] ?? '', 'Trip dates' => $trip->dateRange(), 'Traveller type' => $trip->travellerType, 'Trip tags' => $trip->tags], $trip->brand->tone);
                $guidePending = $g['pending'];
                if ($guidePending) {
                    self::$pending = true;
                }
                if ($text === '' && $g['guide']['overview'] !== '') {
                    $text = '<p>' . htmlspecialchars($g['guide']['overview'], ENT_QUOTES, 'UTF-8') . '</p>';
                    $textSource = 'AI guide (researched)';
                }
                foreach (['attractions', 'practical', 'culture'] as $k) {
                    if ($sections[$k]['html'] === '' && $g['guide'][$k] !== '') {
                        $sections[$k] = ['html' => '<p>' . htmlspecialchars($g['guide'][$k], ENT_QUOTES, 'UTF-8') . '</p>', 'source' => 'AI guide (researched)'];
                    }
                }
            }
            $filled = count(array_filter($sections, static fn ($s) => $s['html'] !== ''));
            Provenance::note('Destination: ' . $d['name'], $textSource ?: ($guidePending ? 'AI guide (writing in the background)' : 'none'), ($wp ? 'Widgety ✓' : 'no Widgety match') . ' · ' . ($gp ? 'Places ✓ (' . count((array) ($gp['photos'] ?? [])) . ' photos)' : 'no Places match') . ' · ' . count($images) . ' image(s) · sections ' . $filled . '/3' . ($guidePending ? ' (AI writing)' : ''), $text !== '' || $images !== [], $needGuide && $ai->configured() ? Ai::$lastCacheId : '');
            $country = $d['country'] !== '' ? $d['country'] : ($trip->countries[0] ?? '');
            $cards[] = ['dest' => $d, 'images' => $images, 'text' => $text, 'sections' => $sections, 'pending' => $guidePending && $text === '', 'country' => $country, 'lat' => $gp['lat'] ?? $d['lat'], 'lng' => $gp['lng'] ?? $d['lng'], 'placeId' => $gp['id'] ?? ''];
        }
        return View::render('trip/fragments/destinations', array_merge($vm, ['cards' => $cards]));
    }

    /** AI "good to know" about an airline on the booking. @param array<string,mixed> $vm */
    public static function airlineFragment(Trip $trip, string $code, array $vm): string
    {
        $name = '';
        foreach ($trip->ofKind('flight') as $f) {
            if ($f->carrierCode === $code) {
                $name = $f->carrier;
                break;
            }
        }
        if ($name === '') {
            return '';
        }
        $g = (new Ai())->guideAsync('airline', $name, $code);
        $guide = $g['guide'];
        if ($g['pending']) {
            self::$pending = true;
        }
        Provenance::note('Airline guide: ' . $name, $guide ? 'AI (cached 60 days)' : ($g['pending'] ? 'AI (writing in the background)' : 'none'), count($guide) . ' section(s)' . (!$guide && !$g['pending'] && Ai::$lastError !== '' ? ' · AI failed: ' . Ai::$lastError : ''), $guide !== [] || $g['pending'], Ai::$lastCacheId);
        return $guide ? View::render('trip/fragments/guide', array_merge($vm, ['title' => 'Flying with ' . $name, 'guide' => $guide, 'logo' => 'https://pics.avs.io/240/80/' . rawurlencode($code) . '@2x.png'])) : '';
    }

    /** AI "good to know" about a UK departure airport. @param array<string,mixed> $vm */
    public static function airportFragment(Trip $trip, string $code, array $vm): string
    {
        $name = '';
        foreach ($trip->ofKind('flight') as $f) {
            if ($f->fromCode === $code && in_array($f->fromCountry, ['GB', 'UK', 'GBR'], true)) {
                $name = $f->from;
                break;
            }
        }
        if ($name === '') {
            return '';
        }
        $g = (new Ai())->guideAsync('airport', $name, $code);
        $guide = $g['guide'];
        if ($g['pending']) {
            self::$pending = true;
        }
        Provenance::note('Airport guide: ' . $name, $guide ? 'AI (cached 60 days)' : ($g['pending'] ? 'AI (writing in the background)' : 'none'), count($guide) . ' section(s)' . (!$guide && !$g['pending'] && Ai::$lastError !== '' ? ' · AI failed: ' . Ai::$lastError : ''), $guide !== [] || $g['pending'], Ai::$lastCacheId);
        return $guide ? View::render('trip/fragments/guide', array_merge($vm, ['title' => $name . ' airport', 'guide' => $guide, 'logo' => ''])) : '';
    }

    /** @param array<string,mixed> $vm */
    public static function staysFragment(Trip $trip, array $vm): string
    {
        $places = new Places();
        $ai = new Ai();
        $cards = [];
        foreach ($trip->ofKind('stay') as $e) {
            $place = $places->configured() ? $places->find($e->searchQueryForPlaces(), $e->lat, $e->lng) : null;
            $desc = '';
            $descSource = 'none';
            if ($place) {
                $desc = $place['summary'];
                $descSource = $desc !== '' ? 'Places summary' : 'none';
            }
            if ($ai->configured()) {
                $facts = $place
                    ? ['Address' => $place['address'], 'Google rating' => $place['rating'] > 0 ? $place['rating'] . ' from ' . $place['ratings'] . ' reviews' : '', 'Category' => implode(', ', array_slice($place['types'], 0, 4)), 'Editorial summary' => $place['summary'], 'Guest comments' => array_map(static fn ($r) => $r['text'], $place['reviews']), 'Stay dates' => Dates::range($e->start, $e->end), 'Room booked' => implode('; ', $e->rooms)]
                    : ['Address' => $e->address, 'Location' => $e->locationName, 'Star rating' => $e->rating, 'Stay dates' => Dates::range($e->start, $e->end), 'Room booked' => implode('; ', $e->rooms), 'Notes from the agent' => strip_tags($e->furtherInfo)];
                $gen = $ai->placeDescriptionAsync($place['name'] ?? $e->title, $e->locationName ?: ($place['address'] ?? $e->address), $facts, $trip->brand->tone, ['kind' => 'stay', 'dates' => Dates::range($e->start, $e->end), 'travellerType' => $trip->travellerType, 'tags' => $trip->tags, 'room' => implode('; ', $e->rooms), 'agentNotes' => Str::truncate(strip_tags($e->furtherInfo), 300)]);
                if ($gen['text'] !== '') {
                    $desc = $gen['text'];
                    $descSource = 'AI (researched' . ($place ? ', grounded in Google Places)' : ', grounded in Vision facts)');
                } elseif ($gen['pending']) {
                    self::$pending = true;
                    $descSource = 'AI (writing in the background)';
                } elseif (Ai::$lastError !== '') {
                    $descSource = ($desc !== '' ? $descSource . '; ' : '') . 'AI failed: ' . Ai::$lastError;
                }
            }
            $minRating = max(1, Settings::int('reviews_min_rating', 4));
            if ($place) {
                $place['reviews'] = array_values(array_filter($place['reviews'], static fn ($r) => (int) $r['rating'] >= $minRating));
                if ($place['rating'] > 0 && $place['rating'] < $minRating) {
                    $place['rating'] = 0.0; // never surface a poor score
                }
            }
            Provenance::note('Stay: ' . $e->title, $place ? 'Google Places' : 'Vision', ($place ? count($place['photos']) . ' photo(s), rating ' . $place['rating'] : count($e->images) . ' Vision image(s)') . ($places->configured() ? ' · ' . (Places::$lastMatch ?: 'no Places result') : '') . ' · description: ' . $descSource, true, str_starts_with($descSource, 'AI') ? Ai::$lastCacheId : '');
            $cards[] = ['element' => $e, 'place' => $place, 'description' => $desc, 'pending' => $desc === '' && self::$pending];
        }
        return View::render('trip/fragments/stays', array_merge($vm, ['cards' => $cards]));
    }

    /** @param array<string,mixed> $vm */
    public static function cruiseFragment(Trip $trip, array $vm): string
    {
        $w = new Widgety();
        $cards = [];
        foreach ($trip->ofKind('cruise') as $e) {
            $ship = $w->configured() ? $w->ship($e->widgetyShipId, $e->ship) : null;
            if ($ship && isset($ship['missing'])) {
                $ship = null;
            }
            $holiday = ($w->configured() && $e->voyageCode !== '') ? $w->holidayByReference($e->voyageCode) : null;
            Provenance::note('Cruise: ' . $e->title, $ship || $holiday ? 'Widgety' : 'Vision', ($ship ? 'ship profile ✓' : 'no ship profile') . ' · ' . ($holiday ? 'voyage ' . $e->voyageCode . ' ✓' : (count($e->ports) . ' Vision port rows')), $ship !== null || $holiday !== null || $e->ports !== []);
            $cards[] = ['element' => $e, 'ship' => $ship, 'holiday' => $holiday];
        }
        return View::render('trip/fragments/cruise', array_merge($vm, ['cards' => $cards]));
    }

    /** @param array<string,mixed> $vm */
    public static function flightsFragment(Trip $trip, array $vm): string
    {
        $svc = new Flights();
        $rows = [];
        foreach ($trip->trackableFlights(Settings::int('flight_window_hours', 48)) as $e) {
            $status = $svc->configured() ? $svc->status($e->flightNo, $e->start ? $e->start->format('Y-m-d') : '') : null;
            Provenance::note('Flight status: ' . $e->flightNo, $status ? ucfirst((string) Settings::get('flight_provider')) : 'none', $status ? $status['statusLabel'] : 'no data', $status !== null);
            $rows[] = ['element' => $e, 'status' => $status];
        }
        return View::render('trip/fragments/flights', array_merge($vm, ['rows' => $rows]));
    }

    /** @param array<string,mixed> $vm */
    public static function weatherFragment(Trip $trip, array $vm): string
    {
        if (!Weather::enabled()) {
            return '';
        }
        $lat = $lng = null;
        $label = '';
        $day = Dates::now();
        $here = $trip->elementsOn($day);
        foreach (array_merge($here, $trip->activeElements()) as $e) {
            if ($e->lat !== null && $e->lng !== null) {
                $lat = $e->lat;
                $lng = $e->lng;
                $label = $e->locationName ?: $e->title;
                break;
            }
        }
        if ($lat === null) {
            foreach ($trip->destinations as $d) {
                if ($d['lat'] !== null && $d['lng'] !== null) {
                    $lat = $d['lat'];
                    $lng = $d['lng'];
                    $label = $d['name'];
                    break;
                }
            }
        }
        if ($lat === null) {
            $name = $trip->destinations[0]['name'] ?? ($trip->countries[0] ?? '');
            $geo = Weather::geocode($name);
            if ($geo) {
                $lat = $geo['lat'];
                $lng = $geo['lng'];
                $label = $geo['name'];
            }
        }
        if ($lat === null || $lng === null) {
            return '';
        }
        $forecast = Weather::forecast($lat, $lng);
        return $forecast ? View::render('trip/fragments/weather', array_merge($vm, ['forecast' => $forecast, 'place' => $label])) : '';
    }

    /** Quotation acceptance: validate, write back to Vision, notify, hand over to the deposit payment. */
    public function accept(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $auth = $this->auth($req, 10);
        if ($auth instanceof WP_Error) {
            return $auth;
        }
        $trip = $auth['trip'];
        if (!Settings::bool('quote_accept_enabled') || $trip->stage !== Stage::QUOTE) {
            return new WP_Error('not_quote', 'This quotation can no longer be accepted online. Please contact your travel agent.', ['status' => 409]);
        }
        $name = Str::clean((string) $req->get_param('name'));
        $email = strtolower(trim((string) $req->get_param('email')));
        $agreed = (bool) $req->get_param('agreed');
        $read = (array) $req->get_param('read');
        if ($name === '' || !is_email($email) || !$agreed) {
            return new WP_Error('invalid', 'Please enter your full name and email address and confirm you agree.', ['status' => 422]);
        }
        $required = ['package', 'names', 'important', 'protection', 'terms'];
        foreach ($required as $r) {
            if (empty($read[$r])) {
                return new WP_Error('unread', 'Please open and read every section before accepting.', ['status' => 422]);
            }
        }
        $stamp = Dates::now();
        $log = sprintf("%s — accepted online by %s <%s> from %s", $stamp->format('Y-m-d H:i'), $name, $email, RateLimit::ip());
        $fields = [];
        foreach (Settings::quoteAcceptFields() as $field => $type) {
            $fields[$field] = match ($type) {
                'checkbox' => true,
                'datetime' => $stamp->format(DATE_ATOM),
                'ip'       => RateLimit::ip(),
                'email'    => $email,
                'append', 'log' => $log,
                default    => $name,
            };
        }
        $written = true;
        if ($fields) {
            $client = new Client();
            $written = $client->patch($trip->base, FieldMap::table('bookings'), $trip->id, $fields);
            if (!$written) {
                Log::error('Quotation acceptance write-back failed', ['booking' => $trip->id]);
                if (Settings::bool('quote_accept_require_writeback')) {
                    return new WP_Error('writeback', 'We could not record your acceptance. Please try again or contact your travel agent.', ['status' => 502]);
                }
            }
            (new BookingRepository($client))->invalidate($trip->base, $trip->id);
        }
        // Notify agent + customer
        $brand = $trip->brand;
        $tripUrl = Token::url((string) $req['token']);
        $esc = static fn (string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        if (Settings::bool('quote_notify_agent') && $brand->email !== '' && is_email($brand->email)) {
            \VisionTrips\Integrations\Email::send($brand, $brand->email, 'Quotation accepted online: ' . $trip->ref, 'Quotation accepted 🎉',
                '<p><strong>' . $esc($name) . '</strong> (' . $esc($email) . ') has accepted quotation <strong>' . $esc($trip->ref) . '</strong> — ' . $esc($trip->name) . '.</p><p>' . $esc($log) . '</p><p>They have been taken to the deposit payment. Confirm the booking in Vision once the suppliers confirm.</p>',
                [['label' => 'Open the trip page', 'url' => $tripUrl]], [['label' => 'Deposit', 'value' => $deposit ? $deposit->money() : '—'], ['label' => 'Write-back', 'value' => $written ? 'Recorded in Vision' : 'Not recorded — check the acceptance fields']]);
        }
        \VisionTrips\Integrations\Email::send($brand, $email, 'Thank you — ' . $trip->name, 'Thank you, ' . Str::firstName($name),
            '<p>We have your acceptance for <strong>' . $esc($trip->name) . '</strong> (' . $esc($trip->ref) . ').</p><p>We are now confirming every part of the trip with the suppliers. Your written confirmation and key information will follow, and your trip page keeps everything in one place: itinerary, payments, documents and how to reach us.</p>',
            [['label' => 'View your trip', 'url' => $tripUrl]], array_values(array_filter([['label' => 'Travel dates', 'value' => $trip->dateRange()], $deposit ? ['label' => 'Deposit', 'value' => $deposit->money()] : null, ['label' => 'Your travel expert', 'value' => $trip->agentName !== '' ? $trip->agentName : $brand->name]])), 'Your acceptance is recorded — here is what happens next.');
        Access::grant($trip->base, $trip->id, max($auth['level'], Access::LEVEL_KNOWLEDGE));
        Audit::accepted($trip, $name, $email, $written);
        if (!headers_sent()) {
            setcookie('vtr_acc_' . substr(md5($trip->base . $trip->id), 0, 12), (string) time(), ['expires' => time() + 30 * DAY_IN_SECONDS, 'path' => '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax']);
        }

        // Hand-over to payment
        $deposit = $trip->depositPayment();
        $payUrl = $deposit && $deposit->link !== '' ? $deposit->link : '';
        if ($payUrl === '' && $deposit && $deposit->amount > 0 && Mint::enabled()) {
            $link = Mint::createLink($trip, $deposit->amount, $trip->ref);
            if ($link['ok']) {
                $payUrl = $link['url'];
            }
        }
        return new WP_REST_Response([
            'ok'       => true,
            'written'  => $written,
            'payUrl'   => $payUrl,
            'amount'   => $deposit ? $deposit->money() : '',
            'bank'     => $payUrl === '' && $brand->trustAccountNumber !== '' ? ['name' => $brand->trustAccountName, 'sort' => $brand->trustSortCode, 'number' => $brand->trustAccountNumber, 'reference' => $trip->ref] : null,
            'message'  => $payUrl !== '' ? 'Thank you. Taking you to the secure deposit payment now.' : 'Thank you. Your travel agent will be in touch to take your deposit.',
        ]);
    }

    /** Custom-amount payment link (customer-initiated), capped at the balance due. */
    public function pay(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $auth = $this->auth($req, 10);
        if ($auth instanceof WP_Error) {
            return $auth;
        }
        $trip = $auth['trip'];
        $paymentId = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) $req->get_param('payment'));
        if ($paymentId !== '') {
            foreach ($trip->payments as $p) {
                if ($p->id === $paymentId && $p->isCustomerPayment() && !$p->isPaid() && !$p->isResort() && $p->amount > 0 && (!$trip->isQuote() || $p->showOnQuote)) {
                    if ($p->link !== '') {
                        return new WP_REST_Response(['ok' => true, 'url' => $p->link]);
                    }
                    $link = Mint::createLink($trip, $p->amount, $trip->ref . ' ' . $p->label());
                    if (!$link['ok']) {
                        return new WP_Error('mint', $link['error'], ['status' => 502]);
                    }
                    Provenance::note('Payment link', 'Mint', $p->money() . ' created on demand', true);
                    return new WP_REST_Response(['ok' => true, 'url' => $link['url']]);
                }
            }
            return new WP_Error('invalid', 'That payment is not due.', ['status' => 404]);
        }
        if (!Settings::bool('allow_custom_payments') || !$trip->brand->mintAllowCustom || !$trip->isLive()) {
            return new WP_Error('disabled', 'Custom payments are not available for this booking.', ['status' => 403]);
        }
        $amountRaw = trim((string) $req->get_param('amount'));
        if (!preg_match('/^\d+(?:\.\d{1,2})?$/', $amountRaw)) {
            return new WP_Error('invalid', 'Please enter a valid amount.', ['status' => 422]);
        }
        $amount = (float) $amountRaw;
        $cap = $trip->balance > 0 ? $trip->balance : 0.0;
        if ($amount <= 0 || $amount > $cap + 0.009 || $amount > 100000) {
            return new WP_Error('invalid', 'The amount must be between £0.01 and your balance of ' . $trip->money($cap) . '.', ['status' => 422]);
        }
        $link = Mint::createLink($trip, $amount, $trip->ref);
        if (!$link['ok']) {
            return new WP_Error('mint', $link['error'], ['status' => 502]);
        }
        return new WP_REST_Response(['ok' => true, 'url' => $link['url']]);
    }

    /** "Ask a question" → email to the brand's customer inbox. */
    public function question(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $auth = $this->auth($req, 5);
        if ($auth instanceof WP_Error) {
            return $auth;
        }
        $trip = $auth['trip'];
        $message = trim(wp_strip_all_tags((string) $req->get_param('message')));
        $from = strtolower(trim((string) $req->get_param('email')));
        if (mb_strlen($message) < 5 || mb_strlen($message) > 2000) {
            return new WP_Error('invalid', 'Please write a short message (up to 2000 characters).', ['status' => 422]);
        }
        $to = $trip->brand->email;
        if ($to === '' || !is_email($to)) {
            return new WP_Error('no_inbox', 'This travel company has not set an email address yet. Please call them instead.', ['status' => 409]);
        }
        $esc = static fn (string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $tripUrl = Token::url((string) $req['token']);
        $sent = \VisionTrips\Integrations\Email::send($trip->brand, $to, 'Message about ' . $trip->ref . ' — ' . $trip->name, 'A message from your customer',
            '<p style="padding:14px 16px;background:#F6F6F3;border-left:4px solid ' . $esc($trip->brand->colour ?: '#1F4F6E') . ';border-radius:8px;white-space:pre-wrap;">' . $esc($message) . '</p><p>From ' . ($from !== '' && is_email($from) ? '<a href="mailto:' . $esc($from) . '">' . $esc($from) . '</a>' : 'the trip page (no email given)') . ' about <strong>' . $esc($trip->ref) . '</strong>.</p>',
            [['label' => 'Open the trip page', 'url' => $tripUrl]] + ($from !== '' && is_email($from) ? [1 => ['label' => 'Reply by email', 'url' => 'mailto:' . $from]] : []));
        if ($sent) {
            Audit::question($trip, $from, $message);
            if ($from !== '' && is_email($from)) {
                \VisionTrips\Integrations\Email::send($trip->brand, $from, 'We have your message — ' . $trip->brand->name, 'Got it, thank you',
                    '<p>Your message about <strong>' . $esc($trip->name) . '</strong> has reached ' . $esc($trip->brand->name) . ' and a real person will come back to you' . ($trip->brand->hours !== '' ? ' during opening hours' : ' as soon as possible') . '.</p><p style="padding:14px 16px;background:#F6F6F3;border-radius:8px;white-space:pre-wrap;color:#4A4F55;">' . $esc($message) . '</p>',
                    [['label' => 'Back to your trip', 'url' => $tripUrl]], [], 'We will reply as soon as we can.');
            }
        }
        return $sent ? new WP_REST_Response(['ok' => true]) : new WP_Error('mail', 'We could not send your message. Please call or email us directly.', ['status' => 502]);
    }

    /**
     * Mint a signed link for a booking. Intended for Airtable automations (a "Send trip link" automation can
     * call this and store the URL in a field). Auth: X-Vision-Key header = the API key in Vision Trips settings.
     */
    public function mintLink(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $key = (string) $req->get_header('x-vision-key');
        $expected = (string) Settings::get('api_minting_key', '');
        if ($expected === '' || !hash_equals($expected, $key)) {
            return new WP_Error('forbidden', 'Invalid API key.', ['status' => 403]);
        }
        $base = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) $req->get_param('base'));
        $record = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) $req->get_param('record'));
        if (!preg_match('/^app[A-Za-z0-9]{14}$/', $base) || !preg_match('/^rec[A-Za-z0-9]{14}$/', $record)) {
            return new WP_Error('invalid', 'base must be an Airtable base id and record a record id.', ['status' => 422]);
        }
        $scope = (string) $req->get_param('scope') === 'agent' ? Token::SCOPE_AGENT : Token::SCOPE_CUSTOMER;
        $hours = (int) $req->get_param('expires_hours');
        if ($scope === Token::SCOPE_AGENT) {
            $hours = $hours > 0 ? min($hours, 24 * 30) : 24;
        }
        $expires = $hours > 0 ? time() + $hours * HOUR_IN_SECONDS : 0;
        $path = (string) preg_replace('#[^a-z/\-]#', '', strtolower((string) $req->get_param('path')));
        $token = Token::mint($base, $record, $scope, $expires);
        return new WP_REST_Response([
            'url'      => Token::url($token, $path),
            'token'    => $token,
            'scope'    => $scope === Token::SCOPE_AGENT ? 'agent' : 'customer',
            'expires'  => $expires ? gmdate('c', $expires) : null,
            'documents' => [
                'confirmation' => Token::url($token, 'documents/confirmation'),
                'invoice'      => Token::url($token, 'documents/invoice'),
                'atol'         => Token::url($token, 'documents/atol'),
                'letter'       => Token::url($token, 'documents/letter'),
                'print'        => Token::url($token, 'documents/print'),
            ],
        ]);
    }

    /** A fellow-traveller link: itinerary, documents and contact, nothing financial. Only a verified lead can mint one. */
    public function share(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $auth = Router::resolve((string) $req['token']);
        if (!$auth || !Settings::module('share')) {
            return new WP_Error('forbidden', 'Not available.', ['status' => 403]);
        }
        if ($auth['level'] < Access::LEVEL_KNOWLEDGE && !$auth['trip']->isQuote()) {
            return new WP_Error('verify', 'Please verify it\'s you first.', ['status' => 403]);
        }
        $trip = $auth['trip'];
        $url = Token::url(Token::mint($trip->base, $trip->id, Token::SCOPE_CUSTOMER, 0, false, true));
        Audit::question($trip, '', 'Shared a fellow-traveller link');
        return new WP_REST_Response(['ok' => true, 'url' => $url, 'text' => 'Here\'s our trip with ' . $trip->brand->name . ' — the itinerary, documents and who to call: ' . $url]);
    }

    /**
     * Vision automations send branded customer emails through here.
     *   POST /wp-json/vision/v1/notify  (X-Vision-Key)
     *   { base, record, template: balance_reminder|documents_issued|payment_received|welcome_home|quote_reminder|custom, to?, subject?, heading?, body? }
     */
    public function notify(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $key = (string) $req->get_header('x-vision-key');
        $expected = (string) Settings::get('api_minting_key', '');
        if ($expected === '' || !hash_equals($expected, $key)) {
            return new WP_Error('forbidden', 'Invalid API key.', ['status' => 403]);
        }
        $base = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) $req->get_param('base'));
        $record = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) $req->get_param('record'));
        $template = sanitize_key((string) $req->get_param('template'));
        $trip = (new BookingRepository(new Client()))->load($base, $record);
        if (!$trip) {
            return new WP_Error('notfound', 'Booking not found.', ['status' => 404]);
        }
        $to = (string) $req->get_param('to');
        $to = $to !== '' && is_email($to) ? $to : $trip->customerEmail;
        if ($to === '') {
            return new WP_Error('noemail', 'No customer email on the booking.', ['status' => 422]);
        }
        $brand = $trip->brand;
        $url = Token::urlFor($base, $record);
        $first = $trip->leadFirstName() ?: 'there';
        $esc = static fn (string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $facts = [['label' => 'Trip', 'value' => $trip->name], ['label' => 'Dates', 'value' => $trip->dateRange()]];
        switch ($template) {
            case 'balance_reminder':
                $subject = 'Your balance for ' . $trip->name;
                $heading = 'Hello ' . $first . ', your balance is due' . ($trip->balanceDueDate ? ' on ' . Dates::medium($trip->balanceDueDate) : ' soon');
                $body = '<p>Your remaining balance of <strong>' . $esc($trip->money($trip->balance)) . '</strong> is due' . ($trip->balanceDueDate ? ' by ' . $esc(Dates::long($trip->balanceDueDate)) : ' shortly') . '. You can pay online in full or in part, whenever suits you.</p>';
                $buttons = [['label' => 'Pay now', 'url' => $url . '#payments']];
                break;
            case 'documents_issued':
                $subject = 'Your travel documents are ready — ' . $trip->name;
                $heading = 'Your travel documents are ready';
                $body = '<p>Hello ' . $esc($first) . ', every part of your trip has been reconfirmed with the suppliers and your tickets and documents are now in your trip page. Keep the travel wallet handy — it has everything you need on the day, including who to call.</p>';
                $buttons = [['label' => 'View your documents', 'url' => $url . '#documents']];
                break;
            case 'payment_received':
                $subject = 'Thank you — payment received';
                $heading = 'Payment received, thank you';
                $body = '<p>Hello ' . $esc($first) . ', we have received your payment. ' . ($trip->balance > 0.009 ? 'Your remaining balance is <strong>' . $esc($trip->money($trip->balance)) . '</strong>' . ($trip->balanceDueDate ? ', due by ' . $esc(Dates::long($trip->balanceDueDate)) : '') . '.' : 'Your trip is now paid in full.') . ($trip->atolCertificateAvailable() ? ' Your ATOL Certificate is in your documents.' : '') . '</p>';
                $buttons = [['label' => 'View your trip', 'url' => $url]];
                if ($trip->atolCertificateAvailable()) {
                    $buttons[] = ['label' => 'ATOL Certificate', 'url' => Token::urlFor($base, $record, 'documents/atol/')];
                }
                break;
            case 'welcome_home':
                $subject = 'Welcome home from ' . $trip->name;
                $heading = 'Welcome home, ' . $first;
                $body = '<p>We hope it was everything you wanted. We would love to hear how it went — and whenever you are ready to start dreaming about the next one, we are here.</p>';
                $buttons = [['label' => 'Tell us how it went', 'url' => $url . '#home']];
                $review = $brand->googleReviews !== '' ? $brand->googleReviews : $brand->trustpilot;
                if ($review !== '') {
                    $buttons[] = ['label' => 'Leave a review', 'url' => $review];
                }
                break;
            case 'quote_reminder':
                $subject = 'Your quotation is waiting — ' . $trip->name;
                $heading = 'Still thinking it over, ' . $first . '?';
                $body = '<p>Your quotation for <strong>' . $esc($trip->name) . '</strong> is ready whenever you are' . ($trip->quoteExpiry ? ', and the price is held until <strong>' . $esc(Dates::long($trip->quoteExpiry)) . '</strong>' : '') . '. If anything needs changing, just reply to this email.</p>';
                $buttons = [['label' => 'View your quotation', 'url' => $url]];
                $facts[] = ['label' => 'Total', 'value' => $trip->money($trip->total)];
                break;
            case 'custom':
                $subject = sanitize_text_field((string) $req->get_param('subject')) ?: 'A message from ' . $brand->name;
                $heading = sanitize_text_field((string) $req->get_param('heading')) ?: $subject;
                $body = Str::richText((string) $req->get_param('body'));
                $buttons = [['label' => 'View your trip', 'url' => $url]];
                break;
            default:
                return new WP_Error('template', 'Unknown template.', ['status' => 400]);
        }
        $sent = \VisionTrips\Integrations\Email::send($brand, $to, $subject, $heading, $body, $buttons, $facts);
        if ($sent) {
            (new Client())->comment($base, \VisionTrips\Airtable\FieldMap::table('bookings'), $record, '📨 Email sent via Vision Trips — ' . $template . ' — to ' . $to . ' — ' . gmdate('D j M Y H:i') . ' UTC');
        }
        return $sent ? new WP_REST_Response(['ok' => true, 'to' => $to, 'template' => $template]) : new WP_Error('mail', 'Email could not be sent.', ['status' => 502]);
    }

    /** Engagement events from the page (sendBeacon). Token must resolve; no verification level needed beyond the page's own. */
    public function events(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $auth = Router::resolve((string) $req['token']);
        if (!$auth) {
            return new WP_Error('forbidden', 'Not available.', ['status' => 403]);
        }
        if (!RateLimit::hit('events|' . RateLimit::ip(), 120, 10 * MINUTE_IN_SECONDS)) {
            return new WP_Error('rate', 'Too many requests.', ['status' => 429]);
        }
        $body = json_decode((string) $req->get_body(), true);
        $events = is_array($body['events'] ?? null) ? $body['events'] : [];
        $device = preg_match('/iPhone|iPad|Android|Mobile/i', (string) ($_SERVER['HTTP_USER_AGENT'] ?? '')) ? 'mobile' : 'desktop';
        $n = \VisionTrips\Support\Events::record($auth['trip'], $events, $device);
        return new WP_REST_Response(['ok' => true, 'recorded' => $n]);
    }

    /** Admin feedback on a piece of AI copy: good | rewrite | never (+ optional note used on the rewrite). */
    public function aiFeedback(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        if (!wp_verify_nonce((string) $req->get_header('x-wp-nonce'), 'wp_rest')) {
            return new WP_Error('nonce', 'Invalid nonce.', ['status' => 403]);
        }
        $ref = (string) preg_replace('/[^a-f0-9]/', '', (string) $req->get_param('ref'));
        $verdict = (string) $req->get_param('verdict');
        $note = sanitize_textarea_field((string) $req->get_param('note'));
        if (strlen($ref) !== 32 || !in_array($verdict, ['good', 'rewrite', 'never'], true)) {
            return new WP_Error('invalid', 'Invalid feedback.', ['status' => 400]);
        }
        $log = get_option('vision_trips_ai_feedback', []);
        $log = is_array($log) ? $log : [];
        $log[] = ['t' => time(), 'ref' => $ref, 'verdict' => $verdict, 'note' => mb_substr($note, 0, 300), 'user' => get_current_user_id()];
        update_option('vision_trips_ai_feedback', array_slice($log, -500), false);
        if ($verdict === 'never') {
            \VisionTrips\Support\Cache::set('ai', $ref, ['blocked' => true], 365 * DAY_IN_SECONDS);
        } elseif ($verdict === 'rewrite') {
            \VisionTrips\Support\Cache::delete('ai', $ref);
            delete_transient('vtr_pending_' . md5($ref));
            if ($note !== '') {
                set_transient('vtr_ai_note_' . $ref, $note, 30 * DAY_IN_SECONDS);
            }
        }
        return new WP_REST_Response(['ok' => true, 'message' => $verdict === 'rewrite' ? 'Rewriting — refresh the page in a minute.' : ($verdict === 'never' ? 'Blocked: the page falls back to the next source.' : 'Thanks, noted.')]);
    }

    /** Signed loopback job runner (see Support\Jobs). */
    public function runJob(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $r = \VisionTrips\Support\Jobs::runSigned((string) $req->get_body(), (string) $req->get_header('x-vision-job'));
        // (one job per request; the runner hands over to the next itself)
        return $r['ok'] ? new WP_REST_Response(['ok' => true]) : new WP_Error('forbidden', $r['error'], ['status' => 403]);
    }

    public function purge(WP_REST_Request $req): WP_REST_Response|WP_Error
    {
        $key = (string) $req->get_header('x-vision-key');
        $expected = (string) Settings::get('api_minting_key', '');
        if ($expected === '' || !hash_equals($expected, $key)) {
            return new WP_Error('forbidden', 'Invalid API key.', ['status' => 403]);
        }
        $base = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) $req->get_param('base'));
        $record = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) $req->get_param('record'));
        if ($base !== '' && $record !== '') {
            (new BookingRepository(new Client()))->invalidate($base, $record);
            return new WP_REST_Response(['ok' => true, 'purged' => 'booking']);
        }
        \VisionTrips\Support\Cache::purgeAll();
        return new WP_REST_Response(['ok' => true, 'purged' => 'all']);
    }
}
