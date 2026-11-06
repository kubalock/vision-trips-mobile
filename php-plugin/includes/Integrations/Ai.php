<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Http;
use VisionTrips\Support\Log;
use VisionTrips\Support\Str;

/**
 * AI copy (Anthropic Messages API). Used for short, factual descriptions of hotels and destinations when
 * Vision has none. Every call is grounded in facts we pass in (Google Places data), cached for 30 days,
 * and the output is sanitised before display. Nothing customer-specific is ever sent.
 */
final class Ai
{
    private const ENDPOINT = 'https://api.anthropic.com/v1/messages';
    /** Tried in order after the configured model, so a retired model id never silently switches AI off. */
    private const FALLBACK_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-sonnet-4-6'];
    public static string $lastError = '';
    /** Cache id of the last piece of copy asked for (for admin feedback buttons). */
    public static string $lastCacheId = '';

    /** An editor's note left by an admin ("Rewrite") that the next generation must honour. */
    private static function editorNote(string $cacheId): string
    {
        $n = get_transient('vtr_ai_note_' . $cacheId);
        return is_string($n) && $n !== '' ? ' Editor\'s note from the travel agent, which you must follow: ' . $n : '';
    }

    private string $key;
    private string $model;

    public function __construct()
    {
        $this->key = trim((string) Settings::get('ai_api_key', ''));
        $this->model = trim((string) Settings::get('ai_model', 'claude-sonnet-5-5')) ?: 'claude-sonnet-5-5';
    }

    public function configured(): bool
    {
        return $this->key !== '' && Settings::get('ai_provider', 'anthropic') === 'anthropic' && Settings::bool('ai_descriptions');
    }

    /**
     * Generic, all-passenger guidance about an airline or a UK airport. Cached for 60 days per subject.
     * The prompt insists on general, stable facts and tells the reader to confirm specifics with the airline/airport.
     * @return array<int,array{title:string,text:string}>
     */
    public function guide(string $kind, string $name, string $code = ''): array
    {
        if (!$this->configured() || !Settings::bool('ai_travel_notes') || $name === '') {
            return [];
        }
        $cacheId = md5('guide|' . $kind . '|' . strtolower($name) . '|' . strtolower($code) . '|' . $this->model);
        $cached = Cache::get('ai', $cacheId);
        if (is_array($cached) && !isset($cached['failed']) && $cached !== []) {
            return $cached;
        }
        $subject = $kind === 'airport' ? "{$name} airport" . ($code !== '' ? " ({$code})" : '') : "the airline {$name}" . ($code !== '' ? " ({$code})" : '');
        $sections = $kind === 'airport'
            ? 'Getting there; Terminals and check-in; Security and what to expect; Lounges, food and shops; Arrivals and onward travel'
            : 'Check-in and boarding passes; Baggage (how allowances usually work, and where to confirm them); Seats, meals and extras; On board; If something changes';
        $prompt = "Write a short, practical traveller guide to {$subject} for UK holidaymakers who booked this trip through an independent travel agent, as 4–5 titled sections ({$sections}). "
            . "The travel agent is the customer's point of contact and arranges everything for them: never tell the reader to buy or book seats, bags, meals, upgrades, lounges, parking, transfers or insurance directly with the airline, airport or any website; where those come up, say their travel agent can arrange them. "
            . "The airline's app or website should be mentioned only for online check-in, boarding passes and live flight status. Do not mention loyalty programmes, airline offers or other airlines. "
            . "Only include general, long-standing facts that apply to every passenger. Do not state prices, exact baggage weights, opening hours, gate numbers or anything that changes often; instead say where to check (the airline app, booking confirmation, airport website). "
            . "If you are not confident a detail is accurate, leave it out. British English, plain language, no marketing tone, no exclamation marks. "
            . "Return JSON only: an array of objects with \"title\" and \"text\" (text 40–70 words each).";
        $prompt .= self::editorNote($cacheId) . "\n\nReply with the JSON array inside <copy></copy> and nothing else.";
        $res = $this->complete($prompt, 900, 40, false, self::GUIDE_SYSTEM);
        if (!$res['ok']) {
            Log::warning('AI guide failed', ['status' => $res['status'], 'error' => $res['error'], 'kind' => $kind]);
            return [];
        }
        $text = '';
        foreach ((array) ($res['data']['content'] ?? []) as $block) {
            if (($block['type'] ?? '') === 'text') {
                $text .= (string) $block['text'];
            }
        }
        $text = self::extractCopy($res['data']) ?: $text;
        $out = self::parseSections($text);
        foreach ($out as $i => $sec) {
            $p = self::guideProblem($sec['text']);
            if ($p !== '') {
                Log::warning('AI guide section rejected', ['kind' => $kind, 'name' => $name, 'title' => $sec['title'], 'reason' => $p]);
                unset($out[$i]);
            }
        }
        $out = array_values($out);
        if (!$out) {
            self::$lastError = 'reply could not be parsed: ' . Str::truncate(trim(strip_tags($text)), 120);
            Log::warning('AI guide: unparseable reply', ['kind' => $kind, 'name' => $name, 'head' => Str::truncate($text, 160)]);
            return [];
        }
        Cache::set('ai', $cacheId, $out, 90 * DAY_IN_SECONDS);
        return $out;
    }

    /**
     * Research-then-write description of a hotel, destination or ship.
     *
     * Step 1 (when "research" is on): the model uses Anthropic's web search tool to look at the official site and
     * reputable recent coverage. Step 2: it writes 80–120 words to make the customer look forward to this specific
     * stay — tailored to who is travelling, when, the room booked and the brand's tone — under strict consumer-law
     * guardrails: nothing it did not find, no superlatives it cannot support, no prices, no guarantees, no advice.
     *
     * @param array<string,mixed> $facts   verified facts (Google Places, Vision, Widgety)
     * @param array<string,mixed> $context trip context: kind, dates, travellerType, tags, room, board, agentNotes
     */
    public function placeDescription(string $name, string $location, array $facts, string $tone = 'broad', array $context = []): string
    {
        if (!$this->configured() || $name === '') {
            return '';
        }
        $kind = (string) ($context['kind'] ?? 'place');
        $research = Settings::bool('ai_research');
        $cacheId = $this->placeCacheId($name, $location, $tone, $context);
        $cached = Cache::get('ai', $cacheId);
        if (is_string($cached)) {
            return $cached;
        }
        // Brochure copy is written once per place and reused on every booking, for every member: no tone, room,
        // dates or traveller details go into the prompt or the cache key. (Tone and context are still accepted so
        // callers need not change; they only shape what is NOT included.)
        $register = 'warm, confident and specific — a printed holiday brochure';
        $audience = 'customers who have chosen it';
        $lines = [];
        foreach ($facts as $k => $v) {
            if ($v === '' || $v === null || $v === []) {
                continue;
            }
            $lines[] = '- ' . $k . ': ' . (is_array($v) ? implode('; ', array_map('strval', $v)) : (string) $v);
        }
        $ctxLines = []; // deliberately empty: nothing booking-specific, so the copy is reusable
        $subject = match ($kind) {
            'destination' => "the destination \"{$name}\"" . ($location !== '' ? " ({$location})" : ''),
            'ship' => "the cruise ship \"{$name}\"",
            default => "the hotel \"{$name}\"" . ($location !== '' ? " in {$location}" : ''),
        };
        $prompt = ($research
            ? "Research {$subject} with web search (the official website plus one or two reputable travel sources, at most 3 searches), then write "
            : "Using only the facts below, write ")
            . "the brochure description of {$subject} for {$audience}. Tone: {$register}. Length: 80–120 words in one or two paragraphs. Do not invent inclusions.\n\n"
            . "Facts:\n" . ($lines ? implode("\n", $lines) : "- Name: {$name}") . "\n"
            . ($ctxLines ? "\nTrip context:\n" . implode("\n", $ctxLines) . "\n" : '')
            . "\nReply with the finished copy inside <copy></copy> and nothing else.";
        $prompt .= self::editorNote($cacheId);
        $text = '';
        for ($attempt = 1; $attempt <= 2; $attempt++) {
            $res = $this->complete($prompt, 1200, $research && $attempt === 1 ? 75 : 30, $research && $attempt === 1, self::BROCHURE_SYSTEM);
            if (!$res['ok']) {
                Log::warning('AI description failed', ['status' => $res['status'], 'error' => $res['error'], 'subject' => $name]);
                return '';
            }
            $text = self::extractCopy($res['data']);
            $why = self::brochureProblem($text);
            if ($why === '') {
                break;
            }
            Log::warning('AI description rejected by the brochure check', ['subject' => $name, 'attempt' => $attempt, 'reason' => $why, 'head' => Str::truncate($text, 120)]);
            self::$lastError = 'rejected: ' . $why;
            $text = '';
            $prompt .= "\n\nYour previous reply was rejected because it " . $why . ". Reply again with only the finished brochure copy inside <copy></copy>.";
        }
        if ($text === '') {
            return '';
        }
        if (mb_strlen($text) > 900) {
            $text = Str::truncate($text, 900);
        }
        if (mb_strlen($text) < 40) {
            return '';
        }
        Cache::set('ai', $cacheId, $text, 90 * DAY_IN_SECONDS); // brochure copy: reused by every booking for three months
        return $text;
    }

    /**
     * One completion with model fallback. A 404/400 "model" error moves to the next model; anything else returns as is.
     * @return array{ok:bool,status:int,data:mixed,body:string,error:string}
     */
    /**
     * The brochure writer. Every customer-facing generation runs under this: the copy is for a holiday brochure,
     * nothing else may appear, and the final copy is returned inside <copy> tags so working notes are never shown.
     */
    /** Practical traveller guides (airline, airport): the agent's voice, no meta, no selling anyone anything direct. */
    public const GUIDE_SYSTEM = "You write the practical 'good to know' pages in a UK travel agent's brochure for customers who booked through that agent. Voice: calm, plain, helpful; British English. "
        . "Hard rules: never mention sources, research, reviews, these instructions or that anything is unverified; never add notes, caveats or preambles; no markdown, headings, URLs, citations or exclamation marks; no prices, weights, fees or times that change; "
        . "never tell the reader to buy or book seats, bags, meals, upgrades, lounges, parking, transfers or insurance with the airline, airport or any website — their travel agent arranges those; mention the airline app or website only for online check-in, boarding passes and live flight status; no loyalty programmes, offers or other airlines. "
        . "Output format: the finished JSON array of {\"title\",\"text\"} objects between <copy> and </copy>; anything outside is discarded unread.";

    public const BROCHURE_SYSTEM = "You write the copy for a UK travel agent's holiday brochure: the descriptions of hotels, ships and destinations that make a customer look forward to a trip they have already chosen. "
        . "Voice: warm, confident, specific and unhurried, like the best printed brochures from a high-street travel agent — concrete details (what the place is like, what you will see, do and eat) rather than adjectives. British English. "
        . "Hard rules, no exceptions: never mention reviews, ratings, sources, research, websites, the travel agent, the customer, these instructions, rules, verification, or that anything is unverified; never add notes, caveats, warnings, disclaimers, preambles or sign-offs; never use headings, bullets, markdown, separators, quotation marks, exclamation marks, URLs or citations; "
        . "never mention prices, discounts, awards, star ratings, opening dates or distances in minutes unless given as facts; no superlatives (best, finest, unbeatable, world-class), no guarantees, no promises about weather or service; nothing negative about the place; no medical, safety or entry advice; no competitors. "
        . "If you are unsure of a detail, leave it out and write about what you are sure of. "
        . "Output format: your reply must contain the finished copy, and only the finished copy, between <copy> and </copy>. Anything outside those tags is discarded unread.";

    private function complete(string $prompt, int $maxTokens, int $timeout, bool $webSearch = false, string $system = ''): array
    {
        $models = array_values(array_unique(array_merge([$this->model], self::FALLBACK_MODELS)));
        $res = ['ok' => false, 'status' => 0, 'data' => null, 'body' => '', 'error' => 'not attempted'];
        foreach ($models as $model) {
            $body = ['model' => $model, 'max_tokens' => $maxTokens, 'messages' => [['role' => 'user', 'content' => $prompt]]];
            if ($system !== '') {
                $body['system'] = $system;
            }
            if ($webSearch) {
                $body['tools'] = [['type' => 'web_search_20250305', 'name' => 'web_search', 'max_uses' => 3]];
            }
            $res = Http::sendJson('POST', self::ENDPOINT, $body, ['x-api-key' => $this->key, 'anthropic-version' => '2023-06-01'], $timeout);
            if (!$res['ok'] && $webSearch && in_array($res['status'], [400, 403], true) && stripos($res['error'], 'tool') !== false) {
                // Account without the web search tool: write from the verified facts instead.
                $webSearch = false;
                unset($body['tools']);
                $res = Http::sendJson('POST', self::ENDPOINT, $body, ['x-api-key' => $this->key, 'anthropic-version' => '2023-06-01'], $timeout);
            }
            if ($res['ok']) {
                if ($model !== $this->model) {
                    Log::warning('AI model fell back', ['from' => $this->model, 'to' => $model]);
                }
                self::$lastError = '';
                return $res;
            }
            self::$lastError = $res['error'];
            $isModelError = in_array($res['status'], [400, 404], true) && stripos($res['error'], 'model') !== false;
            if (!$isModelError) {
                break;
            }
        }
        return $res;
    }

    /**
     * Non-blocking description: returns the cached text, or '' and queues a background job (pending=true).
     * @param array<string,mixed> $facts @param array<string,mixed> $context
     * @return array{text:string,pending:bool}
     */
    public function placeDescriptionAsync(string $name, string $location, array $facts, string $tone = 'broad', array $context = []): array
    {
        if (!$this->configured() || $name === '') {
            return ['text' => '', 'pending' => false];
        }
        $cacheId = $this->placeCacheId($name, $location, $tone, $context);
        self::$lastCacheId = $cacheId;
        $cached = Cache::get('ai', $cacheId);
        if (is_string($cached)) {
            return ['text' => $cached, 'pending' => false];
        }
        if (is_array($cached) && isset($cached['blocked'])) {
            self::$lastError = 'blocked by the travel agent';
            return ['text' => '', 'pending' => false];
        }
        if (is_array($cached) && isset($cached['failed'])) {
            self::$lastError = (string) $cached['failed'];
            return ['text' => '', 'pending' => false];
        }
        if (\VisionTrips\Support\Jobs::isPending($cacheId)) {
            return ['text' => '', 'pending' => true];
        }
        $queued = \VisionTrips\Support\Jobs::dispatch('place', ['name' => $name, 'location' => $location, 'facts' => $facts, 'tone' => $tone, 'context' => $context], $cacheId);
        return ['text' => '', 'pending' => $queued];
    }

    /** @return array{guide:array<int,array{title:string,text:string}>,pending:bool} */
    public function guideAsync(string $kind, string $name, string $code = ''): array
    {
        if (!$this->configured() || !Settings::bool('ai_travel_notes') || $name === '') {
            return ['guide' => [], 'pending' => false];
        }
        $cacheId = md5('guide|' . $kind . '|' . strtolower($name) . '|' . strtolower($code) . '|' . $this->model);
        self::$lastCacheId = $cacheId;
        $cached = Cache::get('ai', $cacheId);
        if (is_array($cached) && (isset($cached['failed']) || isset($cached['blocked']))) {
            self::$lastError = (string) ($cached['failed'] ?? 'blocked by the travel agent');
            return ['guide' => [], 'pending' => false];
        }
        if (is_array($cached) && $cached !== []) {
            return ['guide' => $cached, 'pending' => false];
        }
        // (an empty array from the old parser is treated as never generated)
        if (\VisionTrips\Support\Jobs::isPending($cacheId)) {
            return ['guide' => [], 'pending' => true];
        }
        $queued = \VisionTrips\Support\Jobs::dispatch('guide', ['kind' => $kind, 'name' => $name, 'code' => $code], $cacheId);
        return ['guide' => [], 'pending' => $queued];
    }

    /** Shared across every booking and member: keyed by the place alone (plus research mode and model). */
    public function placeCacheId(string $name, string $location, string $tone, array $context): string
    {
        $kind = (string) ($context['kind'] ?? 'place');
        return md5('v4|' . $kind . '|' . self::entityKey($name) . '|' . self::entityKey($location) . '|' . (Settings::bool('ai_research') ? 'r' : 'f') . '|' . $this->model);
    }

    /** "Barceló Corralejo Bay - Adults Only", "Barcelo Corralejo Bay" and "BARCELO CORRALEJO BAY " are the same entity. */
    public static function entityKey(string $s): string
    {
        $s = strtolower(function_exists('remove_accents') ? remove_accents($s) : $s);
        $s = (string) preg_replace('/\s*[-–—(].*$/', '', $s); // drop " - Adults Only", " (All Inclusive)"
        $s = (string) preg_replace('/[^a-z0-9]+/', ' ', $s);
        return trim($s);
    }

    /**
     * The finished copy from a reply: the last <copy>…</copy> block (working notes around it are discarded);
     * without tags, the last text block after any tool use, with obvious preambles removed.
     * @param mixed $data
     */
    public static function extractCopy($data): string
    {
        $blocks = [];
        foreach ((array) ($data['content'] ?? []) as $block) {
            if (($block['type'] ?? '') === 'text') {
                $blocks[] = (string) $block['text'];
            }
        }
        $all = implode("\n", $blocks);
        if (preg_match_all('/<copy>(.*?)<\/copy>/is', $all, $m) && $m[1]) {
            $text = (string) end($m[1]);
        } else {
            $text = (string) (end($blocks) ?: '');
            $text = (string) preg_replace('/^.*?(here is|here\'s|below is)[^\n]*\n/is', '', $text);
        }
        $text = strip_tags($text);
        $text = (string) preg_replace('/\[\d+\]|\(?https?:\/\/\S+\)?/', '', $text);
        $text = (string) preg_replace('/\*\*|__|^#+\s*|^[-–—]{3,}\s*$/m', '', $text);
        $text = (string) preg_replace('/[ \t]+/', ' ', $text);
        $text = (string) preg_replace('/\s*\n\s*/', "\n", $text);
        return trim($text);
    }

    /**
     * Why a piece of copy cannot go in front of a customer, or '' when it can. Catches the model talking to
     * anyone, mentioning sources or rules, hedging, negativity, markdown and empty replies.
     */
    public static function brochureProblem(string $text): string
    {
        $t = trim($text);
        if (mb_strlen($t) < 40) {
            return 'was empty or too short';
        }
        $meta = [
            'spoke to the travel agent or reader about the task' => '/\b(note to|dear (travel|agent)|travel professional|the (description|text|copy) (below|above)|before (finalising|finalizing|sending)|for (the|your) (client|customer)\b.*\b(please|note)|as requested|as an ai|i (cannot|can\'t|am unable|have (written|researched|drafted))|here (is|\'s) (a|the|your)|i hope this)/iu',
            'mentioned reviews, ratings or sources' => '/\b(review|reviews|rating|ratings|tripadvisor|trustpilot|booking\.com|google|website|sources?|according to|verified|unverified|confirmed guest|guest comments?|research(ed)?)\b/iu',
            'mentioned rules or instructions' => '/\b(rules?|instructions?|guidelines?|complies|compliance|consumer (law|protection)|regulations?|superlatives?|claims?)\b/iu',
            'was negative about the place' => '/\b(cleanliness|dirty|unclean|complain|complaints?|concerns?|issues?|problems?|disappoint|poor|negative|caution|warning|mixed|dated|tired|noisy|rude|avoid)\b/iu',
            'used markdown or separators' => '/(\*\*|^#|^\s*[-*•]\s|---|```|\[\d+\])/mu',
            'used a superlative or a guarantee' => '/\b(the best|finest|unbeatable|world-class|guarantee[ds]?|cheapest|number one|no\.? ?1)\b/iu',
            'contained a URL or a citation' => '~https?://|www\.~iu',
        ];
        foreach ($meta as $why => $re) {
            if (preg_match($re, $t)) {
                return $why;
            }
        }
        return '';
    }

    /** Leak check for practical guides (meta, sources, rules, markdown, selling direct) — negativity is allowed there. */
    public static function guideProblem(string $text): string
    {
        $t = trim($text);
        if (mb_strlen($t) < 20) {
            return 'was empty or too short';
        }
        $checks = [
            'spoke to the travel agent or reader about the task' => '/\b(note to|travel professional|the (description|text|copy) (below|above)|as an ai|i (cannot|can\'t|am unable)|here (is|\'s) (a|the|your)|as requested)/iu',
            'mentioned sources or research' => '/\b(sources?|according to|verified|unverified|research(ed)?|tripadvisor|trustpilot)\b/iu',
            'mentioned rules or instructions' => '/\b(these (rules|instructions)|guidelines|complies|compliance)\b/iu',
            'used markdown' => '/(\*\*|^#|```|\[\d+\])/mu',
            'contained a URL' => '~https?://|www\.~iu',
            'told the reader to book or buy direct' => '/\b(book|buy|purchase|pre-?book|reserve)\b[^.]{0,40}\b(direct(ly)?|on the airline\'?s? (website|site|app)|online with the airline|with the airport)\b/iu',
        ];
        foreach ($checks as $why => $re) {
            if (preg_match($re, $t)) {
                return $why;
            }
        }
        return '';
    }

    /**
     * Titled sections from a model reply: a JSON array of {title,text}, an object wrapping one ({sections:[…]} etc.),
     * JSON embedded in prose, or a markdown fallback of headings followed by paragraphs.
     * @return array<int,array{title:string,text:string}>
     */
    public static function parseSections(string $text): array
    {
        $clean = trim((string) preg_replace('/```(?:json)?/i', '', $text));
        $candidates = [$clean];
        if (preg_match('/\[\s*\{.*\}\s*\]/s', $clean, $m)) {
            $candidates[] = $m[0];
        }
        if (preg_match('/\{.*\}/s', $clean, $m)) {
            $candidates[] = $m[0];
        }
        $rows = null;
        foreach ($candidates as $c) {
            $data = json_decode($c, true);
            if (!is_array($data)) {
                continue;
            }
            if (array_is_list($data)) {
                $rows = $data;
                break;
            }
            foreach ($data as $v) {
                if (is_array($v) && array_is_list($v) && isset($v[0]['title'])) {
                    $rows = $v;
                    break 2;
                }
            }
            if (isset($data['title']) && isset($data['text'])) {
                $rows = [$data];
                break;
            }
        }
        $out = [];
        foreach ((array) $rows as $row) {
            if (is_array($row) && !empty($row['title']) && !empty($row['text'])) {
                $out[] = ['title' => Str::truncate(strip_tags((string) $row['title']), 60), 'text' => Str::truncate(strip_tags((string) $row['text']), 600)];
            }
        }
        if (!$out && preg_match_all('/^#{1,4}\s*(.+?)\s*$\n+((?:(?!^#).+\n?)+)/m', $clean, $mm, PREG_SET_ORDER)) {
            foreach ($mm as $sec) {
                $out[] = ['title' => Str::truncate(trim($sec[1]), 60), 'text' => Str::truncate(trim((string) preg_replace('/\s+/', ' ', strip_tags($sec[2]))), 600)];
            }
        }
        return array_slice($out, 0, 5);
    }

    /**
     * A destination guide in the same four sections the page already has (overview, things to do, practical,
     * culture), researched then written for a customer who has booked. Cached 30 days per destination/tone.
     * @param array<string,mixed> $facts
     * @return array{overview:string,attractions:string,practical:string,culture:string}
     */
    public function destinationGuide(string $name, string $country, array $facts, string $tone = 'broad'): array
    {
        $empty = ['overview' => '', 'attractions' => '', 'practical' => '', 'culture' => ''];
        if (!$this->configured() || $name === '') {
            return $empty;
        }
        $cacheId = $this->destinationCacheId($name, $country, $tone);
        $cached = Cache::get('ai', $cacheId);
        if (is_array($cached) && isset($cached['overview'])) {
            return $cached;
        }
        $research = Settings::bool('ai_research');
        $voice = 'warm, confident and specific — a printed holiday brochure'; // one guide per destination, reused everywhere
        $factLines = [];
        foreach ($facts as $k => $v) {
            $v = is_array($v) ? implode('; ', array_filter(array_map('strval', $v))) : trim((string) $v);
            if ($v !== '') {
                $factLines[] = $k . ': ' . $v;
            }
        }
        $prompt = ($research ? "Research {$name}, {$country} with web search (the official tourist board plus one or two reputable travel sources, at most three searches), then write " : 'Write ')
            . "the brochure pages for {$name}, {$country}. Tone: {$voice}. Four pieces of finished copy, each plain sentences in one or two paragraphs:\n"
            . "overview (60–90 words: what the place is like and why people love it); attractions (70–110 words: the things worth seeing and doing, named); practical (60–90 words: getting around, money, tipping, language, timings — for entry rules say only to check the official advice); culture (50–80 words: customs, food and drink, etiquette).\n"
            . ($factLines ? 'Facts: ' . implode('; ', $factLines) . "\n" : '')
            . "Reply with a JSON object with exactly the keys overview, attractions, practical, culture, inside <copy></copy>, and nothing else.";
        $prompt .= self::editorNote($cacheId);
        $out = [];
        for ($attempt = 1; $attempt <= 2; $attempt++) {
            $res = $this->complete($prompt, 1400, $research && $attempt === 1 ? 75 : 30, $research && $attempt === 1, self::BROCHURE_SYSTEM);
            if (!$res['ok']) {
                Log::warning('AI destination guide failed', ['status' => $res['status'], 'error' => $res['error'], 'name' => $name]);
                return $empty;
            }
            $text = self::extractCopy($res['data']);
            $json = json_decode(trim((string) preg_replace('/^```(?:json)?|```$/m', '', $text)), true);
            if (!is_array($json) && preg_match('/\{.*\}/s', $text, $m)) {
                $json = json_decode($m[0], true);
            }
            $out = [];
            $why = is_array($json) ? '' : 'was not valid JSON';
            if ($why === '') {
                foreach (array_keys($empty) as $k) {
                    $v = trim(strip_tags((string) ($json[$k] ?? '')));
                    $v = (string) preg_replace('/\*\*|__/', '', $v);
                    $p = $v !== '' ? self::brochureProblem($v) : '';
                    if ($p !== '') {
                        $why = $k . ' ' . $p;
                        break;
                    }
                    $out[$k] = Str::truncate($v, 900);
                }
            }
            if ($why === '' && ($out['overview'] ?? '') !== '') {
                break;
            }
            Log::warning('AI destination guide rejected', ['name' => $name, 'attempt' => $attempt, 'reason' => $why ?: 'empty overview']);
            self::$lastError = 'rejected: ' . ($why ?: 'empty overview');
            $out = [];
            $prompt .= "\n\nYour previous reply was rejected because it " . ($why ?: 'had no overview') . ". Reply again with only the JSON object inside <copy></copy>.";
        }
        if (($out['overview'] ?? '') === '') {
            return $empty;
        }
        Cache::set('ai', $cacheId, $out, 90 * DAY_IN_SECONDS);
        return $out;
    }

    /** @return array{guide:array{overview:string,attractions:string,practical:string,culture:string},pending:bool} */
    public function destinationGuideAsync(string $name, string $country, array $facts, string $tone = 'broad'): array
    {
        $empty = ['overview' => '', 'attractions' => '', 'practical' => '', 'culture' => ''];
        if (!$this->configured() || $name === '') {
            return ['guide' => $empty, 'pending' => false];
        }
        $cacheId = $this->destinationCacheId($name, $country, $tone);
        self::$lastCacheId = $cacheId;
        $cached = Cache::get('ai', $cacheId);
        if (is_array($cached) && isset($cached['overview'])) {
            return ['guide' => $cached, 'pending' => false];
        }
        if (is_array($cached) && (isset($cached['failed']) || isset($cached['blocked']))) {
            return ['guide' => $empty, 'pending' => false];
        }
        if (\VisionTrips\Support\Jobs::isPending($cacheId)) {
            return ['guide' => $empty, 'pending' => true];
        }
        $queued = \VisionTrips\Support\Jobs::dispatch('destination', ['name' => $name, 'country' => $country, 'facts' => $facts, 'tone' => $tone], $cacheId);
        return ['guide' => $empty, 'pending' => $queued];
    }

    /** Shared across every booking and member: keyed by the destination alone. */
    private function destinationCacheId(string $name, string $country, string $tone): string
    {
        return md5('destguide|v2|' . self::entityKey($name) . '|' . self::entityKey($country) . '|' . (Settings::bool('ai_research') ? 'r' : 'f') . '|' . $this->model);
    }

    /** Live check for the admin screen. @return array{ok:bool,model:string,message:string} */
    public function test(): array
    {
        if ($this->key === '') {
            return ['ok' => false, 'model' => $this->model, 'message' => 'No API key saved.'];
        }
        $res = $this->complete('Reply with the single word OK.', 10, 20);
        $text = '';
        foreach ((array) ($res['data']['content'] ?? []) as $block) {
            $text .= (string) ($block['text'] ?? '');
        }
        return ['ok' => $res['ok'], 'model' => (string) ($res['data']['model'] ?? $this->model), 'message' => $res['ok'] ? 'Reply: ' . trim($text) : $res['error']];
    }
}
