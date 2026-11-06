<?php
declare(strict_types=1);

namespace VisionTrips\Admin;

use VisionTrips\Airtable\Client;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Domain\Theme;
use VisionTrips\Integrations\Flights;
use VisionTrips\Integrations\Places;
use VisionTrips\Integrations\Widgety;
use VisionTrips\Security\Token;
use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Crypto;
use VisionTrips\Support\Log;

/**
 * Only The Travel Network Group uses wp-admin. Members never log in: their customisation comes from Airtable.
 */
final class Admin
{
    /** @var array<int,array<string,mixed>> */
    private array $testResults = [];
    /** @var array<int,array<string,mixed>> */
    private array $stagingResults = [];

    private const CAP = 'manage_options';
    private const SLUG = 'vision-trips';

    public function register(): void
    {
        add_action('admin_menu', [$this, 'menu']);
        add_action('admin_post_vision_trips_save', [$this, 'save']);
        add_action('admin_post_vision_trips_action', [$this, 'action']);
        add_action('admin_enqueue_scripts', [$this, 'assets']);
    }

    public function menu(): void
    {
        add_menu_page('Vision Trips', 'Vision Trips', self::CAP, self::SLUG, [$this, 'page'], 'dashicons-palmtree', 58);
    }

    public function assets(string $hook): void
    {
        if (!str_contains($hook, self::SLUG)) {
            return;
        }
        wp_enqueue_style('vision-trips-admin', VISION_TRIPS_URL . 'assets/css/admin.css', [], VISION_TRIPS_VERSION);
        wp_enqueue_script('vision-trips-admin', VISION_TRIPS_URL . 'assets/js/admin.js', [], VISION_TRIPS_VERSION, true);
    }

    private function tabs(): array
    {
        return ['status' => 'Status', 'connections' => 'Connections', 'fields' => 'Field Studio', 'security' => 'Security', 'experience' => 'Experience', 'themes' => 'Themes', 'legal' => 'Legal', 'engagement' => 'Engagement', 'tools' => 'Tools & logs', 'changelog' => 'Changelog'];
    }

    public function page(): void
    {
        if (!current_user_can(self::CAP)) {
            wp_die('Not allowed.');
        }
        $tab = sanitize_key($_GET['tab'] ?? 'status');
        if (!isset($this->tabs()[$tab])) {
            $tab = 'status';
        }
        $notice = isset($_GET['notice']) ? sanitize_text_field((string) $_GET['notice']) : '';
        echo '<div class="wrap vt-admin"><h1>Vision Trips <span class="vt-version">v' . esc_html(VISION_TRIPS_VERSION) . '</span></h1>';
        if ($notice !== '') {
            echo '<div class="notice notice-' . (str_starts_with($notice, 'Error') ? 'error' : 'success') . ' is-dismissible"><p>' . esc_html($notice) . '</p></div>';
        }
        echo '<nav class="nav-tab-wrapper">';
        foreach ($this->tabs() as $key => $label) {
            echo '<a class="nav-tab' . ($key === $tab ? ' nav-tab-active' : '') . '" href="' . esc_url(admin_url('admin.php?page=' . self::SLUG . '&tab=' . $key)) . '">' . esc_html($label) . '</a>';
        }
        echo '</nav>';
        $method = 'tab' . ucfirst($tab);
        $this->$method();
        echo '</div>';
    }

    /* ------------------------------------------------------------------ Tabs */

    private function tabStatus(): void
    {
        $client = new Client();
        // Diagnostics run synchronously on this page (no redirect), so the results sit right under the form.
        $diag = null;
        $staging = null;
        if (isset($_POST['vt_diag']) && wp_verify_nonce((string) ($_POST['_vtd'] ?? ''), 'vt_diag')) {
            $base = sanitize_text_field((string) wp_unslash($_POST['test_base'] ?? ''));
            $record = sanitize_text_field((string) wp_unslash($_POST['test_record'] ?? ''));
            $records = array_values(array_filter(array_map('trim', preg_split('/\s+/', (string) wp_unslash($_POST['test_records'] ?? '')) ?: [])));
            Settings::setMany(['staging_base' => $base, 'staging_records' => implode("\n", $records)]);
            if ($_POST['vt_diag'] === 'test') {
                $diag = \VisionTrips\Admin\Diagnostics::testEverything($base, $record, !empty($_POST['test_comment']), sanitize_email((string) wp_unslash($_POST['test_email'] ?? '')));
            } else {
                $staging = \VisionTrips\Admin\Diagnostics::renderStaging($base, $records);
            }
        }
        $checks = [
            ['Airtable token', $client->configured(), $client->configured() ? 'Configured' : 'Add a personal access token under Connections.'],
            ['Widgety', (new Widgety())->configured(), (new Widgety())->configured() ? 'Configured' : 'Optional — cruise ship and voyage content.'],
            ['Google Places', (new Places())->configured(), (new Places())->configured() ? 'Configured' : 'Optional — hotel photos, ratings, maps.'],
            ['AI descriptions', trim((string) Settings::get('ai_api_key', '')) !== '', trim((string) Settings::get('ai_api_key', '')) !== '' ? 'Configured' : 'Optional — descriptions where Vision has none.'],
            ['Flight status', (new Flights())->configured(), (new Flights())->configured() ? ucfirst((string) Settings::get('flight_provider')) : 'Optional — live departure-day status.'],
            ['Link signing', (string) Settings::get('link_secret', '') !== '', 'Secrets present'],
            ['Pretty permalinks', (bool) get_option('permalink_structure'), get_option('permalink_structure') ? 'On' : 'Required: Settings → Permalinks → Post name'],
            ['HTTPS', is_ssl() || (defined('FORCE_SSL_ADMIN') && FORCE_SSL_ADMIN), 'Session cookies are marked Secure on HTTPS only'],
        ];
        echo '<div class="vt-grid">';
        echo '<div class="vt-card"><h2>Health</h2><table class="widefat striped"><tbody>';
        foreach ($checks as [$label, $ok, $text]) {
            echo '<tr><td><span class="vt-dot ' . ($ok ? 'ok' : 'warn') . '"></span> ' . esc_html($label) . '</td><td>' . esc_html($text) . '</td></tr>';
        }
        echo '</tbody></table></div>';
        $slug = trim((string) Settings::get('trip_page_slug', 'trip'), '/');
        echo '<div class="vt-card"><h2>URLs</h2><p><code>' . esc_html(home_url('/' . $slug . '/{token}/')) . '</code> — customer experience<br><code>' . esc_html(home_url('/' . $slug . '/{token}/documents/confirmation/')) . '</code> — documents<br><code>' . esc_html(home_url('/' . trim((string) Settings::get('portal_page_slug', 'my-trips'), '/') . '/?m=app…')) . '</code> — customer portal</p>';
        echo '<p>Old links (<code>?member=app…&amp;booking=rec…</code>) redirect automatically to signed links, so existing Vision formulas keep working. Add <code>&amp;k=' . esc_html($this->agentKeyHint()) . '</code> to any old link to open it in agent scope (letters, front file, no verification).</p></div>';
        echo '<div class="vt-card"><h2>Open a booking</h2><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">' . wp_nonce_field('vision_trips_action', '_vtn', true, false) . '<input type="hidden" name="action" value="vision_trips_action"><input type="hidden" name="do" value="open"><p><label>Base ID <input name="base" class="regular-text" placeholder="appXXXXXXXXXXXXXX" required></label></p><p><label>Booking record ID <input name="record" class="regular-text" placeholder="recXXXXXXXXXXXXXX" required></label></p><p><label><input type="checkbox" name="agent" value="1" checked> Agent scope (no verification, fresh data)</label></p><p><button class="button button-primary">Open trip</button></p></form></div>';
        echo '</div>';
        $sb = (string) Settings::get('staging_base', '');
        $sr = (string) Settings::get('staging_records', '');
        $firstRec = trim((string) (preg_split('/\s+/', $sr)[0] ?? ''));
        echo '<form method="post" class="vt-grid" style="margin-top:16px"><input type="hidden" name="_vtd" value="' . esc_attr(wp_create_nonce('vt_diag')) . '">';
        echo '<div class="vt-card"><h2>Test everything</h2><p>One real booking through every integration — Airtable, Google Places, Widgety, AI, flight status, weather, Mint readiness, email, Airtable comment — then a full page render. Use a staging base and a test booking.</p>';
        echo '<p><label class="vt-label">Base ID</label><input type="text" name="test_base" class="regular-text" value="' . esc_attr($sb) . '" placeholder="appXXXXXXXXXXXXXX"></p>';
        echo '<p><label class="vt-label">Booking record ID</label><input type="text" name="test_record" class="regular-text" value="' . esc_attr($firstRec) . '" placeholder="recXXXXXXXXXXXXXX"></p>';
        echo '<p><label class="vt-label">Send a test email to</label><input type="email" name="test_email" class="regular-text" value="' . esc_attr((string) get_option('admin_email')) . '"></p>';
        echo '<p><label><input type="checkbox" name="test_comment" value="1"> Write a test comment on the booking (needs data.recordComments:write)</label></p>';
        echo '<p><button class="button button-primary" name="vt_diag" value="test">Run the test</button></p>';
        if ($diag !== null) {
            echo '<table class="widefat striped"><thead><tr><th>Check</th><th>Result</th><th>Time</th></tr></thead><tbody>';
            foreach ($diag as $r) {
                echo '<tr><td><span class="vt-dot ' . ($r['ok'] ? 'ok' : '') . '"></span> ' . esc_html($r['check']) . '</td><td>' . esc_html($r['detail']) . '</td><td>' . (int) $r['ms'] . ' ms</td></tr>';
            }
            echo '</tbody></table>';
        }
        echo '</div>';
        echo '<div class="vt-card"><h2>Render staging bookings</h2><p>Every record below goes through the full page build (fresh from Airtable). Anything that throws is listed with the file and line. Run this before every release.</p>';
        echo '<p><label class="vt-label">Record IDs (one per line)</label><textarea name="test_records" rows="8" class="large-text code">' . esc_textarea($sr) . '</textarea></p>';
        echo '<p><button class="button button-primary" name="vt_diag" value="staging">Render all</button></p>';
        if ($staging !== null) {
            echo '<table class="widefat striped"><thead><tr><th>Record</th><th>Result</th><th>Time</th></tr></thead><tbody>';
            foreach ($staging as $r) {
                echo '<tr' . ($r['ok'] ? '' : ' class="vt-error"') . '><td><code>' . esc_html($r['record']) . '</code></td><td>' . esc_html($r['detail']) . '</td><td>' . (int) $r['ms'] . ' ms</td></tr>';
            }
            if (!$staging) {
                echo '<tr><td colspan="3">No valid record IDs.</td></tr>';
            }
            echo '</tbody></table>';
        }
        echo '</div></form>';
        echo '<div class="vt-card" style="margin-top:16px"><h2>Daily health digest</h2><p>A grouped email of warnings and errors from the last 24 hours, sent each morning to ' . esc_html(trim((string) Settings::get('digest_email', '')) ?: (string) get_option('admin_email')) . '. ' . (Settings::bool('digest_enabled') ? 'On.' : 'Off.') . ' Change under Tools &amp; logs.</p><p>' . $this->actionButton('send_digest', 'Send a digest now') . '</p></div>';
    }

    private function tabConnections(): void
    {
        $this->formOpen('connections');
        echo '<div class="vt-grid">';
        echo '<div class="vt-card"><h2>Airtable</h2>';
        $this->secret('airtable_pat', 'Personal access token (active)', 'Scopes: data.records:read, data.records:write (for quotation acceptance), schema.bases:read. Access to every member base.');
        $this->secret('airtable_pat_standby', 'Standby token (for rotation)', 'Add the new token here, test it, then click Rotate. The old token becomes standby so you can revoke it later. If the active token is rejected (401/403) the plugin fails over to standby automatically.');
        $this->text('airtable_reference_base', 'Reference base ID', 'A base to read the Vision schema from (Field Studio). Any member base built from the Vision template works.');
        $this->number('cache_ttl_booking', 'Booking cache (seconds)', 'How long a loaded booking is reused before Airtable is asked again. 60 keeps pages instant while changes in Vision appear within a minute.');
        echo '<p>' . $this->actionButton('rotate_pat', 'Rotate tokens') . ' ' . $this->actionButton('test_airtable', 'Test active token') . '</p></div>';

        echo '<div class="vt-card"><h2>Widgety</h2>';
        $this->text('widgety_app_id', 'App ID');
        $this->secret('widgety_token', 'Token');
        $this->text('widgety_app_id_2', 'Second app ID (optional)');
        $this->secret('widgety_token_2', 'Second token (optional)');
        $this->text('widgety_base_url', 'Base URL');
        $this->text('widgety_accept_header', 'Accept header', 'Widgety negotiates API versions with the Accept header — set the V3 media type shown at developer.widgety.co.uk.');
        $this->text('widgety_ship_path', 'Ship path', '{slug} is replaced with the Widgety ship id or a slug of the ship name.');
        $this->text('widgety_holiday_lookup', 'Holiday lookup path', '{ref} is replaced with the Voyage Code from the Vision element. Verify the exact path for your account.');
        echo '<p>' . $this->actionButton('test_widgety', 'Test Widgety') . '</p></div>';

        echo '<div class="vt-card"><h2>Google</h2>';
        $this->secret('google_places_key', 'Places API (New) key', 'Restrict the key to the Places API (New) and your server IPs.');
        $this->secret('google_maps_embed_key', 'Maps Embed API key (optional)', 'Without it, maps fall back to the keyless Google Maps embed.');
        $this->checkbox('places_official_only', 'Prefer photos posted by the business', 'Photos whose author is the business itself come first; customer snapshots are only used when the business has posted none.');
        $this->number('places_max_photos', 'Photos per stay');
        $this->select('places_match_mode', 'Match checking', ['balanced' => 'Balanced — show unless clearly the wrong place (recommended)', 'strict' => 'Strict — name must match and Google must class it as lodging', 'off' => 'Off — always trust Google\'s first result']);
        echo '<p class="description">The verdict for each stay (e.g. "matched: name 0.86, lodging ✓") appears in the admin sources panel at the foot of the trip page.</p>';
        echo '</div>';

        echo '<div class="vt-card"><h2>AI descriptions</h2>';
        $this->select('ai_provider', 'Provider', ['anthropic' => 'Anthropic (Claude)', 'off' => 'Off']);
        $this->secret('ai_api_key', 'API key');
        $this->text('ai_model', 'Model', 'Default claude-sonnet-5-5. If a model id is retired the plugin falls back to a current one automatically and logs it.');
        $this->checkbox('ai_descriptions', 'Generate hotel/destination descriptions from Google Places facts when Vision has none');
        $this->checkbox('ai_research', 'Research first: let the model use web search (official site, reputable reviews) before writing, so descriptions sell the specific stay rather than paraphrase Google. Falls back to verified facts only if the account lacks the tool.');
        $this->checkbox('ai_travel_notes', 'Airline and UK airport guides');
        echo '<p>' . $this->actionButton('test_ai', 'Test AI') . ' ' . $this->actionButton('regen_ai', 'Regenerate all AI copy') . '</p></div>';

        echo '<div class="vt-card"><h2>Flights & weather</h2>';
        $this->select('flight_provider', 'Flight status provider', ['aerodatabox' => 'AeroDataBox (RapidAPI)', 'aviationstack' => 'AviationStack', 'off' => 'Off']);
        $this->secret('flight_api_key', 'API key');
        $this->number('flight_window_hours', 'Show live status from (hours before departure)');
        $this->checkbox('weather_enabled', 'Destination weather (Open-Meteo, free, no key)');
        echo '</div></div>';
        $this->formClose();
    }

    private function tabFields(): void
    {
        $ref = (string) Settings::get('airtable_reference_base', '');
        $tables = $ref !== '' ? (new Client())->schema($ref) : [];
        $tableName = isset($_GET['table']) ? sanitize_text_field(wp_unslash((string) $_GET['table'])) : FieldMap::table('elements');
        $config = (array) Settings::get('fields', []);
        echo '<div class="vt-card"><h2>Field Studio</h2><p>Choose which Vision fields customers can see in "More details" on each itinerary item, rename them, and order them — without touching code. Typed essentials (dates, airports, rooms, cabins, suppliers…) are always handled by the designed layouts and are not listed here.</p>';
        if ($ref === '') {
            echo '<p class="vt-warn">Set a reference base ID under Connections first.</p></div>';
            return;
        }
        if (!$tables) {
            echo '<p class="vt-warn">Could not read the schema. Check the token has <code>schema.bases:read</code>. ' . $this->actionButton('refresh_schema', 'Try again') . '</p></div>';
            return;
        }
        echo '<form method="get" class="vt-inline"><input type="hidden" name="page" value="' . self::SLUG . '"><input type="hidden" name="tab" value="fields"><label>Table <select name="table" onchange="this.form.submit()">';
        $allowed = [FieldMap::table('elements'), FieldMap::table('bookings'), FieldMap::table('payments')];
        foreach ($tables as $t) {
            if (!in_array($t['name'], $allowed, true)) {
                continue;
            }
            echo '<option value="' . esc_attr($t['name']) . '"' . selected($t['name'], $tableName, false) . '>' . esc_html($t['name']) . '</option>';
        }
        echo '</select></label> ' . $this->actionButton('refresh_schema', 'Refresh schema') . '</form>';
        $table = null;
        foreach ($tables as $t) {
            if ($t['name'] === $tableName) {
                $table = $t;
            }
        }
        if (!$table) {
            echo '<p>Table not found in schema.</p></div>';
            return;
        }
        $group = $tableName === FieldMap::table('elements') ? 'element' : ($tableName === FieldMap::table('payments') ? 'payment' : 'booking');
        $consumed = FieldMap::consumed($group);
        $this->formOpen('fields');
        echo '<input type="hidden" name="fields_table" value="' . esc_attr($tableName) . '">';
        echo '<p><input type="search" class="regular-text vt-filter" placeholder="Filter fields…" data-filter="#vt-fields"></p>';
        echo '<table class="widefat striped" id="vt-fields"><thead><tr><th>Show</th><th>Field</th><th>Type</th><th>Label shown to customer</th><th>Order</th></tr></thead><tbody>';
        foreach ($table['fields'] as $f) {
            $name = (string) $f['name'];
            if (isset($consumed[\VisionTrips\Support\Arr::normKey($name)])) {
                continue;
            }
            $rule = $config[$tableName][$name] ?? null;
            $show = $rule !== null ? !empty($rule['show']) : FieldMap::defaultVisible($name, (string) ($f['type'] ?? ''));
            $label = (string) ($rule['label'] ?? '');
            $order = (int) ($rule['order'] ?? 500);
            $k = esc_attr(base64_encode($name));
            echo '<tr><td><input type="checkbox" name="f[' . $k . '][show]" value="1"' . checked($show, true, false) . '></td><td>' . esc_html($name) . '</td><td><code>' . esc_html((string) ($f['type'] ?? '')) . '</code></td><td><input name="f[' . $k . '][label]" value="' . esc_attr($label) . '" placeholder="' . esc_attr($name) . '"></td><td><input type="number" name="f[' . $k . '][order]" value="' . esc_attr((string) $order) . '" class="small-text"></td></tr>';
        }
        echo '</tbody></table>';
        echo '<p>' . $this->actionButton('reset_fields', 'Reset this table to defaults', 'button') . '</p>';
        $this->formClose();
        echo '</div>';
    }

    private function tabSecurity(): void
    {
        $this->formOpen('security');
        echo '<div class="vt-grid"><div class="vt-card"><h2>Who can open a trip</h2>';
        $this->select('challenge_quotation', 'Quotations', ['none' => 'Link only (no question)', 'surname' => 'Lead passenger surname', 'postcode' => 'Postcode']);
        $this->select('challenge_confirmed', 'Confirmed, cancelled & closed bookings', ['any' => 'Postcode or surname + date of birth (customer chooses)', 'postcode' => 'Postcode', 'surname_dob' => 'Surname + date of birth', 'otp' => 'Email code every new device']);
        $this->checkbox('trust_signed_links', 'Signed links open without a question (unless the booking has Enable 2FA)', 'Links minted by the API carry a signature. Old ?member=&booking= links are never trusted.');
        $this->checkbox('otp_enabled', 'Email one-time codes available (always used when a booking has Enable 2FA ticked in Vision)');
        $this->number('session_days', 'Remember a verified device for (days)');
        $this->number('max_challenge_attempts', 'Wrong answers allowed per 15 minutes');
        $this->checkbox('show_dob', 'Show dates of birth on verified sessions');
        $this->checkbox('sw_enabled', 'Offline copy of trip pages (service worker)', 'Caches the trip page and assets on the customer\'s phone so it opens without signal. Leave off until the site is stable; visit Settings → Permalinks after enabling.');
        $this->checkbox('csp_enabled', 'Send a strict Content-Security-Policy on trip pages', 'Only enable when the site URL and the plugin URL share the same scheme and host; otherwise the browser will refuse to load the plugin\'s own CSS and JS. Check the browser console after enabling.');
        echo '</div><div class="vt-card"><h2>Keys</h2>';
        $this->secret('api_minting_key', 'API key for link minting', 'Send as the X-Vision-Key header to POST ' . rest_url('vision/v1/links/mint') . ' with {base, record, scope?, expires_hours?, path?}. Also authorises POST ' . rest_url('vision/v1/cache/purge') . '.');
        echo '<p>' . $this->actionButton('regen_api_key', 'Generate new API key') . ' ' . $this->actionButton('rotate_link_secret', 'Rotate link signing secret', 'button') . '</p><p class="description">Rotating the signing secret keeps existing links valid (the previous secret is kept once). Rotate twice to invalidate every link ever sent.</p>';
        echo '<p><strong>Agent link key:</strong> <code>' . esc_html($this->agentKeyHint()) . '</code><br><span class="description">Append <code>&amp;k=…</code> to legacy links in Vision formulas for agent-only views (letters, front file). Derived from the API key.</span></p>';
        echo '</div></div>';
        $this->formClose();
    }

    private function tabExperience(): void
    {
        $this->formOpen('experience');
        echo '<div class="vt-card"><h2>Modules</h2><p>Switch parts of the trip page on or off for every member. New modules ship off; turn them on when you have seen them on staging.</p><div class="vt-modules">';
        foreach (Settings::MODULES as $key => [$label, $desc]) {
            echo '<label class="vt-module"><input type="hidden" name="modules[' . esc_attr($key) . ']" value="0"><input type="checkbox" name="modules[' . esc_attr($key) . ']" value="1"' . checked(Settings::module($key), true, false) . '> <strong>' . esc_html($label) . '</strong><span class="description">' . esc_html($desc) . '</span></label>';
        }
        echo '</div></div>';
        echo '<div class="vt-grid"><div class="vt-card"><h2>Quotations</h2>';
        $this->checkbox('quote_accept_enabled', 'Customers can accept a quotation online (forced read of names, important information, protection and terms, then straight to the deposit)');
        $this->checkbox('hide_suppliers_on_quotation', 'Hide supplier names and references while a booking is a quotation');
        $this->number('quote_default_validity_days', 'Treat quotations as fresh for (days) when no Quotation Expiry is set');
        $this->textarea('quote_accept_fields', 'Write back to Vision (Bookings) on acceptance', 'One per line: Field Name|type. Types: checkbox, datetime, text, email, ip, log. Create these fields in the Vision template first; missing fields fail safely and are logged.');
        $this->checkbox('quote_accept_require_writeback', 'Block acceptance if the write-back fails');
        $this->checkbox('quote_notify_agent', 'Email the brand inbox when a quotation is accepted');
        echo '</div><div class="vt-card"><h2>Bookings</h2>';
        $this->checkbox('surprise_mode', 'Honour "Surprise Booking": hide destination and itinerary details from the customer page');
        $this->checkbox('allow_custom_payments', 'Customers can pay a custom amount (brand must allow Mint custom payments)');
        $this->checkbox('mint_enabled', 'Mint payment links');
        $this->checkbox('ics_enabled', 'Add-to-calendar export');
        $this->checkbox('portal_enabled', 'Customer portal (/my-trips/)');
        $this->text('legal_footer_text', 'Footer attribution');
        $this->text('trip_page_slug', 'Trip URL slug', 'Save, then visit Settings → Permalinks once to refresh rewrite rules.');
        $this->text('portal_page_slug', 'Portal URL slug');
        echo '</div></div>';
        $this->formClose();
    }

    private function tabThemes(): void
    {
        $this->formOpen('themes');
        $overrides = (array) Settings::get('theme_overrides', []);
        $priority = Theme::priority();
        echo '<div class="vt-grid"><div class="vt-card"><h2>Priority</h2><p>A booking can carry several tags; the first one in this list that is present decides the theme. One tag per line — reorder to taste.</p>';
        echo '<p><textarea name="s[theme_priority]" rows="14" class="large-text code">' . esc_textarea(implode("\n", $priority)) . '</textarea></p></div>';
        echo '<div class="vt-card"><h2>Tag → theme</h2><p>Every Vision tag has its own theme (typography, surface wash, hero treatment, motif, corner radius). The member\'s brand colour is always the accent. Override a tag to use another tag\'s theme if you prefer.</p><table class="widefat striped"><thead><tr><th>Vision tag</th><th>Theme</th><th>Feel</th></tr></thead><tbody>';
        foreach ($priority as $tag) {
            $current = (string) ($overrides[$tag] ?? $tag);
            echo '<tr><td><strong>' . esc_html($tag) . '</strong></td><td><select name="theme_overrides[' . esc_attr($tag) . ']">';
            foreach (Theme::THEMES as $key => $spec) {
                if ($key === 'default') {
                    continue;
                }
                echo '<option value="' . esc_attr($key) . '"' . selected($key, $current, false) . '>' . esc_html($key) . ' — ' . esc_html($spec['family']) . ' ' . esc_html((string) $spec['weight']) . ($key === $tag ? ' (own)' : '') . '</option>';
            }
            echo '</select></td><td class="description">' . esc_html(Theme::spec($current)['mood']) . '</td></tr>';
        }
        echo '</tbody></table></div></div>';
        $this->formClose();
    }

    private function tabEngagement(): void
    {
        $sum = \VisionTrips\Support\Events::summary();
        echo '<div class="vt-grid"><div class="vt-card"><h2>At a glance</h2>';
        echo '<p>Module "Engagement tracking" is ' . (Settings::module('events') ? 'on' : 'off (Experience → Modules)') . '. Optional Vision table: <code>' . esc_html((string) Settings::get('events_table', '') ?: 'not set') . '</code> (fields: Booking, Event, Detail, Stage, When, Device).</p>';
        echo '<table class="widefat striped"><tbody>';
        echo '<tr><td>Page views</td><td><strong>' . (int) $sum['views'] . '</strong></td></tr>';
        echo '<tr><td>Acceptances started → completed</td><td><strong>' . (int) $sum['accept_start'] . ' → ' . (int) $sum['accept_complete'] . '</strong>' . ($sum['accept_start'] ? ' (' . round(100 * $sum['accept_complete'] / max(1, $sum['accept_start'])) . '%)' : '') . '</td></tr>';
        echo '<tr><td>Pay now taps</td><td><strong>' . (int) $sum['pay'] . '</strong></td></tr>';
        echo '</tbody></table>';
        echo '<h3>What customers ask to add</h3><table class="widefat striped"><tbody>';
        foreach (array_slice($sum['asks'], 0, 15, true) as $k => $n) {
            echo '<tr><td>' . esc_html($k) . '</td><td><strong>' . (int) $n . '</strong></td></tr>';
        }
        if (!$sum['asks']) {
            echo '<tr><td colspan="2">Nothing yet.</td></tr>';
        }
        echo '</tbody></table></div>';
        echo '<div class="vt-card"><h2>Top events</h2><table class="widefat striped"><tbody>';
        foreach ($sum['top'] as $k => $n) {
            echo '<tr><td>' . esc_html($k) . '</td><td><strong>' . (int) $n . '</strong></td></tr>';
        }
        echo '</tbody></table><h3>By stage</h3><table class="widefat striped"><tbody>';
        foreach ($sum['byStage'] as $k => $n) {
            echo '<tr><td>' . esc_html(str_replace('stage:', '', $k)) . '</td><td><strong>' . (int) $n . '</strong></td></tr>';
        }
        echo '</tbody></table><p>' . $this->actionButton('clear_events', 'Clear engagement data') . '</p></div></div>';
        echo '<div class="vt-card"><h2>Recent</h2><table class="widefat striped vt-log"><thead><tr><th>When (UTC)</th><th>Booking</th><th>Brand</th><th>Stage</th><th>Event</th><th>Detail</th><th>Device</th></tr></thead><tbody>';
        foreach (\VisionTrips\Support\Events::recent(60) as $e) {
            echo '<tr><td>' . esc_html(gmdate('d M H:i', (int) $e['t'])) . '</td><td>' . esc_html((string) $e['ref']) . '</td><td>' . esc_html((string) $e['brand']) . '</td><td>' . esc_html((string) $e['stage']) . '</td><td>' . esc_html((string) $e['name']) . '</td><td>' . esc_html((string) $e['detail']) . '</td><td>' . esc_html((string) $e['device']) . '</td></tr>';
        }
        echo '</tbody></table></div>';
        $this->formOpen('engagement');
        echo '<div class="vt-card"><h2>Settings</h2>';
        $this->text('events_table', 'Vision table for engagement rows (optional)', 'Create a table in the Vision template with: Booking (link to Bookings), Event, Detail, Stage, When (date/time), Device. Leave blank to keep data in WordPress only.');
        echo '</div>';
        $this->formClose();
    }

    private function tabChangelog(): void
    {
        $md = (string) @file_get_contents(VISION_TRIPS_DIR . 'CHANGELOG.md');
        echo '<div class="vt-card"><h2>Version ' . esc_html(VISION_TRIPS_VERSION) . '</h2>';
        $html = '';
        $inList = false;
        foreach (preg_split('/\r?\n/', $md) ?: [] as $line) {
            if (preg_match('/^## (.*)$/', $line, $m)) {
                $html .= ($inList ? '</ul>' : '') . '<h3>' . esc_html($m[1]) . '</h3>';
                $inList = false;
            } elseif (preg_match('/^### (.*)$/', $line, $m)) {
                $html .= ($inList ? '</ul>' : '') . '<h4>' . esc_html($m[1]) . '</h4>';
                $inList = false;
            } elseif (preg_match('/^- (.*)$/', $line, $m)) {
                $html .= (!$inList ? '<ul>' : '') . '<li>' . esc_html($m[1]) . '</li>';
                $inList = true;
            } elseif (trim($line) === '' || str_starts_with($line, '# ')) {
                continue;
            } else {
                $html .= ($inList ? '</ul>' : '') . '<p>' . esc_html($line) . '</p>';
                $inList = false;
            }
        }
        echo $html . ($inList ? '</ul>' : '') . '</div>';
    }

    private function tabLegal(): void
    {
        $this->formOpen('legal');
        $texts = \VisionTrips\Domain\Legal::texts();
        echo '<div class="vt-card"><h2>Consumer and regulatory texts</h2><p>Shown in the quotation acceptance flow, the "Who you\'re booking with" section and on confirmations, selected automatically from the booking\'s ATOL and Licensing fields. Placeholders: <code>{organiser}</code> <code>{retailer}</code> <code>{member}</code> <code>{atol}</code> <code>{protection}</code> <code>{regulator}</code>. These are plain-English summaries with links to the statutory wording — <strong>have TTNG compliance confirm them before go-live.</strong> Leave a box empty to use the default.</p>';
        $this->checkbox('lta_notice', 'Show the linked travel arrangement notice when a booking is sold as an agent without a flight and contains more than one type of service');
        foreach ($texts as $key => $t) {
            $custom = (string) ((array) Settings::get('legal_texts', []))[$key] ?? '';
            echo '<p><label><span class="vt-label">' . esc_html($t['label']) . '</span><textarea name="legal[' . esc_attr($key) . ']" rows="6" class="large-text">' . esc_textarea($custom !== '' ? $custom : $t['text']) . '</textarea></label></p>';
        }
        echo '</div>';
        $this->formClose();
    }

    private function tabTools(): void
    {
        $this->formOpen('tools');
        echo '<div class="vt-card"><h2>Daily health digest</h2>';
        $this->checkbox('digest_enabled', 'Email a grouped digest of warnings and errors every morning');
        $this->text('digest_email', 'Send to', 'Blank = the WordPress admin email');
        echo '</div>';
        $this->formClose();
        echo '<div class="vt-grid"><div class="vt-card"><h2>Cache</h2><p>' . $this->actionButton('purge_cache', 'Purge all caches') . ' ' . $this->actionButton('flush_rewrites', 'Flush rewrite rules', 'button') . '</p><p class="description">Booking data is cached for ' . esc_html((string) Settings::int('cache_ttl_booking', 60)) . 's; Widgety, Places and AI content for 7–30 days. Purge after changing settings that affect rendering.</p></div>';
        echo '<div class="vt-card"><h2>Log</h2><p>' . $this->actionButton('clear_log', 'Clear log', 'button') . '</p><table class="widefat striped vt-log"><thead><tr><th>Time (UTC)</th><th>Level</th><th>Message</th><th>Context</th></tr></thead><tbody>';
        foreach (array_slice(Log::all(), 0, 150) as $row) {
            echo '<tr class="vt-' . esc_attr((string) $row['l']) . '"><td>' . esc_html((string) $row['t']) . '</td><td>' . esc_html((string) $row['l']) . '</td><td>' . esc_html((string) $row['m']) . '</td><td><code>' . esc_html((string) wp_json_encode($row['c'])) . '</code></td></tr>';
        }
        echo '</tbody></table></div></div>';
    }

    /* ------------------------------------------------------------------ Form helpers */

    private function formOpen(string $tab): void
    {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" class="vt-form">';
        wp_nonce_field('vision_trips_save', '_vtn');
        echo '<input type="hidden" name="action" value="vision_trips_save"><input type="hidden" name="tab" value="' . esc_attr($tab) . '">';
    }

    private function formClose(): void
    {
        echo '<p class="vt-save"><button class="button button-primary button-large">Save changes</button></p></form>';
    }

    private function text(string $key, string $label, string $help = ''): void
    {
        $locked = Settings::isOverriddenByConstant($key);
        echo '<p><label><span class="vt-label">' . esc_html($label) . '</span><input type="text" class="regular-text" name="s[' . esc_attr($key) . ']" value="' . esc_attr((string) Settings::get($key, '')) . '"' . ($locked ? ' disabled' : '') . '></label>' . ($locked ? ' <em>set in wp-config.php</em>' : '') . ($help !== '' ? '<span class="description">' . wp_kses_post($help) . '</span>' : '') . '</p>';
    }

    private function number(string $key, string $label, string $help = ''): void
    {
        echo '<p><label><span class="vt-label">' . esc_html($label) . '</span><input type="number" class="small-text" name="s[' . esc_attr($key) . ']" value="' . esc_attr((string) Settings::get($key, '')) . '"></label>' . ($help !== '' ? '<span class="description">' . esc_html($help) . '</span>' : '') . '</p>';
    }

    private function textarea(string $key, string $label, string $help = ''): void
    {
        echo '<p><label><span class="vt-label">' . esc_html($label) . '</span><textarea name="s[' . esc_attr($key) . ']" rows="5" class="large-text code">' . esc_textarea((string) Settings::get($key, '')) . '</textarea></label>' . ($help !== '' ? '<span class="description">' . esc_html($help) . '</span>' : '') . '</p>';
    }

    private function secret(string $key, string $label, string $help = ''): void
    {
        $locked = Settings::isOverriddenByConstant($key);
        $has = (string) Settings::get($key, '') !== '';
        echo '<p><label><span class="vt-label">' . esc_html($label) . '</span><input type="password" autocomplete="new-password" class="regular-text" name="s[' . esc_attr($key) . ']" value="" placeholder="' . ($has ? '•••••••• (saved)' : 'not set') . '"' . ($locked ? ' disabled' : '') . '></label>';
        if ($has && !$locked) {
            echo ' <label class="vt-clear"><input type="checkbox" name="clear[' . esc_attr($key) . ']" value="1"> clear</label>';
        }
        echo ($locked ? ' <em>set in wp-config.php</em>' : '') . ($help !== '' ? '<span class="description">' . wp_kses_post($help) . '</span>' : '') . '</p>';
    }

    private function checkbox(string $key, string $label, string $help = ''): void
    {
        echo '<p class="vt-check"><label><input type="hidden" name="s[' . esc_attr($key) . ']" value="0"><input type="checkbox" name="s[' . esc_attr($key) . ']" value="1"' . checked(Settings::bool($key), true, false) . '> ' . esc_html($label) . '</label>' . ($help !== '' ? '<span class="description">' . esc_html($help) . '</span>' : '') . '</p>';
    }

    private function select(string $key, string $label, array $options): void
    {
        echo '<p><label><span class="vt-label">' . esc_html($label) . '</span><select name="s[' . esc_attr($key) . ']">';
        foreach ($options as $value => $text) {
            echo '<option value="' . esc_attr((string) $value) . '"' . selected((string) Settings::get($key, ''), (string) $value, false) . '>' . esc_html($text) . '</option>';
        }
        echo '</select></label></p>';
    }

    private function actionButton(string $do, string $label, string $class = 'button button-secondary'): string
    {
        $url = wp_nonce_url(admin_url('admin-post.php?action=vision_trips_action&do=' . $do . '&tab=' . sanitize_key($_GET['tab'] ?? 'status') . '&table=' . rawurlencode((string) ($_GET['table'] ?? ''))), 'vision_trips_action', '_vtn');
        return '<a class="' . esc_attr($class) . '" href="' . esc_url($url) . '">' . esc_html($label) . '</a>';
    }

    private function agentKeyHint(): string
    {
        return substr(hash('sha256', 'agent|' . (string) Settings::get('api_minting_key', '')), 0, 24);
    }

    /* ------------------------------------------------------------------ Handlers */

    public function save(): void
    {
        if (!current_user_can(self::CAP) || !check_admin_referer('vision_trips_save', '_vtn')) {
            wp_die('Not allowed.');
        }
        $tab = sanitize_key($_POST['tab'] ?? 'status');
        $input = isset($_POST['s']) && is_array($_POST['s']) ? wp_unslash($_POST['s']) : [];
        $defaults = Settings::defaults();
        foreach ($input as $key => $value) {
            $key = sanitize_key((string) $key);
            if (!array_key_exists($key, $defaults) || Settings::isOverriddenByConstant($key)) {
                continue;
            }
            if (in_array($key, Settings::SECRETS, true)) {
                $value = trim((string) $value);
                if ($value === '') {
                    continue; // leave unchanged
                }
                Settings::set($key, $value);
                continue;
            }
            $value = match (true) {
                is_bool($defaults[$key]) => (bool) (int) $value,
                is_int($defaults[$key]) => (int) $value,
                in_array($key, ['quote_accept_fields', 'theme_priority'], true) => sanitize_textarea_field((string) $value),
                default => sanitize_text_field((string) $value),
            };
            Settings::set($key, $value);
        }
        foreach ((array) ($_POST['clear'] ?? []) as $key => $_) {
            $key = sanitize_key((string) $key);
            if (in_array($key, Settings::SECRETS, true)) {
                Settings::set($key, '');
            }
        }
        if ($tab === 'themes') {
            $overrides = [];
            foreach ((array) wp_unslash($_POST['theme_overrides'] ?? []) as $tag => $theme) {
                $tag = sanitize_text_field((string) $tag);
                $theme = sanitize_text_field((string) $theme);
                if (isset(Theme::THEMES[$tag]) && isset(Theme::THEMES[$theme]) && $tag !== $theme) {
                    $overrides[$tag] = $theme;
                }
            }
            Settings::set('theme_overrides', $overrides);
        }
        if ($tab === 'experience' && isset($_POST['modules'])) {
            $modules = [];
            foreach ((array) wp_unslash($_POST['modules']) as $k => $v) {
                $k = sanitize_key((string) $k);
                if (isset(Settings::MODULES[$k])) {
                    $modules[$k] = (bool) (int) $v;
                }
            }
            Settings::set('modules', $modules);
        }
        if ($tab === 'legal') {
            $defaults = require VISION_TRIPS_DIR . 'config/legal.php';
            $custom = [];
            foreach ((array) wp_unslash($_POST['legal'] ?? []) as $key => $text) {
                $key = sanitize_key((string) $key);
                $text = trim(sanitize_textarea_field((string) $text));
                if (isset($defaults[$key]) && $text !== '' && $text !== $defaults[$key]['text']) {
                    $custom[$key] = $text;
                }
            }
            Settings::set('legal_texts', $custom);
        }
        if ($tab === 'fields') {
            $table = sanitize_text_field(wp_unslash((string) ($_POST['fields_table'] ?? '')));
            $config = (array) Settings::get('fields', []);
            $rules = [];
            foreach ((array) ($_POST['f'] ?? []) as $k => $row) {
                $name = base64_decode((string) $k, true);
                if ($name === false || $name === '') {
                    continue;
                }
                $rules[$name] = ['show' => !empty($row['show']), 'label' => sanitize_text_field(wp_unslash((string) ($row['label'] ?? ''))), 'order' => (int) ($row['order'] ?? 500)];
            }
            $config[$table] = $rules;
            Settings::set('fields', $config);
        }
        if (in_array($tab, ['experience'], true)) {
            update_option('vision_trips_flush', '1', false);
        }
        Cache::purgeAll();
        wp_safe_redirect(admin_url('admin.php?page=' . self::SLUG . '&tab=' . $tab . '&notice=' . rawurlencode('Saved.')));
        exit;
    }

    public function action(): void
    {
        if (!current_user_can(self::CAP) || !check_admin_referer('vision_trips_action', '_vtn')) {
            wp_die('Not allowed.');
        }
        $do = sanitize_key($_REQUEST['do'] ?? '');
        $tab = sanitize_key($_REQUEST['tab'] ?? 'status');
        $table = sanitize_text_field(wp_unslash((string) ($_REQUEST['table'] ?? '')));
        $notice = 'Done.';
        switch ($do) {
            case 'rotate_pat':
                Settings::rotateAirtablePat();
                $notice = (string) Settings::get('airtable_pat_standby', '') === '' ? 'Error: no standby token to rotate to.' : 'Tokens rotated. The previous token is now standby — revoke it in Airtable when ready.';
                break;
            case 'test_airtable':
                $r = Client::testToken((string) Settings::get('airtable_pat', ''));
                $notice = $r['ok'] ? 'Airtable OK — token can see ' . count($r['bases']) . ' base(s).' : 'Error: ' . $r['error'];
                break;
            case 'test_widgety':
                $w = new Widgety();
                $ship = $w->configured() ? $w->ship('', 'Queen Mary 2') : null;
                $notice = $ship && empty($ship['missing']) ? 'Widgety OK — ship lookup returned "' . ($ship['name'] ?? '') . '".' : 'Error: Widgety lookup failed. Check credentials, Accept header and paths.';
                break;
            case 'clear_events':
                \VisionTrips\Support\Events::clear();
                $notice = 'Engagement data cleared.';
                break;
            case 'send_digest':
                $notice = \VisionTrips\Admin\Diagnostics::sendDigest() ? 'Digest sent.' : 'Nothing to send (no warnings or errors in the last 24h) or digest disabled.';
                break;
            case 'regen_ai':
                \VisionTrips\Support\Cache::bump('ai');
                delete_option('vision_trips_jobs');
                $notice = 'AI copy will be regenerated: every hotel, destination, airline and airport guide is written afresh the next time its page is viewed.';
                break;
            case 'test_ai':
                $r = (new \VisionTrips\Integrations\Ai())->test();
                $notice = $r['ok'] ? 'AI OK — model ' . $r['model'] . ' · ' . $r['message'] : 'Error: AI call failed — ' . $r['message'];
                break;
            case 'refresh_schema':
                $ref = (string) Settings::get('airtable_reference_base', '');
                $tables = $ref !== '' ? (new Client())->schema($ref, true) : [];
                $notice = $tables ? 'Schema refreshed (' . count($tables) . ' tables).' : 'Error: could not fetch schema.';
                break;
            case 'reset_fields':
                $config = (array) Settings::get('fields', []);
                unset($config[$table]);
                Settings::set('fields', $config);
                $notice = 'Field visibility reset to defaults for ' . $table . '.';
                break;
            case 'regen_api_key':
                Settings::set('api_minting_key', Crypto::randomToken(32));
                $notice = 'New API key generated. Update your Airtable automation.';
                break;
            case 'rotate_link_secret':
                Settings::rotateLinkSecret();
                $notice = 'Link signing secret rotated. Existing links stay valid until the next rotation.';
                break;
            case 'purge_cache':
                Cache::purgeAll();
                $notice = 'All caches purged.';
                break;
            case 'flush_rewrites':
                flush_rewrite_rules();
                $notice = 'Rewrite rules flushed.';
                break;
            case 'clear_log':
                Log::clear();
                $notice = 'Log cleared.';
                break;
            case 'open':
                $base = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) ($_POST['base'] ?? ''));
                $record = (string) preg_replace('/[^A-Za-z0-9]/', '', (string) ($_POST['record'] ?? ''));
                if (preg_match('/^app[A-Za-z0-9]{14}$/', $base) && preg_match('/^rec[A-Za-z0-9]{14}$/', $record)) {
                    $scope = !empty($_POST['agent']) ? Token::SCOPE_AGENT : Token::SCOPE_CUSTOMER;
                    $url = Token::urlFor($base, $record, '', $scope, $scope === Token::SCOPE_AGENT ? time() + DAY_IN_SECONDS : 0);
                    wp_safe_redirect($scope === Token::SCOPE_AGENT ? add_query_arg('fresh', '1', $url) : $url);
                    exit;
                }
                $notice = 'Error: invalid base or record id.';
                break;
        }
        wp_safe_redirect(admin_url('admin.php?page=' . self::SLUG . '&tab=' . $tab . ($table !== '' ? '&table=' . rawurlencode($table) : '') . '&notice=' . rawurlencode($notice)));
        exit;
    }
}
