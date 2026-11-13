import { HttpException, NotFoundException } from '@nestjs/common';
import { createCustomerInvitationRequestSchema, createCustomerInvitationResponseSchema, invitationStateSchema, INVITATION_TOKEN_PATTERN } from '@vision-trips/contracts';
import { DeviceTrustService } from '../security/device-trust.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { InvitationTargetError, type InvitationContext, type TripsService } from '../trips/trips.service.js';
import { CustomerInvitationsService, OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_WINDOW, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS } from './customer-invitations.service.js';
import type { InvitationEmailService } from './invitation-email.service.js';
import { generateInvitationToken, hashInvitationToken } from './invitation-token.js';

const BASE = 'appABCDEFGHIJKLMN';
const BOOKING = 'recBOOKINGAAAAAAA';
const CUSTOMER = 'recCUSTOMERAAAAAA';
const OTHER_CUSTOMER = 'recCUSTOMERBBBBBB';

function context(overrides: Partial<InvitationContext> = {}): InvitationContext {
  return {
    tenantId: 'recBRANDAAAAAAAAA', tripName: 'Lisbon Escape', customer: { email: 'grace@example.com', firstName: 'Grace' },
    brand: { name: 'Example Travel', logoUrl: null, primaryColor: '#155B75', supportEmail: 'agent@example.com', supportPhone: '020 7000 0000' },
    ...overrides,
  };
}

function setup() {
  const store = new DurableAuthStore(':memory:');
  const sessions = new SessionsService(store);
  const trust = new DeviceTrustService();
  const sentCodes: string[] = [];
  const sentLinks: string[] = [];
  const email = {
    sendInvitation: vi.fn(async (_context: InvitationContext, url: string) => { sentLinks.push(url); return 'email-1'; }),
    sendCode: vi.fn(async (_context: InvitationContext, code: string) => { sentCodes.push(code); return 'email-2'; }),
  };
  const trips = {
    invitationContext: vi.fn(async (_base: string, _booking: string, customer: string | null) => context(customer ? {} : { customer: null })),
    primaryCustomerRecordId: vi.fn().mockResolvedValue(CUSTOMER),
    snapshot: vi.fn(async () => ({ tripId: 'trp_public', summary: { name: 'Lisbon Escape' } })),
  };
  const airtable = { addComment: vi.fn().mockResolvedValue(undefined) };
  const service = new CustomerInvitationsService(store, trips as unknown as TripsService, airtable as never, sessions, trust, email as unknown as InvitationEmailService);
  return { store, sessions, trust, email, trips, airtable, service, sentCodes, sentLinks };
}

const request = (overrides: Record<string, unknown> = {}) => createCustomerInvitationRequestSchema.parse({ baseId: BASE, bookingRecordId: BOOKING, customerRecordId: CUSTOMER, ...overrides });
const tokenOf = (url: string | null) => url!.split('/').pop()!;
async function rejection(promise: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try { await promise; } catch (error) {
    if (error instanceof HttpException) return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    throw error;
  }
  throw new Error('Expected the promise to reject.');
}

describe('invitation tokens', () => {
  it('are vt_-prefixed, carry 192 bits of randomness and are hashed with SHA-256', () => {
    const token = generateInvitationToken();
    expect(token).toMatch(INVITATION_TOKEN_PATTERN);
    expect(Buffer.from(token.slice(3), 'base64url')).toHaveLength(24);
    expect(hashInvitationToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(token)).not.toContain(token.slice(3));
    expect(new Set(Array.from({ length: 200 }, generateInvitationToken)).size).toBe(200);
  });
});

describe('CustomerInvitationsService', () => {
  beforeEach(() => {
    process.env.VISION_TRIP_LINK_BASE_URL = 'https://trips.example/trip';
    process.env.VISION_LINK_SECRET = 'invitation-test-secret';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.VISION_TRIP_LINK_BASE_URL; delete process.env.VISION_LINK_SECRET; delete process.env.VISION_INVITATION_TTL_DAYS;
    delete process.env.VISION_DEV_BASE_ID; delete process.env.VISION_DEV_BOOKING_RECORD_ID; delete process.env.VISION_DEV_CUSTOMER_RECORD_ID;
    delete process.env.NODE_ENV;
  });

  describe('creating invitations (agent API)', () => {
    it('emails an opaque link, audits the booking and never stores the raw token', async () => {
      const { service, store, email, airtable } = setup();
      const result = await service.create(request());

      expect(createCustomerInvitationResponseSchema.parse(result)).toMatchObject({ status: 'sent', emailSent: true, duplicate: false, auditRecorded: true, destinationHint: 'gr***@example.com', scope: 'primary_customer' });
      expect(result.url).toMatch(/^https:\/\/trips\.example\/trip\/vt_[A-Za-z0-9_-]{32}$/);
      for (const secret of [BASE, BOOKING, CUSTOMER, 'grace', 'example.com']) expect(result.url).not.toContain(secret);
      expect(email.sendInvitation).toHaveBeenCalledWith(expect.anything(), result.url, expect.any(Number), result.invitationId);
      expect(airtable.addComment).toHaveBeenCalledWith(BASE, 'Bookings', BOOKING, expect.stringContaining('Customer App invitation emailed to gr***@example.com'));

      const token = tokenOf(result.url);
      const database = (store as unknown as { database: { prepare(sql: string): { all(): unknown[] } } }).database;
      const everything = JSON.stringify(['customer_invitations', 'invitation_otps', 'idempotency_results', 'verification_challenges'].map((table) => database.prepare(`SELECT * FROM ${table}`).all()));
      expect(everything).not.toContain(token);
      expect(everything).not.toContain(token.slice(3));
      expect(everything).toContain(hashInvitationToken(token));
    });

    it('defaults to a 30-day expiry and honours VISION_INVITATION_TTL_DAYS', async () => {
      const { service } = setup();
      const now = Date.now();
      const standard = await service.create(request({ sendEmail: false }), now);
      expect(Date.parse(standard.expiresAt) - now).toBe(30 * 86_400_000);
      process.env.VISION_INVITATION_TTL_DAYS = '7';
      const shorter = await service.create(request({ sendEmail: false, customerRecordId: OTHER_CUSTOMER }), now);
      expect(Date.parse(shorter.expiresAt) - now).toBe(7 * 86_400_000);
    });

    it('refuses a Customer that is not linked to the Booking', async () => {
      const { service, trips, email } = setup();
      trips.invitationContext.mockRejectedValueOnce(new InvitationTargetError('customer_not_linked'));
      expect(await rejection(service.create(request()))).toMatchObject({ status: 422, body: { code: 'customer_not_linked' } });
      expect(email.sendInvitation).not.toHaveBeenCalled();
    });

    it('refuses a Customer without a valid email address', async () => {
      const { service, trips } = setup();
      trips.invitationContext.mockRejectedValueOnce(new InvitationTargetError('customer_email_missing'));
      expect(await rejection(service.create(request()))).toMatchObject({ status: 422, body: { code: 'customer_email_missing' } });
    });

    it('reports a missing Booking or Customer without Airtable details', async () => {
      const { service, trips } = setup();
      trips.invitationContext.mockRejectedValueOnce(new NotFoundException('Airtable could not find the Bookings record.'));
      expect(await rejection(service.create(request()))).toMatchObject({ status: 422, body: { code: 'record_not_found' } });
    });

    it('treats an Airtable automation retry with the same idempotency key as a duplicate, without a second email', async () => {
      const { service, email, trips } = setup();
      const first = await service.create(request({ idempotencyKey: 'airtable:recBOOKING:1' }));
      const retry = await service.create(request({ idempotencyKey: 'airtable:recBOOKING:1' }));

      expect(retry).toMatchObject({ status: 'duplicate', duplicate: true, url: null, invitationId: first.invitationId, emailSent: true });
      expect(email.sendInvitation).toHaveBeenCalledOnce();
      expect(trips.invitationContext).toHaveBeenCalledOnce(); // A retry does not even read Airtable.
      expect((await service.resolve(tokenOf(first.url), [])).status).toBe('pending'); // The emailed link still works.
    });

    it('handles concurrent deliveries of the same automation run as one invitation', async () => {
      const { service, email } = setup();
      const [a, b] = await Promise.all([service.create(request({ idempotencyKey: 'airtable:race:1' })), service.create(request({ idempotencyKey: 'airtable:race:1' }))]);
      expect([a.status, b.status].sort()).toEqual(['duplicate', 'sent']);
      expect(email.sendInvitation).toHaveBeenCalledOnce();
    });

    it('ignores a repeated email request within the duplicate window, then replaces the old link after it', async () => {
      const { service, email } = setup();
      const now = Date.now();
      const first = await service.create(request(), now);
      const repeat = await service.create(request(), now + 60_000);
      expect(repeat).toMatchObject({ status: 'duplicate', invitationId: first.invitationId });
      expect(email.sendInvitation).toHaveBeenCalledOnce();

      const later = await service.create(request(), now + 11 * 60_000);
      expect(later.status).toBe('sent');
      expect(email.sendInvitation).toHaveBeenCalledTimes(2);
      expect(await rejection(service.resolve(tokenOf(first.url), []))).toMatchObject({ status: 410, body: { code: 'invitation_replaced' } });
      expect((await service.resolve(tokenOf(later.url), [])).status).toBe('pending');
    });

    it('issues no link when the email fails, and a retry with the same key starts afresh', async () => {
      const { service, email } = setup();
      email.sendInvitation.mockRejectedValueOnce(new Error('provider down'));
      expect(await rejection(service.create(request({ idempotencyKey: 'airtable:fail:1' })))).toMatchObject({ status: 502, body: { code: 'delivery_failed' } });
      const retry = await service.create(request({ idempotencyKey: 'airtable:fail:1' }));
      expect(retry.status).toBe('sent');
    });

    it('still returns the link when only the audit comment fails', async () => {
      const { service, airtable } = setup();
      airtable.addComment.mockRejectedValueOnce(new Error('Airtable down'));
      const result = await service.create(request());
      expect(result).toMatchObject({ status: 'sent', auditRecorded: false });
    });

    it('can be revoked by the agent', async () => {
      const { service } = setup();
      const created = await service.create(request());
      await expect(service.revoke(BASE, BOOKING, CUSTOMER)).resolves.toEqual({ revoked: 1 });
      expect(await rejection(service.resolve(tokenOf(created.url), []))).toMatchObject({ status: 410, body: { code: 'invitation_revoked' } });
    });
  });

  describe('opening an invitation (customer)', () => {
    it('shows only branding and a masked email, and opening it never creates a session', async () => {
      const { service, store, trips } = setup();
      const { url } = await service.create(request());
      const state = await service.resolve(tokenOf(url), []);

      expect(invitationStateSchema.parse(state)).toEqual(state);
      expect(state).toMatchObject({ status: 'pending', verification: 'email_otp', destinationHint: 'gr***@example.com', trustedDevice: false, brand: { name: 'Example Travel' } });
      expect(Object.keys(state).sort()).toEqual(['brand', 'destinationHint', 'expiresAt', 'otp', 'scope', 'status', 'trustedDevice', 'verification']);
      expect(JSON.stringify(state)).not.toMatch(/Lisbon|grace@|rec[A-Z]|app[A-Z]/);
      expect(trips.snapshot).not.toHaveBeenCalled();
      const database = (store as unknown as { database: { prepare(sql: string): { get(): { count: number } } } }).database;
      expect(database.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count).toBe(0);
    });

    it('rejects malformed, unknown and expired invitations with distinct, generic codes', async () => {
      const { service } = setup();
      expect(await rejection(service.resolve('not-a-token', []))).toMatchObject({ status: 404, body: { code: 'invitation_invalid' } });
      expect(await rejection(service.resolve(generateInvitationToken(), []))).toMatchObject({ status: 404, body: { code: 'invitation_invalid' } });

      vi.useFakeTimers({ toFake: ['Date'] });
      const { url } = await service.create(request());
      vi.setSystemTime(Date.now() + 31 * 86_400_000);
      const expired = await rejection(service.resolve(tokenOf(url), []));
      expect(expired).toMatchObject({ status: 410, body: { code: 'invitation_expired' } });
      expect(String(expired.body.message)).toContain('Ask your travel agent');
    });

    it('stops working when the Customer is unlinked after the invitation was sent', async () => {
      const { service, trips } = setup();
      const { url } = await service.create(request());
      trips.invitationContext.mockRejectedValueOnce(new InvitationTargetError('customer_not_linked'));
      expect(await rejection(service.resolve(tokenOf(url), []))).toMatchObject({ status: 409, body: { code: 'customer_unavailable' } });
    });
  });

  describe('email codes', () => {
    it('stores only a keyed hash of the code and verifies it into a scoped, verified session', async () => {
      const { service, store, sessions, sentCodes } = setup();
      const { url } = await service.create(request());
      const token = tokenOf(url);
      const otp = await service.sendCode(token);
      expect(otp).toMatchObject({ remainingSends: OTP_MAX_SENDS_PER_WINDOW - 1, remainingAttempts: OTP_MAX_ATTEMPTS });
      const code = sentCodes[0];
      expect(code).toMatch(/^\d{6}$/);
      const database = (store as unknown as { database: { prepare(sql: string): { all(): unknown[] } } }).database;
      expect(JSON.stringify(database.prepare('SELECT * FROM invitation_otps').all())).not.toContain(code);

      const authorized = await service.verifyCode(token, code, false);
      expect(authorized.status).toBe('authorized');
      expect(authorized.trustedDeviceToken).toBeUndefined();
      expect(sessions.validateAccess(`Bearer ${authorized.session.accessToken}`)).toMatchObject({ baseId: BASE, recordId: BOOKING, customerRecordId: CUSTOMER, fellowTraveller: false, assurance: 'otp' });
    });

    it('scopes a fellow-traveller invitation to the fellow-traveller view', async () => {
      const { service, sessions, sentCodes, trips } = setup();
      const { url } = await service.create(request({ scope: 'fellow_traveller' }));
      await service.sendCode(tokenOf(url));
      const authorized = await service.verifyCode(tokenOf(url), sentCodes[0], false);
      expect(trips.snapshot).toHaveBeenCalledWith(BASE, BOOKING, 'fellow_traveller');
      expect(sessions.validateAccess(`Bearer ${authorized.session.accessToken}`)).toMatchObject({ fellowTraveller: true, assurance: 'otp' });
    });

    it('cannot be replayed once the invitation is consumed', async () => {
      const { service, sentCodes } = setup();
      const { url } = await service.create(request());
      await service.sendCode(tokenOf(url));
      await service.verifyCode(tokenOf(url), sentCodes[0], false);
      expect(await rejection(service.verifyCode(tokenOf(url), sentCodes[0], false))).toMatchObject({ status: 410, body: { code: 'invitation_consumed' } });
      expect(await rejection(service.resolve(tokenOf(url), []))).toMatchObject({ status: 410, body: { code: 'invitation_consumed' } });
    });

    it('lets only one of two concurrent correct submissions create a session', async () => {
      const { service, sentCodes, trips } = setup();
      const { url } = await service.create(request());
      await service.sendCode(tokenOf(url));
      let release!: () => void;
      trips.snapshot.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ tripId: 'trp_public', summary: { name: 'Lisbon Escape' } }); }));
      const first = service.verifyCode(tokenOf(url), sentCodes[0], false);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      const second = await rejection(service.verifyCode(tokenOf(url), sentCodes[0], false));
      release();
      await expect(first).resolves.toMatchObject({ status: 'authorized' });
      expect(second).toMatchObject({ status: 409, body: { code: 'verification_in_progress' } });
    });

    it('keeps the invitation usable when loading the trip fails after a correct code', async () => {
      const { service, sentCodes, trips } = setup();
      const { url } = await service.create(request());
      await service.sendCode(tokenOf(url));
      trips.snapshot.mockRejectedValueOnce(new Error('Airtable timeout'));
      expect(await rejection(service.verifyCode(tokenOf(url), sentCodes[0], false))).toMatchObject({ status: 503 });
      await expect(service.verifyCode(tokenOf(url), sentCodes[0], false)).resolves.toMatchObject({ status: 'authorized' });
    });

    it('expires codes after ten minutes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { service, sentCodes } = setup();
      const { url } = await service.create(request());
      await service.sendCode(tokenOf(url));
      vi.setSystemTime(Date.now() + OTP_TTL_MS + 1);
      expect(await rejection(service.verifyCode(tokenOf(url), sentCodes[0], false))).toMatchObject({ status: 401, body: { code: 'code_expired' } });
    });

    it('requires a code to have been sent', async () => {
      const { service } = setup();
      const { url } = await service.create(request());
      expect(await rejection(service.verifyCode(tokenOf(url), '123456', false))).toMatchObject({ status: 400, body: { code: 'code_not_sent' } });
    });

    it('limits wrong guesses per code, then requires a new code', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { service, sentCodes } = setup();
      const { url } = await service.create(request());
      await service.sendCode(tokenOf(url));
      const wrong = sentCodes[0] === '000000' ? '111111' : '000000';
      for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
        expect(await rejection(service.verifyCode(tokenOf(url), wrong, false))).toMatchObject({ status: 401, body: { code: 'code_invalid', remainingAttempts: OTP_MAX_ATTEMPTS - attempt } });
      }
      expect(await rejection(service.verifyCode(tokenOf(url), wrong, false))).toMatchObject({ status: 429, body: { code: 'attempts_exhausted', remainingAttempts: 0 } });
      // Even the right code is refused now.
      expect(await rejection(service.verifyCode(tokenOf(url), sentCodes[0], false))).toMatchObject({ status: 429, body: { code: 'attempts_exhausted' } });

      vi.setSystemTime(Date.now() + OTP_RESEND_COOLDOWN_MS);
      await service.sendCode(tokenOf(url));
      await expect(service.verifyCode(tokenOf(url), sentCodes[1], false)).resolves.toMatchObject({ status: 'authorized' });
    });

    it('enforces the resend cooldown and the per-invitation send limit', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const { service, email } = setup();
      const { url } = await service.create(request());
      await service.sendCode(tokenOf(url));
      const cooldown = await rejection(service.sendCode(tokenOf(url)));
      expect(cooldown).toMatchObject({ status: 429, body: { code: 'resend_cooldown' } });
      expect(cooldown.body.retryAfterSeconds).toBeGreaterThan(0);
      for (let send = 2; send <= OTP_MAX_SENDS_PER_WINDOW; send += 1) {
        vi.setSystemTime(Date.now() + OTP_RESEND_COOLDOWN_MS);
        await service.sendCode(tokenOf(url));
      }
      vi.setSystemTime(Date.now() + OTP_RESEND_COOLDOWN_MS);
      expect(await rejection(service.sendCode(tokenOf(url)))).toMatchObject({ status: 429, body: { code: 'send_limit' } });
      expect(email.sendCode).toHaveBeenCalledTimes(OTP_MAX_SENDS_PER_WINDOW);
    });

    it('limits codes per customer across several invitations', async () => {
      const { service } = setup();
      let limited = false;
      for (let index = 0; index < 12 && !limited; index += 1) {
        const { url } = await service.create(request({ sendEmail: false }));
        try { await service.sendCode(tokenOf(url)); } catch (error) { limited = error instanceof HttpException && (error.getResponse() as { code: string }).code === 'send_limit'; }
      }
      expect(limited).toBe(true);
    });

    it('allows an immediate retry when the code email could not be sent', async () => {
      const { service, email } = setup();
      const { url } = await service.create(request());
      email.sendCode.mockRejectedValueOnce(new Error('provider down'));
      expect(await rejection(service.sendCode(tokenOf(url)))).toMatchObject({ status: 502, body: { code: 'delivery_failed' } });
      await expect(service.sendCode(tokenOf(url))).resolves.toMatchObject({ remainingSends: OTP_MAX_SENDS_PER_WINDOW - 1 });
    });
  });

  describe('trusted devices', () => {
    it('lets a device trusted for this customer open a new invitation without a code', async () => {
      const { service, sessions, sentCodes } = setup();
      const first = await service.create(request());
      await service.sendCode(tokenOf(first.url));
      const verified = await service.verifyCode(tokenOf(first.url), sentCodes[0], true);
      expect(verified.trustedDeviceToken).toBeTruthy();

      const second = await service.create(request({ idempotencyKey: 'second-invite' }), Date.now() + 11 * 60_000);
      const state = await service.resolve(tokenOf(second.url), [verified.trustedDeviceToken!]);
      expect(state.trustedDevice).toBe(true);
      const opened = await service.open(tokenOf(second.url), [verified.trustedDeviceToken!]);
      expect(sessions.validateAccess(`Bearer ${opened.session.accessToken}`)).toMatchObject({ assurance: 'trusted_device', customerRecordId: CUSTOMER });
    });

    it('does not trust a device verified for a different customer', async () => {
      const { service, trust } = setup();
      const other = trust.issue(BASE, BOOKING, OTHER_CUSTOMER);
      const { url } = await service.create(request());
      expect((await service.resolve(tokenOf(url), [other])).trustedDevice).toBe(false);
      expect(await rejection(service.open(tokenOf(url), [other]))).toMatchObject({ status: 403, body: { code: 'verification_required' } });
    });
  });

  describe('internal issuers', () => {
    it('turns a legacy link into a short-lived invitation for the primary customer', async () => {
      const { service, trips } = setup();
      const token = await service.fromLegacyLink(BASE, BOOKING);
      expect(token).toMatch(INVITATION_TOKEN_PATTERN);
      expect(trips.primaryCustomerRecordId).toHaveBeenCalledWith(BASE, BOOKING);
      const state = await service.resolve(token, []);
      expect(state.verification).toBe('email_otp');
      expect(Date.parse(state.expiresAt) - Date.now()).toBeLessThanOrEqual(30 * 60_000);
    });

    it('refuses a legacy link whose booking has no customer to verify', async () => {
      const { service, trips } = setup();
      trips.primaryCustomerRecordId.mockResolvedValueOnce(null);
      expect(await rejection(service.fromLegacyLink(BASE, BOOKING))).toMatchObject({ status: 409, body: { code: 'customer_unavailable' } });
    });

    it('step-up replaces an unverified session with a verified one', async () => {
      const { service, sessions, sentCodes } = setup();
      const legacy = sessions.issue({ baseId: BASE, recordId: BOOKING, fellowTraveller: false, customerRecordId: null, assurance: 'legacy' });
      const principal = sessions.validateAccess(`Bearer ${legacy.accessToken}`);
      const token = await service.stepUp(principal);
      await service.sendCode(token);
      const verified = await service.verifyCode(token, sentCodes[0], false);
      expect(sessions.validateAccess(`Bearer ${verified.session.accessToken}`)).toMatchObject({ assurance: 'otp', customerRecordId: CUSTOMER });
      expect(() => sessions.validateAccess(`Bearer ${legacy.accessToken}`)).toThrow();
    });

    it('creates reusable fellow-traveller share links that open without a code and stay restricted', async () => {
      const { service, sessions, trips } = setup();
      const principal = { baseId: BASE, recordId: BOOKING, fellowTraveller: false, customerRecordId: CUSTOMER, assurance: 'otp' as const };
      const { url } = await service.shareLink(principal);
      const state = await service.resolve(tokenOf(url), []);
      expect(state).toMatchObject({ verification: 'none', scope: 'fellow_traveller', destinationHint: null });
      const first = await service.open(tokenOf(url), []);
      const second = await service.open(tokenOf(url), []);
      expect(sessions.validateAccess(`Bearer ${first.session.accessToken}`)).toMatchObject({ fellowTraveller: true, assurance: 'link' });
      expect(second.status).toBe('authorized');
      expect(trips.snapshot).toHaveBeenCalledWith(BASE, BOOKING, 'fellow_traveller');
      expect(await rejection(service.sendCode(tokenOf(url)))).toMatchObject({ status: 400 });
    });
  });

  describe('development invitations', () => {
    it('reports a clear configuration message when VISION_DEV_* is missing or malformed', () => {
      const { service } = setup();
      expect(service.devStatus()).toEqual({ available: false, message: expect.stringContaining('VISION_DEV_BASE_ID') });
      process.env.VISION_DEV_BASE_ID = 'not-a-base';
      process.env.VISION_DEV_BOOKING_RECORD_ID = BOOKING;
      process.env.VISION_DEV_CUSTOMER_RECORD_ID = CUSTOMER;
      expect(service.devStatus().message).toContain('VISION_DEV_BASE_ID must look like');
    });

    it('creates an invitation from server-side identifiers that goes through the normal email-code flow', async () => {
      const { service, sentCodes } = setup();
      Object.assign(process.env, { VISION_DEV_BASE_ID: BASE, VISION_DEV_BOOKING_RECORD_ID: BOOKING, VISION_DEV_CUSTOMER_RECORD_ID: CUSTOMER });
      expect(service.devStatus()).toEqual({ available: true, message: null });
      const { invitationToken } = await service.devInvitation();
      expect(invitationToken).toMatch(INVITATION_TOKEN_PATTERN);
      await service.sendCode(invitationToken);
      await expect(service.verifyCode(invitationToken, sentCodes[0], false)).resolves.toMatchObject({ status: 'authorized' });
    });

    it('does not exist in production', async () => {
      const { service } = setup();
      Object.assign(process.env, { NODE_ENV: 'production', VISION_DEV_BASE_ID: BASE, VISION_DEV_BOOKING_RECORD_ID: BOOKING, VISION_DEV_CUSTOMER_RECORD_ID: CUSTOMER });
      expect(() => service.devStatus()).toThrow(NotFoundException);
      await expect(service.devInvitation()).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
