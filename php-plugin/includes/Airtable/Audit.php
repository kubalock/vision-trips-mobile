<?php
declare(strict_types=1);

namespace VisionTrips\Airtable;

use VisionTrips\Domain\Trip;
use VisionTrips\Settings;
use VisionTrips\Support\Log;
use VisionTrips\Support\RateLimit;

/**
 * Writes native Airtable comments on the Bookings record so the member sees, in Vision, when and how the customer
 * engaged: first view per device per day, quotation acceptance, questions sent. Needs the token scope
 * data.recordComments:write. Failures are logged and never affect the customer.
 */
final class Audit
{
    public static function viewed(Trip $trip, int $level, string $scope): void
    {
        if (!Settings::bool('view_comments') || $scope === 'a') {
            return;
        }
        $ip = RateLimit::ip();
        $key = 'vtr_seen_' . md5($trip->base . $trip->id . $ip . gmdate('Y-m-d'));
        if (get_transient($key)) {
            return;
        }
        set_transient($key, 1, DAY_IN_SECONDS);
        $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
        $device = preg_match('/iPhone|iPad|Android|Mobile/i', $ua) ? 'mobile' : 'desktop';
        $browser = preg_match('/Edg\//', $ua) ? 'Edge' : (preg_match('/Chrome\//', $ua) ? 'Chrome' : (preg_match('/Safari\//', $ua) ? 'Safari' : (preg_match('/Firefox\//', $ua) ? 'Firefox' : 'browser')));
        $verification = match (true) { $level >= 2 => 'email code', $level >= 1 => 'identity question', default => 'link only' };
        self::post($trip, sprintf('👀 Trip page viewed — %s UTC · %s (%s) · IP %s · verified by %s · stage: %s', gmdate('D j M Y H:i'), $device, $browser, $ip, $verification, $trip->stage));
        self::countView($trip);
    }

    /** Optional "Trip Page Views" / "Trip Page Last Viewed" fields on Bookings, for Vision automations (e.g. quote nudges). */
    private static function countView(Trip $trip): void
    {
        $countField = trim((string) Settings::get('view_count_field', ''));
        $dateField = trim((string) Settings::get('last_view_field', ''));
        if (($countField === '' && $dateField === '') || get_transient('vtr_viewfields_off')) {
            return;
        }
        $fields = [];
        if ($countField !== '') {
            $fields[$countField] = (int) ($trip->raw[$countField] ?? 0) + 1;
        }
        if ($dateField !== '') {
            $fields[$dateField] = gmdate('c');
        }
        if (!(new Client())->patch($trip->base, FieldMap::table('bookings'), $trip->id, $fields)) {
            set_transient('vtr_viewfields_off', 1, HOUR_IN_SECONDS); // fields probably don't exist in this base; try again later
        }
    }

    public static function accepted(Trip $trip, string $name, string $email, bool $written): void
    {
        self::post($trip, sprintf('✅ Quotation accepted online — %s UTC · by %s <%s> · IP %s · fields written: %s', gmdate('D j M Y H:i'), $name, $email, RateLimit::ip(), $written ? 'yes' : 'no (check field names)'));
    }

    public static function question(Trip $trip, string $email, string $message): void
    {
        self::post($trip, sprintf('💬 Customer message via trip page — %s UTC · %s: %s', gmdate('D j M Y H:i'), $email !== '' ? $email : 'no email given', mb_substr($message, 0, 400)));
    }

    private static function post(Trip $trip, string $text): void
    {
        if (!Settings::bool('view_comments')) {
            return;
        }
        $ok = (new Client())->comment($trip->base, FieldMap::table('bookings'), $trip->id, $text);
        if (!$ok) {
            Log::warning('Airtable comment failed (needs data.recordComments:write)', ['booking' => $trip->id]);
        }
    }
}
