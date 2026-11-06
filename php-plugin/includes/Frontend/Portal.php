<?php
declare(strict_types=1);

namespace VisionTrips\Frontend;

use VisionTrips\Airtable\BookingRepository;
use VisionTrips\Airtable\Client;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Domain\Brand;
use VisionTrips\Domain\Stage;
use VisionTrips\Domain\Theme;
use VisionTrips\Integrations\Email;
use VisionTrips\Security\Access;
use VisionTrips\Security\Token;
use VisionTrips\Settings;
use VisionTrips\Support\Cache;
use VisionTrips\Support\Crypto;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Log;
use VisionTrips\Support\RateLimit;

/**
 * /my-trips/?m={baseId}
 *  email → one-time code → signed two-hour portal session → trips list and marketing preferences.
 * The UI never reveals whether an email is known: the code step looks identical either way.
 */
final class Portal
{
    private const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    private const AIRPORTS = ['Aberdeen Airport', 'Belfast City Airport', 'Belfast International Airport', 'Birmingham International Airport', 'Bournemouth Airport', 'Bristol Airport', 'Cardiff Airport', 'East Midlands Airport', 'Edinburgh Airport', 'Exeter Airport', 'Glasgow Airport', 'Humberside Airport', 'Inverness Airport', 'Leeds Bradford Airport', 'Liverpool John Lennon Airport', 'London City Airport', 'London Gatwick Airport', 'London Heathrow Airport', 'London Luton Airport', 'London Southend Airport', 'London Stansted Airport', 'Manchester Airport', 'Newcastle Airport', 'Newquay Airport', 'Norwich Airport', 'Southampton Airport', 'Teesside Airport'];

    public function handle(): void
    {
        if (!Settings::bool('portal_enabled')) {
            echo View::render('states/plain', ['title' => 'Portal unavailable', 'message' => 'The trip portal is switched off.', 'status' => 404]);
            return;
        }
        $base = isset($_GET['m']) ? preg_replace('/[^A-Za-z0-9]/', '', (string) $_GET['m']) : '';
        if (!preg_match('/^app[A-Za-z0-9]{14}$/', $base)) {
            echo View::render('states/plain', ['title' => 'Which travel company?', 'message' => 'Please use the "My trips" link on your travel company\'s website or in an email from them.', 'status' => 400]);
            return;
        }
        $client = new Client();
        if (!$client->configured()) {
            echo View::render('states/plain', ['title' => 'Not configured', 'message' => 'This site is not connected to Vision yet.', 'status' => 503]);
            return;
        }
        $repo = new BookingRepository($client);
        $brand = $this->brandForBase($client, $base);
        $self = add_query_arg('m', $base, home_url('/' . trim((string) Settings::get('portal_page_slug', 'my-trips'), '/') . '/'));
        $vars = [
            'brand' => $brand, 'base' => $base, 'step' => 'email', 'error' => '', 'notice' => '', 'email' => '', 'trips' => [], 'prefs' => null,
            'airports' => [], 'months' => self::MONTHS, 'nonce' => wp_create_nonce('vt_portal_' . $base), 'self' => $self,
            'accent' => $brand->colour !== '' ? $brand->colour : '#1F4F6E', 'theme' => 'default', 'spec' => Theme::spec('default'),
            'fontsUrl' => Theme::fontsUrl('default', $brand->fontDisplay, $brand->fontBody), 'displayFont' => $brand->fontDisplay !== '' ? $brand->fontDisplay : 'Fraunces', 'bodyFont' => $brand->fontBody !== '' ? $brand->fontBody : 'Instrument Sans',
        ];
        $session = Access::portalEmail($base);
        $view = isset($_GET['view']) ? sanitize_key((string) $_GET['view']) : '';

        if (isset($_GET['signout'])) {
            Access::revokePortal($base);
            wp_safe_redirect($self, 303);
            exit;
        }

        if ($_SERVER['REQUEST_METHOD'] === 'POST' && wp_verify_nonce((string) ($_POST['_vt'] ?? ''), 'vt_portal_' . $base)) {
            $action = (string) ($_POST['vt_action'] ?? '');
            $email = strtolower(trim((string) ($_POST['email'] ?? '')));
            $vars['email'] = $email;
            if (!RateLimit::hit('portal|' . RateLimit::ip(), 12, 15 * MINUTE_IN_SECONDS)) {
                $vars['error'] = 'Too many attempts. Please wait a few minutes.';
            } elseif ($action === 'send' && is_email($email)) {
                if ($repo->findByEmail($base, $email) || $repo->findCustomers($base, $email)) {
                    $code = Crypto::otpCode(6);
                    set_transient('vtr_portal_' . md5($base . $email), ['h' => hash_hmac('sha256', $code, (string) Settings::get('link_secret', '')), 'e' => time() + 600, 'a' => 0], 600);
                    Email::send($brand, $email, $code . ' is your code for ' . $brand->name, 'Your one-time code',
                        '<p>Hello,</p><p>Enter this code to see your trips and preferences with <strong>' . htmlspecialchars($brand->name, ENT_QUOTES, 'UTF-8') . '</strong>:</p><p style="font-size:36px;letter-spacing:0.25em;font-weight:700;margin:14px 0;color:#1B1D1F;">' . $code . '</p><p>It expires in 10 minutes.</p>', [], [], 'Your code is ' . $code);
                } else {
                    Log::info('Portal: unknown email', ['base' => $base]);
                }
                $vars['step'] = 'code';
            } elseif ($action === 'verify' && is_email($email)) {
                $key = 'vtr_portal_' . md5($base . $email);
                $data = get_transient($key);
                $code = (string) preg_replace('/\D/', '', (string) ($_POST['code'] ?? ''));
                $ok = false;
                if (is_array($data) && (int) $data['e'] > time() && (int) $data['a'] < 5) {
                    $data['a']++;
                    set_transient($key, $data, max(1, (int) $data['e'] - time()));
                    $ok = $code !== '' && hash_equals((string) $data['h'], hash_hmac('sha256', $code, (string) Settings::get('link_secret', '')));
                }
                if ($ok) {
                    delete_transient($key);
                    Access::grantPortal($base, $email);
                    $session = $email;
                    $view = '';
                } else {
                    $vars['step'] = 'code';
                    $vars['error'] = 'That code is not right or has expired.';
                }
            } elseif ($action === 'prefs' && $session !== '') {
                $airports = array_values(array_intersect($repo->customerOptions($base, 'pref_airports', self::AIRPORTS), array_map('sanitize_text_field', (array) wp_unslash($_POST['airports'] ?? []))));
                $months = array_values(array_intersect(self::MONTHS, array_map('sanitize_text_field', (array) wp_unslash($_POST['months'] ?? []))));
                $r = $repo->savePreferences($base, $session, !empty($_POST['mkt_email']), !empty($_POST['mkt_sms']), !empty($_POST['mkt_post']), $airports, $months);
                $vars['notice'] = $r['ok'] ? 'Saved. Thank you — we\'ll only get in touch the way you\'ve chosen.' : ($r['updated'] > 0 ? 'Saved for ' . $r['updated'] . ' of your records. Please check with us if anything looks wrong.' : 'We could not save that just now. Please try again or let us know.');
                $view = 'prefs';
            } else {
                $vars['error'] = 'Please enter a valid email address.';
            }
        }

        if ($session !== '') {
            $vars['email'] = $session;
            if ($view === 'prefs') {
                $vars['step'] = 'prefs';
                $vars['prefs'] = $repo->preferences($base, $session);
                $vars['airports'] = $repo->customerOptions($base, 'pref_airports', self::AIRPORTS);
            } else {
                $list = $repo->findByEmail($base, $session);
                foreach ($list as &$t) {
                    Access::grant($base, $t['id'], Access::LEVEL_OTP);
                    $t['url'] = Token::urlFor($base, $t['id']);
                    $t['stage'] = Stage::resolve($t['status'], Dates::parse($t['departs']), Dates::parse($t['returns']), null);
                }
                unset($t);
                $vars['trips'] = $list;
                $vars['step'] = 'list';
            }
        }
        echo View::render('portal/page', $vars);
    }

    private function brandForBase(Client $client, string $base): Brand
    {
        $cached = Cache::get('portal-brand', $base);
        if (is_array($cached) && !empty($cached['brand'])) {
            return Brand::fromRecords($cached['brand'], $cached['member'] ?? []);
        }
        $brands = $client->find($base, FieldMap::table('brands'), '{Approved & Active}=1', [], 1);
        $brand = $brands[0] ?? [];
        $members = $client->find($base, FieldMap::table('members'), '1=1', [], 1);
        $member = $members[0] ?? [];
        Cache::set('portal-brand', $base, ['brand' => $brand, 'member' => $member], HOUR_IN_SECONDS);
        return Brand::fromRecords($brand, $member);
    }
}
