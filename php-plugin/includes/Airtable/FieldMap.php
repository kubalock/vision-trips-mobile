<?php
declare(strict_types=1);

namespace VisionTrips\Airtable;

use VisionTrips\Support\Arr;

/**
 * Access to the logical field map (config/fields.php) and customer-visibility rules for raw fields.
 */
final class FieldMap
{
    /** @var array<string,mixed>|null */
    private static ?array $map = null;

    /** @return array<string,mixed> */
    public static function map(): array
    {
        if (self::$map === null) {
            $map = require VISION_TRIPS_DIR . 'config/fields.php';
            self::$map = function_exists('apply_filters') ? (array) apply_filters('vision_trips/field_map', $map) : $map;
        }
        return self::$map;
    }

    public static function table(string $key): string
    {
        return (string) (self::map()['tables'][$key] ?? $key);
    }

    /** @return string[] */
    public static function candidates(string $group, string $key): array
    {
        $c = self::map()[$group][$key] ?? [];
        return is_array($c) ? $c : [];
    }

    /** Pick a logical field from a record's fields array. */
    public static function pick(array $fields, string $group, string $key): mixed
    {
        return Arr::pick($fields, self::candidates($group, $key));
    }

    /** All Airtable field names consumed by a logical group (used to exclude them from "More details"). */
    public static function consumed(string $group): array
    {
        $out = [];
        foreach ((array) (self::map()[$group] ?? []) as $cands) {
            foreach ((array) $cands as $c) {
                $out[Arr::normKey((string) $c)] = true;
            }
        }
        return $out;
    }

    /** Fields that must never reach a customer, even if ticked in Field Studio (money, margins, internal finance). */
    public static function isFinancial(string $name, string $type = ''): bool
    {
        $n = Arr::normKey($name);
        if (in_array(strtolower($type), ['currency', 'percent'], true)) {
            return true;
        }
        return (bool) preg_match('/\b(net|gross|commission|vat|margin|markup|profit|supplement|supplements|cost|costs|invoice|balance|balances|outstanding|paid|payment|payments|refund|refunds|deposit|mint|sings|ibos|taps|corpay|prf|sfc|safi|ms total|ms completed|ms paid|ms outstanding|rate|fee|fees|discount|price|prices|pricing)\b/', $n);
    }

    /**
     * Default rule for raw "More details" fields: hidden unless clearly customer-safe.
     * Everything financial or internal stays off until a TTNG admin ticks it in Field Studio.
     */
    public static function defaultVisible(string $name, string $type = ''): bool
    {
        if (self::isFinancial($name, $type)) {
            return false;
        }
        $n = Arr::normKey($name);
        $t = strtolower($type);
        if (in_array($t, ['formula', 'rollup', 'count', 'lookup', 'button', 'multiplerecordlinks', 'multipleattachments', 'createdby', 'lastmodifiedby', 'createdtime', 'lastmodifiedtime', 'autonumber', 'multiplecollaborators', 'singlecollaborator', 'checkbox', 'url', 'barcode', 'duration'], true)) {
            return false;
        }
        if (preg_match('/\b(klaviyo|deeplink|recordid|json|id|sync|push|import|export|flag|review|complete|received|score|comment|comments|internal|preference|hide|sort|created|modified|classification|ai)\b/', $n)) {
            return false;
        }
        $allow = ['check-in time', 'check in time', 'check-out time', 'check out time', 'board basis', 'meal basis', 'meal plan', 'baggage', 'baggage allowance', 'lounge', 'parking type', 'transfer type', 'duration', 'excursions', 'excursion', 'drinks package', 'gratuities', 'dining', 'dining option', 'resort', 'room type', 'cabin grade', 'deck', 'vehicle', 'tour name', 'tour guide', 'language', 'meeting point', 'dress code', 'what to bring', 'includes', 'included', 'highlights'];
        return in_array($n, $allow, true);
    }
}
