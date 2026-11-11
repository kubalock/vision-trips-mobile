import { BadGatewayException, BadRequestException, Controller, Get, NotFoundException, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { byteLimit } from '../trip-actions/supplier-document.js';
import { PLACE_PHOTO_WIDTHS, verifyPlacePhoto, type PlacePhotoWidth } from './place-photos.js';

const MAX_PHOTO_BYTES = 5_000_000;

/**
 * Serves Google Places photos without exposing the API key. Images are loaded by `<img>` tags, which cannot send
 * the app's access token, so the signed link itself is the permission: only photos the API handed out are served.
 */
@ApiExcludeController()
@Controller('media')
export class MediaController {
  /** Replaceable in tests. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

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
