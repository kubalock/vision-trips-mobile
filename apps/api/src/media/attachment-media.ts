import { createCipheriv, createDecipheriv, createHash, createHmac } from 'node:crypto';
import type { AirtableRecord } from '../airtable/airtable.service.js';

/*
 * Airtable attachment URLs expire within hours, so a saved or offline snapshot would soon show broken images and an
 * unplayable walkthrough. Instead, image and video attachments are given stable links to the API's own
 * `/media/attachment/<token>` endpoint, which reads the record again and streams the attachment from its current URL.
 *
 * The token is the permission (an <img> can't send the app's access token). It is encrypted and authenticated, so it
 * reveals no base, table, record or attachment ID and can't be forged or altered. The same attachment always gets the
 * same token, so browsers and the app can cache the file. A removed attachment stops being served.
 *
 * Snapshots are cached per booking and shared across requests, so they hold a `vt-media:<token>` marker; the
 * MediaUrlInterceptor turns markers into absolute URLs for the host the request came to.
 */

export const MEDIA_MARKER = 'vt-media:';
export type AttachmentVariant = 'o' | 's' | 'l' | 'f';
export interface AttachmentRef { b: string; t: string; r: string; f: string; a: string; v: AttachmentVariant }

const MEDIA_TYPE = /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|quicktime|webm|ogg|x-m4v))$/i;
const ALLOWED_TABLES = new Set(['Bookings', 'Bookings [Elements]', 'Bookings [Upsells]', 'Brands & Branches', 'Suppliers', 'CMS [Airlines]', 'CMS [Locations]', 'CMS [Cruise Ships]', 'CMS [Cruise Operators]']);

function key(): Buffer {
  const secret = process.env.VISION_MEDIA_SECRET?.trim() || process.env.VISION_LINK_SECRET?.trim() || 'local-development-only';
  return createHash('sha256').update(`vision-attachment-media:${secret}`).digest();
}

/** Deterministic authenticated encryption (the IV is derived from the content), so equal references give equal tokens. */
export function attachmentToken(ref: AttachmentRef): string {
  const plain = Buffer.from(JSON.stringify([ref.b, ref.t, ref.r, ref.f, ref.a, ref.v]));
  const iv = createHmac('sha256', key()).update(plain).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}

export function readAttachmentToken(token: string): AttachmentRef | null {
  if (!/^[A-Za-z0-9_-]{40,600}$/.test(token)) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
    const [b, t, r, f, a, v] = JSON.parse(plain) as string[];
    if (!/^app[A-Za-z0-9]{14}$/.test(b ?? '') || !/^rec[A-Za-z0-9]{14}$/.test(r ?? '') || !/^att[A-Za-z0-9]{14}$/.test(a ?? '')) return null;
    if (!ALLOWED_TABLES.has(t ?? '') || typeof f !== 'string' || !['o', 's', 'l', 'f'].includes(v ?? '')) return null;
    return { b: b!, t: t!, r: r!, f, a: a!, v: v as AttachmentVariant };
  } catch { return null; }
}

interface Thumb { url?: unknown; width?: unknown; height?: unknown }
interface Attachment { id?: unknown; url?: unknown; type?: unknown; thumbnails?: { small?: Thumb; large?: Thumb; full?: Thumb } }

function isAttachment(value: unknown): value is Attachment {
  const item = value as Attachment | null;
  return Boolean(item && typeof item === 'object' && typeof item.id === 'string' && /^att[A-Za-z0-9]{14}$/.test(item.id) && typeof item.url === 'string');
}

/**
 * A copy of the record whose image and video attachments point at the media endpoint (as `vt-media:` markers).
 * Other attachments (PDFs, documents) and the fields in `skip` are left as they are.
 */
export function withMediaLinks(baseId: string, table: string, record: AirtableRecord, skip: readonly string[] = []): AirtableRecord {
  if (!ALLOWED_TABLES.has(table) || !record?.fields) return record;
  let changed = false;
  const fields: Record<string, unknown> = { ...record.fields };
  for (const [field, value] of Object.entries(record.fields)) {
    if (skip.includes(field) || !Array.isArray(value) || !value.some(isAttachment)) continue;
    fields[field] = value.map((item) => {
      if (!isAttachment(item) || !MEDIA_TYPE.test(typeof item.type === 'string' ? item.type : '')) return item;
      changed = true;
      const link = (v: AttachmentVariant) => `${MEDIA_MARKER}${attachmentToken({ b: baseId, t: table, r: record.id, f: field, a: item.id as string, v })}`;
      const thumbs = item.thumbnails ? Object.fromEntries((['small', 'large', 'full'] as const).flatMap((size) => {
        const thumb = item.thumbnails?.[size];
        return thumb && typeof thumb.url === 'string' ? [[size, { ...thumb, url: link(size === 'small' ? 's' : size === 'large' ? 'l' : 'f') }]] : [];
      })) : undefined;
      return { ...item, url: link('o'), ...(thumbs ? { thumbnails: thumbs } : {}) };
    });
  }
  return changed ? { ...record, fields } : record;
}

/** The attachment's current URL for the variant, or null when it is gone or not media. */
export function currentAttachmentUrl(record: AirtableRecord, ref: AttachmentRef): { url: string; type: string } | null {
  const value = record.fields[ref.f];
  if (!Array.isArray(value)) return null;
  const item = value.find((candidate) => isAttachment(candidate) && candidate.id === ref.a) as Attachment | undefined;
  if (!item || !MEDIA_TYPE.test(typeof item.type === 'string' ? item.type : '')) return null;
  const variant = ref.v === 's' ? item.thumbnails?.small : ref.v === 'l' ? item.thumbnails?.large : ref.v === 'f' ? item.thumbnails?.full : item;
  const url = typeof variant?.url === 'string' ? variant.url : null;
  return url && isAirtableContentUrl(url) ? { url, type: typeof item.type === 'string' ? item.type : '' } : null;
}

/** Only Airtable's own content hosts are ever fetched: the endpoint is never an open proxy. */
export function isAirtableContentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'dl.airtable.com' || url.hostname.endsWith('.airtableusercontent.com'));
  } catch { return false; }
}

/** Replaces `vt-media:` markers anywhere in a JSON body with absolute media URLs for `apiBase`. */
export function resolveMediaMarkers<T>(body: T, apiBase: string): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return value.startsWith(MEDIA_MARKER) ? `${apiBase}/media/attachment/${value.slice(MEDIA_MARKER.length)}` : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([field, item]) => [field, walk(item)]));
    }
    return value;
  };
  return walk(body) as T;
}
