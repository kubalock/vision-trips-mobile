<?php
declare(strict_types=1);

namespace VisionTrips\Support;

/**
 * Encryption at rest for API keys (libsodium secretbox, fallback AES-256-GCM) and HMAC signing utilities.
 * The symmetric key is derived from WordPress AUTH_KEY + SECURE_AUTH_KEY, or VISION_TRIPS_MASTER_KEY if defined.
 */
final class Crypto
{
    private const PREFIX_SODIUM = 'vts1:';
    private const PREFIX_OPENSSL = 'vto1:';

    private static function masterKey(): string
    {
        if (defined('VISION_TRIPS_MASTER_KEY') && is_string(VISION_TRIPS_MASTER_KEY) && VISION_TRIPS_MASTER_KEY !== '') {
            $seed = VISION_TRIPS_MASTER_KEY;
        } else {
            $seed = (defined('AUTH_KEY') ? AUTH_KEY : '') . '|' . (defined('SECURE_AUTH_KEY') ? SECURE_AUTH_KEY : '') . '|vision-trips';
        }
        return hash('sha256', $seed, true); // 32 bytes
    }

    public static function encrypt(string $plain): string
    {
        if ($plain === '') {
            return '';
        }
        if (function_exists('sodium_crypto_secretbox')) {
            $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
            $cipher = sodium_crypto_secretbox($plain, $nonce, self::masterKey());
            return self::PREFIX_SODIUM . self::b64($nonce . $cipher);
        }
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plain, 'aes-256-gcm', self::masterKey(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            return '';
        }
        return self::PREFIX_OPENSSL . self::b64($iv . $tag . $cipher);
    }

    public static function decrypt(string $stored): string
    {
        if ($stored === '') {
            return '';
        }
        try {
            if (str_starts_with($stored, self::PREFIX_SODIUM) && function_exists('sodium_crypto_secretbox_open')) {
                $raw = self::unb64(substr($stored, strlen(self::PREFIX_SODIUM)));
                $nonce = substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
                $cipher = substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
                $plain = sodium_crypto_secretbox_open($cipher, $nonce, self::masterKey());
                return $plain === false ? '' : $plain;
            }
            if (str_starts_with($stored, self::PREFIX_OPENSSL)) {
                $raw = self::unb64(substr($stored, strlen(self::PREFIX_OPENSSL)));
                $iv = substr($raw, 0, 12);
                $tag = substr($raw, 12, 16);
                $cipher = substr($raw, 28);
                $plain = openssl_decrypt($cipher, 'aes-256-gcm', self::masterKey(), OPENSSL_RAW_DATA, $iv, $tag);
                return $plain === false ? '' : $plain;
            }
        } catch (\Throwable) {
            return '';
        }
        // Legacy plain value (pre-encryption) — return as is so rotation can re-encrypt.
        return $stored;
    }

    public static function b64(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    public static function unb64(string $enc): string
    {
        $enc = strtr($enc, '-_', '+/');
        $pad = strlen($enc) % 4;
        if ($pad) {
            $enc .= str_repeat('=', 4 - $pad);
        }
        return (string) base64_decode($enc, true);
    }

    public static function hmac(string $data, string $secret): string
    {
        return self::b64(hash_hmac('sha256', $data, $secret, true));
    }

    public static function randomToken(int $bytes = 24): string
    {
        return self::b64(random_bytes($bytes));
    }

    public static function otpCode(int $digits = 6): string
    {
        $max = (10 ** $digits) - 1;
        return str_pad((string) random_int(0, $max), $digits, '0', STR_PAD_LEFT);
    }

    public static function equals(string $a, string $b): bool
    {
        return hash_equals($a, $b);
    }
}
