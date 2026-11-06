import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ParsedTripToken {
  baseId: string;
  recordId: string;
  scope: 'customer' | 'agent';
  expiresAt: number;
  legacy: boolean;
  fellowTraveller: boolean;
}

interface TokenPayload {
  v?: number;
  b?: string;
  r?: string;
  s?: string;
  e?: number;
  l?: number;
  t?: number;
}

@Injectable()
export class LinkTokenService {
  mintFellowTravellerLink(baseId: string, recordId: string, expiresAt: number): string {
    const secret = process.env.VISION_LINK_SECRET;
    if (!secret) throw new Error('VISION_LINK_SECRET is not configured.');
    const payload = Buffer.from(JSON.stringify({ v: 1, b: baseId, r: recordId, s: 'c', e: expiresAt, t: 1 })).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    const baseUrl = (process.env.VISION_TRIP_LINK_BASE_URL?.trim() || 'http://localhost:4200/trip').replace(/\/$/, '');
    return `${baseUrl}/${payload}.${signature}`;
  }

  parseLinkOrToken(input: string): ParsedTripToken {
    const token = this.extractToken(input);
    const parts = token.split('.');
    if (parts.length !== 2) throw new UnauthorizedException('The itinerary link is not valid.');

    const [payload, suppliedSignature] = parts;
    const secrets = [process.env.VISION_LINK_SECRET, process.env.VISION_LINK_SECRET_PREVIOUS].filter(
      (value): value is string => Boolean(value),
    );
    if (secrets.length === 0) throw new Error('VISION_LINK_SECRET is not configured.');

    const signatureValid = secrets.some((secret) => {
      const expected = createHmac('sha256', secret).update(payload).digest('base64url');
      const supplied = Buffer.from(suppliedSignature);
      const wanted = Buffer.from(expected);
      return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
    });
    if (!signatureValid) throw new UnauthorizedException('The itinerary link is not valid.');

    let decoded: TokenPayload;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      throw new UnauthorizedException('The itinerary link is not valid.');
    }

    if (!/^app[A-Za-z0-9]{14}$/.test(decoded.b ?? '') || !/^rec[A-Za-z0-9]{14}$/.test(decoded.r ?? '')) {
      throw new UnauthorizedException('The itinerary link is not valid.');
    }
    const expiresAt = Number(decoded.e ?? 0);
    if (expiresAt > 0 && expiresAt < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('The itinerary link has expired.');
    }

    return {
      baseId: decoded.b!,
      recordId: decoded.r!,
      scope: decoded.s === 'a' ? 'agent' : 'customer',
      expiresAt,
      legacy: Boolean(decoded.l),
      fellowTraveller: Boolean(decoded.t),
    };
  }

  private extractToken(input: string): string {
    const trimmed = input.trim();
    if (trimmed.length > 4096) throw new UnauthorizedException('The itinerary link is not valid.');
    if (!trimmed.includes('://')) return trimmed.replace(/^trip\//, '').split('/')[0];

    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split('/').filter(Boolean);
      const tripIndex = parts.lastIndexOf('trip');
      return tripIndex >= 0 ? (parts[tripIndex + 1] ?? '') : '';
    } catch {
      throw new UnauthorizedException('The itinerary link is not valid.');
    }
  }
}
