import { BadGatewayException, BadRequestException, Controller, Get, Headers, NotFoundException, Optional, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { currentAttachmentUrl, isAirtableContentUrl, readAttachmentToken, type AttachmentRef } from '../media/attachment-media.js';
import { TtlCache } from '../trips/ttl-cache.js';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { byteLimit } from '../trip-actions/supplier-document.js';
import { PLACE_PHOTO_WIDTHS, verifyPlacePhoto, type PlacePhotoWidth } from './place-photos.js';

const MAX_PHOTO_BYTES = 5_000_000;
const MAX_IMAGE_BYTES = 20_000_000;
const MAX_VIDEO_BYTES = 500_000_000;
/** Airtable attachment URLs last a couple of hours; the record is re-read well before that, or at once if refused. */
const RECORD_CACHE_MS = 30 * 60_000;
const records = new TtlCache<AirtableRecord>(500);

/**
 * Serves Google Places photos without exposing the API key. Images are loaded by `<img>` tags, which cannot send
 * the app's access token, so the signed link itself is the permission: only photos the API handed out are served.
 */
@ApiExcludeController()
@Controller('media')
export class MediaController {
  /** Replaceable in tests. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  constructor(@Optional() private readonly airtable?: AirtableService) {}

  /**
   * An Airtable image or video attachment, by its encrypted token (see attachment-media.ts). The record is read again
   * so the current Airtable URL is used; videos support Range requests so they can be streamed and scrubbed.
   */
  @Get('attachment/:token')
  async attachment(@Param('token') token: string, @Headers('range') range: string | undefined, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const ref = readAttachmentToken(token);
    if (!ref || !this.airtable) throw new NotFoundException('This file is not available.');
    let upstream = await this.fetchAttachment(ref, range, false);
    // An expired or rotated URL: read the record again once and retry.
    if (upstream && [401, 403, 404, 410].includes(upstream.status)) { await upstream.body?.cancel().catch(() => undefined); upstream = await this.fetchAttachment(ref, range, true); }
    const contentType = (upstream?.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const video = /^video\//i.test(contentType);
    if (!upstream || !(upstream.ok || upstream.status === 206) || !upstream.body || !/^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|quicktime|webm|ogg|x-m4v))$/i.test(contentType)) {
      await upstream?.body?.cancel().catch(() => undefined);
      throw new BadGatewayException('The file could not be loaded.');
    }
    // The token names one attachment (a new file gets a new attachment ID), so the content never changes.
    response.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (video) {
      response.setHeader('Accept-Ranges', 'bytes');
      const contentRange = upstream.headers.get('content-range');
      if (upstream.status === 206 && contentRange) { response.status(206); response.setHeader('Content-Range', contentRange); }
    }
    const declared = Number(upstream.headers.get('content-length') ?? NaN);
    const limited = byteLimit(video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES);
    const body = Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>);
    body.on('error', (error) => limited.destroy(error));
    limited.on('error', () => body.destroy());
    return new StreamableFile(body.pipe(limited), { type: contentType, ...(Number.isFinite(declared) && declared > 0 ? { length: declared } : {}) });
  }

  private async fetchAttachment(ref: AttachmentRef, range: string | undefined, fresh: boolean): Promise<globalThis.Response | null> {
    const cacheKey = `${ref.b}:${ref.t}:${ref.r}`;
    let record = fresh ? undefined : records.get(cacheKey);
    if (!record) {
      record = await this.airtable!.record(ref.b, ref.t, ref.r).catch(() => undefined);
      if (!record) return null;
      records.set(cacheKey, record, RECORD_CACHE_MS);
    }
    const current = currentAttachmentUrl(record, ref);
    if (!current) return null;
    const headers: Record<string, string> = {};
    if (range && /^bytes=\d*-\d*$/.test(range) && /^video\//i.test(current.type)) headers['Range'] = range;
    const response = await this.fetchImpl(current.url, { headers, signal: AbortSignal.timeout(20_000) }).catch(() => null);
    // Redirects are followed only within Airtable's own content hosts.
    if (response?.url && !isAirtableContentUrl(response.url)) { await response.body?.cancel().catch(() => undefined); return null; }
    return response;
  }

  @Get('place-photo')
  async placePhoto(
    @Query('name') name: string | undefined, @Query('w') width: string | undefined, @Query('sig') signature: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const size = Number(width) as PlacePhotoWidth;
    if (!name || !signature || !PLACE_PHOTO_WIDTHS.includes(size)) throw new BadRequestException('This photo link is not valid.');
    if (!verifyPlacePhoto(name, signature)) throw new NotFoundException('This photo is not available.');
    const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
    if (!key) throw new NotFoundException('This photo is not available.');

    // The key goes in a header, never in a URL; Google answers with a redirect to the image, which fetch follows.
    const upstream = await this.fetchImpl(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=${size}`, { headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(10_000) })
      .catch(() => null);
    const contentType = upstream?.headers.get('content-type') ?? '';
    if (!upstream?.ok || !upstream.body || !/^image\/(jpeg|png|webp|gif|avif)$/i.test(contentType.split(';')[0].trim())) {
      await upstream?.body?.cancel().catch(() => undefined);
      throw new BadGatewayException('The photo could not be loaded.');
    }
    // Photos for a place rarely change; let the browser and any CDN keep them for a day.
    response.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const limited = byteLimit(MAX_PHOTO_BYTES);
    const body = Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>);
    body.on('error', (error) => limited.destroy(error));
    limited.on('error', () => body.destroy());
    return new StreamableFile(body.pipe(limited), { type: contentType });
  }
}
