<?php
declare(strict_types=1);

namespace VisionTrips;

use VisionTrips\Support\Crypto;

/**
 * Central settings registry.
 *  - Secrets are encrypted at rest (see Support\Crypto) and may be overridden by constants in wp-config.php
 *    (e.g. define('VISION_TRIPS_AIRTABLE_PAT', '...')).
 *  - Everything is stored in a single option array to keep autoload cheap.
 */
final class Settings
{
    public const OPTION = 'vision_trips_settings';

    /** @var array<string,mixed>|null */
    private static ?array $cache = null;

    /** Keys whose values are secrets (encrypted, masked in the UI, constant-overridable). */
    public const SECRETS = [
        'airtable_pat', 'airtable_pat_standby',
        'widgety_token', 'widgety_token_2',
        'google_places_key', 'google_maps_embed_key',
        'ai_api_key',
        'flight_api_key',
        'link_secret', 'link_secret_previous',
        'api_minting_key',
    ];

    /** @return array<string,mixed> */
    public static function defaults(): array
    {
        return [
            // Airtable
            'airtable_pat'              => '',
            'airtable_pat_standby'      => '',
            'airtable_reference_base'   => '',
            'cache_ttl_booking'         => 60,
            // Widgety
            'widgety_app_id'            => '',
            'widgety_token'             => '',
            'widgety_app_id_2'          => '',
            'widgety_token_2'           => '',
            'widgety_base_url'          => 'https://www.widgety.co.uk',
            'widgety_accept_header'     => 'application/json',
            'widgety_holiday_lookup'    => '/api/cruises.json?reference={ref}',
            'widgety_ship_path'         => '/api/ships/{slug}.json',
            'widgety_destination_lookup' => '/api/ports.json?search={name}',
            'airline_logo_cdn'          => 'https://pics.avs.io/{w}/{h}/{iata}@2x.png',
            // Google
            'google_places_key'         => '',
            'google_maps_embed_key'     => '',
            'places_official_only'      => true,
            'places_match_mode'         => 'balanced', // balanced | strict | off
            'places_max_photos'         => 6,
            // AI
            'ai_provider'               => 'anthropic',
            'ai_api_key'                => '',
            'ai_model'                  => 'claude-sonnet-5-5',
            'ai_descriptions'           => true,
            'ai_research'               => true,   // research with Anthropic web search before writing
            // Flights / weather
            'flight_provider'           => 'aerodatabox',
            'flight_api_key'            => '',
            'flight_window_hours'       => 48,
            'weather_enabled'           => true,
            // Security
            'link_secret'               => '',
            'link_secret_previous'      => '',
            'api_minting_key'           => '',
            'session_days'              => 30,
            'challenge_quotation'       => 'none',      // none | surname | postcode
            'challenge_confirmed'       => 'any',       // any | postcode | surname_dob | otp
            'otp_enabled'               => true,
            'trust_signed_links'        => true,
            'show_dob'                  => false,
            'max_challenge_attempts'    => 5,
            // Experience
            'hide_suppliers_on_quotation' => true,
            'surprise_mode'             => true,
            'allow_custom_payments'     => true,
            'quote_accept_enabled'      => true,
            'quote_accept_require_writeback' => false,
            'quote_notify_agent'        => true,
            'quote_default_validity_days' => 14,
            'quote_accept_fields'       => "Quotation Accepted|checkbox\nQuotation Accepted At|datetime\nQuotation Accepted By|text\nQuotation Accepted IP|text",
            'mint_enabled'              => true,
            'legal_footer_text'         => 'Vision by The Travel Network Group',
            'trip_page_slug'            => 'trip',
            'portal_page_slug'          => 'my-trips',
            'portal_enabled'            => true,
            'ics_enabled'               => true,
            'fields'                    => [],   // Field Studio config
            'theme_overrides'           => [],   // tag => theme
            'theme_priority'            => '',   // one tag per line
            'legal_texts'               => [],   // key => text (see config/legal.php)
            'lta_notice'                => true,
            'view_comments'             => true,
            'csp_enabled'               => false,
            'modules'                   => [],     // module key => bool; missing = on (see Settings::MODULES)
            'events_table'              => '',     // optional Vision table to append engagement rows to (e.g. Bookings [Engagement])
            'digest_enabled'            => true,   // daily email of warnings/errors to the admin
            'digest_email'              => '',     // blank = WordPress admin email
            'staging_base'              => '',     // staging member base for the Test everything grid
            'staging_records'           => '',     // one record id per line
            'view_count_field'          => 'Trip Page Views',
            'last_view_field'           => 'Trip Page Last Viewed',
            'sw_enabled'                => false,  // offline copy of the trip page via a service worker  // strict CSP; only when the plugin URL and site URL share an origin   // Airtable comment when a customer views / accepts / asks
            'ai_travel_notes'           => true,   // AI 'good to know' for airlines and UK airports
            'reviews_min_rating'        => 4,
            'ideas_enabled'             => true,   // conversion ideas / upsell prompts
            'widgety_place_lookup'      => '/api/ports.json?q={name}',
            'widgety_destination_lookup' => '/api/destinations.json?q={name}',
        ];
    }

    /** @return array<string,mixed> */
    public static function all(): array
    {
        if (self::$cache === null) {
            $stored = get_option(self::OPTION, []);
            self::$cache = array_merge(self::defaults(), is_array($stored) ? $stored : []);
        }
        return self::$cache;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $const = 'VISION_TRIPS_' . strtoupper($key);
        if (defined($const)) {
            return constant($const);
        }
        $all = self::all();
        if (!array_key_exists($key, $all)) {
            return $default;
        }
        $value = $all[$key];
        if (in_array($key, self::SECRETS, true) && is_string($value) && $value !== '') {
            static $memo = [];
            $k = md5($key . '|' . $value);
            return $memo[$k] ??= Crypto::decrypt($value);
        }
        return $value;
    }

    /** Switchable page modules: key => [label, description]. New modules ship OFF until you turn them on. */
    public const MODULES = [
        'reassure'     => ['Reassurance strip', 'Protection, named expert, tailored, out-of-hours — under the hero'],
        'next'         => ['What happens next', 'Timeline from the Bookings task checkboxes'],
        'messages'     => ['What we\'ve sent you', 'Sent items from Customer Communication'],
        'stays'        => ['Where you\'re staying', 'Google Places photos/reviews + AI descriptions'],
        'cruise'       => ['Ship and voyage', 'Widgety ship profile and voyage'],
        'destinations' => ['Where you\'re going', 'Widgety/Places imagery + AI destination guides'],
        'guides'       => ['Airline and airport guides', 'AI "good to know" inside flight cards'],
        'today'        => ['Today module', 'Live flights and weather on departure/travel days'],
        'ideas'        => ['Make it even better', 'Vision upsells + conversion ideas'],
        'whybook'      => ['Why book with us', 'Reasons to Book from the brand record'],
        'faq'          => ['Quick answers', 'Generated FAQ'],
        'home'         => ['Welcome home', 'Review, next trip, recommend us'],
        'summary'      => ['Up next card', 'Stage-aware summary card under the hero (new)'],
        'folds'        => ['Compact long tail', 'Collapse ideas, FAQ, why-book, messages and protection on phones (new)'],
        'events'       => ['Engagement tracking', 'Record what customers open and tap (new)'],
        'share'        => ['Share with fellow travellers', 'Lead passenger can invite co-travellers (new)'],
        'wallet'       => ['Travel wallet', 'Tickets, vouchers and emergency numbers on one page (new)'],
        'compare'      => ['Compare quotations', 'Other open quotations for the same customer, side by side (new)'],
    ];
    private const MODULES_OFF_BY_DEFAULT = ['summary', 'folds', 'events', 'share', 'wallet', 'compare'];

    public static function module(string $key): bool
    {
        $m = (array) self::get('modules', []);
        if (array_key_exists($key, $m)) {
            return (bool) $m[$key];
        }
        return !in_array($key, self::MODULES_OFF_BY_DEFAULT, true);
    }

    public static function bool(string $key): bool
    {
        return (bool) self::get($key, false);
    }

    public static function int(string $key, int $default = 0): int
    {
        $v = self::get($key, $default);
        return is_numeric($v) ? (int) $v : $default;
    }

    public static function set(string $key, mixed $value): void
    {
        $all = self::all();
        if (in_array($key, self::SECRETS, true)) {
            $value = is_string($value) && $value !== '' ? Crypto::encrypt($value) : '';
        }
        $all[$key] = $value;
        self::$cache = $all;
        update_option(self::OPTION, $all, false);
    }

    /** @param array<string,mixed> $values */
    public static function setMany(array $values): void
    {
        foreach ($values as $k => $v) {
            self::set((string) $k, $v);
        }
    }

    public static function isOverriddenByConstant(string $key): bool
    {
        return defined('VISION_TRIPS_' . strtoupper($key));
    }

    /** Ensure signing secrets exist (called on activation / first boot). */
    public static function ensureSecrets(): void
    {
        if (self::get('link_secret', '') === '') {
            self::set('link_secret', Crypto::randomToken(32));
        }
        if (self::get('api_minting_key', '') === '') {
            self::set('api_minting_key', Crypto::randomToken(32));
        }
    }

    /** Rotate the link-signing secret keeping the previous one valid for existing links. */
    public static function rotateLinkSecret(): void
    {
        self::set('link_secret_previous', self::get('link_secret', ''));
        self::set('link_secret', Crypto::randomToken(32));
    }

    /** Swap active and standby Airtable tokens. */
    public static function rotateAirtablePat(): void
    {
        $active = self::get('airtable_pat', '');
        $standby = self::get('airtable_pat_standby', '');
        if ($standby === '') {
            return;
        }
        self::set('airtable_pat', $standby);
        self::set('airtable_pat_standby', $active);
    }

    /**
     * Parse the quote acceptance write-back map ("Field Name|type" per line).
     * @return array<string,string> field => type (checkbox|datetime|text|append)
     */
    public static function quoteAcceptFields(): array
    {
        $raw = (string) self::get('quote_accept_fields', '');
        $out = [];
        foreach (preg_split('/\r?\n/', $raw) ?: [] as $line) {
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            [$name, $type] = array_pad(explode('|', $line, 2), 2, 'text');
            $out[trim($name)] = trim(strtolower($type));
        }
        return $out;
    }
}
