import { BadRequestException } from '@nestjs/common';
import type { TripSnapshot } from '@vision-trips/contracts';
import type { CustomerInvitationsService } from '../invitations/customer-invitations.service.js';
import type { LinkTokenService } from '../security/link-token.service.js';
import { LinkTokenService as RealLinkTokenService } from '../security/link-token.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { SessionsService } from '../sessions/sessions.service.js';
import type { TripsService } from '../trips/trips.service.js';
import { LinkExchangesService } from './link-exchanges.service.js';

const INVITATION = 'vt_abcdefghijklmnopqrstuvwxyzABCDEF';

function setup(parsed: Partial<ReturnType<LinkTokenService['parseLinkOrToken']>> = {}) {
  const sessions = new SessionsService(new DurableAuthStore(':memory:'));
  const tokens = {
    extractToken: (input: string) => new RealLinkTokenService().extractToken(input),
    parseLinkOrToken: vi.fn(() => ({ scope: 'customer', baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false, legacy: false, expiresAt: 0, ...parsed })),
  };
  const trips = { snapshot: vi.fn().mockResolvedValue({ tripId: 'trip1' } as TripSnapshot) };
  const invitations = { fromLegacyLink: vi.fn().mockResolvedValue(INVITATION) };
  const service = new LinkExchangesService(tokens as unknown as LinkTokenService, trips as unknown as TripsService, sessions, invitations as unknown as CustomerInvitationsService);
  return { service, sessions, trips, invitations, tokens };
}

describe('LinkExchangesService', () => {
  it('sends a signed customer link into email verification instead of authorising it', async () => {
    const { service, trips, invitations } = setup();
    const result = await service.create('https://trips.example/trip/payload.signature/');
    expect(result).toEqual({ status: 'invitation_required', invitationToken: INVITATION });
    expect(invitations.fromLegacyLink).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'recABCDEFGHIJKLMN');
    expect(trips.snapshot).not.toHaveBeenCalled();
  });

  it('does the same for links minted from old ?member=&booking= URLs', async () => {
    const { service, invitations } = setup({ legacy: true });
    await expect(service.create('payload.signature-for-a-legacy-link')).resolves.toMatchObject({ status: 'invitation_required' });
    expect(invitations.fromLegacyLink).toHaveBeenCalledOnce();
  });

  it('passes vt_ invitation links straight to the invitation flow', async () => {
    const { service, tokens, invitations } = setup();
    await expect(service.create(`https://trips.example/trip/${INVITATION}`)).resolves.toEqual({ status: 'invitation_required', invitationToken: INVITATION });
    expect(tokens.parseLinkOrToken).not.toHaveBeenCalled();
    expect(invitations.fromLegacyLink).not.toHaveBeenCalled();
  });

  it('keeps legacy fellow-traveller links restricted and unverified', async () => {
    const { service, sessions, trips } = setup({ fellowTraveller: true });
    const result = await service.create('payload.signature-for-a-share-link');
    expect(result.status).toBe('authorized');
    expect(trips.snapshot).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'recABCDEFGHIJKLMN', 'fellow_traveller');
    if (result.status !== 'authorized') return;
    expect(sessions.validateAccess(`Bearer ${result.session.accessToken}`)).toMatchObject({ fellowTraveller: true, assurance: 'link', customerRecordId: null });
  });

  it('refuses agent links and junk', async () => {
    await expect(setup({ scope: 'agent' }).service.create('payload.signature-for-an-agent')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup().service.create('short')).rejects.toBeInstanceOf(BadRequestException);
  });
});
