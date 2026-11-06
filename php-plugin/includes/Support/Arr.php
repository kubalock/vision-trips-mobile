<?php
declare(strict_types=1);

namespace VisionTrips\Support;

/**
 * Helpers for reading Airtable field payloads safely.
 * Airtable values arrive as scalars, arrays (lookups / links), attachment objects or collaborator objects.
 */
final class Arr
{
    /**
     * First non-empty value from a list of candidate field names (exact, then whitespace/NBSP-normalised match).
     *
     * @param array<string,mixed> $fields
     * @param string[] $candidates
     */
    public static function pick(array $fields, array $candidates): mixed
    {
        foreach ($candidates as $key) {
            if (array_key_exists($key, $fields) && $fields[$key] !== '' && $fields[$key] !== null && $fields[$key] !== []) {
                return $fields[$key];
            }
        }
        $map = [];
        foreach ($fields as $k => $v) {
            $map[self::normKey((string) $k)] = $k;
        }
        foreach ($candidates as $key) {
            $nk = self::normKey($key);
            if (isset($map[$nk])) {
                $v = $fields[$map[$nk]];
                if ($v !== '' && $v !== null && $v !== []) {
                    return $v;
                }
            }
        }
        return null;
    }

    public static function normKey(string $key): string
    {
        $key = str_replace("\xC2\xA0", ' ', $key);
        $key = (string) preg_replace('/\s+/u', ' ', $key);
        return strtolower(trim($key));
    }

    /**
     * Collect Airtable record IDs anywhere inside a value.
     *
     * @return string[]
     */
    public static function recordIds(mixed $value): array
    {
        $ids = [];
        $walk = static function ($x) use (&$ids, &$walk): void {
            if (is_array($x)) {
                foreach ($x as $v) {
                    $walk($v);
                }
            } elseif (is_scalar($x)) {
                $s = (string) $x;
                if (preg_match('/^rec[a-zA-Z0-9]{14}$/', $s)) {
                    $ids[] = $s;
                }
            }
        };
        $walk($value);
        return array_values(array_unique($ids));
    }

    /**
     * Flatten a value to a list of display strings (names, emails, filenames …), ignoring record IDs.
     *
     * @return string[]
     */
    public static function strings(mixed $value): array
    {
        $out = [];
        $walk = static function ($x) use (&$out, &$walk): void {
            if (is_array($x)) {
                if (isset($x['url'])) {
                    $out[] = (string) ($x['filename'] ?? $x['name'] ?? $x['url']);
                } elseif (isset($x['name'])) {
                    $out[] = (string) $x['name'];
                } elseif (isset($x['email'])) {
                    $out[] = (string) $x['email'];
                } elseif (isset($x['text'])) {
                    $out[] = (string) $x['text'];
                } elseif (isset($x['value'])) {
                    $out[] = (string) $x['value'];
                } else {
                    foreach ($x as $v) {
                        $walk($v);
                    }
                }
            } elseif (is_bool($x)) {
                $out[] = $x ? '1' : '';
            } elseif (is_scalar($x)) {
                $out[] = (string) $x;
            }
        };
        $walk($value);
        $out = array_map(static fn ($s) => Str::clean((string) $s), $out);
        return array_values(array_filter($out, static fn ($s) => $s !== '' && !preg_match('/^rec[a-zA-Z0-9]{14}$/', $s)));
    }

    /** First scalar of a lookup / array, or the scalar itself. */
    public static function first(mixed $value): mixed
    {
        if (is_array($value)) {
            // Collaborator / attachment / select objects: return their display value, never the id.
            if (isset($value['name']) || isset($value['email']) || isset($value['url'])) {
                return (string) ($value['name'] ?? $value['filename'] ?? $value['email'] ?? $value['url'] ?? '');
            }
            foreach ($value as $v) {
                if ($v !== null && $v !== '') {
                    return is_array($v) && !isset($v['url']) ? self::first($v) : $v;
                }
            }
            return null;
        }
        return $value;
    }

    /** Attachment objects anywhere inside a value. @return array<int,array<string,mixed>> */
    public static function attachments(mixed $value): array
    {
        $found = [];
        $walk = static function ($x) use (&$found, &$walk): void {
            if (is_array($x)) {
                if (isset($x['url'])) {
                    $found[] = $x;
                    return;
                }
                foreach ($x as $v) {
                    $walk($v);
                }
            }
        };
        $walk($value);
        return $found;
    }

    /** Normalised attachment list with thumb/full URLs and filtered to images unless $all. */
    public static function images(mixed $value, bool $all = false): array
    {
        $out = [];
        foreach (self::attachments($value) as $att) {
            $type = (string) ($att['type'] ?? '');
            if (!$all && $type !== '' && strpos($type, 'image/') !== 0) {
                continue;
            }
            $out[] = [
                'url'   => (string) $att['url'],
                'thumb' => (string) ($att['thumbnails']['large']['url'] ?? $att['thumbnails']['small']['url'] ?? $att['url']),
                'name'  => (string) ($att['filename'] ?? 'image'),
                'type'  => $type,
                'w'     => (int) ($att['width'] ?? 0),
                'h'     => (int) ($att['height'] ?? 0),
            ];
        }
        return $out;
    }

    public static function truthy(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return ((float) $value) > 0;
        }
        $s = strtolower(trim(Str::clean(implode(' ', self::strings($value)))));
        return in_array($s, ['1', 'true', 'yes', 'y', 'on', 'checked'], true);
    }

    public static function number(mixed $value): float
    {
        $v = self::first($value);
        if (is_numeric($v)) {
            return (float) $v;
        }
        $s = preg_replace('/[^\d.\-]/', '', (string) $v);
        return is_numeric($s) ? (float) $s : 0.0;
    }
}
