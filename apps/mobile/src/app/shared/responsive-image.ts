import type { ImageVariant } from '@vision-trips/contracts';

/** Anything with a source URL and, optionally, its sizes and smaller copies (trip images, Places photos). */
export interface ResponsiveSource { url: string; width?: number | null; height?: number | null; variants?: ImageVariant[] }

/** Typical displayed widths in CSS pixels, for `sizes`. */
export const IMAGE_SIZES = {
  hero: '100vw',
  card: '(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw',
  gallery: '(min-width: 640px) 33vw, 50vw',
  strip: '208px',
  thumb: '160px',
  fullscreen: '100vw',
} as const;

/** `srcset` from the image's smaller copies, or null when there are none (the browser then uses `src`). */
export function srcset(image: ResponsiveSource | null | undefined): string | null {
  const variants = image?.variants ?? [];
  return variants.length ? variants.map((variant) => `${variant.url} ${variant.width}w`).join(', ') : null;
}

/**
 * The `src` for a slot about `cssWidth` pixels wide: the smallest copy that is still sharp on a 2× screen, else
 * the largest copy available, else the original. Browsers that understand `srcset` choose for themselves.
 */
export function sourceFor(image: ResponsiveSource, cssWidth: number): string {
  const variants = image.variants ?? [];
  if (!variants.length) return image.url;
  return (variants.find((variant) => variant.width >= cssWidth * 2) ?? variants[variants.length - 1]).url;
}
