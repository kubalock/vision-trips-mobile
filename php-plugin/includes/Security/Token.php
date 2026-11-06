<?php
declare(strict_types=1);

namespace VisionTrips\Security;

use VisionTrips\Settings;
use VisionTrips\Support\Crypto;

/**
 * Opaque trip tokens: base64url(payload) . "." . HMAC. Payload: {v,b,r,s,e}
 *  v = version, b = base id, r = record id, s = scope (c customer | a agent), e = expiry epoch (0 = none)
 */
final class Token
{
    public const SCOPE_CUSTOMER = 'c';
    public const SCOPE_AGENT = 'a';

    public static function mint(string $base, string $record, string $scope = self::SCOPE_CUSTOMER, int $expires = 0, bool $legacy = false, bool $traveller = false): string
    {
        $data = ['v' => 1, 'b' => $base, 'r' => $record, 's' => $scope, 'e' => $expires];
        if ($traveller) {
            $data['t'] = 1; // shared with a fellow traveller: itinerary and documents, nothing financial
        }
        if ($legacy) {
            $data['l'] = 1; // minted from an old ?member=&booking= link: never treated as a trusted signed link
        }
        $payload = Crypto::b64((string) wp_json_encode($data));
        return $payload . '.' . Crypto::hmac($payload, (string) Settings::get('link_secret', ''));
    }

    /** @return array{base:string,record:string,scope:string,expires:int,legacy:bool}|null */
    public static function parse(string $token): ?array
    {
        $token = trim($token);
        if ($token === '' || substr_count($token, '.') !== 1) {
            return null;
        }
        [$payload, $sig] = explode('.', $token, 2);
        $valid = false;
        foreach ([(string) Settings::get('link_secret', ''), (string) Settings::get('link_secret_previous', '')] as $secret) {
            if ($secret !== '' && Crypto::equals(Crypto::hmac($payload, $secret), $sig)) {
                $valid = true;
                break;
            }
        }
        if (!$valid) {
            return null;
        }
        $data = json_decode(Crypto::unb64($payload), true);
        if (!is_array($data) || empty($data['b']) || empty($data['r'])) {
            return null;
        }
        if (!preg_match('/^app[A-Za-z0-9]{14}$/', (string) $data['b']) || !preg_match('/^rec[A-Za-z0-9]{14}$/', (string) $data['r'])) {
            return null;
        }
        $exp = (int) ($data['e'] ?? 0);
        if ($exp > 0 && $exp < time()) {
            return null;
        }
        return ['base' => (string) $data['b'], 'record' => (string) $data['r'], 'scope' => (string) ($data['s'] ?? self::SCOPE_CUSTOMER), 'expires' => $exp, 'legacy' => !empty($data['l']), 'traveller' => !empty($data['t'])];
    }

    /** Public URL for a trip token (optionally a sub-view). */
    public static function url(string $token, string $path = ''): string
    {
        $slug = trim((string) Settings::get('trip_page_slug', 'trip'), '/');
        $url = home_url('/' . $slug . '/' . rawurlencode($token) . '/');
        if ($path !== '') {
            $url .= trim($path, '/') . '/';
        }
        return $url;
    }

    public static function urlFor(string $base, string $record, string $path = '', string $scope = self::SCOPE_CUSTOMER, int $expires = 0, bool $legacy = false): string
    {
        return self::url(self::mint($base, $record, $scope, $expires, $legacy), $path);
    }
}
