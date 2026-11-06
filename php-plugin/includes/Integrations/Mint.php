<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Domain\Trip;
use VisionTrips\Settings;
use VisionTrips\Support\Http;
use VisionTrips\Support\Log;

/**
 * Mint Payments payment links (per-brand credentials live on Brands & Branches in Airtable).
 */
final class Mint
{
    private const ENDPOINT = 'https://secure.mintpayments.com/mpay/v5/payment-links';

    public static function enabled(): bool
    {
        return Settings::bool('mint_enabled');
    }

    /**
     * Create a hosted payment link for an amount against the booking's Mint booking id.
     * @return array{ok:bool,url:string,id:string,error:string}
     */
    public static function createLink(Trip $trip, float $amount, string $reference = ''): array
    {
        $creds = $trip->brand->mintCredentials();
        if (!self::enabled() || $creds['key'] === '' || $creds['unit'] === '' || !preg_match('/^BK\./', $trip->mintBookingId)) {
            return ['ok' => false, 'url' => '', 'id' => '', 'error' => 'Online payments are not set up for this booking.'];
        }
        $methods = $trip->brand->mintMethods ?: ['CARD'];
        $currency = $trip->altCurrency && in_array($trip->altCurrencyType, ['USD', 'EUR'], true) ? $trip->altCurrencyType : 'GBP';
        $expiry = ($trip->returns && $trip->returns->getTimestamp() > time()) ? $trip->returns->getTimestamp() : strtotime('+2 years');
        $payload = [
            'business_unit'           => $creds['unit'],
            'amount'                  => number_format($amount, 2, '.', ''),
            'currency'                => $currency,
            'booking'                 => $trip->mintBookingId,
            'allowed_payment_methods' => array_values($methods),
            'overridable_fields'      => ['customer'],
            'transaction_mode'        => 'autocapture',
            'pay_by_utc'              => gmdate('Y-m-d\TH:i:s\Z', (int) $expiry),
            'customer_reference'      => $reference !== '' ? $reference : $trip->ref,
        ];
        if ($trip->brand->mintWebhook !== '' && wp_http_validate_url($trip->brand->mintWebhook) && str_starts_with($trip->brand->mintWebhook, 'https://')) {
            $payload['webhook_url'] = $trip->brand->mintWebhook;
        }
        $res = Http::sendJson('POST', self::ENDPOINT, $payload, ['Authorization' => 'Bearer ' . $creds['key']], 30);
        $url = (string) ($res['data']['payment_link']['url'] ?? '');
        if (!$res['ok'] || $url === '') {
            Log::error('Mint payment link failed', ['status' => $res['status'], 'error' => $res['error'], 'booking' => $trip->id]);
            return ['ok' => false, 'url' => '', 'id' => '', 'error' => 'We could not create the payment link. Please try again or contact your travel agent.'];
        }
        $host = (string) parse_url($url, PHP_URL_HOST);
        if (!str_ends_with($host, 'mintpayments.com')) {
            return ['ok' => false, 'url' => '', 'id' => '', 'error' => 'Unexpected payment URL.'];
        }
        return ['ok' => true, 'url' => $url, 'id' => (string) ($res['data']['payment_link']['id'] ?? ''), 'error' => ''];
    }
}
