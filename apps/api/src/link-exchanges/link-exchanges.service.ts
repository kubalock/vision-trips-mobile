import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { LinkExchangeResponse } from '@vision-trips/contracts';
import { randomUUID } from 'node:crypto';
import { LinkTokenService } from '../security/link-token.service.js';
import { TripsService } from '../trips/trips.service.js';
import { SessionsService } from '../sessions/sessions.service.js';

@Injectable()
export class LinkExchangesService {
  private readonly pending = new Map<string, {
    baseId: string;
    recordId: string;
    fellowTraveller: boolean;
    postcode: string;
    expiresAt: number;
  }>();
  constructor(
    private readonly tokens: LinkTokenService,
    private readonly trips: TripsService,
    private readonly sessions: SessionsService,
  ) {}

  async create(linkOrCode: unknown): Promise<LinkExchangeResponse> {
    if (typeof linkOrCode !== 'string' || linkOrCode.trim().length < 16) {
      throw new BadRequestException('Enter a valid itinerary link.');
    }
    const token = this.tokens.parseLinkOrToken(linkOrCode);
    if (token.scope === 'agent') throw new BadRequestException('Agent links cannot be saved in the customer app.');

    const exchangeId = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const profile = await this.trips.verificationProfile(token.baseId, token.recordId);
    if (token.legacy || profile.forceOtp) {
      this.pending.set(exchangeId, {
        baseId: token.baseId,
        recordId: token.recordId,
        fellowTraveller: token.fellowTraveller,
        postcode: profile.postcode,
        expiresAt: Date.now() + 10 * 60_000,
      });
      const methods: Array<'postcode' | 'otp'> = [];
      if (profile.postcode && !profile.forceOtp) methods.push('postcode');
      if (profile.email) methods.push('otp');
      return {
        status: 'verification_required',
        challenge: {
          exchangeId,
          brandName: 'Vision Trips',
          tripHint: 'Verify your identity to open this trip',
          methods,
          expiresAt,
        },
      };
    }

    const snapshot = await this.trips.snapshot(
      token.baseId,
      token.recordId,
      token.fellowTraveller ? 'fellow_traveller' : 'primary_customer',
    );
    const session = this.sessions.issue({
      baseId: token.baseId,
      recordId: token.recordId,
      fellowTraveller: token.fellowTraveller,
    });
    return { status: 'authorized', exchangeId, expiresAt, snapshot, session };
  }

  async verifyPostcode(exchangeId: string, postcode: unknown): Promise<LinkExchangeResponse> {
    const pending = this.pending.get(exchangeId);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pending.delete(exchangeId);
      throw new NotFoundException('This verification request has expired.');
    }
    if (!pending.postcode || typeof postcode !== 'string' || normalizePostcode(postcode) !== normalizePostcode(pending.postcode)) {
      throw new UnauthorizedException('The postcode did not match the booking.');
    }
    this.pending.delete(exchangeId);
    const snapshot = await this.trips.snapshot(
      pending.baseId,
      pending.recordId,
      pending.fellowTraveller ? 'fellow_traveller' : 'primary_customer',
    );
    const session = this.sessions.issue(pending);
    return {
      status: 'authorized',
      exchangeId,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      snapshot,
      session,
    };
  }
}

function normalizePostcode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
