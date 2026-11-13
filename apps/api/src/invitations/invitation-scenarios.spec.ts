import { HttpException } from '@nestjs/common';
import { createCustomerInvitationRequestSchema } from '@vision-trips/contracts';
import { DeviceTrustService } from '../security/device-trust.service.js';
import { identityKey } from '../security/identity-key.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { InvitationTargetError, type InvitationContext, type TripsService } from '../trips/trips.service.js';
import { CustomerInvitationsService } from './customer-invitations.service.js';
import type { InvitationEmailService } from './invitation-email.service.js';

/**
 * Scenario matrix for identity, invitation, multi-account and cross-branch behaviour. Two Airtable bases (branches)
 * deliberately reuse the same record IDs and email addresses, so every check proves scoping by base + Customer.
 */
const BASE_A = 'appBRANCHAAAAAAAA';
const BASE_B = 'appBRANCHBBBBBBBB';
const BOOKING_1 = 'recBOOKING1111111';
const BOOKING_2 = 'recBOOKING2222222';
const GRACE = 'recCUSTOMERGRACE1';
const ALAN = 'recCUSTOMERALAN01';

interface Person { email: string; bookings: string[] }
type Directory = Record<string, Record<string, Person>>;

function directory(): Directory {
  return {
    [BASE_A]: { [GRACE]: { email: 'grace@example.com', bookings: [BOOKING_1, BOOKING_2] }, [ALAN]: { email: 'alan@example.com', bookings: [BOOKING_1] } },
    [BASE_B]: { [GRACE]: { email: 'grace@example.com', bookings: [BOOKING_1] } },
  };
}

function setup(people = directory()) {
  const store = new DurableAuthStore(':memory:');
  const sessions = new SessionsService(store);
  const trust = new DeviceTrustService();
  /** Every code email, with who it went to — so a test can pick the code a specific invitation sent. */
  const codes: Array<{ to: string; code: string; brand: string }> = [];
  const links: Array<{ to: string; url: string }> = [];
  const email = {
    sendInvitation: vi.fn(async (context: InvitationContext, url: string) => { links.push({ to: context.customer!.email, url }); return 'email'; }),
    sendCode: vi.fn(async (context: InvitationContext, code: string) => { codes.push({ to: context.customer!.email, code, brand: context.brand.name }); return 'email'; }),
  };
  const trips = {
    invitationContext: vi.fn(async (base: string, booking: string, customer: string | null): Promise<InvitationContext> => {
      const person = customer ? people[base]?.[customer] : null;
      if (customer && (!person || !person.bookings.includes(booking))) throw new InvitationTargetError('customer_not_linked');
      return {
        tenantId: `brand-${base}`, tripName: `Trip ${booking}`, customer: person ? { email: person.email, firstName: null } : null,
        brand: { name: base === BASE_A ? 'Branch A Travel' : 'Branch B Travel', logoUrl: null, primaryColor: null, supportEmail: null, supportPhone: null },
      };
    }),
    primaryCustomerRecordId: vi.fn().mockResolvedValue(GRACE),
    snapshot: vi.fn(async (base: string, booking: string) => ({ tripId: `trp_${base}_${booking}` })),
  };
  const airtable = { addComment: vi.fn().mockResolvedValue(undefined) };
  const service = new CustomerInvitationsService(store, trips as unknown as TripsService, airtable as never, sessions, trust, email as unknown as InvitationEmailService);
  return { store, sessions, trust, email, trips, service, codes, links, people };
}

type Setup = ReturnType<typeof setup>;
const request = (overrides: Record<string, unknown> = {}) => createCustomerInvitationRequestSchema.parse({ baseId: BASE_A, bookingRecordId: BOOKING_1, customerRecordId: GRACE, ...overrides });
const tokenOf = (url: string | null) => url!.split('/').pop()!;
async function rejection(promise: Promise<unknown>): Promise<{ status: number; code: string; message: string }> {
  try { await promise; } catch (error) {
    if (error instanceof HttpException) { const body = error.getResponse() as { code: string; message: string }; return { status: error.getStatus(), code: body.code, message: body.message }; }
    throw error;
  }
  throw new Error('Expected the promise to reject.');
}
async function invite(context: Setup, overrides: Record<string, unknown> = {}, now = Date.now()): Promise<string> {
  return tokenOf((await context.service.create(request(overrides), now)).url);
}
async function verify(context: Setup, token: string, rememberDevice = false) {
  await context.service.sendCode(token);
  return context.service.verifyCode(token, context.codes.at(-1)!.code, rememberDevice);
}
const principalOf = (context: Setup, accessToken: string) => context.sessions.validateAccess(`Bearer ${accessToken}`);

describe('invitation scenario matrix', () => {
  beforeEach(() => {
    process.env.VISION_TRIP_LINK_BASE_URL = 'https://trips.example/trip';
    process.env.VISION_LINK_SECRET = 'scenario-test-secret';
  });
  afterEach(() => { vi.useRealTimers(); delete process.env.VISION_TRIP_LINK_BASE_URL; delete process.env.VISION_LINK_SECRET; });

  describe('1. two invitations for the same Booking and Customer', () => {
    it('concurrent automation calls with one idempotency key send one email', async () => {
      const context = setup();
      const [a, b] = await Promise.all([context.service.create(request({ idempotencyKey: 'airtable-run-1' })), context.service.create(request({ idempotencyKey: 'airtable-run-1' }))]);
      expect([a.status, b.status].sort()).toEqual(['duplicate', 'sent']);
      expect(context.email.sendInvitation).toHaveBeenCalledOnce();
    });

    it('concurrent calls with different keys inside the duplicate window send one email', async () => {
      const context = setup();
      const results = await Promise.all([context.service.create(request({ idempotencyKey: 'airtable-run-1' })), context.service.create(request({ idempotencyKey: 'airtable-run-2' }))]);
      expect(results.map((result) => result.status).sort()).toEqual(['duplicate', 'sent']);
      expect(context.email.sendInvitation).toHaveBeenCalledOnce();
    });

    it('the newest unused invitation replaces the older one, which then explains it was replaced', async () => {
      const context = setup();
      const now = Date.now();
      const first = await invite(context, {}, now);
      expect((await context.service.resolve(first, [])).status).toBe('pending'); // Opened before the second exists.
      const second = await invite(context, {}, now + 11 * 60_000);
      const old = await rejection(context.service.resolve(first, []));
      expect(old).toMatchObject({ status: 410, code: 'invitation_replaced' });
      expect(old.message).toMatch(/newer invitation/i);
      expect((await context.service.resolve(second, [])).status).toBe('pending');
    });

    it('an explicitly revoked invitation still says “cancelled”, not “replaced”', async () => {
      const context = setup();
      const token = await invite(context);
      await context.service.revoke(BASE_A, BOOKING_1, GRACE);
      expect(await rejection(context.service.resolve(token, []))).toMatchObject({ code: 'invitation_revoked' });
    });

    it('completing the first invitation before the second is sent keeps the session alive', async () => {
      const context = setup();
      const now = Date.now();
      const first = await invite(context, {}, now);
      const authorized = await verify(context, first);
      const second = await invite(context, {}, now + 60_000); // Inside the window, but the first was used: a fresh link.
      expect((await context.service.resolve(second, [])).status).toBe('pending');
      expect(principalOf(context, authorized.session.accessToken).customerRecordId).toBe(GRACE); // Resending never signs the customer out.
      expect(context.sessions.refresh(authorized.session.refreshToken).accessToken).toBeTruthy();
    });

    it('completing the second invitation first leaves the first unusable', async () => {
      const context = setup();
      const now = Date.now();
      const first = await invite(context, {}, now);
      const second = await invite(context, {}, now + 11 * 60_000);
      await verify(context, second);
      expect(await rejection(context.service.sendCode(first))).toMatchObject({ code: 'invitation_replaced' });
    });

    it('codes are bound to their invitation: a code from invitation A never opens invitation B', async () => {
      const context = setup();
      const a = await invite(context);
      const b = await invite(context, { bookingRecordId: BOOKING_2 }); // A second live invitation for the same person.
      await context.service.sendCode(a);
      const codeA = context.codes.at(-1)!.code;
      await context.service.sendCode(b);
      const codeB = context.codes.at(-1)!.code;
      if (codeA !== codeB) expect(await rejection(context.service.verifyCode(b, codeA, false))).toMatchObject({ code: 'code_invalid' });
      expect((await context.service.verifyCode(a, codeA, false)).status).toBe('authorized');
      expect((await context.service.verifyCode(b, codeB, false)).status).toBe('authorized');
    });

    it('two tabs verifying the same invitation create exactly one session', async () => {
      const context = setup();
      const token = await invite(context);
      await context.service.sendCode(token);
      const code = context.codes.at(-1)!.code;
      const outcomes = await Promise.allSettled([context.service.verifyCode(token, code, false), context.service.verifyCode(token, code, false)]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    });
  });

  describe('2. invitations for two Bookings to the same Customer', () => {
    it('are independent: one does not replace, revoke or consume the other', async () => {
      const context = setup();
      const first = await invite(context);
      const second = await invite(context, { bookingRecordId: BOOKING_2 });
      await verify(context, first);
      expect((await context.service.resolve(second, [])).status).toBe('pending');
      await context.service.revoke(BASE_A, BOOKING_2, GRACE);
      expect(await rejection(context.service.resolve(second, []))).toMatchObject({ code: 'invitation_revoked' });
    });

    it('revoking one Booking’s invitation leaves the other usable', async () => {
      const context = setup();
      const first = await invite(context);
      const second = await invite(context, { bookingRecordId: BOOKING_2 });
      await context.service.revoke(BASE_A, BOOKING_1, null);
      expect((await verify(context, second)).status).toBe('authorized');
      expect(await rejection(context.service.resolve(first, []))).toMatchObject({ code: 'invitation_revoked' });
    });

    it('trusted-device tokens stay booking-specific (policy): trusting Booking 1 does not skip the code for Booking 2', async () => {
      const context = setup();
      const verified = await verify(context, await invite(context), true);
      const second = await invite(context, { bookingRecordId: BOOKING_2 });
      expect((await context.service.resolve(second, [verified.trustedDeviceToken!])).trustedDevice).toBe(false);
      expect(await rejection(context.service.open(second, [verified.trustedDeviceToken!]))).toMatchObject({ code: 'verification_required' });
    });

    it('sessions for two bookings of the same Customer share one identity key', async () => {
      const context = setup();
      const one = await verify(context, await invite(context));
      const two = await verify(context, await invite(context, { bookingRecordId: BOOKING_2 }));
      expect(one.session.identityKey).toBeDefined();
      expect(one.session.identityKey).toBe(two.session.identityKey);
    });
  });

  describe('3. different Customers and email addresses', () => {
    it('sends each code only to the invited Customer and keeps that Customer in the session', async () => {
      const context = setup();
      const forGrace = await invite(context);
      const forAlan = await invite(context, { customerRecordId: ALAN });
      const alan = await verify(context, forAlan);
      expect(context.codes.at(-1)!.to).toBe('alan@example.com');
      const grace = await verify(context, forGrace);
      expect(context.codes.at(-1)!.to).toBe('grace@example.com');
      expect(principalOf(context, alan.session.accessToken).customerRecordId).toBe(ALAN);
      expect(principalOf(context, grace.session.accessToken).customerRecordId).toBe(GRACE);
      expect(alan.session.identityKey).not.toBe(grace.session.identityKey); // Same booking, two identities: never merged.
    });

    it('two Customers sharing one email address still get separate identities', async () => {
      const people = directory();
      people[BASE_A][ALAN].email = 'grace@example.com';
      const context = setup(people);
      const alan = await verify(context, await invite(context, { customerRecordId: ALAN }));
      const grace = await verify(context, await invite(context));
      expect(principalOf(context, alan.session.accessToken).customerRecordId).toBe(ALAN);
      expect(alan.session.identityKey).not.toBe(grace.session.identityKey);
    });

    it('a device trusted by one person is not trusted for the other person on the same device', async () => {
      const context = setup();
      const grace = await verify(context, await invite(context), true);
      const forAlan = await invite(context, { customerRecordId: ALAN });
      expect((await context.service.resolve(forAlan, [grace.trustedDeviceToken!])).trustedDevice).toBe(false);
      expect(await rejection(context.service.open(forAlan, [grace.trustedDeviceToken!]))).toMatchObject({ code: 'verification_required' });
    });

    it('an email change after the invitation was sent invalidates it before a code is requested', async () => {
      const context = setup();
      const token = await invite(context);
      context.people[BASE_A][GRACE].email = 'grace.new@example.com';
      expect(await rejection(context.service.resolve(token, []))).toMatchObject({ status: 409, code: 'destination_changed' });
      expect(await rejection(context.service.sendCode(token))).toMatchObject({ code: 'destination_changed' });
      expect(context.email.sendCode).not.toHaveBeenCalled();
    });

    it('an email change after the code was sent stops the code from creating a session', async () => {
      const context = setup();
      const token = await invite(context);
      await context.service.sendCode(token);
      context.people[BASE_A][GRACE].email = 'grace.new@example.com';
      expect(await rejection(context.service.verifyCode(token, context.codes.at(-1)!.code, false))).toMatchObject({ code: 'destination_changed' });
      // A fresh invitation follows the new address.
      const fresh = await invite(context, {}, Date.now() + 11 * 60_000);
      await context.service.sendCode(fresh);
      expect(context.codes.at(-1)!.to).toBe('grace.new@example.com');
    });

    it('an email change also blocks trusted-device opening of an invitation sent to the old address', async () => {
      const context = setup();
      const verified = await verify(context, await invite(context), true);
      const later = await invite(context, {}, Date.now() + 11 * 60_000);
      context.people[BASE_A][GRACE].email = 'grace.new@example.com';
      expect(await rejection(context.service.open(later, [verified.trustedDeviceToken!]))).toMatchObject({ code: 'destination_changed' });
    });

    it('a Customer unlinked from the Booking after the invite cannot verify', async () => {
      const context = setup();
      const token = await invite(context);
      await context.service.sendCode(token);
      context.people[BASE_A][GRACE].bookings = [BOOKING_2];
      expect(await rejection(context.service.verifyCode(token, context.codes.at(-1)!.code, false))).toMatchObject({ code: 'customer_unavailable' });
    });
  });

  describe('4. Branch A and Branch B on one device', () => {
    it('same email and record IDs in two bases produce separate sessions, identities and trust', async () => {
      const context = setup();
      const a = await verify(context, await invite(context), true);
      const b = await verify(context, await invite(context, { baseId: BASE_B }), true);
      expect(principalOf(context, a.session.accessToken)).toMatchObject({ baseId: BASE_A, customerRecordId: GRACE });
      expect(principalOf(context, b.session.accessToken)).toMatchObject({ baseId: BASE_B, customerRecordId: GRACE });
      expect(a.session.identityKey).not.toBe(b.session.identityKey);
      expect(context.codes.map((code) => code.brand)).toEqual(['Branch A Travel', 'Branch B Travel']);
      // A's trust never opens B's invitation, even though booking and customer IDs are identical.
      const laterB = await invite(context, { baseId: BASE_B }, Date.now() + 11 * 60_000);
      expect((await context.service.resolve(laterB, [a.trustedDeviceToken!])).trustedDevice).toBe(false);
      expect((await context.service.resolve(laterB, [b.trustedDeviceToken!])).trustedDevice).toBe(true);
    });

    it('verifying Branch B leaves Branch A’s session working, and they expire or end independently', async () => {
      const context = setup();
      const a = await verify(context, await invite(context));
      const b = await verify(context, await invite(context, { baseId: BASE_B }));
      context.sessions.revoke(b.session.refreshToken);
      expect(() => context.sessions.refresh(b.session.refreshToken)).toThrow();
      expect(context.sessions.refresh(a.session.refreshToken).identityKey).toBe(a.session.identityKey);
    });

    it('invitation codes and per-customer send limits are scoped by base', async () => {
      const context = setup();
      const a = await invite(context);
      const b = await invite(context, { baseId: BASE_B });
      await context.service.sendCode(a);
      expect(await rejection(context.service.verifyCode(b, context.codes.at(-1)!.code, false))).toMatchObject({ code: 'code_not_sent' });
    });
  });

  describe('trusted-device scope', () => {
    it('is valid only for its base, booking and Customer', () => {
      const trust = new DeviceTrustService();
      const token = trust.issue(BASE_A, BOOKING_1, GRACE);
      expect(trust.validFor(token, BASE_A, BOOKING_1, GRACE)).toBe(true);
      expect(trust.validFor(token, BASE_B, BOOKING_1, GRACE)).toBe(false);
      expect(trust.validFor(token, BASE_A, BOOKING_2, GRACE)).toBe(false);
      expect(trust.validFor(token, BASE_A, BOOKING_1, ALAN)).toBe(false);
      expect(trust.validFor(token, BASE_A, BOOKING_1, null)).toBe(false);
    });
  });

  describe('identity keys', () => {
    it('are opaque and scoped by base + Customer, never by email or booking alone', () => {
      const grace = identityKey({ baseId: BASE_A, recordId: BOOKING_1, customerRecordId: GRACE, fellowTraveller: false });
      expect(grace).toMatch(/^idk_[A-Za-z0-9_-]{22}$/);
      expect(grace).not.toContain(GRACE);
      expect(identityKey({ baseId: BASE_A, recordId: BOOKING_2, customerRecordId: GRACE, fellowTraveller: false })).toBe(grace);
      expect(identityKey({ baseId: BASE_B, recordId: BOOKING_1, customerRecordId: GRACE, fellowTraveller: false })).not.toBe(grace);
      expect(identityKey({ baseId: BASE_A, recordId: BOOKING_1, customerRecordId: null, fellowTraveller: true })).not.toBe(grace);
    });
  });
});
