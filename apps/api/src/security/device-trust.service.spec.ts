import { afterEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { DeviceTrustService } from './device-trust.service.js';

describe('DeviceTrustService', () => {
  const originalSecret = process.env.VISION_LINK_SECRET;

  afterEach(() => {
    process.env.VISION_LINK_SECRET = originalSecret;
  });

  it('accepts a signed token only for its booking and customer', () => {
    process.env.VISION_LINK_SECRET = 'test-secret';
    const service = new DeviceTrustService();
    const token = service.issue('app123', 'rec123', 'recCUSTOMER');

    expect(service.validFor(token, 'app123', 'rec123', 'recCUSTOMER')).toBe(true);
    expect(service.validFor(token, 'app123', 'rec999', 'recCUSTOMER')).toBe(false);
    expect(service.validFor(token, 'app123', 'rec123', 'recOTHER')).toBe(false);
    expect(service.validFor(token, 'app123', 'rec123', null)).toBe(false);
    expect(service.validFor(`${token}x`, 'app123', 'rec123', 'recCUSTOMER')).toBe(false);
  });

  it('rejects expired tokens', () => {
    process.env.VISION_LINK_SECRET = 'test-secret';
    const service = new DeviceTrustService();
    const token = service.issue('app123', 'rec123', 'recCUSTOMER', Date.now() - 31 * 86_400_000);
    expect(service.validFor(token, 'app123', 'rec123', 'recCUSTOMER')).toBe(false);
  });

  it('no longer honours version 1 (booking-only) tokens', () => {
    process.env.VISION_LINK_SECRET = 'test-secret';
    const payload = Buffer.from(JSON.stringify({ b: 'app123', r: 'rec123', e: Date.now() + 60_000 })).toString('base64url');
    const legacy = `${payload}.${createHmac('sha256', 'test-secret').update(`device:${payload}`).digest('base64url')}`;
    expect(new DeviceTrustService().validFor(legacy, 'app123', 'rec123', 'recCUSTOMER')).toBe(false);
  });
});
