import type { ThemeTokens } from '@vision-trips/contracts';
import { fontStack, memberFontsUrl, themeStyle } from './theme-style';

const theme = (extra: Partial<ThemeTokens>): ThemeTokens => ({ key: 'default', primaryColor: '#123456', secondaryColor: '#E7F0F2', displayFont: 'Fraunces', bodyFont: 'Instrument Sans', overlay: 'soft', radius: 'soft', motif: 'none', spacingScale: 1, ...extra });

describe('theme style (matching the website)', () => {
  it('sets the same variables as the website for a Fraunces theme', () => {
    const style = themeStyle(theme({ key: 'River Cruise', displayWeight: 400, displaySoft: 40, displayWonk: 0, tracking: 0, wash: '#2F5E52', radius: 'soft', buttonRadius: '999px', spacingScale: 1.05 }));
    expect(style).toMatchObject({
      '--vt-display': "'Fraunces Variable', 'Fraunces', Georgia, serif", '--vt-display-weight': '400', '--vt-axes': '"SOFT" 40, "WONK" 0', '--vt-track': '0em',
      '--vt-wash': '#2F5E52', '--vt-hero-a': 'color-mix(in srgb, #2F5E52 72%, #000)', '--vt-hero-b': 'color-mix(in srgb, #2F5E52 45%, var(--vt-accent))',
      '--r-l': '24px', '--r': '16px', '--r-s': '10px', '--btn-r': '999px', '--vt-space': '1.05',
    });
    expect(style['--vt-body']).toContain("'Instrument Sans Variable'");
  });

  it('uses the width axis for the grotesques and crisp corners where the website does', () => {
    const style = themeStyle(theme({ key: 'Ski & Winter Sports', displayFont: 'Bricolage Grotesque', displayWeight: 800, displayStretch: 95, tracking: -0.03, radius: 'crisp', buttonRadius: '10px' }));
    expect(style).toMatchObject({ '--vt-axes': '"wdth" 95', '--vt-display-stretch': '95%', '--vt-display-weight': '800', '--r': '10px', '--btn-r': '10px', '--vt-track': '-0.03em' });
  });

  it('falls back safely for older snapshots and unsafe values', () => {
    const style = themeStyle(theme({ displayFont: "x'); background:url(evil", wash: 'red;}', buttonRadius: '1px; color: red' }));
    expect(style['--vt-display']).toContain('Fraunces Variable');
    expect(style['--vt-wash']).toBe('#5B7A8C');
    expect(style['--btn-r']).toBe('999px');
    expect(themeStyle(null)['--vt-display-weight']).toBe('500');
  });

  it('loads a member’s own web fonts from Google Fonts, but never the bundled ones', () => {
    expect(memberFontsUrl(theme({ displayFont: 'Playfair Display', bodyFont: 'Lato' }))).toBe('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@300;400;500;600;700&family=Lato:wght@300;400;500;600;700&display=swap');
    expect(memberFontsUrl(theme({}))).toBeNull();
    expect(fontStack('Lato', 'Instrument Sans')).toBe("'Lato', 'Instrument Sans Variable', 'Instrument Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif");
  });
});
