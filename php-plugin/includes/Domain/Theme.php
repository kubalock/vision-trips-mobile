<?php
declare(strict_types=1);

namespace VisionTrips\Domain;

use VisionTrips\Settings;

/**
 * One theme per Vision "Tag". The member's brand colour is always the accent; a theme sets the typographic voice
 * (family, weight, width, softness, tracking), the surface wash, the hero treatment and the corner radius, so a
 * ski trip, a river cruise and an ultra-luxury honeymoon feel different without ever losing the member's identity.
 *
 * Families (one display family loads per page):
 *  - Fraunces (variable: opsz, wght, SOFT, WONK) — editorial serif; SOFT rounds it, WONK adds quirk
 *  - Bricolage Grotesque (variable: opsz, wght, wdth) — characterful grotesk; wdth 75–100
 *  - Fredoka (variable: wght, wdth) — rounded, playful
 * Body is Instrument Sans everywhere (members can override both via Primary/Secondary Web Font).
 */
final class Theme
{
    public const FAMILIES = [
        'Fraunces'            => 'Fraunces:opsz,wght,SOFT,WONK@9..144,100..900,0..100,0..1',
        'Bricolage Grotesque' => 'Bricolage Grotesque:opsz,wdth,wght@12..96,75..100,200..800',
        'Fredoka'             => 'Fredoka:wdth,wght@75..125,300..700',
        'Instrument Sans'     => 'Instrument Sans:ital,wght@0,400..700;1,400..700',
    ];

    /**
     * Default priority: first tag present on the booking wins. Editable in wp-admin → Themes.
     * Luxury tiers first (they are a feel), then product-defining tags, then haul tags, then flight-only.
     */
    public const DEFAULT_PRIORITY = [
        'Ultra Luxury', 'Premium Luxury', 'Affordable Luxury',
        'Expedition Cruise', 'Ocean Cruise', 'River Cruise',
        'Safari & Wildlife', 'Disney & Universal', 'Ski & Winter Sports', 'Rail', 'Coach', 'Fly-Drive & Road Trip',
        'Villa & Self-Catering', 'Lakes & Mountains', 'Touring & Adventure', 'Events & Sports', 'Activity & Special Interest',
        'City', 'Beach', 'UK & Domestic Break', 'Adult Only', 'Mainstream',
        'Long Haul', 'Mid Haul', 'Short Haul', 'Flight Only',
    ];

    /**
     * Theme specs keyed by tag. Keys:
     *  family, weight, stretch (%), soft (0–100 Fraunces), wonk (0/1), tracking (em), wash (hex), overlay (deep|soft|warm|cool|dusk),
     *  radius (crisp|soft|round), mood (admin description)
     */
    public const THEMES = [
        'Ultra Luxury'                => ['family' => 'Fraunces', 'weight' => 300, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => 0.01, 'wash' => '#2A2A2E', 'overlay' => 'deep', 'radius' => 'soft', 'motif' => 'hairline', 'space' => 1.2, 'caps' => 0, 'btn' => '999px', 'mood' => 'Hairline serif, charcoal, long silences'],
        'Premium Luxury'              => ['family' => 'Fraunces', 'weight' => 300, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => 0.005, 'wash' => '#3C3A44', 'overlay' => 'deep', 'radius' => 'soft', 'motif' => 'hairline', 'space' => 1.15, 'caps' => 0, 'btn' => '999px', 'mood' => 'Light serif, plum-grey, restrained'],
        'Affordable Luxury'           => ['family' => 'Fraunces', 'weight' => 400, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => 0, 'wash' => '#4A4650', 'overlay' => 'deep', 'radius' => 'soft', 'motif' => 'hairline', 'space' => 1.05, 'caps' => 0, 'btn' => '999px', 'mood' => 'Classic serif, warm grey, polished'],
        'Expedition Cruise'           => ['family' => 'Bricolage Grotesque', 'weight' => 600, 'stretch' => 85, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.02, 'wash' => '#2E4B5A', 'overlay' => 'cool', 'radius' => 'crisp', 'motif' => 'contour', 'space' => 0.95, 'caps' => 1, 'btn' => '10px', 'mood' => 'Condensed grotesk, glacier blue, utilitarian'],
        'Ocean Cruise'                => ['family' => 'Fraunces', 'weight' => 400, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => 0, 'wash' => '#1F4F6E', 'overlay' => 'cool', 'radius' => 'soft', 'motif' => 'waves', 'space' => 1.05, 'caps' => 0, 'btn' => '999px', 'mood' => 'Classic serif, deep sea, horizon gradient'],
        'River Cruise'                => ['family' => 'Fraunces', 'weight' => 400, 'stretch' => 100, 'soft' => 40, 'wonk' => 0, 'tracking' => 0, 'wash' => '#2F5E52', 'overlay' => 'soft', 'radius' => 'soft', 'motif' => 'ripples', 'space' => 1.05, 'caps' => 0, 'btn' => '999px', 'mood' => 'Softened serif, river green, unhurried'],
        'Safari & Wildlife'           => ['family' => 'Fraunces', 'weight' => 400, 'stretch' => 100, 'soft' => 30, 'wonk' => 1, 'tracking' => 0, 'wash' => '#6B5A35', 'overlay' => 'warm', 'radius' => 'soft', 'motif' => 'leaf', 'space' => 1.05, 'caps' => 0, 'btn' => '999px', 'mood' => 'Wonky serif, savanna ochre, golden hour'],
        'Disney & Universal'          => ['family' => 'Fredoka', 'weight' => 600, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.01, 'wash' => '#C94E3F', 'overlay' => 'warm', 'radius' => 'round', 'motif' => 'stars', 'space' => 1, 'caps' => 0, 'btn' => '999px', 'mood' => 'Rounded display, bright, big corners'],
        'Ski & Winter Sports'         => ['family' => 'Bricolage Grotesque', 'weight' => 800, 'stretch' => 95, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.03, 'wash' => '#3B5F82', 'overlay' => 'cool', 'radius' => 'crisp', 'motif' => 'snow', 'space' => 0.95, 'caps' => 1, 'btn' => '10px', 'mood' => 'Heavy grotesk, alpine blue, sharp'],
        'Rail'                        => ['family' => 'Fraunces', 'weight' => 500, 'stretch' => 100, 'soft' => 0, 'wonk' => 1, 'tracking' => 0.01, 'wash' => '#5E2E3A', 'overlay' => 'dusk', 'radius' => 'crisp', 'motif' => 'rails', 'space' => 1, 'caps' => 0, 'btn' => '10px', 'mood' => 'Heritage serif, burgundy, timetable crisp'],
        'Coach'                       => ['family' => 'Bricolage Grotesque', 'weight' => 600, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.01, 'wash' => '#4A5A6A', 'overlay' => 'soft', 'radius' => 'soft', 'motif' => 'dashes', 'space' => 1, 'caps' => 0, 'btn' => '999px', 'mood' => 'Friendly grotesk, steel blue, relaxed'],
        'Fly-Drive & Road Trip'       => ['family' => 'Bricolage Grotesque', 'weight' => 700, 'stretch' => 80, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.02, 'wash' => '#7A5A3A', 'overlay' => 'warm', 'radius' => 'crisp', 'motif' => 'dashes', 'space' => 0.95, 'caps' => 0, 'btn' => '8px', 'mood' => 'Highway-sign condensed, desert, straight edges'],
        'Villa & Self-Catering'       => ['family' => 'Fraunces', 'weight' => 500, 'stretch' => 100, 'soft' => 100, 'wonk' => 0, 'tracking' => 0, 'wash' => '#5E7A5A', 'overlay' => 'warm', 'radius' => 'round', 'motif' => 'tiles', 'space' => 1.05, 'caps' => 0, 'btn' => '999px', 'mood' => 'Soft serif, sage, sun-bleached'],
        'Lakes & Mountains'           => ['family' => 'Fraunces', 'weight' => 500, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => 0, 'wash' => '#3F6B5A', 'overlay' => 'cool', 'radius' => 'soft', 'motif' => 'peaks', 'space' => 1.05, 'caps' => 0, 'btn' => '999px', 'mood' => 'Crisp serif, pine green, clear air'],
        'Touring & Adventure'         => ['family' => 'Bricolage Grotesque', 'weight' => 600, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.02, 'wash' => '#4F5D3A', 'overlay' => 'warm', 'radius' => 'soft', 'motif' => 'compass', 'space' => 1, 'caps' => 0, 'btn' => '999px', 'mood' => 'Sturdy grotesk, olive, map-like'],
        'Events & Sports'             => ['family' => 'Bricolage Grotesque', 'weight' => 800, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.03, 'wash' => '#3A2E5A', 'overlay' => 'deep', 'radius' => 'crisp', 'motif' => 'stripes', 'space' => 0.9, 'caps' => 1, 'btn' => '8px', 'mood' => 'Poster-weight grotesk, violet, high contrast'],
        'Activity & Special Interest' => ['family' => 'Bricolage Grotesque', 'weight' => 600, 'stretch' => 95, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.015, 'wash' => '#2F6B6B', 'overlay' => 'soft', 'radius' => 'soft', 'motif' => 'compass', 'space' => 0.95, 'caps' => 0, 'btn' => '999px', 'mood' => 'Active grotesk, teal, purposeful'],
        'City'                        => ['family' => 'Bricolage Grotesque', 'weight' => 700, 'stretch' => 90, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.03, 'wash' => '#2B2F36', 'overlay' => 'dusk', 'radius' => 'crisp', 'motif' => 'grid', 'space' => 0.9, 'caps' => 0, 'btn' => '10px', 'mood' => 'Tight grotesk, slate, neon-dusk'],
        'Beach'                       => ['family' => 'Fraunces', 'weight' => 500, 'stretch' => 100, 'soft' => 100, 'wonk' => 0, 'tracking' => 0, 'wash' => '#1E8A8C', 'overlay' => 'warm', 'radius' => 'round', 'motif' => 'sun', 'space' => 1, 'caps' => 0, 'btn' => '999px', 'mood' => 'Soft serif, sea green, warm light'],
        'UK & Domestic Break'         => ['family' => 'Fraunces', 'weight' => 500, 'stretch' => 100, 'soft' => 30, 'wonk' => 0, 'tracking' => 0, 'wash' => '#4E6B5C', 'overlay' => 'soft', 'radius' => 'soft', 'motif' => 'leaf', 'space' => 1, 'caps' => 0, 'btn' => '999px', 'mood' => 'Homely serif, hedgerow green'],
        'Adult Only'                  => ['family' => 'Fraunces', 'weight' => 300, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => 0.01, 'wash' => '#4A3A4A', 'overlay' => 'deep', 'radius' => 'soft', 'motif' => 'hairline', 'space' => 1.15, 'caps' => 0, 'btn' => '999px', 'mood' => 'Light serif, plum, calm'],
        'Mainstream'                  => ['family' => 'Bricolage Grotesque', 'weight' => 700, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.02, 'wash' => '#1F6F8B', 'overlay' => 'warm', 'radius' => 'round', 'motif' => 'sun', 'space' => 1, 'caps' => 0, 'btn' => '999px', 'mood' => 'Clear grotesk, holiday blue, easy'],
        'Long Haul'                   => ['family' => 'Fraunces', 'weight' => 400, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => 0, 'wash' => '#2E4B6E', 'overlay' => 'deep', 'radius' => 'soft', 'motif' => 'compass', 'space' => 1.05, 'caps' => 0, 'btn' => '999px', 'mood' => 'Classic serif, far-horizon blue'],
        'Mid Haul'                    => ['family' => 'Fraunces', 'weight' => 500, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => 0, 'wash' => '#4A6A7A', 'overlay' => 'soft', 'radius' => 'soft', 'motif' => 'dots', 'space' => 1, 'caps' => 0, 'btn' => '999px', 'mood' => 'Measured serif, dusty blue'],
        'Short Haul'                  => ['family' => 'Bricolage Grotesque', 'weight' => 600, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.02, 'wash' => '#2A7A8C', 'overlay' => 'warm', 'radius' => 'soft', 'motif' => 'dots', 'space' => 0.95, 'caps' => 0, 'btn' => '999px', 'mood' => 'Quick grotesk, bright teal'],
        'Flight Only'                 => ['family' => 'Bricolage Grotesque', 'weight' => 700, 'stretch' => 90, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.02, 'wash' => '#2B3A4A', 'overlay' => 'cool', 'radius' => 'crisp', 'motif' => 'dashes', 'space' => 0.95, 'caps' => 0, 'btn' => '10px', 'mood' => 'Departure-board grotesk, navy'],
        'default'                     => ['family' => 'Fraunces', 'weight' => 500, 'stretch' => 100, 'soft' => 0, 'wonk' => 0, 'tracking' => -0.01, 'wash' => '#5B7A8C', 'overlay' => 'soft', 'radius' => 'soft', 'motif' => 'none', 'space' => 1, 'caps' => 0, 'btn' => '999px', 'mood' => 'Balanced serif, slate blue'],
    ];

    /** Tag priority as configured (falls back to the default order; unknown tags ignored). @return string[] */
    public static function priority(): array
    {
        $raw = (string) Settings::get('theme_priority', '');
        $order = [];
        foreach (preg_split('/\r?\n/', $raw) ?: [] as $line) {
            $line = trim($line);
            if ($line !== '' && isset(self::THEMES[$line]) && !in_array($line, $order, true)) {
                $order[] = $line;
            }
        }
        foreach (self::DEFAULT_PRIORITY as $tag) {
            if (!in_array($tag, $order, true)) {
                $order[] = $tag;
            }
        }
        return $order;
    }

    /**
     * Resolve the theme key (a tag name or 'default') for a booking.
     * @param string[] $tags
     * @param string[] $holidayTypes
     */
    public static function resolve(array $tags, array $holidayTypes = [], string $sector = '', string $brandTheme = '', string $brandTone = ''): string
    {
        $overrides = (array) Settings::get('theme_overrides', []);
        foreach (self::priority() as $tag) {
            if (in_array($tag, $tags, true)) {
                $t = (string) ($overrides[$tag] ?? $tag);
                return isset(self::THEMES[$t]) ? $t : $tag;
            }
        }
        $ht = array_map('strtolower', $holidayTypes);
        $sector = strtolower($sector);
        $map = [
            'luxury' => 'Premium Luxury', 'boutique' => 'Affordable Luxury', "weddings & honeymoon's" => 'Adult Only',
            'ocean cruising' => 'Ocean Cruise', 'river cruising' => 'River Cruise', 'safari' => 'Safari & Wildlife', 'ski' => 'Ski & Winter Sports',
            'active' => 'Activity & Special Interest', 'walking' => 'Lakes & Mountains', 'mountains' => 'Lakes & Mountains', 'city' => 'City',
            'family' => 'Mainstream', 'beach' => 'Beach', 'long haul' => 'Long Haul', 'budget' => 'Mainstream', 'adults only' => 'Adult Only', "18-30's" => 'Beach',
        ];
        foreach ($map as $type => $theme) {
            if (in_array($type, $ht, true)) {
                return $theme;
            }
        }
        if ($sector !== '') {
            foreach (['luxury' => 'Premium Luxury', 'ocean' => 'Ocean Cruise', 'river' => 'River Cruise', 'touring' => 'Touring & Adventure', 'long haul' => 'Long Haul', 'europe' => 'Short Haul', 'mainstream' => 'Mainstream'] as $needle => $theme) {
                if (str_contains($sector, $needle)) {
                    return $theme;
                }
            }
        }
        if (stripos($brandTheme, 'luxury') !== false || $brandTone === 'formal') {
            return 'Premium Luxury';
        }
        if ($brandTone === 'casual') {
            return 'Beach';
        }
        return 'default';
    }

    /** @return array{family:string,weight:int,stretch:int,soft:int,wonk:int,tracking:float,wash:string,overlay:string,radius:string,mood:string} */
    public static function spec(string $theme): array
    {
        return self::THEMES[$theme] ?? self::THEMES['default'];
    }

    public static function slug(string $theme): string
    {
        return strtolower(trim((string) preg_replace('/[^a-z0-9]+/i', '-', $theme), '-')) ?: 'default';
    }

    /** Google Fonts stylesheet URL: the theme's display family (or the member's) + body family. */
    public static function fontsUrl(string $theme, string $brandDisplay = '', string $brandBody = ''): string
    {
        $spec = self::spec($theme);
        $display = $brandDisplay !== '' ? $brandDisplay : $spec['family'];
        $body = $brandBody !== '' ? $brandBody : 'Instrument Sans';
        $families = [];
        foreach (array_unique([$display, $body]) as $f) {
            $families[] = self::FAMILIES[$f] ?? ($f . ':wght@300;400;500;600;700');
        }
        $q = implode('&', array_map(static fn ($f) => 'family=' . str_replace(' ', '+', $f), $families));
        return 'https://fonts.googleapis.com/css2?' . $q . '&display=swap';
    }

    /** Body classes: theme slug, motif, density and optional caps kicker. */
    public static function bodyClasses(string $theme): string
    {
        $s = self::spec($theme);
        return 'theme-' . self::slug($theme) . ' motif-' . ($s['motif'] ?? 'none') . (!empty($s['caps']) ? ' kicker-caps' : '');
    }

    /**
     * CSS custom properties for the theme, emitted in the page head. The brand colour is set separately as --vt-accent.
     * @return array<string,string>
     */
    public static function cssVars(string $theme, string $brandDisplay = '', string $brandBody = ''): array
    {
        $s = self::spec($theme);
        $display = $brandDisplay !== '' ? $brandDisplay : $s['family'];
        $axes = match ($display) {
            'Fraunces' => sprintf('"SOFT" %d, "WONK" %d', $s['soft'], $s['wonk']),
            'Bricolage Grotesque', 'Fredoka' => '"wdth" ' . $s['stretch'],
            default => 'normal',
        };
        [$rl, $r, $rs] = match ($s['radius']) {
            'crisp' => ['14px', '10px', '6px'],
            'round' => ['30px', '22px', '14px'],
            default => ['24px', '16px', '10px'],
        };
        return [
            '--vt-display'         => "'" . addslashes($display) . "', " . ($display === 'Fraunces' ? 'Georgia, serif' : 'system-ui, sans-serif'),
            '--vt-display-weight'  => (string) $s['weight'],
            '--vt-display-stretch' => $s['stretch'] . '%',
            '--vt-axes'            => $axes,
            '--vt-soft'            => (string) $s['soft'],
            '--vt-track'           => $s['tracking'] . 'em',
            '--vt-wash'            => $s['wash'],
            '--vt-hero-a'          => 'color-mix(in srgb, ' . $s['wash'] . ' 72%, #000)',
            '--vt-hero-b'          => 'color-mix(in srgb, ' . $s['wash'] . ' 45%, var(--vt-accent))',
            '--r-l'                => $rl,
            '--r'                  => $r,
            '--r-s'                => $rs,
            '--btn-r'              => (string) ($s['btn'] ?? '999px'),
            '--vt-space'           => (string) ($s['space'] ?? 1),
        ];
    }
}
