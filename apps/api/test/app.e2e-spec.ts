import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { createHmac } from 'node:crypto';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.VISION_LINK_SECRET = 'e2e-secret';
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

  it('/v1/link-exchanges (POST) returns a sanitized Airtable snapshot', async () => {
    const booking = {
      id: 'recABCDEFGHIJKLMN',
      createdTime: '2026-11-01T10:00:00.000Z',
      fields: {
        'Booking Reference': 'VT-1001',
        'Trip Name': 'Mediterranean Escape',
        Status: 'Confirmed',
        'Departure Date': '2027-03-01',
        'Brands & Branches': ['recBRANDABCDEFGHI'],
        'Internal Notes': 'private',
      },
    };
    const brand = { id: 'recBRANDABCDEFGHI', fields: { 'Trading Name': 'Example Travel' } };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(booking), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(booking), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(brand), { status: 200 }));
    const token = mint({ v: 1, b: 'appABCDEFGHIJKLMN', r: 'recABCDEFGHIJKLMN', s: 'c', e: 0 });

    const response = await request(app.getHttpServer())
      .post('/v1/link-exchanges')
      .send({ linkOrCode: `https://trips.example/trip/${token}/` })
      .expect(201);

    expect(response.body.status).toBe('authorized');
    expect(response.body.snapshot.summary.name).toBe('Mediterranean Escape');
    expect(JSON.stringify(response.body)).not.toContain('recABCDEFGHIJKLMN');
    expect(JSON.stringify(response.body)).not.toContain('Internal Notes');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockRestore();
  });

  it('/v1/link-exchanges/local rejects malformed Airtable ids', async () => {
    await request(app.getHttpServer())
      .post('/v1/link-exchanges/local')
      .send({ baseId: 'not-a-base', recordId: 'not-a-record' })
      .expect(400);
  });

  it('/v1/link-exchanges/local is unavailable in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await request(app.getHttpServer())
        .post('/v1/link-exchanges/local')
        .send({ baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN' })
        .expect(404);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  afterEach(async () => {
    await app.close();
  });
});

function mint(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', 'e2e-secret').update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
