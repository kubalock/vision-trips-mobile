import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { createHmac } from 'node:crypto';
import { fetchUrl } from './fetch-url.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.VISION_LINK_SECRET = 'e2e-secret';
    process.env.AUTH_DATABASE_PATH = ':memory:';
    process.env.AIRTABLE_TOKEN = 'airtable-test-token';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
  });

  it('/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/v1/health')
      .expect(200)
      .expect({ status: 'ok', service: 'vision-trips-api' });
  });

  it('/v1/link-exchanges (POST) sends a signed customer link into email verification without a session', async () => {
    const booking = { id: 'recABCDEFGHIJKLMN', fields: { 'Customers | Email': 'alex@example.com', Customers: ['recCUSTOMERAAAAAA'], 'Brands & Branches': ['recBRANDABCDEFGHI'] } };
    const customer = { id: 'recCUSTOMERAAAAAA', fields: { 'Primary Email': 'alex@example.com', 'First Name': 'Alex' } };
    const brand = { id: 'recBRANDABCDEFGHI', fields: { 'Trading Name': 'Example Travel' } };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => airtableResponse(fetchUrl(input), { booking, customer, brand }));
    const token = mint({ v: 1, b: 'appABCDEFGHIJKLMN', r: 'recABCDEFGHIJKLMN', s: 'c', e: 0 });

    const response = await request(app.getHttpServer())
      .post('/v1/link-exchanges')
      .send({ linkOrCode: `https://trips.example/trip/${token}/` })
      .expect(201);

    expect(response.body).toEqual({ status: 'invitation_required', invitationToken: expect.stringMatching(/^vt_[A-Za-z0-9_-]{32}$/) });
    expect(JSON.stringify(response.body)).not.toMatch(/session|snapshot|recABCDEFGHIJKLMN/);

    const welcome = await request(app.getHttpServer())
      .post('/v1/link-exchanges/invitations/resolve')
      .send({ token: response.body.invitationToken })
      .expect(200);
    expect(welcome.body).toMatchObject({ status: 'pending', verification: 'email_otp', destinationHint: 'al**@example.com', brand: { name: 'Example Travel' } });
    expect(JSON.stringify(welcome.body)).not.toMatch(/rec[A-Z]{3}|app[A-Z]{3}|alex@/);
  });

  it('completes the invitation flow end to end: create, open, send code, verify', async () => {
    process.env.VISION_AUTOMATION_KEY = 'automation-e2e';
    process.env.VISION_TRIP_LINK_BASE_URL = 'https://trips.example/trip';
    const booking = { id: 'recABCDEFGHIJKLMN', fields: { 'Trip Name': 'Mediterranean Escape', Customers: ['recCUSTOMERAAAAAA'], 'Brands & Branches': ['recBRANDABCDEFGHI'] } };
    const customer = { id: 'recCUSTOMERAAAAAA', fields: { 'Primary Email': 'alex@example.com' } };
    const brand = { id: 'recBRANDABCDEFGHI', fields: { 'Trading Name': 'Example Travel' } };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => airtableResponse(fetchUrl(input), { booking, customer, brand }));
    const logged: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((line: string) => { logged.push(line); });

    await request(app.getHttpServer()).post('/v1/customer-invitations').send({ baseId: 'appABCDEFGHIJKLMN', bookingRecordId: 'recABCDEFGHIJKLMN', customerRecordId: 'recCUSTOMERAAAAAA' }).expect(403);
    const created = await request(app.getHttpServer())
      .post('/v1/customer-invitations')
      .set('X-Vision-Key', 'automation-e2e')
      .set('Idempotency-Key', 'header-is-ignored-1')
      .send({ baseId: 'appABCDEFGHIJKLMN', bookingRecordId: 'recABCDEFGHIJKLMN', customerRecordId: 'recCUSTOMERAAAAAA', idempotencyKey: 'airtable:e2e:1' })
      .expect(200);
    expect(created.body).toMatchObject({ status: 'sent', emailSent: true, url: expect.stringMatching(/^https:\/\/trips\.example\/trip\/vt_/) });
    const token = String(created.body.url).split('/').pop();

    await request(app.getHttpServer()).post('/v1/link-exchanges/invitations/code').send({ token }).expect(200);
    const code = logged.join('\n').match(/(\d{6}) is your/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    await request(app.getHttpServer()).post('/v1/link-exchanges/invitations/verify').send({ token, code: '000000' === code ? '111111' : '000000' }).expect(401);
    const verified = await request(app.getHttpServer()).post('/v1/link-exchanges/invitations/verify').send({ token, code: ` ${code!.slice(0, 3)}-${code!.slice(3)} ` }).expect(200);
    expect(verified.body).toMatchObject({ status: 'authorized', session: { accessToken: expect.any(String) }, snapshot: { summary: { name: 'Mediterranean Escape' } } });
    await request(app.getHttpServer()).post('/v1/link-exchanges/invitations/verify').send({ token, code }).expect(410);
    delete process.env.VISION_AUTOMATION_KEY; delete process.env.VISION_TRIP_LINK_BASE_URL;
  });

  it('/v1/link-exchanges/invitations/* rejects malformed tokens with a customer-safe code', async () => {
    const response = await request(app.getHttpServer()).post('/v1/link-exchanges/invitations/resolve').send({ token: 'appABCDEFGHIJKLMN' }).expect(400);
    expect(response.body).toMatchObject({ code: 'invitation_invalid' });
  });

  it('/v1/link-exchanges/local (raw Airtable IDs) no longer exists', async () => {
    await request(app.getHttpServer())
      .post('/v1/link-exchanges/local')
      .send({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN' })
      .expect(404);
  });

  it('/v1/link-exchanges/dev-invitation reports configuration in development', async () => {
    const response = await request(app.getHttpServer()).get('/v1/link-exchanges/dev-invitation').expect(200);
    expect(response.body).toEqual({ available: false, message: expect.stringContaining('VISION_DEV_BASE_ID') });
  });

  it('/v1/link-exchanges/dev-invitation is unavailable in production, even when configured', async () => {
    const previous = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production', VISION_DEV_BASE_ID: 'appABCDEFGHIJKLMN', VISION_DEV_BOOKING_RECORD_ID: 'recABCDEFGHIJKLMN', VISION_DEV_CUSTOMER_RECORD_ID: 'recCUSTOMERAAAAAA' });
    try {
      await request(app.getHttpServer()).get('/v1/link-exchanges/dev-invitation').expect(404);
      await request(app.getHttpServer()).post('/v1/link-exchanges/dev-invitation').expect(404);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
      delete process.env.VISION_DEV_BASE_ID; delete process.env.VISION_DEV_BOOKING_RECORD_ID; delete process.env.VISION_DEV_CUSTOMER_RECORD_ID;
    }
  });

  it('/v1/trips/current/calendar.ics requires an access session', async () => {
    await request(app.getHttpServer())
      .get('/v1/trips/current/calendar.ics')
      .expect(401);
  });

  it('/v1/trips/current/documents/confirmation.html requires an access session', async () => {
    await request(app.getHttpServer())
      .get('/v1/trips/current/documents/confirmation.html')
      .expect(401);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });
});

function mint(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', 'e2e-secret').update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

/** A tiny Airtable stand-in: single records by id, and RECORD_ID() list filters. */
function airtableResponse(url: string, records: Record<string, { id: string; fields: Record<string, unknown> }>): Response {
  const all = Object.values(records);
  const parsed = new URL(url);
  if (parsed.pathname.endsWith('/comments')) return new Response(JSON.stringify({ id: 'com1' }), { status: 200 });
  const id = parsed.pathname.split('/').pop() ?? '';
  const single = all.find((record) => record.id === id);
  if (single) return new Response(JSON.stringify(single), { status: 200 });
  const ids = [...decodeURIComponent(parsed.searchParams.get('filterByFormula') ?? '').matchAll(/RECORD_ID\(\)='(rec[A-Za-z0-9]{14})'/g)].map((match) => match[1]);
  return new Response(JSON.stringify({ records: all.filter((record) => ids.includes(record.id)) }), { status: 200 });
}
