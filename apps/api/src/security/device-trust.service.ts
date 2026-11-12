import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Trusted-device tokens: issued after a customer verifies an email code with "trust this device", and only valid for
 * that booking *and* that customer. Version 1 tokens (booking only, which postcode checks could also earn) are no
 * longer honoured, so every device verifies by email once.
 */
interface TrustPayload { v: 2; b: string; r: string; c: string; e: number }

export const DEVICE_TRUST_DAYS = 30;

@Injectable()
export class DeviceTrustService {
  issue(baseId: string, recordId: string, customerRecordId: string, now = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ v: 2, b: baseId, r: recordId, c: customerRecordId, e: now + DEVICE_TRUST_DAYS * 86_400_000 } satisfies TrustPayload)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  validFor(token: unknown, baseId: string, recordId: string, customerRecordId: string | null): boolean {
    if (typeof token !== 'string' || !customerRecordId || token.length > 4096) return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = this.sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<TrustPayload>;
      return value.v === 2 && value.b === baseId && value.r === recordId && value.c === customerRecordId && typeof value.e === 'number' && value.e > Date.now();
    } catch { return false; }
  }

  private sign(payload: string): string {
    return createHmac('sha256', process.env.VISION_LINK_SECRET || 'local-development-only').update(`device:${payload}`).digest('base64url');
  }
}
