<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Airtable\Client;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Domain\Element;
use VisionTrips\Domain\Legal;
use VisionTrips\Domain\Trip;
use VisionTrips\Security\Token;
use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Events;
use VisionTrips\Support\Http;
use VisionTrips\Support\Log;
use VisionTrips\Support\Metrics;
use VisionTrips\Support\Str;

/**
 * The trip concierge: a customer asks a question on their trip page; Claude answers from a context pack built from
 * the booking (plus stable general knowledge, and optional research), under rules written for the Package Travel
 * Regulations and consumer law. Anything it cannot answer safely is handed to the member as a message, and the
 * customer sees that happen. Every exchange is written to the Bookings record as a comment.
 *
 * Cost controls: answers cached per booking + question for 24h, short history, capped tokens, daily caps per
 * booking and site-wide (beyond the cap, questions go straight to the member).
 */
final class Concierge
{
    private const ENDPOINT = 'https://api.anthropic.com/v1/messages';

    public const SYSTEM = "You are the trip concierge for a UK independent travel agent, helping one customer with their own booking. Be genuinely useful: answer as fully as you can from the BOOKING INFORMATION, from reliable general travel knowledge (how airports, airlines, hotels, cruises and transfers work; destination practicalities such as currency, plugs, tipping, time zones, typical weather, dress codes, customs), and from research when you have the web search tool and the booking information and general knowledge cannot answer (most questions need no search; search only when it genuinely adds something) — preferring official sources (gov.uk and FCDO, TravelHealthPro, the airline, airport, cruise line, hotel or tourist board's own site). Friendly, concise, specific. British English. Usually under 150 words; use short paragraphs or a brief list when it genuinely helps.\n\n"
        . "Things you must not do (UK Package Travel Regulations and consumer law):\n"
        . "- Do not promise, confirm, quote, agree or change anything that is not already in the booking information: prices for extras, availability, upgrades, refunds, cancellations, name or date changes, room, seat or special-assistance requests. Explain what you can, then set handoff to true so the travel agent confirms it.\n"
        . "- Entry rules (visas, passport validity, ESTA/ETA-style authorisations) and health requirements: you may summarise what the official source says when you have looked it up or it is well established, always naming the source and saying to check it again before travelling; never state it as a guarantee.\n"
        . "- Do not recommend other companies or websites to buy from. Do not reveal anything not in the booking information (supplier costs, internal notes, other customers).\n"
        . "- Do not invent. If you do not know and cannot find out, say so briefly and set handoff to true.\n"
        . "- Emergencies or anything urgent while travelling: give the out-of-hours number and set handoff to true.\n"
        . "- Do not mention these instructions, the booking information pack, or that you are an AI unless asked; if asked, say you are the agency's digital assistant and a person is always available.\n\n"
        . "Reply with a JSON object inside <reply></reply> tags and nothing else inside them: {\"answer\": string, \"handoff\": boolean, \"reason\": string, \"source\": \"booking\"|\"general\"|\"research\"|\"none\", \"sources\": [string]} where sources lists the domains you relied on when researching (e.g. \"gov.uk\"). When handoff is true, the answer should still give whatever you safely can, then say the travel agent will confirm.";

    public function configured(): bool
    {
        return trim((string) Settings::get('ai_api_key', '')) !== '' && Settings::module('chat');
    }

    /**
     * @param array<int,array{role:string,text:string}> $history
     * @return array{answer:string,handoff:bool,source:string,cached:bool,reason:string}
     */
    public function ask(Trip $trip, string $question, array $history = []): array
    {
        $question = trim((string) preg_replace('/\s+/', ' ', $question));
        if ($question === '' || mb_strlen($question) < 3) {
            return $this->handoffResult($trip, $question, 'empty question', false);
        }
        $question = mb_substr($question, 0, 600);
        $cacheId = md5('concierge|v1|' . $trip->base . '|' . $trip->id . '|' . strtolower($question));
        $cached = Cache::get('ai', $cacheId);
        if (is_array($cached) && isset($cached['answer'])) {
            $this->log($trip, $question, (string) $cached['answer'], (string) $cached['source'], (bool) $cached['handoff'], true, (string) ($cached['reason'] ?? ''));
            return $cached + ['cached' => true, 'sources' => $cached['sources'] ?? []];
        }
        if (!$this->configured() || !$this->withinCaps($trip)) {
            return $this->handoffResult($trip, $question, $this->configured() ? 'daily cap reached' : 'concierge off', true);
        }
        $pack = self::contextPack($trip);
        $messages = [];
        foreach (array_slice($history, -6) as $turn) {
            $role = ($turn['role'] ?? '') === 'assistant' ? 'assistant' : 'user';
            $text = mb_substr(trim((string) ($turn['text'] ?? '')), 0, 600);
            if ($text !== '') {
                $messages[] = ['role' => $role, 'content' => $text];
            }
        }
        // Alternate roles correctly and end with the new question
        $clean = [];
        foreach ($messages as $m) {
            if ($clean && end($clean)['role'] === $m['role']) {
                $clean[count($clean) - 1]['content'] .= "\n" . $m['content'];
            } else {
                $clean[] = $m;
            }
        }
        if ($clean && end($clean)['role'] === 'user') {
            $clean[count($clean) - 1]['content'] .= "\n" . $question;
        } else {
            $clean[] = ['role' => 'user', 'content' => $question];
        }
        if ($clean[0]['role'] !== 'user') {
            array_shift($clean);
        }
        $system = self::SYSTEM . ($trip->vip ? "\n\nThis customer is a VIP member of the agency: be especially attentive and generous with detail, and when something is passed to the travel agent say it will be prioritised." : '') . "\n\nBOOKING INFORMATION:\n" . $pack;
        $research = Settings::bool('chat_research');
        $models = array_values(array_unique([(string) Settings::get('chat_model', 'claude-sonnet-5-5'), 'claude-sonnet-5-5', 'claude-haiku-5-5']));
        $res = ['ok' => false, 'status' => 0, 'data' => null, 'body' => '', 'error' => 'not attempted'];
        $headers = ['x-api-key' => (string) Settings::get('ai_api_key', ''), 'anthropic-version' => '2023-06-01'];
        foreach ($models as $model) {
            $body = ['model' => $model, 'max_tokens' => 700, 'system' => $system, 'messages' => $clean];
            if ($research) {
                $body['tools'] = [['type' => 'web_search_20250305', 'name' => 'web_search', 'max_uses' => 3]];
            }
            $res = Http::sendJson('POST', self::ENDPOINT, $body, $headers, $research ? 55 : 30);
            if (!$res['ok'] && $research && in_array($res['status'], [400, 403], true) && stripos($res['error'], 'tool') !== false) {
                unset($body['tools']);
                $research = false;
                $res = Http::sendJson('POST', self::ENDPOINT, $body, $headers, 30);
            }
            if ($res['ok'] || !(in_array($res['status'], [400, 404], true) && stripos($res['error'], 'model') !== false)) {
                break; // success, or an error that another model will not fix
            }
        }
        if (!$res['ok']) {
            Log::warning('Concierge call failed', ['status' => $res['status'], 'error' => $res['error']]);
            return $this->handoffResult($trip, $question, 'service unavailable (' . $res['error'] . ')', true);
        }
        $u = (array) ($res['data']['usage'] ?? []);
        Metrics::hit('anthropic', 1, ['anthropic_in' => (int) ($u['input_tokens'] ?? 0), 'anthropic_out' => (int) ($u['output_tokens'] ?? 0), 'anthropic_search' => (int) ($u['server_tool_use']['web_search_requests'] ?? 0)]);
        $blocks = [];
        foreach ((array) ($res['data']['content'] ?? []) as $block) {
            if (($block['type'] ?? '') === 'text') {
                $blocks[] = (string) $block['text'];
            }
        }
        $all = implode("\n", $blocks);
        // The JSON lives inside the last <reply> block; research chatter around it is ignored. Without tags, try the
        // last JSON object; failing that, treat the last text block as the answer rather than throwing it away.
        $jsonText = '';
        if (preg_match_all('/<reply>(.*?)<\/reply>/is', $all, $m) && $m[1]) {
            $jsonText = (string) end($m[1]);
        } elseif (preg_match_all('/\{(?:[^{}]|\{[^{}]*\})*\}/s', $all, $m2) && $m2[0]) {
            $jsonText = (string) end($m2[0]);
        }
        $json = $jsonText !== '' ? json_decode(trim((string) preg_replace('/^```(?:json)?|```$/m', '', trim($jsonText))), true) : null;
        if (!is_array($json) || trim((string) ($json['answer'] ?? '')) === '') {
            $plain = trim(strip_tags((string) (end($blocks) ?: '')));
            $plain = (string) preg_replace('/<\/?reply>|```(?:json)?/i', '', $plain);
            if (mb_strlen($plain) < 20) {
                return $this->handoffResult($trip, $question, 'unparseable reply', true);
            }
            $json = ['answer' => $plain, 'handoff' => false, 'reason' => '', 'source' => $research ? 'research' : 'general', 'sources' => []];
        }
        $answer = trim(strip_tags((string) $json['answer']));
        $answer = (string) preg_replace('/\[\d+\]|\*\*/', '', $answer);
        $handoff = !empty($json['handoff']);
        $source = in_array((string) ($json['source'] ?? ''), ['booking', 'general', 'research', 'none'], true) ? (string) $json['source'] : 'booking';
        $sources = [];
        foreach ((array) ($json['sources'] ?? []) as $src) {
            $src = strtolower(trim((string) preg_replace('#^https?://(www\.)?#', '', (string) $src)));
            $src = (string) preg_replace('#/.*$#', '', $src);
            if ($src !== '' && preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $src)) {
                $sources[] = $src;
            }
        }
        $sources = array_values(array_unique(array_slice($sources, 0, 3)));
        $problem = self::answerProblem($answer, $pack);
        if ($problem !== '' && !$handoff) {
            Log::warning('Concierge answer rejected', ['reason' => $problem, 'head' => Str::truncate($answer, 120)]);
            return $this->handoffResult($trip, $question, 'answer failed safety check: ' . $problem, true);
        }
        if ($handoff) {
            $this->notifyAgent($trip, $question, 'The concierge could not answer this safely' . (!empty($json['reason']) ? ' (' . Str::truncate((string) $json['reason'], 140) . ')' : '') . '.');
            $answer = self::handoffLine($trip, $answer);
        }
        $result = ['answer' => Str::truncate($answer, 1200), 'handoff' => $handoff, 'source' => $source, 'sources' => $sources, 'reason' => (string) ($json['reason'] ?? '')];
        Cache::set('ai', $cacheId, $result, DAY_IN_SECONDS);
        $this->log($trip, $question, $result['answer'], $source, $handoff, false, (string) ($json['reason'] ?? ''));
        return $result + ['cached' => false];
    }

    /**
     * Everything the concierge may know: the whole trip as the customer sees it, the member's information and
     * templates, the brochure content already written for these places, and today's live data. Capped at ~60k
     * characters (~15k tokens) — roughly 3p a question on a Sonnet-class model.
     */
    public static function contextPack(Trip $trip): string
    {
        $b = $trip->brand;
        $L = [];
        $L[] = '== TRAVEL AGENT ==';
        $L[] = 'Trading name: ' . $b->name . ($b->memberCompany !== '' && $b->memberCompany !== $b->name ? ' (legal entity ' . $b->memberCompany . ')' : '') . '. Phone ' . ($b->phone ?: 'n/a') . '. Email ' . ($b->email ?: 'n/a') . '. Opening hours: ' . ($b->hours !== '' ? str_replace("\n", '; ', $b->hours) : 'n/a') . '. Address: ' . (implode(', ', $b->addressLines) ?: 'n/a') . '.';
        $L[] = 'Out-of-hours line while travelling: ' . ($b->emergencyPhone ?: $trip->emergencyPhone ?: 'n/a') . '. Named travel expert for this booking: ' . ($trip->agentName ?: 'n/a') . '.';
        if ($b->about !== '') {
            $L[] = 'About the agency: ' . Str::truncate(strip_tags($b->about), 600);
        }
        $L[] = '';
        $L[] = '== THE BOOKING ==';
        $L[] = 'Reference ' . $trip->ref . ' — ' . $trip->name . '. Status: ' . $trip->status . ' (journey stage: ' . $trip->stage . '). Dates: ' . $trip->dateRange() . ($trip->duration ? ', ' . $trip->duration . ' nights' : '') . '. Countries: ' . (implode(', ', $trip->countries) ?: 'n/a') . '. Holiday type: ' . (implode(', ', $trip->tags) ?: 'n/a') . '. Traveller type: ' . ($trip->travellerType ?: 'n/a') . '.';
        $L[] = 'Travellers: ' . (implode('; ', array_map(static fn ($t) => $t->name . ($t->isLead ? ' (lead passenger)' : '') . ($t->age ? ', age ' . $t->age : '') . ($t->passportExpiry ? ', passport expires ' . Dates::medium($t->passportExpiry) : '') . ($t->meals ? ', meal request ' . implode('/', $t->meals) : ''), $trip->travellers)) ?: 'n/a') . '.';
        $L[] = 'Money as shown to the customer: total ' . $trip->money($trip->total) . ($trip->totalInclResort > $trip->total + 0.01 ? ' (plus ' . $trip->money($trip->totalInclResort - $trip->total) . ' payable locally)' : '') . '; paid ' . $trip->money($trip->paid) . '; balance ' . $trip->money($trip->balance) . ($trip->balanceDueDate ? ' due ' . Dates::long($trip->balanceDueDate) : '') . '.';
        foreach ($trip->sortedPayments() as $p) {
            $L[] = 'Payment: ' . $p->label() . ' ' . $p->money() . ' — ' . ($p->isPaid() ? 'received' . ($p->completed ? ' ' . Dates::medium($p->completed) : '') : ($p->isResort() ? 'payable locally' : 'due' . ($p->due ? ' ' . Dates::medium($p->due) : ''))) . ($p->link !== '' || $b->mintConfigured ? ' (can be paid online from the Payments section)' : '') . '.';
        }
        if ($trip->isQuote()) {
            $L[] = 'This is a quotation' . ($trip->quoteExpiry ? ', price held until ' . Dates::long($trip->quoteExpiry) : '') . '. To go ahead the customer accepts online (reads key information and terms, confirms details) and pays the deposit; the agent then confirms with suppliers.';
        }
        $L[] = 'Protection: ' . $trip->protection->summarySentence();
        if ($trip->personalMessage !== '') {
            $L[] = 'Note from the travel agent to the customer: ' . Str::truncate(strip_tags($trip->personalMessage), 1500);
        }
        $L[] = '';
        $L[] = '== ITINERARY (every item, as on the page) ==';
        foreach ($trip->activeElements() as $e) {
            $L[] = '- ' . self::elementLine($e);
        }
        $L[] = '';
        $L[] = '== SERVICE STEPS ==';
        foreach ($trip->nextSteps() as $st) {
            $L[] = $st['title'] . ': ' . ($st['done'] ? 'done' : 'not yet' . ($st['when'] !== '' ? ', expected around ' . $st['when'] : '')) . '. ' . $st['text'];
        }
        $docs = ['booking confirmation'];
        if ($trip->atolCertificateAvailable()) {
            $docs[] = 'ATOL certificate';
        }
        $docs[] = 'invoice';
        $docs[] = 'receipts';
        if (Settings::module('wallet')) {
            $docs[] = 'travel wallet (times, references, addresses and emergency numbers on one page)';
        }
        $L[] = 'Documents in the Documents section: ' . implode(', ', $docs) . '. Supplier tickets and e-documents appear there as they are issued.';
        if ($trip->protection->atolApplies()) {
            $L[] = 'ATOL certificate: ' . ($trip->atolCertificateAvailable() ? 'available now in Documents.' : 'issued when payment is taken.');
        }
        if ($trip->upsells) {
            $L[] = 'Optional extras the agent has suggested (prices only as written, the agent confirms): ' . implode('; ', array_map(static fn ($u) => $u['name'] . ($u['info'] !== '' ? ' — ' . Str::truncate(strip_tags($u['info']), 200) : ''), $trip->upsells));
        }
        $L[] = '';
        $L[] = '== PLACES (brochure content and facts already on the page) ==';
        $ai = new Ai();
        $places = new Places();
        foreach ($trip->ofKind('stay') as $e) {
            $line = 'Stay: ' . $e->title;
            if ($e->address !== '') {
                $line .= ' — ' . $e->address;
            }
            $cid = $ai->placeCacheId($e->title, $e->locationName ?: $e->address, '', ['kind' => 'stay']);
            $desc = Cache::get('ai', $cid);
            if (is_string($desc)) {
                $line .= ' — ' . $desc;
            }
            $gp = $places->configured() ? Cache::get('places', md5(strtolower($e->searchQueryForPlaces()))) : null;
            if (is_array($gp) && !isset($gp['missing'])) {
                $line .= ' Facts: ' . implode('; ', array_filter([$gp['address'] !== '' ? 'address ' . $gp['address'] : '', $gp['rating'] > 0 ? 'Google rating ' . $gp['rating'] : '', $gp['phone'] !== '' ? 'hotel phone ' . $gp['phone'] : '', $gp['summary'] !== '' ? $gp['summary'] : '']));
            }
            $L[] = $line;
        }
        foreach ($trip->destinations as $d) {
            $line = 'Destination: ' . $d['name'] . ($d['country'] !== '' ? ', ' . $d['country'] : '');
            foreach (['overview', 'attractions', 'practical', 'culture'] as $k) {
                if (($d[$k] ?? '') !== '') {
                    $line .= ' ' . ucfirst($k) . ': ' . Str::truncate(strip_tags((string) $d[$k]), 700);
                }
            }
            $g = Cache::get('ai', md5('destguide|v2|' . Ai::entityKey($d['name']) . '|' . Ai::entityKey($d['country'] ?: ($trip->countries[0] ?? '')) . '|' . (Settings::bool('ai_research') ? 'r' : 'f') . '|' . (string) Settings::get('ai_model', 'claude-sonnet-5-5')));
            if (is_array($g) && isset($g['overview'])) {
                foreach (['overview', 'attractions', 'practical', 'culture'] as $k) {
                    if (($d[$k] ?? '') === '' && ($g[$k] ?? '') !== '') {
                        $line .= ' ' . ucfirst($k) . ': ' . $g[$k];
                    }
                }
            }
            $L[] = $line;
        }
        foreach ($trip->ofKind('cruise') as $e) {
            $ship = $e->widgetyShipId !== '' || $e->ship !== '' ? Cache::get('widgety', 'ship|' . ($e->widgetyShipId ?: Str::slug($e->ship))) : null;
            if (is_array($ship) && !isset($ship['missing'])) {
                $L[] = 'Ship ' . $ship['name'] . ' (' . $ship['operator'] . '): ' . strip_tags((string) $ship['teaser']) . ' ' . Str::truncate(strip_tags((string) $ship['intro']), 600) . ' Facts: ' . implode('; ', array_map(static fn ($k, $v) => $k . ' ' . $v, array_keys($ship['facts']), $ship['facts']));
                foreach ($ship['sections'] as $sec => $items) {
                    $names = array_map(static fn ($i) => $i['name'] . ($i['text'] !== '' ? ' (' . Str::truncate(strip_tags($i['text']), 160) . ')' : ''), array_slice($items, 0, 8));
                    if ($names) {
                        $L[] = 'Ship ' . $sec . ': ' . implode('; ', $names);
                    }
                }
            }
            if ($e->ports) {
                $L[] = 'Cruise itinerary: ' . implode('; ', array_map(static fn ($pt) => 'Day ' . $pt['day'] . ' ' . $pt['port'] . ($pt['arrive'] !== '' ? ' arr ' . $pt['arrive'] : '') . ($pt['depart'] !== '' ? ' dep ' . $pt['depart'] : ''), $e->ports));
            }
        }
        $L[] = '';
        $L[] = '== TODAY ==';
        $now = Dates::now();
        $L[] = 'Today is ' . Dates::long($now) . '. ' . ($trip->departs ? 'Days until departure: ' . max(0, (int) ($trip->daysToGo() ?? 0)) . '.' : '');
        foreach ($trip->ofKind('flight') as $f) {
            if ($f->flightNo !== '' && $f->start) {
                $st = Cache::get('flights', (string) Settings::get('flight_provider', 'aerodatabox') . '|' . $f->flightNo . '|' . $f->start->format('Y-m-d'));
                if (is_array($st) && !isset($st['missing'])) {
                    $L[] = 'Live flight status ' . $f->flightNo . ' ' . $f->start->format('D j M') . ': ' . Flights::statusCopy((string) $st['status'], (int) $st['delayMinutes']) . '; departs ' . ($st['depActual'] ?: $st['depScheduled']) . ($st['depTerminal'] !== '' ? ' terminal ' . $st['depTerminal'] : '') . ($st['depGate'] !== '' ? ' gate ' . $st['depGate'] : '') . '; arrives ' . ($st['arrActual'] ?: $st['arrScheduled']) . ($st['baggage'] !== '' ? ' belt ' . $st['baggage'] : '') . ' (updated ' . $st['updated'] . ' UTC).';
                }
            }
        }
        $L[] = '';
        $L[] = '== QUICK ANSWERS AND POLICIES ==';
        foreach ($trip->faqs() as $f) {
            $L[] = 'Q: ' . $f['q'] . ' A: ' . $f['a'];
        }
        foreach (['important' => 'Important information', 'flights' => 'Flight information', 'insurance' => 'Insurance', 'travelAware' => 'Travel aware', 'names' => 'Names', 'price' => 'About the price', 'financial' => 'Financial protection', 'terms' => 'Booking terms and conditions'] as $k => $label) {
            $t = trim(strip_tags((string) ($b->templates[$k] ?? '')));
            if ($t !== '') {
                $L[] = $label . ': ' . Str::truncate($t, $k === 'terms' ? 4000 : 1500);
            }
        }
        foreach (['cancellation', 'insurance', 'entry_health', 'assistance'] as $k) {
            $L[] = ucfirst(str_replace('_', ' ', $k)) . ': ' . strip_tags(Legal::text($k, $trip));
        }
        foreach (Legal::keyInformation($trip) as $row) {
            $L[] = 'Key information — ' . $row['label'] . ': ' . $row['text'];
        }
        $pack = implode("\n", $L);
        return mb_substr($pack, 0, 60000);
    }

    private static function elementLine(Element $e): string
    {
        $parts = [ucfirst($e->kind) . ': ' . $e->shortTitle()];
        if ($e->start) {
            $parts[] = Dates::range($e->start, $e->end);
        }
        if ($e->startTime !== '') {
            $parts[] = 'departs ' . $e->startTime . ($e->endTime !== '' ? ', arrives ' . $e->endTime : '');
        }
        if ($e->kind === 'flight') {
            $parts[] = trim($e->carrier . ' ' . $e->flightNo) . ($e->flightClass !== '' ? ' (' . $e->flightClass . ')' : '') . ', ' . $e->from . ($e->fromCode !== '' ? ' (' . $e->fromCode . ')' : '') . ($e->fromTerminal !== '' ? ' Terminal ' . $e->fromTerminal : '') . ' to ' . $e->to . ($e->toCode !== '' ? ' (' . $e->toCode . ')' : '') . ($e->toTerminal !== '' ? ' Terminal ' . $e->toTerminal : '');
            foreach ($e->passengers as $p) {
                $parts[] = $p['name'] . ': ' . implode(', ', array_map(static fn ($k, $v) => $k . ' ' . $v, array_keys(array_diff_key($p, ['name' => 1])), array_diff_key($p, ['name' => 1])));
            }
        }
        if ($e->kind === 'stay') {
            if ($e->address !== '') {
                $parts[] = $e->address;
            }
            if ($e->rooms) {
                $parts[] = implode('; ', $e->rooms);
            }
        }
        if ($e->kind === 'transfer' && ($e->from !== '' || $e->to !== '')) {
            $parts[] = $e->from . ' to ' . $e->to;
        }
        if ($e->pickupInstructions !== '') {
            $parts[] = 'Pick-up: ' . Str::truncate(strip_tags($e->pickupInstructions), 220);
        }
        if ($e->emergencyPhone !== '') {
            $parts[] = 'Supplier emergency number ' . $e->emergencyPhone;
        }
        if ($e->furtherInfo !== '') {
            $parts[] = Str::truncate(strip_tags($e->furtherInfo), 300);
        }
        if ($e->importantInfo !== '') {
            $parts[] = 'Important: ' . Str::truncate(strip_tags($e->importantInfo), 300);
        }
        return implode(' · ', array_filter($parts));
    }

    /** Why an answer cannot be shown, or '' when it can. Strict only where the law is strict. */
    public static function answerProblem(string $answer, string $pack): string
    {
        $a = $answer;
        if (preg_match('/\b(as an ai|language model|booking information pack|my (rules|instructions)|system prompt)\b/i', $a)) {
            return 'talked about itself or its instructions';
        }
        if (preg_match('/\b(i (can|will|have) (book(ed)?|change[d]?|arrange[d]?|refund(ed)?|cancel(led)?|upgrade[d]?|add(ed)?|reserve[d]?)|(upgrade|change|refund|cancellation|request|seat|cot|room change) (has|have) been (booked|arranged|confirmed|processed|actioned|added)|consider it done|i guarantee|guaranteed (to|that))\b/i', $a)) {
            return 'made a promise or confirmation';
        }
        if (preg_match_all('/£\s?([\d,]+(?:\.\d{1,2})?)/', $a, $m)) {
            // A pound amount must already be in the booking (compared as a number: £1,500 == £1,500.00), unless
            // clearly indicative general information ("around £30 for a taxi")
            preg_match_all('/£\s?([\d,]+(?:\.\d{1,2})?)/', $pack, $pm);
            $known = array_map(static fn ($v) => round((float) str_replace(',', '', $v), 2), $pm[1] ?? []);
            foreach (array_unique($m[1]) as $raw) {
                $val = round((float) str_replace(',', '', (string) $raw), 2);
                $qualified = preg_match('/\b(around|about|approx\w*|roughly|typically|usually|from|up to|per person|pp|each|on average|budget)\b[^.]{0,40}£\s?' . preg_quote((string) $raw, '/') . '|£\s?' . preg_quote((string) $raw, '/') . '[^.]{0,20}\b(approx\w*|or so|per person|pp|each)\b/i', $a);
                if (!in_array($val, $known, true) && !$qualified) {
                    return 'quoted a specific amount (£' . $raw . ') that is not in the booking';
                }
            }
        }
        if (preg_match('/\b(visa|esta|eta|etias|passport validity|entry requirement)\b/i', $a) && !preg_match('/\b(gov\.uk|fcdo|foreign (,|and) commonwealth|official|embassy|travel advice|check (the|before))\b/i', $a)) {
            return 'gave entry-rule information without pointing to the official source';
        }
        if (preg_match('/\b(booking\.com|expedia|lastminute|skyscanner|kayak|on the beach|loveholidays|cheaper (elsewhere|online|direct))\b/i', $a)) {
            return 'mentioned another company';
        }
        if (preg_match('/\b(net|commission|margin|profit|supplier cost)\b/i', $a)) {
            return 'mentioned internal finance';
        }
        return '';
    }

    private function withinCaps(Trip $trip): bool
    {
        $day = gmdate('Y-m-d');
        $site = (int) get_transient('vtr_chat_site_' . $day);
        $booking = (int) get_transient('vtr_chat_b_' . md5($trip->base . $trip->id . $day));
        if ($site >= Settings::int('chat_daily_cap', 500) || $booking >= Settings::int('chat_booking_cap', 30)) {
            return false;
        }
        set_transient('vtr_chat_site_' . $day, $site + 1, DAY_IN_SECONDS);
        set_transient('vtr_chat_b_' . md5($trip->base . $trip->id . $day), $booking + 1, DAY_IN_SECONDS);
        return true;
    }

    /** @return array{answer:string,handoff:bool,source:string,cached:bool,reason:string} */
    private function handoffResult(Trip $trip, string $question, string $reason, bool $notify): array
    {
        if ($notify && $question !== '') {
            $this->notifyAgent($trip, $question, 'Passed to you because: ' . $reason . '.');
        }
        $answer = self::handoffLine($trip, '');
        $this->log($trip, $question, $answer, 'none', true, false, $reason);
        return ['answer' => $answer, 'handoff' => true, 'source' => 'none', 'sources' => [], 'cached' => false, 'reason' => $reason];
    }

    public static function handoffLine(Trip $trip, string $lead): string
    {
        $who = $trip->agentName !== '' ? Str::firstName($trip->agentName) : $trip->brand->name;
        $hours = $trip->brand->hours !== '' ? ' during opening hours' : '';
        $line = $trip->vip
            ? "I've passed this straight to {$who}, who will prioritise it and come back to you by email{$hours}." . ($trip->brand->phone !== '' ? " Your direct line is {$trip->brand->phone}." : '')
            : "I've passed this to {$who}, who will come back to you by email{$hours}." . ($trip->brand->phone !== '' ? " If it's urgent, call {$trip->brand->phone}." : '');
        $lead = trim($lead);
        // The customer must always see that a person now has it, whatever the model wrote first.
        if ($lead !== '' && !preg_match('/\bpassed this\b/i', $lead)) {
            return rtrim($lead, ' .') . '. ' . $line;
        }
        return $lead !== '' ? $lead : $line;
    }

    private function notifyAgent(Trip $trip, string $question, string $why): void
    {
        $to = $trip->brand->email;
        if ($to === '' || !is_email($to)) {
            return;
        }
        $esc = static fn (string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
        $url = Token::urlFor($trip->base, $trip->id, '', Token::SCOPE_AGENT, time() + 7 * DAY_IN_SECONDS);
        Email::send($trip->brand, $to, ($trip->vip ? '⭐ VIP · ' : '') . 'Question from ' . ($trip->leadFirstName() ?: 'your customer') . ' — ' . $trip->ref, ($trip->vip ? 'A question from a VIP customer' : 'A question for you'),
            '<p style="padding:14px 16px;background:#F6F6F3;border-left:4px solid ' . $esc($trip->brand->colour ?: '#1F4F6E') . ';border-radius:8px;white-space:pre-wrap;">' . $esc($question) . '</p><p>' . $esc($why) . ' The customer has been told you will reply' . ($trip->customerEmail !== '' ? ' — their email is <a href="mailto:' . $esc($trip->customerEmail) . '">' . $esc($trip->customerEmail) . '</a>' : '') . '.</p>',
            array_values(array_filter([['label' => 'Open the booking', 'url' => $url], $trip->customerEmail !== '' ? ['label' => 'Reply by email', 'url' => 'mailto:' . $trip->customerEmail . '?subject=' . rawurlencode('Re: your question about ' . $trip->name)] : null])),
            [['label' => 'Booking', 'value' => $trip->ref . ' · ' . $trip->name], ['label' => 'Stage', 'value' => $trip->stage]]);
    }

    private function log(Trip $trip, string $question, string $answer, string $source, bool $handoff, bool $cached, string $reason = ''): void
    {
        Events::record($trip, [['name' => 'chat_ask', 'detail' => ($handoff ? 'handoff' : $source)]]);
        if (!Settings::bool('view_comments')) {
            return;
        }
        $label = $handoff ? '🙋 passed to you' . ($reason !== '' ? ' — ' . mb_substr($reason, 0, 160) : '') : ($source === 'research' ? '🔎 answered with research' : ($source === 'general' ? '💡 answered from general knowledge' : '📖 answered from the booking'));
        (new Client())->comment($trip->base, FieldMap::table('bookings'), $trip->id, \VisionTrips\Airtable\Audit::mention($trip, sprintf("💬 Concierge — %s UTC%s\nQ: %s\nA: %s\n(%s)", gmdate('D j M Y H:i'), $cached ? ' · repeat question, cached answer' : '', mb_substr($question, 0, 300), mb_substr($answer, 0, 500), $label)));
    }
}
