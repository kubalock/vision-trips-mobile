<?php
declare(strict_types=1);

namespace VisionTrips\Support;

use DateTimeImmutable;
use DateTimeZone;

final class Dates
{
    public static function tz(): DateTimeZone
    {
        if (function_exists('wp_timezone')) {
            return wp_timezone();
        }
        return new DateTimeZone('Europe/London');
    }

    public static function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', self::tz());
    }

    /**
     * Parse any Airtable date value (ISO date, ISO datetime, lookup array, "6/5/2027" US style from formulas).
     */
    public static function parse(mixed $value): ?DateTimeImmutable
    {
        if ($value instanceof DateTimeImmutable) {
            return $value;
        }
        if ($value instanceof \DateTimeInterface) {
            return DateTimeImmutable::createFromInterface($value);
        }
        $v = Arr::first($value);
        if ($v === null) {
            return null;
        }
        $s = Str::clean($v);
        if ($s === '') {
            return null;
        }
        try {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) {
                return new DateTimeImmutable($s . ' 00:00:00', self::tz());
            }
            if (preg_match('/^\d{4}-\d{2}-\d{2}T/', $s)) {
                $d = new DateTimeImmutable($s);
                return $d->setTimezone(self::tz());
            }
            if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/', $s, $m)) {
                // Airtable formula dates default to M/D/YYYY
                $d = DateTimeImmutable::createFromFormat('n/j/Y', $s, self::tz());
                if ($d) {
                    return $d->setTime(0, 0, 0);
                }
            }
            if (is_numeric($s)) {
                return (new DateTimeImmutable('@' . (int) $s))->setTimezone(self::tz());
            }
            $d = new DateTimeImmutable($s, self::tz());
            return $d;
        } catch (\Throwable) {
            return null;
        }
    }

    /** "Thursday 6 May 2027" */
    public static function long(mixed $value): string
    {
        $d = self::parse($value);
        return $d ? $d->format('l j F Y') : '';
    }

    /** "Thu 6 May" */
    public static function short(mixed $value, bool $withYear = false): string
    {
        $d = self::parse($value);
        return $d ? $d->format($withYear ? 'D j M Y' : 'D j M') : '';
    }

    /** "6 May 2027" */
    public static function medium(mixed $value): string
    {
        $d = self::parse($value);
        return $d ? $d->format('j M Y') : '';
    }

    public static function numeric(mixed $value): string
    {
        $d = self::parse($value);
        return $d ? $d->format('d/m/Y') : '';
    }

    public static function iso(mixed $value): string
    {
        $d = self::parse($value);
        return $d ? $d->format('Y-m-d') : '';
    }

    /** Human range "6–17 May 2027" or "28 Dec 2026 – 4 Jan 2027". */
    public static function range(mixed $from, mixed $to): string
    {
        $a = self::parse($from);
        $b = self::parse($to);
        if ($a && $b) {
            if ($a->format('Y-m') === $b->format('Y-m')) {
                return $a->format('j') . '–' . $b->format('j F Y');
            }
            if ($a->format('Y') === $b->format('Y')) {
                return $a->format('j M') . ' – ' . $b->format('j M Y');
            }
            return $a->format('j M Y') . ' – ' . $b->format('j M Y');
        }
        return $a ? $a->format('j F Y') : ($b ? $b->format('j F Y') : '');
    }

    /** Time like "10:40" from text fields such as "10:40", "1040", "10.40am". */
    public static function time(mixed $value): string
    {
        $s = Str::clean(Arr::first($value));
        if ($s === '') {
            return '';
        }
        if (preg_match('/^(\d{1,2})[:.]?(\d{2})\s*(am|pm)?$/i', $s, $m)) {
            $h = (int) $m[1];
            $mi = $m[2];
            $ap = strtolower($m[3] ?? '');
            if ($ap === 'pm' && $h < 12) {
                $h += 12;
            }
            if ($ap === 'am' && $h === 12) {
                $h = 0;
            }
            return sprintf('%02d:%s', $h, $mi);
        }
        return $s;
    }

    public static function daysBetween(?DateTimeImmutable $a, ?DateTimeImmutable $b): ?int
    {
        if (!$a || !$b) {
            return null;
        }
        $a0 = $a->setTime(0, 0, 0);
        $b0 = $b->setTime(0, 0, 0);
        return (int) $a0->diff($b0)->format('%r%a');
    }
}
