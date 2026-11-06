<?php
declare(strict_types=1);

namespace VisionTrips\Security;

use VisionTrips\Domain\Trip;
use VisionTrips\Settings;
use VisionTrips\Support\Crypto;
use VisionTrips\Support\Dates;
use VisionTrips\Support\Log;
use VisionTrips\Support\RateLimit;
use VisionTrips\Support\Str;

/**
 * Who can see what.
 *
 * Levels: 0 = link only, 1 = knowledge verified (postcode / surname+DOB), 2 = email OTP verified.
 * Policy:
 *  - Quotation: light (configurable: none | surname | postcode). The customer is reading an offer; friction kills conversion.
 *  - Confirmed / cancelled / closed: knowledge check once per device (30-day signed cookie), unless a signed link
 *    and "trust signed links" is on. Bookings with "Enable 2FA" always require an email OTP.
 *  - Agent-scoped tokens (minted via the API, short-lived) skip challenges.
 */
final class Access
{
    public const LEVEL_LINK = 0;
    public const LEVEL_KNOWLEDGE = 1;
    public const LEVEL_OTP = 2;

    private const COOKIE = 'vtr_s';
    private const OTP_TTL = 600;

    /** Level required to view the trip page. */
    public static function requiredLevel(Trip $trip, bool $signedLink, string $scope): int
    {
        if ($scope === Token::SCOPE_AGENT) {
            return self::LEVEL_LINK;
        }
        if ($trip->enable2fa && Settings::bool('otp_enabled')) {
            return self::LEVEL_OTP;
        }
        if ($trip->isQuote()) {
            $mode = (string) Settings::get('challenge_quotation', 'none');
            if ($mode === 'none' || ($signedLink && Settings::bool('trust_signed_links'))) {
                return self::LEVEL_LINK;
            }
            return self::LEVEL_KNOWLEDGE;
        }
        $mode = (string) Settings::get('challenge_confirmed', 'any');
        if ($mode === 'otp') {
            return self::LEVEL_OTP;
        }
        if ($signedLink && Settings::bool('trust_signed_links')) {
            return self::LEVEL_LINK;
        }
        return self::LEVEL_KNOWLEDGE;
    }

    /** Current level for this booking from the session cookie. */
    public static function currentLevel(string $base, string $record): int
    {
        $raw = $_COOKIE[self::COOKIE . '_' . substr(md5($base . $record), 0, 12)] ?? '';
        if (!is_string($raw) || $raw === '') {
            return self::LEVEL_LINK;
        }
        $data = self::verifySession($raw);
        if (!$data || $data['b'] !== $base || $data['r'] !== $record) {
            return self::LEVEL_LINK;
        }
        return (int) $data['l'];
    }

    public static function grant(string $base, string $record, int $level): void
    {
        $days = max(1, Settings::int('session_days', 30));
        $payload = Crypto::b64((string) wp_json_encode(['b' => $base, 'r' => $record, 'l' => $level, 'e' => time() + $days * DAY_IN_SECONDS, 'n' => Crypto::randomToken(8)]));
        $value = $payload . '.' . Crypto::hmac($payload, self::sessionSecret());
        $name = self::COOKIE . '_' . substr(md5($base . $record), 0, 12);
        $secure = is_ssl();
        if (!headers_sent()) {
            setcookie($name, $value, ['expires' => time() + $days * DAY_IN_SECONDS, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']);
        }
        $_COOKIE[$name] = $value;
    }

    public static function revoke(string $base, string $record): void
    {
        $name = self::COOKIE . '_' . substr(md5($base . $record), 0, 12);
        if (!headers_sent()) {
            setcookie($name, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax']);
        }
        unset($_COOKIE[$name]);
    }

    /** Which challenge options to offer, based on what we know about the booking. @return string[] */
    public static function challengeOptions(Trip $trip): array
    {
        $mode = $trip->isQuote() ? (string) Settings::get('challenge_quotation', 'none') : (string) Settings::get('challenge_confirmed', 'any');
        $opts = [];
        $hasPostcode = $trip->customerPostcode !== '';
        $hasDob = (bool) array_filter($trip->travellers, static fn ($t) => $t->dob !== null);
        $hasSurname = $trip->lead && $trip->lead->last !== '';
        if ($mode === 'postcode' && $hasPostcode) {
            $opts[] = 'postcode';
        } elseif ($mode === 'surname' && $hasSurname) {
            $opts[] = 'surname';
        } elseif ($mode === 'surname_dob' && $hasSurname && $hasDob) {
            $opts[] = 'surname_dob';
        } else {
            if ($hasPostcode) {
                $opts[] = 'postcode';
            }
            if ($hasSurname && $hasDob) {
                $opts[] = 'surname_dob';
            }
            if (!$opts && $hasSurname) {
                $opts[] = 'surname';
            }
        }
        if ($trip->customerEmail !== '' && Settings::bool('otp_enabled')) {
            $opts[] = 'otp';
        }
        return array_values(array_unique($opts));
    }

    /**
     * Check a knowledge answer. Returns true and grants level 1 on success.
     * @param array<string,string> $input
     */
    public static function verifyKnowledge(Trip $trip, string $method, array $input): bool
    {
        $bucket = 'challenge|' . $trip->base . '|' . $trip->id . '|' . RateLimit::ip();
        if (!RateLimit::hit($bucket, Settings::int('max_challenge_attempts', 5), 15 * MINUTE_IN_SECONDS)) {
            Log::warning('Challenge rate limit hit', ['booking' => $trip->id]);
            return false;
        }
        $ok = false;
        switch ($method) {
            case 'postcode':
                $given = Str::normalisePostcode((string) ($input['postcode'] ?? ''));
                $ok = $given !== '' && $given === Str::normalisePostcode($trip->customerPostcode);
                break;
            case 'surname':
                $given = self::normName((string) ($input['surname'] ?? ''));
                $ok = $given !== '' && self::surnameMatches($trip, $given);
                break;
            case 'surname_dob':
                $given = self::normName((string) ($input['surname'] ?? ''));
                $dob = Dates::parse((string) ($input['dob'] ?? ''));
                if ($given !== '' && $dob) {
                    foreach ($trip->travellers as $t) {
                        if ($t->dob && $t->dob->format('Y-m-d') === $dob->format('Y-m-d') && self::normName($t->last) === $given) {
                            $ok = true;
                            break;
                        }
                    }
                }
                break;
        }
        if ($ok) {
            RateLimit::reset($bucket);
            self::grant($trip->base, $trip->id, self::LEVEL_KNOWLEDGE);
        }
        return $ok;
    }

    private static function surnameMatches(Trip $trip, string $given): bool
    {
        if ($trip->lead && self::normName($trip->lead->last) === $given) {
            return true;
        }
        foreach ($trip->travellers as $t) {
            if (self::normName($t->last) === $given) {
                return true;
            }
        }
        return false;
    }

    private static function normName(string $s): string
    {
        $s = strtolower(trim($s));
        if (function_exists('remove_accents')) {
            $s = remove_accents($s);
        }
        return (string) preg_replace('/[^a-z]/', '', $s);
    }

    /** Send a one-time code to the booking's customer email. Returns masked email or '' on failure. */
    public static function sendOtp(Trip $trip): string
    {
        if ($trip->customerEmail === '' || !Settings::bool('otp_enabled')) {
            return '';
        }
        $bucket = 'otp-send|' . $trip->base . '|' . $trip->id;
        if (!RateLimit::hit($bucket, 4, 15 * MINUTE_IN_SECONDS)) {
            return '';
        }
        $code = Crypto::otpCode(6);
        set_transient('vtr_otp_' . md5($trip->base . $trip->id), ['h' => hash_hmac('sha256', $code, self::sessionSecret()), 'e' => time() + self::OTP_TTL, 'a' => 0], self::OTP_TTL);
        $brand = $trip->brand->name;
        $subject = sprintf('%s is your code for %s', $code, $brand);
        $first = $trip->leadFirstName();
        $sent = \VisionTrips\Integrations\Email::send($trip->brand, $trip->customerEmail, $subject, 'Your one-time code',
            '<p>' . ($first !== '' ? 'Hello ' . htmlspecialchars($first, ENT_QUOTES, 'UTF-8') . ',' : 'Hello,') . '</p><p>Enter this code to open your trip page for <strong>' . htmlspecialchars($trip->name, ENT_QUOTES, 'UTF-8') . '</strong>:</p><p style="font-size:36px;letter-spacing:0.25em;font-weight:700;margin:14px 0;color:#1B1D1F;">' . $code . '</p><p>It expires in 10 minutes. If you didn\'t request it, you can ignore this email — nothing has changed on your booking.</p>',
            [], [], 'Your code is ' . $code);
        if (!$sent) {
            Log::error('OTP email failed', ['booking' => $trip->id]);
            return '';
        }
        return Str::maskEmail($trip->customerEmail);
    }

    public static function verifyOtp(Trip $trip, string $code): bool
    {
        $key = 'vtr_otp_' . md5($trip->base . $trip->id);
        $data = get_transient($key);
        if (!is_array($data) || (int) $data['e'] < time()) {
            return false;
        }
        $data['a'] = (int) $data['a'] + 1;
        if ($data['a'] > 5) {
            delete_transient($key);
            return false;
        }
        set_transient($key, $data, max(1, (int) $data['e'] - time()));
        $code = (string) preg_replace('/\D/', '', $code);
        if ($code === '' || !hash_equals((string) $data['h'], hash_hmac('sha256', $code, self::sessionSecret()))) {
            return false;
        }
        delete_transient($key);
        self::grant($trip->base, $trip->id, self::LEVEL_OTP);
        return true;
    }

    /** Portal session: proves an email address for a member base for two hours. */
    public static function grantPortal(string $base, string $email): void
    {
        $payload = Crypto::b64((string) wp_json_encode(['b' => $base, 'm' => strtolower($email), 'e' => time() + 2 * HOUR_IN_SECONDS, 'n' => Crypto::randomToken(6)]));
        $value = $payload . '.' . Crypto::hmac($payload, self::sessionSecret());
        $name = 'vtr_p_' . substr(md5($base), 0, 12);
        if (!headers_sent()) {
            setcookie($name, $value, ['expires' => time() + 2 * HOUR_IN_SECONDS, 'path' => '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax']);
        }
        $_COOKIE[$name] = $value;
    }

    public static function portalEmail(string $base): string
    {
        $raw = $_COOKIE['vtr_p_' . substr(md5($base), 0, 12)] ?? '';
        if (!is_string($raw) || substr_count($raw, '.') !== 1) {
            return '';
        }
        [$payload, $sig] = explode('.', $raw, 2);
        if (!Crypto::equals(Crypto::hmac($payload, self::sessionSecret()), $sig)) {
            return '';
        }
        $data = json_decode(Crypto::unb64($payload), true);
        if (!is_array($data) || ($data['b'] ?? '') !== $base || (int) ($data['e'] ?? 0) < time()) {
            return '';
        }
        return (string) $data['m'];
    }

    public static function revokePortal(string $base): void
    {
        $name = 'vtr_p_' . substr(md5($base), 0, 12);
        if (!headers_sent()) {
            setcookie($name, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax']);
        }
        unset($_COOKIE[$name]);
    }

    private static function sessionSecret(): string
    {
        return hash('sha256', (string) Settings::get('link_secret', '') . '|session|' . (defined('NONCE_KEY') ? NONCE_KEY : ''));
    }

    /** @return array{b:string,r:string,l:int,e:int}|null */
    private static function verifySession(string $raw): ?array
    {
        if (substr_count($raw, '.') !== 1) {
            return null;
        }
        [$payload, $sig] = explode('.', $raw, 2);
        if (!Crypto::equals(Crypto::hmac($payload, self::sessionSecret()), $sig)) {
            return null;
        }
        $data = json_decode(Crypto::unb64($payload), true);
        if (!is_array($data) || (int) ($data['e'] ?? 0) < time()) {
            return null;
        }
        return ['b' => (string) $data['b'], 'r' => (string) $data['r'], 'l' => (int) $data['l'], 'e' => (int) $data['e']];
    }
}
