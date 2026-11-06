import { BadRequestException, Injectable } from '@nestjs/common';
import type { LinkExchangeResponse } from '@vision-trips/contracts';
import { randomUUID } from 'node:crypto';
import { LinkTokenService } from '../security/link-token.service.js';
import { TripsService } from '../trips/trips.service.js';

@Injectable()
export class LinkExchangesService {
  constructor(
    private readonly tokens: LinkTokenService,
    private readonly trips: TripsService,
  ) {}

  async create(linkOrCode: unknown): Promise<LinkExchangeResponse> {
    if (typeof linkOrCode !== 'string' || linkOrCode.trim().length < 16) {
      throw new BadRequestException('Enter a valid itinerary link.');
    }
    const token = this.tokens.parseLinkOrToken(linkOrCode);
    if (token.scope === 'agent') throw new BadRequestException('Agent links cannot be saved in the customer app.');

    const exchangeId = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    if (token.legacy) {
      return {
        status: 'verification_required',
        challenge: {
          exchangeId,
          brandName: 'Vision Trips',
          tripHint: 'Verify your identity to open this trip',
          methods: ['otp'],
          expiresAt,
        },
      };
    }

    const snapshot = await this.trips.snapshot(
      token.baseId,
      token.recordId,
      token.fellowTraveller ? 'fellow_traveller' : 'primary_customer',
    );
    return { status: 'authorized', exchangeId, expiresAt, snapshot };
  }
}
