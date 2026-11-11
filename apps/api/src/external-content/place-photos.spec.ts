import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MediaController } from './media.controller.js';
import { PLACE_PHOTO_REF, placePhotoUrl, resolvePlacePhoto, signPlacePhoto, verifyPlacePhoto } from './place-photos.js';

const NAME = 'places/ChIJabc123/photos/AXCi2Q_photo-ref';

describe('place photo links', () => {
  it('turns a cached photo name into signed, key-free links in three sizes', () => {
    const image = resolvePlacePhoto<{ url: string; attribution: string; official: boolean; variants?: Array<{ url: string; width: number }> }>({ url: `${PLACE_PHOTO_REF}${NAME}`, attribution: 'Hotel', official: true }, 'https://api.example/v1');

    expect(image?.url).toBe(`https://api.example/v1/media/place-photo?name=${encodeURIComponent(NAME)}&w=1400&sig=${signPlacePhoto(NAME)}`);
    expect(image?.variants?.map((variant) => variant.width)).toEqual([480, 960, 1400]);
    expect(JSON.stringify(image)).not.toMatch(/key=|googleapis/);
  });

  it('drops any old link that still carries a key', () => {
    expect(resolvePlacePhoto({ url: 'https://places.googleapis.com/v1/x/media?maxWidthPx=1400&key=SECRET' }, 'https://api.example/v1')).toBeNull();
  });

  it('only accepts its own signatures and well-formed photo names', () => {
    expect(verifyPlacePhoto(NAME, signPlacePhoto(NAME))).toBe(true);
    expect(verifyPlacePhoto(NAME, signPlacePhoto('places/other/photos/x'))).toBe(false);
    expect(verifyPlacePhoto('https://evil.example/x', signPlacePhoto('https://evil.example/x'))).toBe(false);
  });
});

describe('GET /v1/media/place-photo', () => {
  let app: INestApplication;
  const google = vi.fn();

  beforeAll(async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'server-only-key';
    const module = await Test.createTestingModule({ controllers: [MediaController] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    module.get(MediaController).fetchImpl = google as never;
    await app.init();
  });
  afterAll(async () => { delete process.env.GOOGLE_PLACES_API_KEY; await app.close(); });

  const path = (url: string) => url.replace('https://api.example', '');

  it('fetches the photo with the key in a header and streams it back with cache headers', async () => {
    google.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }));

    const response = await request(app.getHttpServer()).get(path(placePhotoUrl('https://api.example/v1', NAME, 480)));

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toContain('max-age=86400');
    expect(Buffer.from(response.body).length).toBe(3);
    const [url, init] = google.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://places.googleapis.com/v1/${NAME}/media?maxWidthPx=480`);
    expect(url).not.toContain('key');
    expect(init.headers).toEqual({ 'X-Goog-Api-Key': 'server-only-key' });
  });

  it('refuses unsigned or tampered links and unsupported sizes without calling Google', async () => {
    google.mockClear();
    const signed = path(placePhotoUrl('https://api.example/v1', NAME, 480));
    const responses = await Promise.all([
      request(app.getHttpServer()).get(signed.replace(/sig=[^&]+/, 'sig=forged')),
      request(app.getHttpServer()).get(signed.replace('w=480', 'w=4000')),
      request(app.getHttpServer()).get(`/v1/media/place-photo?name=${encodeURIComponent('places/x/photos/y')}&w=480`),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 400, 400]);
    expect(google).not.toHaveBeenCalled();
  });

  it('refuses anything Google returns that is not an image', async () => {
    google.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    const response = await request(app.getHttpServer()).get(path(placePhotoUrl('https://api.example/v1', NAME, 960)));
    expect(response.status).toBe(502);
  });
});
