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

  it('keeps a dark brand colour’s hue for dark-mode buttons instead of turning it grey', () => {
    const channels = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const navy = brandPalette('#0B1D33', 'dark');
    const [r, g, b] = channels(navy.action);
    expect(b - r).toBeGreaterThan(40); // clearly blue, not a flat grey
    expect(contrast(navy.action, navy.actionInk)).toBeGreaterThanOrEqual(7);
    const green = brandPalette('#14532D', 'dark');
    const [gr, gg, gb] = channels(green.action);
    expect(gg - Math.max(gr, gb)).toBeGreaterThan(40);
  });

  it('gives a colourless brand a near-white dark-mode button', () => {
    expect(brandPalette('#111111', 'dark').action).toBe('#f2f1ec');
    expect(brandPalette('#777777', 'dark').actionInk).toBe('#111111');
  });
});
