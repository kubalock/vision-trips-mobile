import { afterEach, describe, expect, it } from 'vitest';
import { DeviceTrustService } from './device-trust.service.js';

describe('DeviceTrustService', () => {
  const originalSecret = process.env.VISION_LINK_SECRET;

  afterEach(() => {
    process.env.VISION_LINK_SECRET = originalSecret;
  });

  it('accepts a signed token only for its booking', () => {
    process.env.VISION_LINK_SECRET = 'test-secret';
    const service = new DeviceTrustService();
    const token = service.issue('app123', 'rec123');

    expect(service.valid(token, 'app123', 'rec123')).toBe(true);
    expect(service.valid(token, 'app123', 'rec999')).toBe(false);
    expect(service.valid(`${token}x`, 'app123', 'rec123')).toBe(false);
  });
});
