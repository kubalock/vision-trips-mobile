<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use DateTimeImmutable;
use VisionTrips\Support\Dates;

/**
 * Where the customer is on their journey. Drives the hero, copy, and which modules appear.
 */
final class Stage
{
    public const QUOTE = 'quote';
    public const QUOTE_EXPIRED = 'quote_expired';
    public const CLOSED = 'closed';
    public const CANCELLED = 'cancelled';
    public const CONFIRMED = 'confirmed';     // confirmed, no dates
    public const COUNTDOWN = 'countdown';     // > 14 days
    public const PREP = 'prep';               // 1–14 days
    public const DEPARTURE = 'departure';     // today
    public const TRAVELLING = 'travelling';
    public const RETURNING = 'returning';     // return day
    public const HOME = 'home';               // <= 30 days after return
    public const PAST = 'past';

    public static function resolve(string $status, ?DateTimeImmutable $departs, ?DateTimeImmutable $returns, ?DateTimeImmutable $quoteExpiry, ?DateTimeImmutable $now = null): string
    {
        $now = ($now ?? Dates::now())->setTime(0, 0, 0);
        $s = strtolower(trim($status));
        if ($s === 'closed quotation') {
            return self::CLOSED;
        }
        if ($s === 'cancelled') {
            return self::CANCELLED;
        }
        if ($s === 'quotation' || $s === '') {
            if ($quoteExpiry && $quoteExpiry->setTime(23, 59, 59) < $now) {
                return self::QUOTE_EXPIRED;
            }
            return self::QUOTE;
        }
        if (!$departs) {
            return self::CONFIRMED;
        }
        $d = Dates::daysBetween($now, $departs) ?? 0;
        if ($d > 14) {
            return self::COUNTDOWN;
        }
        if ($d > 0) {
            return self::PREP;
        }
        if ($d === 0) {
            return self::DEPARTURE;
        }
        if ($returns) {
            $r = Dates::daysBetween($now, $returns) ?? 0;
            if ($r > 0) {
                return self::TRAVELLING;
            }
            if ($r === 0) {
                return self::RETURNING;
            }
            if ($r >= -30) {
                return self::HOME;
            }
            return self::PAST;
        }
        return $d >= -30 ? self::TRAVELLING : self::PAST;
    }

    public static function isLive(string $stage): bool
    {
        return in_array($stage, [self::CONFIRMED, self::COUNTDOWN, self::PREP, self::DEPARTURE, self::TRAVELLING, self::RETURNING, self::HOME, self::PAST], true);
    }

    public static function isQuote(string $stage): bool
    {
        return in_array($stage, [self::QUOTE, self::QUOTE_EXPIRED], true);
    }

    public static function isAway(string $stage): bool
    {
        return in_array($stage, [self::DEPARTURE, self::TRAVELLING, self::RETURNING], true);
    }
}
