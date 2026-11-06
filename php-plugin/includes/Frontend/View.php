<?php
declare(strict_types=1);

namespace VisionTrips\Frontend;

/**
 * Tiny template engine: PHP files under Views/, variables extracted, output buffered.
 * Helpers (e, a, icon, partial, url) are plain functions in the VisionTrips\Frontend namespace.
 */
final class View
{
    /** @param array<string,mixed> $vars */
    public static function render(string $template, array $vars = []): string
    {
        $file = VISION_TRIPS_DIR . 'includes/Frontend/Views/' . str_replace(['..', '\\'], '', $template) . '.php';
        if (!is_file($file)) {
            return '<!-- missing view ' . htmlspecialchars($template, ENT_QUOTES, 'UTF-8') . ' -->';
        }
        $render = static function (string $__file, array $__vars): string {
            extract($__vars, EXTR_SKIP);
            $__level = ob_get_level();
            ob_start();
            try {
                include $__file;
            } catch (\Throwable $__e) {
                while (ob_get_level() > $__level) {
                    ob_end_clean();
                }
                throw $__e;
            }
            return (string) ob_get_clean();
        };
        return $render($file, $vars);
    }

    /** Inline SVG icon (currentColor), from a curated set — no icon font, no external requests. */
    public static function icon(string $name, string $class = ''): string
    {
        $paths = [
            'plane'      => '<path d="M2.5 19.5h19M3.8 12.4l3.2.9 4.3-3.6 6.3 1.9c1 .3 2-.2 2.3-1.1.3-.9-.2-1.9-1.1-2.3L12.8 6l-2.7-4.1-2.1.7 1.4 4.2-3.9 1.3L4.1 7l-1.9.6z"/>',
            'bed'        => '<path d="M3 11V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4M3 11h18v7M3 11v7m0-3h18M7 8h4v3H7zm6 0h4v3h-4z"/>',
            'ship'       => '<path d="M3 17l1.5 3h15L21 17M3 17c2 1 4 1 6 0s4-1 6 0 4 1 6 0M5 17V9l7-3 7 3v8M12 6V3m-5 7h10"/>',
            'car'        => '<path d="M5 17h14M4 12l2-5a2 2 0 0 1 1.9-1.3h8.2A2 2 0 0 1 18 7l2 5v6H4zM7.5 15a1 1 0 1 0 0 .01M16.5 15a1 1 0 1 0 0 .01"/>',
            'train'      => '<path d="M6 4h12a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zm-2 7h16M8 21l1.5-3m6.5 3-1.5-3M8.5 14.5h.01M15.5 14.5h.01"/>',
            'parking'    => '<path d="M5 3h14v18H5zM9 17V7h4a3 3 0 0 1 0 6H9"/>',
            'ticket'     => '<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4zm11 1v6"/>',
            'star'       => '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
            'pin'        => '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>',
            'calendar'   => '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 10h16M8 3v4m8-4v4"/>',
            'clock'      => '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2"/>',
            'phone'      => '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
            'mail'       => '<path d="M3 6h18v12H3zm0 0 9 7 9-7"/>',
            'globe'      => '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
            'card'       => '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm0 3h18M7 15h4"/>',
            'doc'        => '<path d="M6 3h8l4 4v14H6zm8 0v4h4M9 12h6m-6 4h6"/>',
            'refresh'    => '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
            'shield'     => '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6zm-3 9 2 2 4-4"/>',
            'check'      => '<path d="m5 12 4 4L19 6"/>',
            'arrow'      => '<path d="M5 12h14m-6-6 6 6-6 6"/>',
            'chevron'    => '<path d="m8 10 4 4 4-4"/>',
            'info'       => '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4v-5m0-3h.01"/>',
            'alert'      => '<path d="M12 9v4m0 4h.01M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/>',
            'sun'        => '<path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4"/>',
            'sun-cloud'  => '<path d="M7 16a4 4 0 1 1 1.3-7.8A5 5 0 0 1 18 10a3.5 3.5 0 0 1-.5 7H7zM4 4l1 1m7-3v1.5"/>',
            'cloud'      => '<path d="M7 18a4 4 0 1 1 1.3-7.8A5 5 0 0 1 18 12a3.5 3.5 0 0 1-.5 6H7z"/>',
            'rain'       => '<path d="M7 15a4 4 0 1 1 1.3-7.8A5 5 0 0 1 18 9a3.5 3.5 0 0 1-.5 6H7zm1 3-1 3m5-3-1 3m5-3-1 3"/>',
            'snow'       => '<path d="M7 14a4 4 0 1 1 1.3-7.8A5 5 0 0 1 18 8a3.5 3.5 0 0 1-.5 6H7zm1 4h.01M12 19h.01M16 18h.01M10 21h.01M14 21h.01"/>',
            'storm'      => '<path d="M7 14a4 4 0 1 1 1.3-7.8A5 5 0 0 1 18 8a3.5 3.5 0 0 1-.5 6H7zm6 0-2 4h3l-2 4"/>',
            'fog'        => '<path d="M4 10h16M4 14h12M8 18h12"/>',
            'bag'        => '<path d="M8 7V5a4 4 0 0 1 8 0v2m-12 0h16l-1 13H5zm4 4v2m8-2v2"/>',
            'share'      => '<path d="M12 3v12m0-12-4 4m4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
            'print'      => '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2m-12-3h12v6H6z"/>',
            'download'   => '<path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/>',
            'lock'       => '<path d="M6 11V8a6 6 0 0 1 12 0v3m-13 0h14v10H5zm7 4v2"/>',
            'user'       => '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0"/>',
            'users'      => '<path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0m0-9a4 4 0 0 0 0-8m6 17a7 7 0 0 0-4-6.3"/>',
            'heart'      => '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
            'compass'    => '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm3-12-2 5-5 2 2-5z"/>',
            'sparkle'    => '<path d="M12 3v4m0 10v4m-9-9h4m10 0h4M7 7l1 1m8 8 1 1m0-10-1 1M8 16l-1 1m5-9 1.5 3.5L17 13l-3.5 1.5L12 18l-1.5-3.5L7 13l3.5-1.5z"/>',
            'home'       => '<path d="m3 11 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
            'list'       => '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
            'wallet'     => '<path d="M3 7a2 2 0 0 1 2-2h13v4H5a2 2 0 0 1-2-2zm0 0v10a2 2 0 0 0 2 2h16v-9H5a2 2 0 0 1-2-2zm13 6h.01"/>',
            'help'       => '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-2.5-11a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7m0 3h.01"/>',
            'external'   => '<path d="M14 4h6v6m0-6-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
            'close'      => '<path d="M6 6l12 12M18 6 6 18"/>',
            'anchor'     => '<path d="M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 0v13M5 13H3a9 9 0 0 0 18 0h-2m-9 0h8"/>',
            'binoculars' => '<path d="M6 9h4v12H3V12zM14 9h4l3 3v9h-7zm-4 4h4M9 9V5h2v4m2 0V5h2v4"/>',
            'whatsapp'   => '<path d="M4 20l1.2-3.6A8 8 0 1 1 8 19zm5-9c0 2 2 4 4 4l1.5-1 1.5.5-.3 1.5c-3 .5-7.5-4-7-7l1.5-.3.5 1.5z"/>',
        ];
        $d = $paths[$name] ?? $paths['info'];
        if ($name === 'chevron') {
            $class = trim($class . ' vt-i--chevron');
        }
        return '<svg class="vt-i' . ($class !== '' ? ' ' . htmlspecialchars($class, ENT_QUOTES, 'UTF-8') : '') . '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' . $d . '</svg>';
    }

    /**
     * Wrapper for content loaded after first paint (Places, Widgety, AI, flights, weather).
     * Production: skeleton + REST fetch. Preview: skeleton + inline <template> that the JS swaps in after a beat,
     * so the loading experience itself can be reviewed.
     */
    public static function asyncSection(string $name, bool $async, string $previewHtml = '', string $skeleton = 'card', string $extraAttrs = ''): string
    {
        // "Quiet" sections (live flight status, weather) show nothing until there is something to show: a placeholder
        // that then vanishes would look like a failure.
        $sk = str_contains($extraAttrs, 'data-quiet') ? '' : self::skeleton($skeleton);
        $attrs = 'class="vt-async" data-section="' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '" data-loaded="0"' . ($extraAttrs !== '' ? ' ' . $extraAttrs : '');
        if ($async) {
            return '<div ' . $attrs . '>' . $sk . '</div>';
        }
        return '<div ' . $attrs . ' data-preview="1">' . $sk . '<template data-fragment>' . $previewHtml . '</template></div>';
    }

    /**
     * Server-rendered content wrapped so the page paints its shell instantly and sections flow in with shimmering
     * skeletons (JS removes them in sequence; without JS the content is simply visible).
     */
    public static function reveal(string $html, string $skeleton = 'rows'): string
    {
        // Server-rendered sections are always visible. Only third-party content (Places, Widgety, AI, flights,
        // weather) uses skeletons, via asyncSection(), and only when its data is not already cached.
        return $html;
    }

    /**
     * Third-party section: if everything it needs is already cached, render it inline now (no browser call);
     * otherwise a skeleton that vision.js fills from the REST API. In the preview the builder runs inline and the
     * JS swaps it in after a beat so the loading state can be reviewed.
     */
    public static function external(string $name, bool $preview, callable $build, string $skeleton = 'card', string $extraAttrs = ''): string
    {
        if ($preview) {
            return self::asyncSection($name, false, (string) $build(), $skeleton, $extraAttrs);
        }
        $mark = \VisionTrips\Support\Provenance::mark();
        \VisionTrips\Support\Jobs::$allowDispatch = false;
        \VisionTrips\Support\Jobs::$refused = false;
        \VisionTrips\Support\Http::$cacheOnly = true;
        \VisionTrips\Support\Http::$missed = false;
        \VisionTrips\Rest\Api::$pending = false;
        $html = '';
        try {
            $html = (string) $build();
        } catch (\Throwable $e) {
            \VisionTrips\Support\Log::warning('Inline render failed; deferring to async', ['section' => $name, 'error' => $e->getMessage()]);
            \VisionTrips\Support\Http::$missed = true;
        } finally {
            \VisionTrips\Support\Http::$cacheOnly = false;
            \VisionTrips\Support\Jobs::$allowDispatch = true;
        }
        if (!\VisionTrips\Support\Http::$missed && !\VisionTrips\Support\Jobs::$refused) {
            \VisionTrips\Support\Provenance::note('Section: ' . $name, 'cache', 'rendered inline from cached data' . (\VisionTrips\Rest\Api::$pending ? ' (AI copy still being written)' : ''), true);
            $poll = \VisionTrips\Rest\Api::$pending ? ' data-poll="1"' : '';
            return '<div class="vt-async is-landed" data-section="' . htmlspecialchars($name, ENT_QUOTES, 'UTF-8') . '" data-loaded="1"' . $poll . ($extraAttrs !== '' ? ' ' . $extraAttrs : '') . '>' . $html . '</div>';
        }
        \VisionTrips\Support\Provenance::rollback($mark); // nothing was looked up; the browser pass reports the real result
        \VisionTrips\Support\Provenance::note('Section: ' . $name, 'deferred', 'not cached yet — looked up after the page loads; its rows appear below as they arrive', true);
        return self::asyncSection($name, true, '', $skeleton, $extraAttrs);
    }

    /** Skeleton placeholders that mirror the real layout so nothing jumps when content lands. */
    public static function skeleton(string $kind): string
    {
        $line = '<span class="vt-sk__line"></span>';
        return match ($kind) {
            'row'  => '<div class="vt-sk vt-sk--row" aria-hidden="true"><span class="vt-sk__dot"></span><div>' . $line . $line . '</div></div>',
            'chip' => '<div class="vt-sk vt-sk--chip" aria-hidden="true"></div>',
            'text' => '<div class="vt-sk vt-sk--text" aria-hidden="true">' . $line . $line . $line . '</div>',
            default => '<div class="vt-sk vt-sk--card" aria-hidden="true"><span class="vt-sk__img"></span><div class="vt-sk__body">' . $line . $line . $line . '</div></div>',
        };
    }

    /** Black or white text for a given background hex (WCAG relative luminance). */
    public static function contrastInk(string $hex): string
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) !== 6) {
            return '#FFFFFF';
        }
        $c = [];
        foreach ([0, 2, 4] as $i) {
            $v = hexdec(substr($hex, $i, 2)) / 255;
            $c[] = $v <= 0.03928 ? $v / 12.92 : (($v + 0.055) / 1.055) ** 2.4;
        }
        $l = 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2];
        return $l > 0.45 ? '#15171A' : '#FFFFFF';
    }

    /** Darken (on light backgrounds) or lighten (on dark) a colour until it reaches 4.5:1 contrast for text use. */
    public static function accessibleAccent(string $hex, string $bgHex): string
    {
        $rgb = self::rgb($hex);
        $bg = self::rgb($bgHex);
        if (!$rgb || !$bg) {
            return $hex;
        }
        $bgL = self::luminance($bg);
        $towardsDark = $bgL > 0.5;
        for ($i = 0; $i < 20; $i++) {
            $l = self::luminance($rgb);
            $ratio = (max($l, $bgL) + 0.05) / (min($l, $bgL) + 0.05);
            if ($ratio >= 4.5) {
                break;
            }
            $rgb = array_map(static fn ($c) => (int) round($towardsDark ? $c * 0.9 : min(255, $c + (255 - $c) * 0.12)), $rgb);
        }
        return sprintf('#%02X%02X%02X', $rgb[0], $rgb[1], $rgb[2]);
    }

    /** @return array{0:int,1:int,2:int}|null */
    private static function rgb(string $hex): ?array
    {
        $hex = ltrim($hex, '#');
        if (strlen($hex) !== 6 || !ctype_xdigit($hex)) {
            return null;
        }
        return [(int) hexdec(substr($hex, 0, 2)), (int) hexdec(substr($hex, 2, 2)), (int) hexdec(substr($hex, 4, 2))];
    }

    /** @param array{0:int,1:int,2:int} $rgb */
    private static function luminance(array $rgb): float
    {
        $c = [];
        foreach ($rgb as $v) {
            $v /= 255;
            $c[] = $v <= 0.03928 ? $v / 12.92 : (($v + 0.055) / 1.055) ** 2.4;
        }
        return 0.2126 * $c[0] + 0.7152 * $c[1] + 0.0722 * $c[2];
    }

    /** Icon for an element kind. */
    public static function kindIcon(string $kind): string
    {
        return self::icon(match ($kind) {
            'flight' => 'plane', 'stay' => 'bed', 'cruise' => 'ship', 'transfer' => 'car', 'carhire' => 'car', 'parking' => 'parking', 'train' => 'train', 'attraction' => 'binoculars', default => 'ticket',
        });
    }

    public static function kindLabel(string $kind): string
    {
        return match ($kind) {
            'flight' => 'Flight', 'stay' => 'Stay', 'cruise' => 'Cruise', 'transfer' => 'Transfer', 'carhire' => 'Car hire', 'parking' => 'Parking', 'train' => 'Train', 'attraction' => 'Experience', default => 'Extra',
        };
    }
}

function e(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Rich text already sanitised by Str::richText — echo as is. */
function raw(string $html): string
{
    return $html;
}

function icon(string $name, string $class = ''): string
{
    return View::icon($name, $class);
}

function partial(string $template, array $vars = []): string
{
    return View::render($template, $vars);
}

function tel(string $phone): string
{
    return 'tel:' . preg_replace('/[^\d+]/', '', $phone);
}
