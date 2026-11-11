import { Body, Controller, Delete, HttpCode, type INestApplication, Post, UnauthorizedException } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSessionCookiesInterceptor } from './web-session-cookies.interceptor.js';

const session = (refreshToken: string) => ({ accessToken: 'vta_access', accessExpiresAt: '2030-01-01T00:00:00.000Z', refreshToken, refreshExpiresAt: '2030-01-30T00:00:00.000Z' });
const trust = `${Buffer.from(JSON.stringify({ b: 'app1', r: 'recA', e: Date.parse('2030-01-30T00:00:00Z') })).toString('base64url')}.signature`;
const seen: Array<Record<string, unknown>> = [];

@Controller('link-exchanges')
class FakeExchanges {
  @Post() create(@Body() body: Record<string, unknown>) { seen.push(body); return { status: 'authorized', snapshot: { tripId: 'trp' }, session: session('vrt_first'), trustedDeviceToken: trust }; }
  @Delete('device-trust') @HttpCode(204) forget(): void {}
}

@Controller('sessions')
class FakeSessions {
  @Post('refresh') refresh(@Body() body: { refreshToken?: unknown }) {
    seen.push(body);
    if (body.refreshToken !== 'vrt_first') throw new UnauthorizedException('The session has expired.');
    return session('vrt_second');
  }
  @Delete('current') @HttpCode(204) revoke(@Body() body: Record<string, unknown>): void { seen.push(body); }
}

describe('web session cookies', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [FakeExchanges, FakeSessions], providers: [{ provide: APP_INTERCEPTOR, useClass: WebSessionCookiesInterceptor }] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    await app.init();
  });
  afterAll(() => app.close());

  it('leaves the installed app untouched', async () => {
    const response = await request(app.getHttpServer()).post('/v1/link-exchanges').send({ linkOrCode: 'x', deviceTrustTokens: [] });
    expect(response.body.session.refreshToken).toBe('vrt_first');
    expect(response.body.trustedDeviceToken).toBe(trust);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('keeps refresh and trust tokens in HttpOnly cookies for browsers', async () => {
    const agent = request(app.getHttpServer());
    const exchange = await agent.post('/v1/link-exchanges').set('X-Vision-Client', 'web').send({ linkOrCode: 'x', deviceTrustTokens: [] });
    const handle = exchange.body.session.refreshToken as string;
    const cookies = exchange.headers['set-cookie'] as unknown as string[];

    expect(handle).toMatch(/^web:[A-Za-z0-9_-]{16,}$/);
    expect(exchange.body.trustedDeviceToken).toBeUndefined();
    expect(JSON.stringify(exchange.body)).not.toContain('vrt_first');
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) expect(cookie).toMatch(/HttpOnly/);
    for (const cookie of cookies) expect(cookie).toMatch(/SameSite=Strict/);
    const sessionCookie = cookies.find((cookie) => cookie.startsWith('vt_rt_'))!;
    const trustCookie = cookies.find((cookie) => cookie.startsWith('vt_dt_'))!;
    expect(sessionCookie).toContain('Path=/v1/sessions');
    expect(trustCookie).toContain('Path=/v1/link-exchanges');

    // The trust cookie is added to the next exchange.
    seen.length = 0;
    await agent.post('/v1/link-exchanges').set('X-Vision-Client', 'web').set('Cookie', trustCookie.split(';')[0]).send({ linkOrCode: 'x', deviceTrustTokens: [] });
    expect(seen[0].deviceTrustTokens).toEqual([trust]);

    // The handle is swapped for the cookie's token, and the renewed token replaces the cookie under the same handle.
    seen.length = 0;
    const refreshed = await agent.post('/v1/sessions/refresh').set('X-Vision-Client', 'web').set('Cookie', sessionCookie.split(';')[0]).send({ refreshToken: handle });
    expect(seen[0].refreshToken).toBe('vrt_first');
    expect(refreshed.body.refreshToken).toBe(handle);
    expect((refreshed.headers['set-cookie'] as unknown as string[])[0]).toContain('vrt_second');

    // Revoking clears the cookie.
    const revoked = await agent.delete('/v1/sessions/current').set('X-Vision-Client', 'web').set('Cookie', sessionCookie.split(';')[0]).send({ refreshToken: handle });
    expect(revoked.status).toBe(204);
    expect((revoked.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^vt_rt_[^=]+=;.*Expires=Thu, 01 Jan 1970/);
  });

  it('refuses a handle without its cookie', async () => {
    seen.length = 0;
    const missing = await request(app.getHttpServer()).post('/v1/sessions/refresh').set('X-Vision-Client', 'web').send({ refreshToken: 'web:AAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(missing.status).toBe(401);
    expect(seen[0].refreshToken).toBeUndefined();
  });

  it('leaves the cookie alone when a refresh is refused, so a tab that lost a race cannot wipe the renewed cookie', async () => {
    const refused = await request(app.getHttpServer()).post('/v1/sessions/refresh').set('X-Vision-Client', 'web').set('Cookie', 'vt_rt_AAAAAAAAAAAAAAAAAAAAAAAA=vrt_stale').send({ refreshToken: 'web:AAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(refused.status).toBe(401);
    expect(refused.headers['set-cookie']).toBeUndefined();
  });

  it('forgets every trusted-device cookie on request', async () => {
    const response = await request(app.getHttpServer()).delete('/v1/link-exchanges/device-trust').set('X-Vision-Client', 'web').set('Cookie', 'vt_dt_one=a; vt_dt_two=b; other=c');
    const cleared = (response.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split('=')[0]);
    expect(cleared).toEqual(['vt_dt_one', 'vt_dt_two']);
  });
});
