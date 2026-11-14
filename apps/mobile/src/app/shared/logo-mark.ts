import { Component, input } from '@angular/core';

/**
 * The Vision Trips mark, "Golden hour": a map pin framing the sun setting on the horizon — any destination, however
 * you travel there. The source artwork lives in public/brand/logo-mark.svg (and the app icons in resources/).
 *
 * - `tile` (default): the full mark on its deep-teal tile, for places that show Vision Trips itself.
 * - `glyph`: the pin and horizon in `currentColor`, with the window cut in `--vt-logo-bg`, for placing on a coloured
 *   tile such as the header, where a travel agency's own accent colour is the background.
 */
@Component({
  selector: 'vt-logo-mark',
  template: `
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      @if (variant() === 'tile') { <rect width="64" height="64" rx="16" fill="#0b3b38" /> }
      <path d="M32 53C24 44 17 37 17 28a15 15 0 0 1 30 0c0 9-7 16-15 25Z" [attr.fill]="ink()" />
      <circle cx="32" cy="28" r="10" [attr.fill]="variant() === 'tile' ? '#0b3b38' : 'var(--vt-logo-bg, #0b3b38)'" />
      <path d="M25.5 31.9a6.5 6.5 0 0 1 13 0Z" fill="#ffb35c" />
      <path d="M21 33.2H43" [attr.stroke]="ink()" stroke-width="3.2" />
    </svg>
  `,
  host: { class: 'vt-logo-mark' },
  styles: `:host { display: inline-grid; place-items: center; line-height: 0; } svg { width: 100%; height: 100%; }`,
})
export class VtLogoMark {
  readonly variant = input<'tile' | 'glyph'>('tile');
  protected ink(): string { return this.variant() === 'tile' ? '#fff' : 'currentColor'; }
}
