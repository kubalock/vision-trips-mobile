import { resolveTheme, THEME_PRIORITY, THEMES, themeTokens } from './theme.js';

const base = { configuredTheme: '', primaryColor: '#123456', secondaryColor: '', displayFont: '', bodyFont: '' };

describe('trip themes (matching the website)', () => {
  it('has a theme for every Vision tag, as the PHP plugin does', () => {
    expect(THEME_PRIORITY).toHaveLength(26);
    for (const tag of THEME_PRIORITY) expect(resolveTheme({ tags: [tag] })).toBe(tag);
    for (const tag of THEME_PRIORITY) expect(THEMES[tag]).toBeDefined();
  });

  it('lets a luxury tier win over a product tag', () => {
    expect(resolveTheme({ tags: ['Ocean Cruise', 'Ultra Luxury'] })).toBe('Ultra Luxury');
  });

  it('falls back to holiday type, sector, then the brand’s theme or tone', () => {
    expect(resolveTheme({ tags: [], holidayTypes: ['Ski'] })).toBe('Ski & Winter Sports');
    expect(resolveTheme({ tags: [], sector: 'Europe Short Breaks' })).toBe('Short Haul');
    expect(resolveTheme({ tags: [], brandTheme: 'Luxury Collection' })).toBe('Premium Luxury');
    expect(resolveTheme({ tags: [], brandTone: 'Friendly and casual' })).toBe('Beach');
    expect(resolveTheme({ tags: [] })).toBe('default');
  });

  it('carries the website’s typography values and lets the member override the fonts', () => {
    const ski = themeTokens({ ...base, tags: ['Ski & Winter Sports'] });
    expect(ski).toMatchObject({ key: 'Ski & Winter Sports', displayFont: 'Bricolage Grotesque', bodyFont: 'Instrument Sans', displayWeight: 800, displayStretch: 95, tracking: -0.03, wash: '#3B5F82', radius: 'crisp', buttonRadius: '10px', capsKickers: true, primaryColor: '#123456' });
    expect(themeTokens({ ...base, tags: ['River Cruise'] })).toMatchObject({ displayFont: 'Fraunces', displaySoft: 40, displayWonk: 0 });
    expect(themeTokens({ ...base, tags: ['Beach'], displayFont: 'Playfair Display', bodyFont: 'Lato' })).toMatchObject({ displayFont: 'Playfair Display', bodyFont: 'Lato' });
    expect(themeTokens({ ...base, tags: [], displayFont: 'bad<font>' }).displayFont).toBe('Fraunces');
  });
});
