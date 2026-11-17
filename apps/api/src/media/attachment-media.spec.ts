import { MediaController } from '../external-content/media.controller.js';
import { attachmentToken, MEDIA_MARKER, readAttachmentToken, resolveMediaMarkers, withMediaLinks } from './attachment-media.js';

const BASE = 'appABCDEFGHIJKLMN';
const RECORD = 'recBOOKINGAAAAAAA';
const hero = (url = 'https://v5.airtableusercontent.com/hero.jpg?sig=1') => ({ id: 'attHEROAAAAAAAAAA', url, type: 'image/jpeg', width: 3000, thumbnails: { large: { url: 'https://v5.airtableusercontent.com/hero-l.jpg?sig=1', width: 768 }, full: { url: 'https://v5.airtableusercontent.com/hero-f.jpg?sig=1', width: 3000 } } });
const pdf = { id: 'attPDFAAAAAAAAAAA', url: 'https://v5.airtableusercontent.com/ticket.pdf?sig=1', type: 'application/pdf' };
const video = { id: 'attVIDEOAAAAAAAAA', url: 'https://v5.airtableusercontent.com/walk.mp4?sig=1', type: 'video/mp4' };

describe('attachment media links', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'media-secret'; });

  it('makes stable, opaque, tamper-proof tokens', () => {
    const ref = { b: BASE, t: 'Bookings', r: RECORD, f: 'Hero Image', a: 'attHEROAAAAAAAAAA', v: 'o' as const };
    const token = attachmentToken(ref);
    expect(attachmentToken(ref)).toBe(token);
    expect(readAttachmentToken(token)).toEqual(ref);
    for (const secret of [BASE, RECORD, 'attHERO', 'Hero Image']) expect(token).not.toContain(secret);
    const tampered = token.slice(0, 20) + (token[20] === 'A' ? 'B' : 'A') + token.slice(21);
    expect(readAttachmentToken(tampered)).toBeNull();
    process.env.VISION_LINK_SECRET = 'another-secret';
    expect(readAttachmentToken(token)).toBeNull();
  });

  it('links images and videos through the API, leaving documents and skipped fields alone', () => {
    const record = { id: RECORD, fields: { 'Hero Image': [hero()], 'Video Walkthrough': [video], 'Customer Documentation': [{ ...hero(), id: 'attDOCIMAGEAAAAAA' }], Tickets: [pdf] } };
    const linked = withMediaLinks(BASE, 'Bookings', record as never, ['Customer Documentation']);
    const heroOut = (linked.fields['Hero Image'] as Array<ReturnType<typeof hero>>)[0]!;
    expect(heroOut.url.startsWith(MEDIA_MARKER)).toBe(true);
    expect(heroOut.thumbnails.large.url.startsWith(MEDIA_MARKER)).toBe(true);
    expect(heroOut.width).toBe(3000);
    expect((linked.fields['Video Walkthrough'] as Array<{ url: string }>)[0]!.url.startsWith(MEDIA_MARKER)).toBe(true);
    expect(linked.fields['Customer Documentation']).toEqual(record.fields['Customer Documentation']);
    expect(linked.fields.Tickets).toEqual([pdf]);
    expect(JSON.stringify(linked.fields['Hero Image'])).not.toContain('airtableusercontent');
    // A rotated Airtable signature gives the same link.
    const rotated = withMediaLinks(BASE, 'Bookings', { id: RECORD, fields: { 'Hero Image': [hero('https://v5.airtableusercontent.com/hero.jpg?sig=2')] } } as never);
    expect((rotated.fields['Hero Image'] as Array<{ url: string }>)[0]!.url).toBe(heroOut.url);
  });

  it('resolves markers to absolute media URLs anywhere in a response', () => {
    expect(resolveMediaMarkers({ snapshot: { summary: { heroImageUrl: `${MEDIA_MARKER}abc` }, gallery: [{ url: `${MEDIA_MARKER}def` }], name: 'vt-media is just text' } }, 'https://api.example/v1'))
      .toEqual({ snapshot: { summary: { heroImageUrl: 'https://api.example/v1/media/attachment/abc' }, gallery: [{ url: 'https://api.example/v1/media/attachment/def' }], name: 'vt-media is just text' } });
  });
});

describe('GET /media/attachment/:token', () => {
  beforeEach(() => { process.env.VISION_LINK_SECRET = 'media-secret'; });
  const token = (v: 'o' | 'l' = 'o', field = 'Hero Image', attachment = 'attHEROAAAAAAAAAA', record = RECORD) => attachmentToken({ b: BASE, t: 'Bookings', r: record, f: field, a: attachment, v });
  const response = () => { const headers: Record<string, string> = {}; const sent = { code: 200 }; return { headers, sent, setHeader: (name: string, value: string) => { headers[name] = value; }, status: (code: number) => { sent.code = code; } }; };
  const image = (url: string, init: ResponseInit = {}) => Object.assign(new Response('img', { status: 200, headers: { 'content-type': 'image/jpeg' }, ...init }), {});

  it('reads the record and streams the current Airtable URL, re-reading once when it has expired', async () => {
    const airtable = { record: vi.fn()
      .mockResolvedValueOnce({ id: 'recFRESHAAAAAAAAA', fields: { 'Hero Image': [hero('https://v5.airtableusercontent.com/hero.jpg?sig=old')] } })
      .mockResolvedValueOnce({ id: 'recFRESHAAAAAAAAA', fields: { 'Hero Image': [hero('https://v5.airtableusercontent.com/hero.jpg?sig=new')] } }) };
    const controller = new MediaController(airtable as never);
    const fetched: string[] = [];
    controller.fetchImpl = vi.fn(async (url: string) => { fetched.push(url); return url.endsWith('old') ? new Response('gone', { status: 403 }) : image(url); }) as never;
    const res = response();
    await controller.attachment(token('o', 'Hero Image', 'attHEROAAAAAAAAAA', 'recFRESHAAAAAAAAA'), undefined, res as never);
    expect(fetched).toEqual(['https://v5.airtableusercontent.com/hero.jpg?sig=old', 'https://v5.airtableusercontent.com/hero.jpg?sig=new']);
    expect(airtable.record).toHaveBeenCalledWith(BASE, 'Bookings', 'recFRESHAAAAAAAAA');
    expect(res.headers['Cache-Control']).toContain('immutable');
  });

  it('refuses forged tokens, removed attachments and anything that is not Airtable media', async () => {
    const airtable = { record: vi.fn().mockResolvedValue({ id: 'recGONEAAAAAAAAAA', fields: { 'Hero Image': [], Tickets: [pdf] } }) };
    const controller = new MediaController(airtable as never);
    controller.fetchImpl = vi.fn() as never;
    await expect(controller.attachment('not-a-token', undefined, response() as never)).rejects.toMatchObject({ status: 404 });
    await expect(controller.attachment(token('o', 'Hero Image', 'attHEROAAAAAAAAAA', 'recGONEAAAAAAAAAA'), undefined, response() as never)).rejects.toMatchObject({ status: 502 });
    await expect(controller.attachment(token('o', 'Tickets', 'attPDFAAAAAAAAAAA', 'recGONEAAAAAAAAAA'), undefined, response() as never)).rejects.toMatchObject({ status: 502 });
    expect(controller.fetchImpl).not.toHaveBeenCalled();
  });

  it('never fetches outside Airtable content hosts', async () => {
    const airtable = { record: vi.fn().mockResolvedValue({ id: 'recEVILAAAAAAAAAA', fields: { 'Hero Image': [hero('https://evil.example/hero.jpg')] } }) };
    const controller = new MediaController(airtable as never);
    controller.fetchImpl = vi.fn() as never;
    await expect(controller.attachment(token('o', 'Hero Image', 'attHEROAAAAAAAAAA', 'recEVILAAAAAAAAAA'), undefined, response() as never)).rejects.toMatchObject({ status: 502 });
    expect(controller.fetchImpl).not.toHaveBeenCalled();
  });

  it('passes Range through for video so it can be streamed', async () => {
    const airtable = { record: vi.fn().mockResolvedValue({ id: 'recVIDEOAAAAAAAAA', fields: { 'Video Walkthrough': [video] } }) };
    const controller = new MediaController(airtable as never);
    let sentRange: string | undefined;
    controller.fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => { sentRange = (init?.headers as Record<string, string> | undefined)?.['Range']; return new Response('part', { status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/100' } }); }) as never;
    const res = response();
    await controller.attachment(token('o', 'Video Walkthrough', 'attVIDEOAAAAAAAAA', 'recVIDEOAAAAAAAAA'), 'bytes=0-3', res as never);
    expect(sentRange).toBe('bytes=0-3');
    expect(res.sent.code).toBe(206);
    expect(res.headers['Content-Range']).toBe('bytes 0-3/100');
  });
});
