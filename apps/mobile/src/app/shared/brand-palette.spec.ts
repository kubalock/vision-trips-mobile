import { brandPalette, contrast } from './brand-palette';

describe('brandPalette', () => {
  it('keeps a brand colour that is already readable', () => {
    const palette = brandPalette('#0F766E', 'light');
    expect(palette.accent).toBe('#0f766e');
    expect(palette.actionInk).toBe('#ffffff');
  });

  it('lightens a black brand colour in dark mode so it stays visible', () => {
    const palette = brandPalette('#000000', 'dark');
    expect(contrast(palette.accent, '#1b1e20')).toBeGreaterThanOrEqual(3);
    expect(contrast(palette.accentText, '#1b1e20')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.action, palette.actionInk)).toBeGreaterThanOrEqual(4.5);
  });

  it('darkens a pale brand colour in light mode and picks readable button text', () => {
    const palette = brandPalette('#FFE14D', 'light');
    expect(contrast(palette.accentText, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.action, palette.actionInk)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back to the default teal for missing or malformed colours', () => {
    expect(brandPalette(null, 'light').accent).toBe('#0f766e');
    expect(brandPalette('not-a-colour', 'light').accent).toBe('#0f766e');
    expect(brandPalette('#abc', 'light').accentText).toMatch(/^#[0-9a-f]{6}$/);
  });
});
