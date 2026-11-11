import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Google Places photos need the API key on every request, so the app must never fetch them from Google directly.
 * The API sends the app signed links to its own `/media/place-photo` endpoint instead; that endpoint checks the
 * signature (so it only serves photos the API handed out, rather than acting as an open proxy), fetches the photo
 * from Google with the key, and streams it back.
 */

/** The widths the app may ask for (Google renders the photo at the requested width). */
export const PLACE_PHOTO_WIDTHS = [480, 960, 1400] as const;
export type PlacePhotoWidth = (typeof PLACE_PHOTO_WIDTHS)[number];

/** Stored in cached place profiles in place of a URL: the Google photo name, never a key-bearing link. */
export const PLACE_PHOTO_REF = 'gplace:';

const PHOTO_NAME = /^places\/[A-Za-z0-9_-]{1,300}\/photos\/[A-Za-z0-9_-]{1,1000}$/;

export function isPlacePhotoName(name: string): boolean { return PHOTO_NAME.test(name); }

export function signPlacePhoto(name: string): string {
  return createHmac('sha256', secret()).update(`place-photo:${name}`).digest('base64url').slice(0, 32);
}

export function verifyPlacePhoto(name: string, signature: string): boolean {
  if (!isPlacePhotoName(name)) return false;
  const expected = Buffer.from(signPlacePhoto(name));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function placePhotoUrl(apiBase: string, name: string, width: PlacePhotoWidth): string {
  return `${apiBase}/media/place-photo?name=${encodeURIComponent(name)}&w=${width}&sig=${signPlacePhoto(name)}`;
}

/** Turns a cached `gplace:` reference into a signed link plus its smaller copies; leaves other URLs alone. */
export function resolvePlacePhoto<T extends { url: string; variants?: Array<{ url: string; width: number }> }>(image: T, apiBase: string): T | null {
  if (!image.url.startsWith(PLACE_PHOTO_REF)) return image.url.includes('key=') ? null : image;
  const name = image.url.slice(PLACE_PHOTO_REF.length);
  if (!isPlacePhotoName(name)) return null;
  return { ...image, url: placePhotoUrl(apiBase, name, 1400), variants: PLACE_PHOTO_WIDTHS.map((width) => ({ url: placePhotoUrl(apiBase, name, width), width })) };
}

function secret(): string {
  return process.env.VISION_LINK_SECRET || 'local-development-only';
}
