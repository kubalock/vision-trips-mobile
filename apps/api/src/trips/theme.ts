import type { ThemeTokens } from '@vision-trips/contracts';

/*
 * One theme per Vision tag, matching the website (PHP plugin Domain/Theme.php). The member's brand colour is always
 * the accent; the theme sets the typographic voice (family, weight, width, softness, tracking), the surface wash and
 * hero gradient, the corner radius, button shape and spacing — so a ski trip, a river cruise and an ultra-luxury
 * honeymoon feel different without losing the member's identity. Members can override both fonts in Vision.
 */

export const THEME_PRIORITY = [
  'Ultra Luxury', 'Premium Luxury', 'Affordable Luxury', 'Expedition Cruise', 'Ocean Cruise', 'River Cruise',
  'Safari & Wildlife', 'Disney & Universal', 'Ski & Winter Sports', 'Rail', 'Coach', 'Fly-Drive & Road Trip',
  'Villa & Self-Catering', 'Lakes & Mountains', 'Touring & Adventure', 'Events & Sports',
  'Activity & Special Interest', 'City', 'Beach', 'UK & Domestic Break', 'Adult Only', 'Mainstream',
  'Long Haul', 'Mid Haul', 'Short Haul', 'Flight Only',
] as const;

interface ThemeSpec {
  family: 'Fraunces' | 'Bricolage Grotesque' | 'Fredoka';
  weight: number; stretch: number; soft: number; wonk: number; tracking: number; wash: string;
  overlay: ThemeTokens['overlay']; radius: ThemeTokens['radius']; motif: string; space: number; caps: boolean; button: string;
}

export const THEMES: Record<string, ThemeSpec> = {
  'Ultra Luxury': { family: 'Fraunces', weight: 300, stretch: 100, soft: 0, wonk: 0, tracking: 0.01, wash: '#2A2A2E', overlay: 'deep', radius: 'soft', motif: 'hairline', space: 1.2, caps: false, button: '999px' },
  'Premium Luxury': { family: 'Fraunces', weight: 300, stretch: 100, soft: 0, wonk: 0, tracking: 0.005, wash: '#3C3A44', overlay: 'deep', radius: 'soft', motif: 'hairline', space: 1.15, caps: false, button: '999px' },
  'Affordable Luxury': { family: 'Fraunces', weight: 400, stretch: 100, soft: 0, wonk: 0, tracking: 0, wash: '#4A4650', overlay: 'deep', radius: 'soft', motif: 'hairline', space: 1.05, caps: false, button: '999px' },
  'Expedition Cruise': { family: 'Bricolage Grotesque', weight: 600, stretch: 85, soft: 0, wonk: 0, tracking: -0.02, wash: '#2E4B5A', overlay: 'cool', radius: 'crisp', motif: 'contour', space: 0.95, caps: true, button: '10px' },
  'Ocean Cruise': { family: 'Fraunces', weight: 400, stretch: 100, soft: 0, wonk: 0, tracking: 0, wash: '#1F4F6E', overlay: 'cool', radius: 'soft', motif: 'waves', space: 1.05, caps: false, button: '999px' },
  'River Cruise': { family: 'Fraunces', weight: 400, stretch: 100, soft: 40, wonk: 0, tracking: 0, wash: '#2F5E52', overlay: 'soft', radius: 'soft', motif: 'ripples', space: 1.05, caps: false, button: '999px' },
  'Safari & Wildlife': { family: 'Fraunces', weight: 400, stretch: 100, soft: 30, wonk: 1, tracking: 0, wash: '#6B5A35', overlay: 'warm', radius: 'soft', motif: 'leaf', space: 1.05, caps: false, button: '999px' },
  'Disney & Universal': { family: 'Fredoka', weight: 600, stretch: 100, soft: 0, wonk: 0, tracking: -0.01, wash: '#C94E3F', overlay: 'warm', radius: 'round', motif: 'stars', space: 1, caps: false, button: '999px' },
  'Ski & Winter Sports': { family: 'Bricolage Grotesque', weight: 800, stretch: 95, soft: 0, wonk: 0, tracking: -0.03, wash: '#3B5F82', overlay: 'cool', radius: 'crisp', motif: 'snow', space: 0.95, caps: true, button: '10px' },
  'Rail': { family: 'Fraunces', weight: 500, stretch: 100, soft: 0, wonk: 1, tracking: 0.01, wash: '#5E2E3A', overlay: 'dusk', radius: 'crisp', motif: 'rails', space: 1, caps: false, button: '10px' },
  'Coach': { family: 'Bricolage Grotesque', weight: 600, stretch: 100, soft: 0, wonk: 0, tracking: -0.01, wash: '#4A5A6A', overlay: 'soft', radius: 'soft', motif: 'dashes', space: 1, caps: false, button: '999px' },
  'Fly-Drive & Road Trip': { family: 'Bricolage Grotesque', weight: 700, stretch: 80, soft: 0, wonk: 0, tracking: -0.02, wash: '#7A5A3A', overlay: 'warm', radius: 'crisp', motif: 'dashes', space: 0.95, caps: false, button: '8px' },
  'Villa & Self-Catering': { family: 'Fraunces', weight: 500, stretch: 100, soft: 100, wonk: 0, tracking: 0, wash: '#5E7A5A', overlay: 'warm', radius: 'round', motif: 'tiles', space: 1.05, caps: false, button: '999px' },
  'Lakes & Mountains': { family: 'Fraunces', weight: 500, stretch: 100, soft: 0, wonk: 0, tracking: 0, wash: '#3F6B5A', overlay: 'cool', radius: 'soft', motif: 'peaks', space: 1.05, caps: false, button: '999px' },
  'Touring & Adventure': { family: 'Bricolage Grotesque', weight: 600, stretch: 100, soft: 0, wonk: 0, tracking: -0.02, wash: '#4F5D3A', overlay: 'warm', radius: 'soft', motif: 'compass', space: 1, caps: false, button: '999px' },
  'Events & Sports': { family: 'Bricolage Grotesque', weight: 800, stretch: 100, soft: 0, wonk: 0, tracking: -0.03, wash: '#3A2E5A', overlay: 'deep', radius: 'crisp', motif: 'stripes', space: 0.9, caps: true, button: '8px' },
  'Activity & Special Interest': { family: 'Bricolage Grotesque', weight: 600, stretch: 95, soft: 0, wonk: 0, tracking: -0.015, wash: '#2F6B6B', overlay: 'soft', radius: 'soft', motif: 'compass', space: 0.95, caps: false, button: '999px' },
  'City': { family: 'Bricolage Grotesque', weight: 700, stretch: 90, soft: 0, wonk: 0, tracking: -0.03, wash: '#2B2F36', overlay: 'dusk', radius: 'crisp', motif: 'grid', space: 0.9, caps: false, button: '10px' },
  'Beach': { family: 'Fraunces', weight: 500, stretch: 100, soft: 100, wonk: 0, tracking: 0, wash: '#1E8A8C', overlay: 'warm', radius: 'round', motif: 'sun', space: 1, caps: false, button: '999px' },
  'UK & Domestic Break': { family: 'Fraunces', weight: 500, stretch: 100, soft: 30, wonk: 0, tracking: 0, wash: '#4E6B5C', overlay: 'soft', radius: 'soft', motif: 'leaf', space: 1, caps: false, button: '999px' },
  'Adult Only': { family: 'Fraunces', weight: 300, stretch: 100, soft: 0, wonk: 0, tracking: 0.01, wash: '#4A3A4A', overlay: 'deep', radius: 'soft', motif: 'hairline', space: 1.15, caps: false, button: '999px' },
  'Mainstream': { family: 'Bricolage Grotesque', weight: 700, stretch: 100, soft: 0, wonk: 0, tracking: -0.02, wash: '#1F6F8B', overlay: 'warm', radius: 'round', motif: 'sun', space: 1, caps: false, button: '999px' },
  'Long Haul': { family: 'Fraunces', weight: 400, stretch: 100, soft: 0, wonk: 0, tracking: 0, wash: '#2E4B6E', overlay: 'deep', radius: 'soft', motif: 'compass', space: 1.05, caps: false, button: '999px' },
  'Mid Haul': { family: 'Fraunces', weight: 500, stretch: 100, soft: 0, wonk: 0, tracking: 0, wash: '#4A6A7A', overlay: 'soft', radius: 'soft', motif: 'dots', space: 1, caps: false, button: '999px' },
  'Short Haul': { family: 'Bricolage Grotesque', weight: 600, stretch: 100, soft: 0, wonk: 0, tracking: -0.02, wash: '#2A7A8C', overlay: 'warm', radius: 'soft', motif: 'dots', space: 0.95, caps: false, button: '999px' },
  'Flight Only': { family: 'Bricolage Grotesque', weight: 700, stretch: 90, soft: 0, wonk: 0, tracking: -0.02, wash: '#2B3A4A', overlay: 'cool', radius: 'crisp', motif: 'dashes', space: 0.95, caps: false, button: '10px' },
  'default': { family: 'Fraunces', weight: 500, stretch: 100, soft: 0, wonk: 0, tracking: -0.01, wash: '#5B7A8C', overlay: 'soft', radius: 'soft', motif: 'none', space: 1, caps: false, button: '999px' },
};

/** Holiday types and sectors map onto themes the same way as on the website, when no tag decides. */
const HOLIDAY_TYPES: Array<[string, string]> = [
  ['luxury', 'Premium Luxury'], ['boutique', 'Affordable Luxury'], ["weddings & honeymoon's", 'Adult Only'], ['ocean cruising', 'Ocean Cruise'],
  ['river cruising', 'River Cruise'], ['safari', 'Safari & Wildlife'], ['ski', 'Ski & Winter Sports'], ['active', 'Activity & Special Interest'],
  ['walking', 'Lakes & Mountains'], ['mountains', 'Lakes & Mountains'], ['city', 'City'], ['family', 'Mainstream'], ['beach', 'Beach'],
  ['long haul', 'Long Haul'], ['budget', 'Mainstream'], ['adults only', 'Adult Only'], ["18-30's", 'Beach'],
];
const SECTORS: Array<[string, string]> = [
  ['luxury', 'Premium Luxury'], ['ocean', 'Ocean Cruise'], ['river', 'River Cruise'], ['touring', 'Touring & Adventure'],
  ['long haul', 'Long Haul'], ['europe', 'Short Haul'], ['mainstream', 'Mainstream'],
];

/** The theme key for a booking: first tag by priority, then holiday type, sector, then the brand's theme or tone. */
export function resolveTheme(input: { tags: string[]; holidayTypes?: string[]; sector?: string | null; brandTheme?: string; brandTone?: string }): string {
  const tag = THEME_PRIORITY.find((candidate) => input.tags.includes(candidate));
  if (tag) return tag;
  const types = (input.holidayTypes ?? []).map((type) => type.trim().toLowerCase());
  const byType = HOLIDAY_TYPES.find(([type]) => types.includes(type));
  if (byType) return byType[1];
  const sector = (input.sector ?? '').toLowerCase();
  const bySector = sector ? SECTORS.find(([needle]) => sector.includes(needle)) : undefined;
  if (bySector) return bySector[1];
  // "Member Tone" is free text in Vision; the website reads it as formal, casual or broad.
  const toneText = (input.brandTone ?? '').toLowerCase();
  const tone = toneText.includes('formal') ? 'formal' : toneText.includes('casual') ? 'casual' : 'broad';
  if (/luxury/i.test(input.brandTheme ?? '') || tone === 'formal') return 'Premium Luxury';
  if (tone === 'casual') return 'Beach';
  return 'default';
}

export function themeTokens(input: {
  tags: string[];
  holidayTypes?: string[];
  sector?: string | null;
  configuredTheme: string;
  brandTone?: string;
  primaryColor: string;
  secondaryColor: string;
  displayFont: string;
  bodyFont: string;
}): ThemeTokens {
  const key = resolveTheme({ tags: input.tags, holidayTypes: input.holidayTypes, sector: input.sector, brandTheme: input.configuredTheme, brandTone: input.brandTone });
  const spec = THEMES[key] ?? THEMES['default']!;
  const memberDisplay = validFont(input.displayFont);
  return {
    key,
    primaryColor: validHex(input.primaryColor) ?? '#1F6F8B',
    secondaryColor: validHex(input.secondaryColor) ?? '#E7F0F2',
    displayFont: memberDisplay ?? spec.family,
    bodyFont: validFont(input.bodyFont) ?? 'Instrument Sans',
    overlay: spec.overlay,
    radius: spec.radius,
    motif: spec.motif,
    spacingScale: spec.space,
    displayWeight: spec.weight,
    displayStretch: spec.stretch,
    displaySoft: spec.soft,
    displayWonk: spec.wonk,
    tracking: spec.tracking,
    wash: spec.wash,
    buttonRadius: spec.button,
    capsKickers: spec.caps,
  };
}

function validHex(value: string): string | null {
  const match = value.trim().match(/^#?([A-Fa-f0-9]{6})$/);
  return match ? `#${match[1]!.toUpperCase()}` : null;
}

function validFont(value: string): string | null {
  const trimmed = value.trim();
  return /^[A-Za-z0-9 ]{2,40}$/.test(trimmed) ? trimmed : null;
}
