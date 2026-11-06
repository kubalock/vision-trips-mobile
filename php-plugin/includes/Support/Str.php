<?php
declare(strict_types=1);

namespace VisionTrips\Support;

final class Str
{
    /** Trim, strip a stray wrapping pair of quotes (some Vision formulas emit them) and drop "Array"/placeholder values. */
    public static function clean(mixed $value): string
    {
        if (is_array($value)) {
            return implode(', ', Arr::strings($value));
        }
        if ($value === null || is_bool($value)) {
            return $value === true ? '1' : '';
        }
        $s = trim((string) $value);
        if ($s === '' || $s === 'Array') {
            return '';
        }
        if (strlen($s) > 1 && $s[0] === '"' && substr($s, -1) === '"') {
            $s = trim(substr($s, 1, -1));
        }
        if (preg_match('/^(tbc|tba|n\/?a|not (set|available)|none|null)$/i', $s) || preg_match('/^(rec|usr|fld|tbl)[A-Za-z0-9]{14}$/', $s)) {
            return '';
        }
        if (function_exists('iconv')) {
            $conv = @iconv('UTF-8', 'UTF-8//IGNORE', $s);
            if (is_string($conv)) {
                $s = $conv;
            }
        }
        return $s;
    }

    public static function slug(string $s): string
    {
        $s = strtolower(trim($s));
        if (function_exists('remove_accents')) {
            $s = remove_accents($s);
        } elseif (function_exists('iconv')) {
            $c = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s);
            if (is_string($c) && $c !== '') {
                $s = $c;
            }
        }
        $s = str_replace('&', ' and ', $s);
        $s = (string) preg_replace('/[^a-z0-9]+/', '-', $s);
        return trim((string) preg_replace('/-+/', '-', $s), '-');
    }

    public static function money(float $amount, string $currency = 'GBP'): string
    {
        $currency = strtoupper(trim($currency)) ?: 'GBP';
        $symbols = ['GBP' => '£', 'EUR' => '€', 'USD' => '$', 'CAD' => 'CA$', 'AUD' => 'A$', 'NOK' => 'kr '];
        $neg = $amount < 0;
        $formatted = number_format(abs($amount), 2, '.', ',');
        $sym = $symbols[$currency] ?? ($currency . ' ');
        return ($neg ? '−' : '') . $sym . $formatted;
    }

    public static function truncate(string $s, int $n = 160): string
    {
        $s = trim(strip_tags($s));
        if (mb_strlen($s) <= $n) {
            return $s;
        }
        $t = mb_substr($s, 0, $n - 1);
        $sp = mb_strrpos($t, ' ');
        if ($sp !== false && $sp > $n * 0.6) {
            $t = mb_substr($t, 0, $sp);
        }
        return rtrim($t, " ,;:.") . '…';
    }

    public static function firstName(string $full): string
    {
        $full = trim($full);
        if ($full === '') {
            return '';
        }
        $parts = preg_split('/\s+/', $full) ?: [];
        $first = $parts[0] ?? '';
        if (preg_match('/^(mr|mrs|ms|miss|mx|dr|prof|rev|sir|dame|lady|lord)\.?$/i', $first) && isset($parts[1])) {
            return $parts[1];
        }
        return $first;
    }

    public static function lastName(string $full): string
    {
        $parts = preg_split('/\s+/', trim($full)) ?: [];
        return (string) end($parts);
    }

    /**
     * Convert Airtable rich text / markdown-ish long text to a safe HTML subset.
     */
    public static function richText(string $text): string
    {
        $text = self::clean($text);
        if ($text === '') {
            return '';
        }
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = str_replace("\xC2\xA0", ' ', $text);
        $hadHtml = (bool) preg_match('/<(p|br|ul|ol|li|strong|em|b|i|a|h[1-6]|div|span)\b/i', $text);
        if ($hadHtml) {
            // Feeds (Widgety, CMS) mix HTML with markdown emphasis and bare newlines: normalise before sanitising.
            $text = (string) preg_replace('/<\s*\/?\s*(div|section|article|span|font|table|tbody|tr|td|th)[^>]*>/i', ' ', $text);
            $text = (string) preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $text);
            $text = (string) preg_replace('/(?<![\w*<])\*(?!\*)([^*\n<]+?)\*(?![\w*>])/', '<em>$1</em>', $text);
            $text = (string) preg_replace('/(<br\s*\/?>\s*){2,}/i', '</p><p>', $text);
            if (!preg_match('/<p\b/i', $text)) {
                $text = '<p>' . (string) preg_replace('/\n{2,}/', '</p><p>', trim($text)) . '</p>';
                $text = (string) preg_replace('/\n/', '<br>', $text);
            }
            $text = (string) preg_replace('/<p>\s*<\/p>/', '', $text);
        }
        if (!$hadHtml) {
            $text = htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
            $text = (string) preg_replace('/^######\s*(.+)$/m', '<h6>$1</h6>', $text);
            $text = (string) preg_replace('/^#####\s*(.+)$/m', '<h5>$1</h5>', $text);
            $text = (string) preg_replace('/^####\s*(.+)$/m', '<h4>$1</h4>', $text);
            $text = (string) preg_replace('/^###\s*(.+)$/m', '<h4>$1</h4>', $text);
            $text = (string) preg_replace('/^##\s*(.+)$/m', '<h3>$1</h3>', $text);
            $text = (string) preg_replace('/^#\s*(.+)$/m', '<h3>$1</h3>', $text);
            $text = (string) preg_replace('/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/', '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>', $text);
            $text = (string) preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $text);
            $text = (string) preg_replace('/__(.+?)__/s', '<strong>$1</strong>', $text);
            $text = (string) preg_replace('/(?<![\w*])\*(?!\*)([^*\n]+?)\*(?![\w*])/', '<em>$1</em>', $text);
            $text = (string) preg_replace('/(?<![\w_])_(?!_)([^_\n]+?)_(?![\w_])/', '<em>$1</em>', $text);
            $text = (string) preg_replace('/(?<!["\'=>])(https?:\/\/[^\s<]+)/', '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>', $text);
            // lists + paragraphs
            $lines = explode("\n", $text);
            $out = '';
            $inUl = $inOl = false;
            $para = [];
            $flush = static function () use (&$para, &$out): void {
                if ($para) {
                    $out .= '<p>' . implode('<br>', $para) . '</p>';
                    $para = [];
                }
            };
            foreach ($lines as $line) {
                $t = rtrim($line);
                if (preg_match('/^\s*[-*•]\s+(.+)$/', $t, $m)) {
                    $flush();
                    if ($inOl) { $out .= '</ol>'; $inOl = false; }
                    if (!$inUl) { $out .= '<ul>'; $inUl = true; }
                    $out .= '<li>' . $m[1] . '</li>';
                } elseif (preg_match('/^\s*\d+[.)]\s+(.+)$/', $t, $m)) {
                    $flush();
                    if ($inUl) { $out .= '</ul>'; $inUl = false; }
                    if (!$inOl) { $out .= '<ol>'; $inOl = true; }
                    $out .= '<li>' . $m[1] . '</li>';
                } elseif (trim($t) === '') {
                    $flush();
                    if ($inUl) { $out .= '</ul>'; $inUl = false; }
                    if ($inOl) { $out .= '</ol>'; $inOl = false; }
                } elseif (preg_match('/^<h[3-6]>/', $t)) {
                    $flush();
                    if ($inUl) { $out .= '</ul>'; $inUl = false; }
                    if ($inOl) { $out .= '</ol>'; $inOl = false; }
                    $out .= $t;
                } else {
                    if ($inUl) { $out .= '</ul>'; $inUl = false; }
                    if ($inOl) { $out .= '</ol>'; $inOl = false; }
                    $para[] = $t;
                }
            }
            $flush();
            if ($inUl) { $out .= '</ul>'; }
            if ($inOl) { $out .= '</ol>'; }
            $text = $out;
        }
        $allowed = [
            'a' => ['href' => [], 'title' => [], 'target' => [], 'rel' => []],
            'p' => [], 'br' => [], 'strong' => [], 'b' => [], 'em' => [], 'i' => [], 'u' => [],
            'ul' => [], 'ol' => [], 'li' => [], 'h3' => [], 'h4' => [], 'h5' => [], 'h6' => [], 'code' => [],
        ];
        return function_exists('wp_kses') ? wp_kses($text, $allowed) : strip_tags($text, '<a><p><br><strong><b><em><i><u><ul><ol><li><h3><h4><h5><h6><code>');
    }

    public static function initials(string $name): string
    {
        $parts = array_values(array_filter(preg_split('/\s+/', trim($name)) ?: []));
        $first = $parts[0] ?? '';
        $last = count($parts) > 1 ? end($parts) : '';
        return strtoupper(mb_substr($first, 0, 1) . mb_substr((string) $last, 0, 1));
    }

    /**
     * A member's personalised message, written in Vision in a hundred different styles, turned into the designed
     * note: their own "Hi Judi" and "Kind regards, Lucy" are removed (the page adds the greeting and signature),
     * single newlines become paragraphs, price/option lines become a list, markdown and stray HTML are handled.
     * @return array{html:string,long:bool} long = over ~900 characters, so the page can fold it
     */
    public static function messageHtml(string $text, string $agentName = '', string $leadFirstName = ''): array
    {
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = str_replace(["\r\n", "\r", "\xC2\xA0"], ["\n", "\n", ' '], $text);
        if (preg_match('/<(p|br|div|li)\b/i', $text)) {
            $text = (string) preg_replace('/<br\s*\/?>/i', "\n", $text);
            $text = (string) preg_replace('/<\/(p|div|li|h[1-6])>/i', "\n", $text);
            $text = strip_tags($text);
        }
        $lines = array_map(static fn ($l) => trim((string) preg_replace('/[ \t]+/', ' ', $l)), explode("\n", $text));
        while ($lines && $lines[0] === '') {
            array_shift($lines);
        }
        // A leading greeting line ("Hi Judi", "Dear Mr & Mrs Wildeman,", "Good morning both")
        if ($lines && mb_strlen($lines[0]) < 70 && preg_match('/^(hi|hiya|hello|hey|dear|good (morning|afternoon|evening)|morning|afternoon|evening)\b/iu', $lines[0]) && !preg_match('/[.!?]\s*\S+\s+\S+/u', $lines[0])) {
            array_shift($lines);
        }
        while ($lines && end($lines) === '') {
            array_pop($lines);
        }
        // A trailing sign-off block, if it is short: from "Kind regards"/"Thanks"/… to the end
        $signoff = '/^(kind(est)? regards|best regards|warm(est)? regards|regards|many thanks|thanks( again| so much| very much)?|thank you( again| so much| very much)?|best wishes|all the best|cheers|yours sincerely|yours faithfully|speak soon|take care|with best wishes|warmly|best)[,.!]?\s*$/iu';
        for ($i = max(0, count($lines) - 6); $i < count($lines); $i++) {
            if (preg_match($signoff, $lines[$i])) {
                $lines = array_slice($lines, 0, $i);
                break;
            }
        }
        // Then any trailing name / job-title lines (the agent's first name or full name, "Travel Consultant", branch)
        $agentFirst = $agentName !== '' ? self::firstName($agentName) : '';
        for ($k = 0; $k < 4 && $lines; $k++) {
            $last = trim((string) end($lines), " ,.-–—");
            if ($last === '') {
                array_pop($lines);
                continue;
            }
            $isName = ($agentFirst !== '' && strcasecmp($last, $agentFirst) === 0) || ($agentName !== '' && strcasecmp($last, $agentName) === 0);
            $isJob = preg_match('/^(senior )?(travel (consultant|advisor|adviser|agent|expert|specialist)|branch manager|manager|director|owner|the team|team|sales (consultant|advisor))$/iu', $last) === 1;
            $prev = count($lines) > 1 ? trim((string) $lines[count($lines) - 2]) : '';
            $bareName = preg_match('/^[A-Z][\p{L}\'-]+( [A-Z][\p{L}\'-]+){0,2}$/u', $last) === 1 && mb_strlen($last) <= 30 && ($prev === '' || preg_match('/[.!?)]$/u', $prev) === 1 || preg_match($signoff, $prev) === 1);
            if ($isName || $isJob || ($k === 0 && $bareName)) {
                array_pop($lines);
                continue;
            }
            break;
        }
        // Blocks: blank lines separate; consecutive item-like lines ("Silverzone - £82.50", "- …", "1. …") become a list
        $blocks = [];
        $list = [];
        $flush = static function () use (&$blocks, &$list): void {
            if ($list) {
                $blocks[] = ['list', $list];
                $list = [];
            }
        };
        $isItem = static fn (string $l): bool => (bool) preg_match('/^([-•*·]\s+\S|\d+[.)]\s+\S|[^:\n]{2,40}\s*[-–—:]\s*£\s?\d|[^:\n]{2,40}\s*[-–—]\s*\d+(\.\d+)?\s*(pp|per person|each)?$)/u', $l);
        foreach ($lines as $l) {
            if ($l === '') {
                $flush();
                continue;
            }
            if ($isItem($l)) {
                $list[] = (string) preg_replace('/^([-•*·]\s+|\d+[.)]\s+)/u', '', $l);
                continue;
            }
            $flush();
            $blocks[] = ['p', $l];
        }
        $flush();
        $inline = static function (string $s): string {
            $s = htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
            $s = (string) preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $s);
            $s = (string) preg_replace('/(?<![\w*])\*(?!\*)([^*\n]+?)\*(?![\w*])/', '<em>$1</em>', $s);
            return (string) preg_replace('~(https?://[^\s<]+)~i', '<a href="$1" target="_blank" rel="noopener">$1</a>', $s);
        };
        $html = '';
        $chars = 0;
        foreach ($blocks as [$type, $content]) {
            if ($type === 'list') {
                $html .= '<ul>' . implode('', array_map(static fn ($i) => '<li>' . $inline($i) . '</li>', $content)) . '</ul>';
                $chars += (int) array_sum(array_map('mb_strlen', $content));
            } else {
                $html .= '<p>' . $inline($content) . '</p>';
                $chars += mb_strlen($content);
            }
        }
        return ['html' => $html, 'long' => $chars > 900];
    }

    /** Mask an email like j***@example.com for verification prompts. */
    public static function maskEmail(string $email): string
    {
        $email = trim($email);
        if (!str_contains($email, '@')) {
            return '';
        }
        [$u, $d] = explode('@', $email, 2);
        return mb_substr($u, 0, 1) . str_repeat('*', max(2, mb_strlen($u) - 1)) . '@' . $d;
    }

    public static function maskPhone(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone) ?? '';
        if (strlen($digits) < 4) {
            return '';
        }
        return str_repeat('*', strlen($digits) - 3) . substr($digits, -3);
    }

    public static function normalisePostcode(string $pc): string
    {
        return strtoupper((string) preg_replace('/\s+/', '', $pc));
    }
}
