/**
 * Turns a brand colour from Airtable into accent tokens that stay readable (WCAG AA) on the current theme.
 * The brand colour is kept when it already has enough contrast; otherwise it is darkened (light theme) or
 * lightened (dark theme) just enough, so a pale or black brand colour never produces unreadable text or buttons.
 */
export type BrandTheme = 'light' | 'dark';

export interface BrandPalette {
  accent: string;      // borders, focus rings, icons: >= 3:1 against the surface
  accentText: string;  // links and accent-coloured text: >= 4.5:1 against the surface
  action: string;      // primary button background
  actionInk: string;   // text on primary buttons: >= 4.5:1 against `action`
  tint: string;
  tint2: string;
}

const SURFACE: Record<BrandTheme, string> = { light: '#ffffff', dark: '#1b1e20' };
const DEFAULT_BRAND = '#0f766e';
const DARK_INK = '#111111';

export function brandPalette(brandColor: string | null | undefined, theme: BrandTheme): BrandPalette {
  const surface = SURFACE[theme];
  const brand = normalizeHex(brandColor) ?? DEFAULT_BRAND;
  const towards = theme === 'light' ? '#000000' : '#ffffff';
  const accent = adjustUntil(brand, towards, (color) => contrast(color, surface) >= 3);
  const accentText = adjustUntil(brand, towards, (color) => contrast(color, surface) >= 4.5);
  // Dark theme: like the default teal (#43B7A7 on near-black ink), buttons use a light version of the brand with dark text.
  const action = theme === 'dark' ? adjustUntil(brand, '#ffffff', (color) => contrast(color, DARK_INK) >= 7) : accent;
  const actionInk = theme === 'dark' ? DARK_INK : contrast(action, '#ffffff') >= 4.5 ? '#ffffff' : contrast(action, DARK_INK) >= contrast(action, '#ffffff') ? DARK_INK : '#ffffff';
  return {
    accent, accentText, action, actionInk,
    tint: mix(accent, surface, theme === 'light' ? 0.09 : 0.14),
    tint2: mix(accent, surface, theme === 'light' ? 0.16 : 0.24),
  };
}

export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function adjustUntil(color: string, towards: string, good: (color: string) => boolean): string {
  if (good(color)) return color;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(towards, color, step / 20);
    if (good(candidate)) return candidate;
  }
  return towards;
}

/** Mixes `weight` of `a` into `b` (0..1). */
function mix(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = rgb(a); const [br, bg, bb] = rgb(b);
  const channel = (x: number, y: number) => Math.round(x * weight + y * (1 - weight)).toString(16).padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgb(color: string): [number, number, number] {
  const hex = color.slice(1);
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}

function normalizeHex(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split('').map((char) => char + char).join('') : match[1];
  return `#${hex.toLowerCase()}`;
}
