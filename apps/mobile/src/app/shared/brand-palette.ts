/**
 * Turns a brand colour from Airtable into accent tokens that stay readable (WCAG AA) on the current theme.
 * The brand colour is kept when it already has enough contrast; otherwise it is darkened (light theme) or
 * lightened (dark theme) just enough, so a pale or black brand colour never produces unreadable text or buttons.
 */
export type BrandTheme = 'light' | 'dark';

export interface BrandPalette {
  accent: string;      // borders, focus rings, icons: >= 3:1 against the surface
  accentText: string;  // links and accent-coloured text: >= 4.5:1 against the surface and both tints
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
  // Dark theme lifts the brand along its own hue: mixing a navy with white would land on a flat grey (#667180).
  const readable = (good: (color: string) => boolean) => theme === 'dark' ? lightenInHue(brand, good) : adjustUntil(brand, towards, good);
  const accent = readable((color) => contrast(color, surface) >= 3);
  const tint = mix(accent, surface, theme === 'light' ? 0.09 : 0.14);
  const tint2 = mix(accent, surface, theme === 'light' ? 0.16 : 0.24);
  // Accent text also sits on its own tints (status pills, the current journey step), so it must pass there too.
  const accentText = readable((color) => [surface, tint, tint2].every((background) => contrast(color, background) >= 4.5));
  // Dark theme: like the default teal (#43B7A7 on near-black ink), buttons use a light version of the brand with dark text.
  // Dark theme buttons: the brand's own hue made light enough for dark text (lightening in HSL keeps it vivid; mixing
  // with white would turn a navy or deep green into a flat grey that reads as disabled). A brand with almost no colour
  // (black, grey) gets a near-white button, which stands out most on the dark surface.
  const action = theme === 'dark' ? darkModeAction(brand) : accent;
  const actionInk = theme === 'dark' ? DARK_INK : contrast(action, '#ffffff') >= 4.5 ? '#ffffff' : contrast(action, DARK_INK) >= contrast(action, '#ffffff') ? DARK_INK : '#ffffff';
  return {
    accent, accentText, action, actionInk,
    tint, tint2,
  };
}

export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const NEAR_WHITE = '#f2f1ec';

function darkModeAction(brand: string): string {
  const [hue, saturation, lightness] = hsl(brand);
  if (saturation < 0.12) return NEAR_WHITE;
  // Keep the hue but calm the saturation: a deep, fully saturated brand (navy #00122c) would otherwise become an
  // electric blue that glares on the dark surface. 30–45% reads as the brand, muted, and never as a disabled grey.
  const vivid = Math.min(0.45, Math.max(saturation, 0.3));
  for (let next = Math.max(lightness, 0.45); next <= 0.92; next += 0.02) {
    const candidate = fromHsl(hue, vivid, next);
    if (contrast(candidate, DARK_INK) >= 7) return candidate;
  }
  return NEAR_WHITE;
}

function hsl(color: string): [number, number, number] {
  const [r, g, b] = rgb(color).map((value) => value / 255) as [number, number, number];
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? ((g - b) / delta + (g < b ? 6 : 0)) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function fromHsl(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The lightest-needed version of the brand's own hue that passes `good`. Saturation is held to 35–65%, so a deep navy
 * reads as blue rather than grey and a vivid brand doesn't glare on the dark surface. Colourless brands (black, grey)
 * have no hue to keep and are mixed towards white as before.
 */
function lightenInHue(brand: string, good: (color: string) => boolean): string {
  if (good(brand)) return brand;
  const [hue, saturation, lightness] = hsl(brand);
  if (saturation < 0.12) return adjustUntil(brand, '#ffffff', good);
  const vivid = Math.min(0.65, Math.max(saturation, 0.35));
  for (let next = lightness; next <= 0.96; next += 0.02) {
    const candidate = fromHsl(hue, vivid, next);
    if (good(candidate)) return candidate;
  }
  return adjustUntil(brand, '#ffffff', good);
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
