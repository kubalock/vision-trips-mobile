import { describe, expect, it, vi } from 'vitest';
import type { TripSnapshot } from '@vision-trips/contracts';
import { DeviceTrustService } from '../security/device-trust.service.js';
import type { LinkTokenService } from '../security/link-token.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { TripsService } from '../trips/trips.service.js';
import type { OtpDeliveryService } from './otp-delivery.service.js';
import { LinkExchangesService } from './link-exchanges.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';

describe('LinkExchangesService OTP', () => {
  it('sends a forced OTP, limits attempts, and can remember the device', async () => {
    let code = '';
    const service = new LinkExchangesService(
      { parseLinkOrToken: () => ({ scope: 'customer', baseId: 'app1', recordId: 'rec1', fellowTraveller: false, legacy: true }) } as unknown as LinkTokenService,
      { verificationProfile: vi.fn().mockResolvedValue({ postcode: 'SW1A 1AA', email: 'alex@example.com', forceOtp: true }), snapshot: vi.fn().mockResolvedValue({ tripId: 'trip1' } as TripSnapshot) } as unknown as TripsService,
      { issue: vi.fn().mockReturnValue({ accessToken: 'a', accessExpiresAt: 'x', refreshToken: 'r', refreshExpiresAt: 'x' }) } as unknown as SessionsService,
      new DeviceTrustService(),
      { send: vi.fn(async (_email: string, sentCode: string) => { code = sentCode; }) } as unknown as OtpDeliveryService,
      new DurableAuthStore(':memory:'),
    );

    const created = await service.create('a-valid-link-token');
    expect(created.status).toBe('verification_required');
    if (created.status !== 'verification_required') return;
    expect(created.challenge.methods).toEqual(['otp']);
    await expect(service.verifyPostcode(created.challenge.exchangeId, 'SW1A 1AA')).rejects.toMatchObject({ status: 400 });
    for (let attempt = 0; attempt < 5; attempt += 1) await expect(service.verifyOtp(created.challenge.exchangeId, 'invalid', true)).rejects.toMatchObject({ status: 401 });
    await expect(service.verifyOtp(created.challenge.exchangeId, 'invalid', true)).rejects.toMatchObject({ status: 429 });

    const retry = await service.create('a-valid-link-token');
    if (retry.status !== 'verification_required') return;
    const authorized = await service.verifyOtp(retry.challenge.exchangeId, code, true);
    expect(authorized.status).toBe('authorized');
    if (authorized.status === 'authorized') expect(authorized.trustedDeviceToken).toBeTruthy();
  });

  it('skips verification when any remembered booking token matches the link', async () => {
    const trust = new DeviceTrustService();
    const verificationProfile = vi.fn();
    const service = new LinkExchangesService(
      { parseLinkOrToken: () => ({ scope: 'customer', baseId: 'app1', recordId: 'rec1', fellowTraveller: false, legacy: true }) } as unknown as LinkTokenService,
      { verificationProfile, snapshot: vi.fn().mockResolvedValue({ tripId: 'trip1' } as TripSnapshot) } as unknown as TripsService,
      { issue: vi.fn().mockReturnValue({ accessToken: 'a', accessExpiresAt: 'x', refreshToken: 'r', refreshExpiresAt: 'x' }) } as unknown as SessionsService,
      trust,
      { send: vi.fn() } as unknown as OtpDeliveryService,
      new DurableAuthStore(':memory:'),
    );

    const result = await service.create('a-valid-link-token', [trust.issue('app1', 'recOTHER'), 'not-a-token', trust.issue('app1', 'rec1')]);

    expect(result.status).toBe('authorized');
    expect(verificationProfile).not.toHaveBeenCalled();
  });

  it('enforces the resend cooldown', async () => {
    const service = new LinkExchangesService(
      { parseLinkOrToken: () => ({ scope: 'customer', baseId: 'app1', recordId: 'rec1', fellowTraveller: false, legacy: true }) } as unknown as LinkTokenService,
      { verificationProfile: vi.fn().mockResolvedValue({ postcode: '', email: 'alex@example.com', forceOtp: true }) } as unknown as TripsService,
      {} as SessionsService,
      new DeviceTrustService(),
      { send: vi.fn() } as unknown as OtpDeliveryService,
      new DurableAuthStore(':memory:'),
    );
    const created = await service.create('a-valid-link-token');
    if (created.status !== 'verification_required') return;
    await expect(service.sendOtp(created.challenge.exchangeId)).rejects.toMatchObject({ status: 429 });
  });

  it('limits wrong postcodes per attempt and per booking, even across new verifications', async () => {
    const trips = { verificationProfile: vi.fn().mockResolvedValue({ postcode: 'SW1A 1AA', email: 'alex@example.com', forceOtp: false }), snapshot: vi.fn().mockResolvedValue({ tripId: 'trip1' } as TripSnapshot) } as unknown as TripsService;
    const service = new LinkExchangesService(
      { parseLinkOrToken: () => ({ scope: 'customer', baseId: 'app1', recordId: 'rec1', fellowTraveller: false, legacy: true }) } as unknown as LinkTokenService,
      trips,
      { issue: vi.fn().mockReturnValue({ accessToken: 'a', accessExpiresAt: 'x', refreshToken: 'r', refreshExpiresAt: 'x' }) } as unknown as SessionsService,
      new DeviceTrustService(),
      { send: vi.fn() } as unknown as OtpDeliveryService,
      new DurableAuthStore(':memory:'),
    );
    const start = async () => { const created = await service.create('a-valid-link-token'); if (created.status !== 'verification_required') throw new Error('expected challenge'); return created.challenge.exchangeId; };

    const first = await start();
    for (let attempt = 0; attempt < 5; attempt += 1) await expect(service.verifyPostcode(first, 'WRONG 1')).rejects.toMatchObject({ status: 401 });
    await expect(service.verifyPostcode(first, 'SW1A 1AA')).rejects.toMatchObject({ status: 429 });

    const second = await start();
    for (let attempt = 0; attempt < 5; attempt += 1) await expect(service.verifyPostcode(second, 'WRONG 2')).rejects.toMatchObject({ status: 401 });
    const third = await start();
    await expect(service.verifyPostcode(third, 'SW1A 1AA')).rejects.toMatchObject({ status: 429 });
  });
});
