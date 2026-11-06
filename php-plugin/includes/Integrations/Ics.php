<?php
declare(strict_types=1);

namespace VisionTrips\Integrations;

use VisionTrips\Domain\Trip;

/**
 * iCalendar export of the itinerary so customers can add their whole trip to Apple/Google calendar in one tap.
 */
final class Ics
{
    public static function build(Trip $trip): string
    {
        $lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vision Trips//' . self::esc($trip->brand->name) . '//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' . self::esc($trip->name)];
        $stamp = gmdate('Ymd\THis\Z');
        foreach ($trip->activeElements() as $e) {
            if (!$e->start) {
                continue;
            }
            $uid = 'vt-' . $e->id . '@vision-trips';
            $summary = $e->title;
            $desc = [];
            if ($e->kind === 'flight') {
                $summary = ($e->carrierCode !== '' && $e->flightNo !== '' ? $e->flightNo . ' ' : 'Flight ') . ($e->fromCode ?: $e->from) . ' to ' . ($e->toCode ?: $e->to);
                if ($e->carrier !== '') {
                    $desc[] = $e->carrier;
                }
            }
            if ($e->supplierRef !== '' && !$e->supplierHidden) {
                $desc[] = 'Reference: ' . $e->supplierRef;
            }
            if ($e->rooms) {
                $desc[] = implode('; ', $e->rooms);
            }
            $desc[] = 'Booked with ' . $trip->brand->name . ' (' . $trip->ref . ')';
            $lines[] = 'BEGIN:VEVENT';
            $lines[] = 'UID:' . $uid;
            $lines[] = 'DTSTAMP:' . $stamp;
            $allDay = $e->startTime === '';
            if ($allDay) {
                $end = ($e->end ?? $e->start)->modify('+1 day');
                $lines[] = 'DTSTART;VALUE=DATE:' . $e->start->format('Ymd');
                $lines[] = 'DTEND;VALUE=DATE:' . $end->format('Ymd');
            } else {
                [$h, $m] = array_map('intval', explode(':', $e->startTime . ':00'));
                $start = $e->start->setTime($h, $m);
                $endDate = $e->end ?? $e->start;
                $end = $start->modify('+2 hours');
                if ($e->endTime !== '' && preg_match('/^(\d{2}):(\d{2})/', $e->endTime, $mm)) {
                    $end = $endDate->setTime((int) $mm[1], (int) $mm[2]);
                    if ($end <= $start) {
                        $end = $end->modify('+1 day');
                    }
                }
                $lines[] = 'DTSTART:' . $start->format('Ymd\THis');
                $lines[] = 'DTEND:' . $end->format('Ymd\THis');
            }
            $lines[] = 'SUMMARY:' . self::esc($summary);
            if ($desc) {
                $lines[] = 'DESCRIPTION:' . self::esc(implode("\n", $desc));
            }
            $loc = $e->address !== '' ? $e->address : ($e->from !== '' ? $e->from : $e->locationName);
            if ($loc !== '') {
                $lines[] = 'LOCATION:' . self::esc($loc);
            }
            $lines[] = 'END:VEVENT';
        }
        $lines[] = 'END:VCALENDAR';
        return implode("\r\n", array_map([self::class, 'fold'], $lines)) . "\r\n";
    }

    private static function esc(string $s): string
    {
        return str_replace(["\\", ";", ",", "\n"], ["\\\\", "\\;", "\\,", "\\n"], $s);
    }

    private static function fold(string $line): string
    {
        $out = '';
        while (strlen($line) > 73) {
            $out .= substr($line, 0, 73) . "\r\n ";
            $line = substr($line, 73);
        }
        return $out . $line;
    }
}
