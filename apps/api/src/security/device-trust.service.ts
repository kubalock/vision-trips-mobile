import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

interface TrustPayload { b: string; r: string; e: number }

@Injectable()
export class DeviceTrustService {
  issue(baseId: string, recordId: string): string {
    const payload = Buffer.from(JSON.stringify({ b: baseId, r: recordId, e: Date.now() + 30 * 24 * 60 * 60_000 } satisfies TrustPayload)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  valid(token: unknown, baseId: string, recordId: string): boolean {
    if (typeof token !== 'string') return false;
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return false;
    const expected = this.sign(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TrustPayload;
      return value.b === baseId && value.r === recordId && value.e > Date.now();
    } catch { return false; }
  }

  private sign(payload: string): string {
    return createHmac('sha256', process.env.VISION_LINK_SECRET || 'local-development-only').update(`device:${payload}`).digest('base64url');
  }
}
