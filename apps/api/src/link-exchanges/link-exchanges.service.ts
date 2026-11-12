import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { LinkExchangeResponse } from '@vision-trips/contracts';
import { randomUUID } from 'node:crypto';
import { CustomerInvitationsService } from '../invitations/customer-invitations.service.js';
import { isInvitationToken } from '../invitations/invitation-token.js';
import { LinkTokenService } from '../security/link-token.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { TripsService } from '../trips/trips.service.js';

/**
 * Entry point for any link the app is given.
 *
 * - `vt_…` invitation links are passed straight to the invitation flow.
 * - Legacy signed customer links (`payload.signature`) still identify a booking, but no longer authorise anything on
 *   their own: they become a short-lived invitation for the booking's primary customer, who must verify by email.
 * - Legacy signed fellow-traveller links (minted before share links became invitations, valid for at most seven days)
 *   keep opening the restricted fellow-traveller view, with `link` assurance: no payments, acceptance or account.
 * - Agent-scope links are refused.
 */
@Injectable()
export class LinkExchangesService {
  private readonly logger = new Logger(LinkExchangesService.name);

  constructor(
    private readonly tokens: LinkTokenService,
    private readonly trips: TripsService,
    private readonly sessions: SessionsService,
    private readonly invitations: CustomerInvitationsService,
  ) {}

  async create(linkOrCode: unknown): Promise<LinkExchangeResponse> {
    if (typeof linkOrCode !== 'string' || linkOrCode.trim().length < 16) throw new BadRequestException('Enter a valid itinerary link.');
    const candidate = this.tokens.extractToken(linkOrCode);
    if (isInvitationToken(candidate)) return { status: 'invitation_required', invitationToken: candidate };
    const token = this.tokens.parseLinkOrToken(linkOrCode);
    if (token.scope === 'agent') throw new BadRequestException('Agent links cannot be saved in the customer app.');
    if (token.fellowTraveller) {
      const snapshot = await this.trips.snapshot(token.baseId, token.recordId, 'fellow_traveller');
      const session = this.sessions.issue({ baseId: token.baseId, recordId: token.recordId, fellowTraveller: true, customerRecordId: null, assurance: 'link' });
      this.logger.log(JSON.stringify({ event: 'legacy_share_link_opened', baseId: token.baseId, bookingRecordId: token.recordId }));
      return { status: 'authorized', exchangeId: randomUUID(), expiresAt: new Date(Date.now() + 600_000).toISOString(), snapshot, session };
    }
    const invitationToken = await this.invitations.fromLegacyLink(token.baseId, token.recordId);
    this.logger.log(JSON.stringify({ event: 'legacy_link_to_invitation', baseId: token.baseId, bookingRecordId: token.recordId, legacy: token.legacy }));
    return { status: 'invitation_required', invitationToken };
  }
}
