<?php
declare(strict_types=1);

namespace VisionTrips\Support;

use VisionTrips\Airtable\Client;
use VisionTrips\Airtable\FieldMap;
use VisionTrips\Domain\Trip;
use VisionTrips\Settings;

/**
 * Engagement events: what customers open and tap. Kept locally (rolling store + aggregate counts) for the
 * wp-admin Engagement tab, and optionally appended to a Vision table so members see it in Airtable.
 * Event names are a fixed vocabulary; details are short strings; nothing personal is stored.
 */
final class Events
{
    public const NAMES = ['page_view', 'section_open', 'card_open', 'nav_tap', 'ask_tap', 'idea_ask', 'upsell_add', 'accept_start', 'accept_complete', 'pay_click', 'custom_pay', 'doc_open', 'share_tap', 'refer_tap', 'review_tap', 'fold_open', 'guide_open', 'calendar_add', 'print'];
    private const STORE = 'vision_trips_events';
    private const COUNTS = 'vision_trips_event_counts';
    private const MAX_STORE = 4000;

    /** @param array<int,array{name:string,detail:string}> $events */
    public static function record(Trip $trip, array $events, string $device = ''): int
    {
        if (!Settings::module('events')) {
            return 0;
        }
        $store = get_option(self::STORE, []);
        $store = is_array($store) ? $store : [];
        $counts = get_option(self::COUNTS, []);
        $counts = is_array($counts) ? $counts : [];
        $accepted = [];
        foreach (array_slice($events, 0, 25) as $e) {
            $name = (string) ($e['name'] ?? '');
            if (!in_array($name, self::NAMES, true)) {
                continue;
            }
            $detail = mb_substr(trim((string) preg_replace('/[^\pL\pN \-_.,:#@&\/]/u', '', (string) ($e['detail'] ?? ''))), 0, 80);
            $row = ['t' => time(), 'b' => $trip->base, 'r' => $trip->id, 'ref' => $trip->ref, 'brand' => $trip->brand->name, 'stage' => $trip->stage, 'theme' => $trip->theme, 'name' => $name, 'detail' => $detail, 'device' => $device];
            $store[] = $row;
            $accepted[] = $row;
            $ck = $name . '|' . $detail;
            $counts[$ck] = (int) ($counts[$ck] ?? 0) + 1;
            $sk = 'stage:' . $trip->stage . '|' . $name;
            $counts[$sk] = (int) ($counts[$sk] ?? 0) + 1;
        }
        if (!$accepted) {
            return 0;
        }
        if (count($store) > self::MAX_STORE) {
            $store = array_slice($store, -self::MAX_STORE);
        }
        update_option(self::STORE, $store, false);
        update_option(self::COUNTS, $counts, false);
        $table = trim((string) Settings::get('events_table', ''));
        if ($table !== '') {
            Jobs::dispatch('events', ['base' => $trip->base, 'table' => $table, 'rows' => $accepted], 'events|' . $trip->id . '|' . time() . '|' . Crypto::randomToken(3));
        }
        return count($accepted);
    }

    /** Background: append rows to the Vision engagement table. @param array<string,mixed> $args */
    public static function flush(array $args): void
    {
        $client = new Client();
        $base = (string) $args['base'];
        $table = (string) $args['table'];
        foreach ((array) $args['rows'] as $row) {
            $client->create($base, $table, [
                'Booking' => [(string) $row['r']],
                'Event'   => (string) $row['name'],
                'Detail'  => (string) $row['detail'],
                'Stage'   => (string) $row['stage'],
                'When'    => gmdate('c', (int) $row['t']),
                'Device'  => (string) $row['device'],
            ]);
        }
    }

    /** @return array<string,int> */
    public static function counts(): array
    {
        $c = get_option(self::COUNTS, []);
        return is_array($c) ? $c : [];
    }

    /** @return array<int,array<string,mixed>> */
    public static function recent(int $n = 60): array
    {
        $s = get_option(self::STORE, []);
        return is_array($s) ? array_reverse(array_slice($s, -$n)) : [];
    }

    public static function clear(): void
    {
        delete_option(self::STORE);
        delete_option(self::COUNTS);
    }

    /** Summary for the admin tab. @return array{views:int,accept_start:int,accept_complete:int,pay:int,asks:array<string,int>,top:array<string,int>,byStage:array<string,int>} */
    public static function summary(): array
    {
        $c = self::counts();
        $sum = static function (string $name) use ($c): int {
            $t = 0;
            foreach ($c as $k => $v) {
                if (str_starts_with($k, $name . '|')) {
                    $t += (int) $v;
                }
            }
            return $t;
        };
        $asks = [];
        $top = [];
        $byStage = [];
        foreach ($c as $k => $v) {
            if (str_starts_with($k, 'idea_ask|') || str_starts_with($k, 'upsell_add|')) {
                $asks[substr($k, (int) strpos($k, '|') + 1) ?: '(unspecified)'] = ((int) ($asks[substr($k, (int) strpos($k, '|') + 1) ?: '(unspecified)'] ?? 0)) + (int) $v;
            } elseif (str_starts_with($k, 'stage:')) {
                $byStage[$k] = (int) $v;
            } else {
                $top[$k] = (int) $v;
            }
        }
        arsort($asks);
        arsort($top);
        ksort($byStage);
        return ['views' => $sum('page_view'), 'accept_start' => $sum('accept_start'), 'accept_complete' => $sum('accept_complete'), 'pay' => $sum('pay_click') + $sum('custom_pay'), 'asks' => $asks, 'top' => array_slice($top, 0, 25, true), 'byStage' => $byStage];
    }
}
