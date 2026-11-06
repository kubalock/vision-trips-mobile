import type { ThemeTokens } from '@vision-trips/contracts';

const priority = [
  'Ultra Luxury', 'Premium Luxury', 'Affordable Luxury', 'Expedition Cruise', 'Ocean Cruise', 'River Cruise',
  'Safari & Wildlife', 'Disney & Universal', 'Ski & Winter Sports', 'Rail', 'Coach', 'Fly-Drive & Road Trip',
  'Villa & Self-Catering', 'Lakes & Mountains', 'Touring & Adventure', 'Events & Sports',
  'Activity & Special Interest', 'City', 'Beach', 'UK & Domestic Break', 'Adult Only', 'Mainstream',
  'Long Haul', 'Mid Haul', 'Short Haul', 'Flight Only',
] as const;

const specs: Record<string, Pick<ThemeTokens, 'displayFont' | 'overlay' | 'radius' | 'motif' | 'spacingScale'>> = {
  'Ultra Luxury': { displayFont: 'Fraunces', overlay: 'deep', radius: 'soft', motif: 'hairline', spacingScale: 1.2 },
  'Premium Luxury': { displayFont: 'Fraunces', overlay: 'deep', radius: 'soft', motif: 'hairline', spacingScale: 1.15 },
  'Affordable Luxury': { displayFont: 'Fraunces', overlay: 'deep', radius: 'soft', motif: 'hairline', spacingScale: 1.05 },
  'Expedition Cruise': { displayFont: 'Bricolage Grotesque', overlay: 'cool', radius: 'crisp', motif: 'contour', spacingScale: 0.95 },
  'Ocean Cruise': { displayFont: 'Fraunces', overlay: 'cool', radius: 'soft', motif: 'waves', spacingScale: 1.05 },
  'River Cruise': { displayFont: 'Fraunces', overlay: 'soft', radius: 'soft', motif: 'ripples', spacingScale: 1.05 },
  'Safari & Wildlife': { displayFont: 'Fraunces', overlay: 'warm', radius: 'soft', motif: 'leaf', spacingScale: 1.05 },
  'Disney & Universal': { displayFont: 'Fredoka', overlay: 'warm', radius: 'round', motif: 'stars', spacingScale: 1 },
  'Ski & Winter Sports': { displayFont: 'Bricolage Grotesque', overlay: 'cool', radius: 'crisp', motif: 'snow', spacingScale: 0.95 },
  'City': { displayFont: 'Bricolage Grotesque', overlay: 'dusk', radius: 'crisp', motif: 'grid', spacingScale: 0.9 },
  'Beach': { displayFont: 'Fraunces', overlay: 'warm', radius: 'round', motif: 'sun', spacingScale: 1 },
  'Mainstream': { displayFont: 'Bricolage Grotesque', overlay: 'warm', radius: 'round', motif: 'sun', spacingScale: 1 },
  default: { displayFont: 'Fraunces', overlay: 'soft', radius: 'soft', motif: 'none', spacingScale: 1 },
};

export function themeTokens(input: {
  tags: string[];
  configuredTheme: string;
  primaryColor: string;
  secondaryColor: string;
  displayFont: string;
  bodyFont: string;
}): ThemeTokens {
  const selected = priority.find((tag) => input.tags.includes(tag)) ??
    (specs[input.configuredTheme] ? input.configuredTheme : 'default');
  const spec = specs[selected] ?? specs.default;
  return {
    key: selected,
    primaryColor: validHex(input.primaryColor) ?? '#1F6F8B',
    secondaryColor: validHex(input.secondaryColor) ?? '#E7F0F2',
    displayFont: validFont(input.displayFont) ?? spec.displayFont,
    bodyFont: validFont(input.bodyFont) ?? 'Instrument Sans',
    overlay: spec.overlay,
    radius: spec.radius,
    motif: spec.motif,
    spacingScale: spec.spacingScale,
  };
}

function validHex(value: string): string | null {
  const match = value.trim().match(/^#?([A-Fa-f0-9]{6})$/);
  return match ? `#${match[1].toUpperCase()}` : null;
}

function validFont(value: string): string | null {
  const trimmed = value.trim();
  return /^[A-Za-z0-9 ]{2,40}$/.test(trimmed) ? trimmed : null;
}
