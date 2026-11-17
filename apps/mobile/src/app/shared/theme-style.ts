import type { ThemeTokens } from '@vision-trips/contracts';

/**
 * The trip's theme as CSS custom properties — the same variables, with the same values, that the website sets in
 * its page head (PHP plugin Theme::cssVars). The member's brand colour comes separately from brandPalette(), which
 * also keeps it readable in light and dark mode.
 *
 * Fraunces, Bricolage Grotesque, Fredoka and Instrument Sans are bundled with the app (so trips look right offline);
 * a member's own Vision web fonts are loaded from Google Fonts by loadMemberFonts(), falling back to the bundled ones.
 */

/** Bundled families: Fontsource registers them as "<Name> Variable". */
const BUNDLED: Record<string, string> = {
  'Fraunces': "'Fraunces Variable', 'Fraunces', Georgia, serif",
  'Bricolage Grotesque': "'Bricolage Grotesque Variable', 'Bricolage Grotesque', system-ui, sans-serif",
  'Fredoka': "'Fredoka Variable', 'Fredoka', system-ui, sans-serif",
  'Instrument Sans': "'Instrument Sans Variable', 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};
export const DEFAULT_DISPLAY = 'Fraunces';
export const DEFAULT_BODY = 'Instrument Sans';

const SAFE_FONT = /^[A-Za-z0-9 ]{2,40}$/;
const SAFE_HEX = /^#[0-9A-Fa-f]{6}$/;
const SAFE_RADIUS = /^\d{1,3}px$/;

export function isBundledFont(name: string): boolean { return name in BUNDLED; }

export function fontStack(name: string | null | undefined, fallback: string): string {
  if (name && BUNDLED[name]) return BUNDLED[name]!;
  const base = BUNDLED[fallback] ?? BUNDLED[DEFAULT_BODY]!;
  return name && SAFE_FONT.test(name) ? `'${name}', ${base}` : base;
}

const RADII: Record<ThemeTokens['radius'], [string, string, string]> = {
  crisp: ['14px', '10px', '6px'], soft: ['24px', '16px', '10px'], round: ['30px', '22px', '14px'],
};

const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function themeStyle(theme: ThemeTokens | null | undefined): Record<string, string> {
  const display = theme?.displayFont && SAFE_FONT.test(theme.displayFont) ? theme.displayFont : DEFAULT_DISPLAY;
  const body = theme?.bodyFont && SAFE_FONT.test(theme.bodyFont) ? theme.bodyFont : DEFAULT_BODY;
  const stretch = clamp(theme?.displayStretch, 50, 150, 100);
  const soft = clamp(theme?.displaySoft, 0, 100, 0);
  const wonk = clamp(theme?.displayWonk, 0, 1, 0);
  // Variable-font axes, exactly as the website: Fraunces softness/quirk, width for the grotesques.
  const axes = display === 'Fraunces' ? `"SOFT" ${soft}, "WONK" ${wonk}` : display === 'Bricolage Grotesque' || display === 'Fredoka' ? `"wdth" ${stretch}` : 'normal';
  const wash = theme?.wash && SAFE_HEX.test(theme.wash) ? theme.wash : '#5B7A8C';
  const [large, medium, small] = RADII[theme?.radius ?? 'soft'] ?? RADII.soft;
  const bodyStack = fontStack(body, DEFAULT_BODY);
  return {
    '--vt-display': fontStack(display, DEFAULT_DISPLAY),
    '--vt-display-weight': String(Math.round(clamp(theme?.displayWeight, 100, 900, 500))),
    '--vt-display-stretch': `${stretch}%`,
    '--vt-axes': axes,
    '--vt-soft': String(soft),
    '--vt-track': `${clamp(theme?.tracking, -0.1, 0.2, -0.01)}em`,
    '--vt-body': bodyStack,
    '--vt-font-family': bodyStack,
    '--vt-wash': wash,
    '--vt-hero-a': `color-mix(in srgb, ${wash} 72%, #000)`,
    '--vt-hero-b': `color-mix(in srgb, ${wash} 45%, var(--vt-accent))`,
    '--r-l': large, '--r': medium, '--r-s': small,
    '--btn-r': theme?.buttonRadius && (theme.buttonRadius === '999px' || SAFE_RADIUS.test(theme.buttonRadius)) ? theme.buttonRadius : '999px',
    '--vt-space': String(clamp(theme?.spacingScale, 0.8, 1.3, 1)),
  };
}

/**
 * A member's own Vision web fonts (Primary/Secondary Web Font) that aren't bundled: one Google Fonts stylesheet, as
 * the website loads. Offline, or if it fails, the bundled fallback in the font stack is used.
 */
export function memberFontsUrl(theme: ThemeTokens | null | undefined): string | null {
  const names = [theme?.displayFont, theme?.bodyFont].filter((name): name is string => Boolean(name && SAFE_FONT.test(name) && !isBundledFont(name)));
  if (!names.length) return null;
  const families = [...new Set(names)].map((name) => `family=${name.replace(/ /g, '+')}:wght@300;400;500;600;700`).join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
