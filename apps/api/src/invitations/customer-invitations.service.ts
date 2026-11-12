import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import {
  AIRTABLE_BASE_ID_PATTERN, AIRTABLE_RECORD_ID_PATTERN,
  type CreateCustomerInvitationResponse, type DevInvitationStatus, type InvitationAuthorized, type InvitationErrorCode,
  type InvitationOtpState, type InvitationScope, type InvitationState, type ParsedCreateCustomerInvitationRequest,
  type SessionAssurance,
} from '@vision-trips/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { AirtableService } from '../airtable/airtable.service.js';
import { DeviceTrustService } from '../security/device-trust.service.js';
import { DurableAuthStore, type InvitationOtp, type InvitationSource, type StoredInvitation } from '../sessions/durable-auth.store.js';
import { SessionsService, type SessionPrincipal } from '../sessions/sessions.service.js';
import { InvitationTargetError, TripsService, type InvitationContext } from '../trips/trips.service.js';
import { InvitationEmailService } from './invitation-email.service.js';
import { generateInvitationToken, generateOtpCode, hashInvitationToken, hashOtpCode, invitationUrl, isInvitationToken, maskEmail, otpMatches } from './invitation-token.js';

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60_000;
export const OTP_MAX_SENDS_PER_WINDOW = 5;
export const OTP_SEND_WINDOW_MS = 60 * 60_000;
/** Codes sent to one Customer across all of their invitations, so new invitations cannot be used to flood an inbox. */
export const CUSTOMER_OTP_SENDS_PER_HOUR = 10;
const LEGACY_INVITATION_TTL_MS = 30 * 60_000;
const STEP_UP_INVITATION_TTL_MS = 15 * 60_000;
const SHARE_INVITATION_TTL_MS = 7 * 86_400_000;
const DEV_INVITATION_TTL_MS = 86_400_000;
const INTERNAL_INVITATIONS_PER_BOOKING_PER_HOUR = 10;
const BOOKINGS_TABLE = () => process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings';

/**
 * The canonical issuer and resolver of Customer App invitations.
 *
 * Policy for repeated agent requests (Airtable automations retry, and agents press buttons twice):
 *  1. The same `idempotencyKey` for the same booking and customer never creates a second invitation or email; the
 *     original outcome is reported as `duplicate` (without a URL, because only the token's hash is kept).
 *  2. Without a key, a request to email a customer who was emailed an invitation for the same booking and scope within
 *     the duplicate window (VISION_INVITATION_DUPLICATE_WINDOW_SECONDS, default 10 minutes) is also a `duplicate`.
 *  3. Otherwise a fresh invitation is created and the previous active, unused one for that booking, customer and
 *     scope is revoked: there is only ever one live agent link per customer, so a resend replaces an older link.
 */
@Injectable()
export class CustomerInvitationsService {
  private readonly logger = new Logger(CustomerInvitationsService.name);

  constructor(
    private readonly store: DurableAuthStore,
    private readonly trips: TripsService,
    private readonly airtable: AirtableService,
    private readonly sessions: SessionsService,
    private readonly trust: DeviceTrustService,
    private readonly email: InvitationEmailService,
  ) {}

  // --- Agent / automation ---------------------------------------------------------------------------------------

  async create(input: ParsedCreateCustomerInvitationRequest, now = Date.now()): Promise<CreateCustomerInvitationResponse> {
    const { baseId, bookingRecordId, customerRecordId, scope, sendEmail } = input;
    const idempotencyKey = input.idempotencyKey ? scopedKey(baseId, bookingRecordId, customerRecordId, input.idempotencyKey) : null;
    const earlier = idempotencyKey ? this.store.invitationByIdempotencyKey(idempotencyKey) : null;
    if (earlier) return this.duplicate(earlier, 'idempotency_key');

    const context = await this.agentContext(baseId, bookingRecordId, customerRecordId);
    // From here to the insert there is no await, so concurrent deliveries of the same request cannot both pass.
    const raced = idempotencyKey ? this.store.invitationByIdempotencyKey(idempotencyKey) : null;
    if (raced) return this.duplicate(raced, 'idempotency_key');
    const activeKey = `agent:${baseId}:${bookingRecordId}:${customerRecordId}:${scope}`;
    const active = this.store.activeInvitation(activeKey);
    if (sendEmail && active && active.emailRequested && !active.acceptedAt && active.expiresAt > now && now - active.createdAt < duplicateWindowMs()) {
      return this.duplicate(active, 'recent_email');
    }
    const { invitation, url } = this.issue({
      source: 'agent', baseId, bookingRecordId, customerRecordId, scope, tenantId: context.tenantId,
      ttlMs: invitationTtlMs(), activeKey, idempotencyKey, emailRequested: sendEmail,
    }, now);

    let sentAt: number | null = null;
    if (sendEmail) {
      try {
        await this.email.sendInvitation(context, url, invitation.expiresAt, invitation.id);
        sentAt = Date.now();
        this.store.markInvitationSent(invitation.id, sentAt);
      } catch (error) {
        this.store.abandonInvitation(invitation.id);
        this.log('invitation_email_failed', invitation, { reason: errorName(error) });
        throw new HttpException({ statusCode: 502, code: 'delivery_failed', message: 'The invitation email could not be sent. No link was issued; retry the request.' }, HttpStatus.BAD_GATEWAY);
      }
    }
    const destinationHint = maskEmail(context.customer!.email);
    const auditRecorded = await this.audit(baseId, bookingRecordId,
      `📲 Customer App invitation ${sentAt ? `emailed to ${destinationHint}` : 'created (link only, not emailed)'} · ${scopeLabel(scope)} · expires ${new Date(invitation.expiresAt).toISOString().slice(0, 10)} · ref ${invitation.id}`);
    this.log(sentAt ? 'invitation_sent' : 'invitation_created', invitation, { auditRecorded });
    return {
      invitationId: invitation.id, status: sentAt ? 'sent' : 'created', url, scope, expiresAt: iso(invitation.expiresAt),
      emailSent: sentAt !== null, sentAt: sentAt ? iso(sentAt) : null, destinationHint, duplicate: false, auditRecorded,
    };
  }

  async revoke(baseId: string, bookingRecordId: string, customerRecordId: string | null): Promise<{ revoked: number }> {
    const revoked = this.store.revokeInvitations(baseId, bookingRecordId, customerRecordId);
    if (revoked) await this.audit(baseId, bookingRecordId, `🚫 ${revoked} Customer App invitation${revoked === 1 ? '' : 's'} revoked by automation · ${new Date().toISOString()}`);
    this.logger.log(JSON.stringify({ event: 'invitations_revoked', baseId, bookingRecordId, revoked }));
    return { revoked };
  }

  // --- Customer -------------------------------------------------------------------------------------------------

  /** Welcome-screen details. Never authenticates and never returns trip, traveller or payment data. */
  async resolve(token: string, deviceTrustTokens: string[]): Promise<InvitationState> {
    const invitation = this.load(token);
    const context = await this.customerContext(invitation);
    const trustedDevice = this.trustedDevice(invitation, deviceTrustTokens);
    return {
      status: 'pending',
      brand: { name: context.brand.name, logoUrl: context.brand.logoUrl, primaryColor: context.brand.primaryColor },
      scope: invitation.scope,
      verification: invitation.verification,
      destinationHint: context.customer ? maskEmail(context.customer.email) : null,
      expiresAt: iso(invitation.expiresAt),
      trustedDevice,
      otp: otpState(this.store.invitationOtp(invitation.id)),
    };
  }

  async sendCode(token: string, now = Date.now()): Promise<InvitationOtpState> {
    const first = this.load(token);
    if (first.verification !== 'email_otp') throw invitationError(400, 'invitation_invalid', 'This link does not need a code.');
    const context = await this.customerContext(first);
    // Re-read after the Airtable round trip: the invitation may have been used, revoked or claimed meanwhile.
    const invitation = this.load(token);
    if (invitation.consumingUntil && invitation.consumingUntil > now) throw invitationError(409, 'verification_in_progress', 'Your code is already being checked.');
    const previous = this.store.invitationOtp(invitation.id);
    const windowStartedAt = now - previous.sendWindowStartedAt >= OTP_SEND_WINDOW_MS ? now : previous.sendWindowStartedAt;
    const sends = windowStartedAt === previous.sendWindowStartedAt ? previous.sends : 0;
    if (previous.codeSentAt && now - previous.codeSentAt < OTP_RESEND_COOLDOWN_MS) {
      throw invitationError(429, 'resend_cooldown', 'Please wait a moment before asking for another code.', { retryAfterSeconds: Math.ceil((previous.codeSentAt + OTP_RESEND_COOLDOWN_MS - now) / 1000) });
    }
    if (sends >= OTP_MAX_SENDS_PER_WINDOW) {
      throw invitationError(429, 'send_limit', 'We’ve sent the maximum number of codes for now. Try again later or contact your travel agent.', { retryAfterSeconds: Math.ceil((windowStartedAt + OTP_SEND_WINDOW_MS - now) / 1000) });
    }
    const bucket = this.store.consumeRateLimit(`invitation-otp:${invitation.baseId}:${invitation.customerRecordId}`, CUSTOMER_OTP_SENDS_PER_HOUR, OTP_SEND_WINDOW_MS, now);
    if (!bucket.allowed) throw invitationError(429, 'send_limit', 'We’ve sent the maximum number of codes for now. Try again later or contact your travel agent.', { retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) });

    const code = generateOtpCode();
    const next: InvitationOtp = { invitationId: invitation.id, codeHash: hashOtpCode(invitation.id, code), codeSentAt: now, codeExpiresAt: now + OTP_TTL_MS, attempts: 0, sends: sends + 1, sendWindowStartedAt: windowStartedAt };
    this.store.putInvitationOtp(next); // Reserved before sending, so a concurrent request meets the cooldown.
    try {
      await this.email.sendCode(context, code, `otp:${invitation.id}:${windowStartedAt}:${next.sends}`);
    } catch (error) {
      this.store.putInvitationOtp(previous);
      this.log('otp_delivery_failed', invitation, { reason: errorName(error) });
      throw invitationError(502, 'delivery_failed', 'We couldn’t send your code just now. Please try again.');
    }
    this.log('otp_sent', invitation, { sends: next.sends });
    return otpState(next, now);
  }

  async verifyCode(token: string, code: string, rememberDevice: boolean, now = Date.now()): Promise<InvitationAuthorized> {
    const invitation = this.load(token);
    if (invitation.verification !== 'email_otp') throw invitationError(400, 'invitation_invalid', 'This link does not need a code.');
    if (invitation.consumingUntil && invitation.consumingUntil > now) throw invitationError(409, 'verification_in_progress', 'Your code is already being checked.');
    const otp = this.store.invitationOtp(invitation.id);
    if (!otp.codeHash || !otp.codeExpiresAt) throw invitationError(400, 'code_not_sent', 'Ask for a code first.');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw invitationError(429, 'attempts_exhausted', 'Too many incorrect codes. Ask for a new code to try again.', { remainingAttempts: 0 });
    if (otp.codeExpiresAt <= now) throw invitationError(401, 'code_expired', 'This code has expired. Ask for a new one.');
    if (!otpMatches(invitation.id, code, otp.codeHash)) {
      const used = this.store.recordOtpFailure(invitation.id);
      const remainingAttempts = Math.max(0, OTP_MAX_ATTEMPTS - used);
      this.log('otp_rejected', invitation, { remainingAttempts });
      if (remainingAttempts === 0) throw invitationError(429, 'attempts_exhausted', 'Too many incorrect codes. Ask for a new code to try again.', { remainingAttempts });
      throw invitationError(401, 'code_invalid', `That code isn’t right. ${remainingAttempts} ${remainingAttempts === 1 ? 'attempt' : 'attempts'} left.`, { remainingAttempts });
    }
    return this.complete(invitation, 'otp', rememberDevice, now);
  }

  /** Opens a share link (no code) or an invitation on a device already trusted for this customer and booking. */
  async open(token: string, deviceTrustTokens: string[], now = Date.now()): Promise<InvitationAuthorized> {
    const invitation = this.load(token);
    if (invitation.verification === 'none') {
      await this.customerContext(invitation);
      const snapshot = await this.snapshotFor(invitation);
      const session = this.sessions.issue({ baseId: invitation.baseId, recordId: invitation.bookingRecordId, fellowTraveller: true, customerRecordId: null, assurance: 'link', invitationId: invitation.id });
      this.log('share_link_opened', invitation);
      return { status: 'authorized', snapshot, session };
    }
    if (!this.trustedDevice(invitation, deviceTrustTokens)) throw invitationError(403, 'verification_required', 'Confirm it’s you with a code sent to your email.');
    return this.complete(invitation, 'trusted_device', false, now);
  }

  // --- Internal issuers -----------------------------------------------------------------------------------------

  /** A legacy signed link only locates the booking; the holder must still verify the primary customer's email. */
  async fromLegacyLink(baseId: string, bookingRecordId: string): Promise<string> {
    this.limitInternal(`legacy-invitation:${baseId}:${bookingRecordId}`);
    const customerRecordId = await this.primaryCustomer(baseId, bookingRecordId);
    const context = await this.customerContext({ baseId, bookingRecordId, customerRecordId });
    return this.issue({ source: 'legacy_link', baseId, bookingRecordId, customerRecordId, scope: 'primary_customer', tenantId: context.tenantId, ttlMs: LEGACY_INVITATION_TTL_MS }).token;
  }

  /** Lets a session without email verification (older sessions, legacy links) prove it before a sensitive action. */
  async stepUp(principal: SessionPrincipal): Promise<string> {
    if (principal.fellowTraveller) throw new ForbiddenException('Only the lead customer can do this.');
    this.limitInternal(`step-up-invitation:${principal.baseId}:${principal.recordId}`);
    const customerRecordId = principal.customerRecordId ?? await this.primaryCustomer(principal.baseId, principal.recordId);
    const context = await this.customerContext({ baseId: principal.baseId, bookingRecordId: principal.recordId, customerRecordId });
    return this.issue({
      source: 'step_up', baseId: principal.baseId, bookingRecordId: principal.recordId, customerRecordId, scope: 'primary_customer',
      tenantId: context.tenantId, ttlMs: STEP_UP_INVITATION_TTL_MS, replacesSessionId: principal.sessionId ?? null,
    }).token;
  }

  /** A seven-day fellow-traveller link minted by a verified lead customer: itinerary and documents, nothing financial. */
  async shareLink(principal: SessionPrincipal): Promise<{ url: string; expiresAt: string }> {
    const context = await this.customerContext({ baseId: principal.baseId, bookingRecordId: principal.recordId, customerRecordId: null });
    const { invitation, url } = this.issue({
      source: 'share', baseId: principal.baseId, bookingRecordId: principal.recordId, customerRecordId: null, scope: 'fellow_traveller',
      tenantId: context.tenantId, ttlMs: SHARE_INVITATION_TTL_MS, verification: 'none', reusable: true,
    });
    await this.audit(principal.baseId, principal.recordId, `🔗 Lead customer created a fellow-traveller link · expires ${iso(invitation.expiresAt).slice(0, 10)} · ref ${invitation.id}`);
    return { url, expiresAt: iso(invitation.expiresAt) };
  }

  devStatus(): DevInvitationStatus {
    assertDevelopment();
    const config = devConfig();
    return { available: config.ok, message: config.ok ? null : config.message };
  }

  async devInvitation(): Promise<{ invitationToken: string }> {
    assertDevelopment();
    const config = devConfig();
    if (!config.ok) throw new ServiceUnavailableException(config.message);
    let context: InvitationContext;
    try {
      context = await this.trips.invitationContext(config.baseId, config.bookingRecordId, config.customerRecordId);
    } catch (error) {
      throw new ServiceUnavailableException(`Development invitation unavailable: ${error instanceof InvitationTargetError
        ? (error.reason === 'customer_not_linked' ? 'VISION_DEV_CUSTOMER_RECORD_ID is not linked to VISION_DEV_BOOKING_RECORD_ID.' : 'the development Customer has no Primary or Secondary Email.')
        : error instanceof HttpException ? error.message : 'Airtable could not be read.'}`);
    }
    const { token } = this.issue({
      source: 'development', baseId: config.baseId, bookingRecordId: config.bookingRecordId, customerRecordId: config.customerRecordId,
      scope: 'primary_customer', tenantId: context.tenantId, ttlMs: DEV_INVITATION_TTL_MS,
      activeKey: `development:${config.baseId}:${config.bookingRecordId}:${config.customerRecordId}`,
    });
    return { invitationToken: token };
  }

  // --- Helpers --------------------------------------------------------------------------------------------------

  private issue(options: IssueOptions, now = Date.now()): { invitation: StoredInvitation; token: string; url: string } {
    const token = generateInvitationToken();
    const url = invitationUrl(token); // Fails before storing anything when links are not configured.
    const invitation: StoredInvitation = {
      id: `inv_${randomBytes(12).toString('base64url')}`,
      tokenHash: hashInvitationToken(token),
      tenantId: options.tenantId,
      baseId: options.baseId,
      bookingRecordId: options.bookingRecordId,
      customerRecordId: options.customerRecordId,
      scope: options.scope,
      verification: options.verification ?? 'email_otp',
      source: options.source,
      createdAt: now,
      expiresAt: now + options.ttlMs,
      sentAt: null, acceptedAt: null, revokedAt: null,
      activeKey: options.activeKey ?? null,
      idempotencyKey: options.idempotencyKey ?? null,
      emailRequested: options.emailRequested ?? false,
      reusable: options.reusable ?? false,
      replacesSessionId: options.replacesSessionId ?? null,
      consumingUntil: null,
    };
    this.store.insertInvitation(invitation);
    if (options.source !== 'agent') this.log('invitation_created', invitation);
    return { invitation, token, url };
  }

  /** Validates the token and its state. Errors are deliberately generic: they never say whose trip a link was for. */
  private load(token: string, now = Date.now()): StoredInvitation {
    if (!isInvitationToken(token)) throw invalidInvitation();
    const invitation = this.store.invitationByTokenHash(hashInvitationToken(token));
    if (!invitation) throw invalidInvitation();
    assertUsable(invitation, now);
    return invitation;
  }

  private async complete(invitation: StoredInvitation, assurance: SessionAssurance, rememberDevice: boolean, now: number): Promise<InvitationAuthorized> {
    const claim = this.store.claimInvitation(invitation.id, now);
    if (claim === null) {
      // Someone else holds the claim, or the invitation ended meanwhile: report whichever is true.
      const current = this.store.invitationById(invitation.id);
      if (current) assertUsable(current, Date.now());
      throw invitationError(409, 'verification_in_progress', 'Your code is already being checked.');
    }
    let snapshot: InvitationAuthorized['snapshot'];
    try {
      await this.customerContext(invitation);
      snapshot = await this.snapshotFor(invitation);
    } catch (error) {
      this.store.releaseInvitationClaim(invitation.id, claim);
      throw error;
    }
    if (!this.store.consumeInvitation(invitation.id, claim)) throw invitationError(409, 'verification_in_progress', 'Your code is already being checked.');
    if (invitation.replacesSessionId) this.sessions.revokeById(invitation.replacesSessionId);
    const fellowTraveller = invitation.scope === 'fellow_traveller';
    const session = this.sessions.issue({ baseId: invitation.baseId, recordId: invitation.bookingRecordId, fellowTraveller, customerRecordId: invitation.customerRecordId, assurance, invitationId: invitation.id });
    const trustedDeviceToken = rememberDevice && invitation.customerRecordId ? this.trust.issue(invitation.baseId, invitation.bookingRecordId, invitation.customerRecordId) : undefined;
    this.log('invitation_verified', invitation, { assurance, trustedDevice: Boolean(trustedDeviceToken) });
    void this.audit(invitation.baseId, invitation.bookingRecordId, `✅ Customer verified in the Vision Trips app (${assurance === 'otp' ? 'email code' : 'trusted device'}) · ${scopeLabel(invitation.scope)} · ref ${invitation.id}`);
    return { status: 'authorized', snapshot, session, ...(trustedDeviceToken ? { trustedDeviceToken } : {}) };
  }

  private trustedDevice(invitation: StoredInvitation, tokens: string[]): boolean {
    return invitation.verification === 'email_otp' && tokens.slice(0, 25).some((token) => this.trust.validFor(token, invitation.baseId, invitation.bookingRecordId, invitation.customerRecordId));
  }

  private async snapshotFor(invitation: Pick<StoredInvitation, 'baseId' | 'bookingRecordId' | 'scope'>): Promise<InvitationAuthorized['snapshot']> {
    try {
      return await this.trips.snapshot(invitation.baseId, invitation.bookingRecordId, invitation.scope);
    } catch (error) {
      throw customerSafe(error);
    }
  }

  /** Re-checks the booking, customer link and email each time (an agent may have changed them since the invite). */
  private async customerContext(invitation: Pick<StoredInvitation, 'baseId' | 'bookingRecordId' | 'customerRecordId'>): Promise<InvitationContext> {
    try {
      return await this.trips.invitationContext(invitation.baseId, invitation.bookingRecordId, invitation.customerRecordId);
    } catch (error) {
      throw customerSafe(error);
    }
  }

  private async agentContext(baseId: string, bookingRecordId: string, customerRecordId: string): Promise<InvitationContext> {
    try {
      return await this.trips.invitationContext(baseId, bookingRecordId, customerRecordId);
    } catch (error) {
      const reason = error instanceof InvitationTargetError ? error.reason : error instanceof NotFoundException ? 'record_not_found' : null;
      this.logger.warn(JSON.stringify({ event: 'invitation_rejected', baseId, bookingRecordId, customerRecordId, reason: reason ?? errorName(error) }));
      if (reason === 'customer_not_linked') throw new UnprocessableEntityException({ statusCode: 422, code: reason, message: 'The selected Customer is not linked to this Booking.' });
      if (reason === 'customer_email_missing') throw new UnprocessableEntityException({ statusCode: 422, code: reason, message: 'The selected Customer has no valid email address.' });
      if (reason === 'record_not_found') throw new UnprocessableEntityException({ statusCode: 422, code: reason, message: 'The Booking or Customer could not be found in this base.' });
      throw error;
    }
  }

  private async primaryCustomer(baseId: string, bookingRecordId: string): Promise<string> {
    let customerRecordId: string | null;
    try {
      customerRecordId = await this.trips.primaryCustomerRecordId(baseId, bookingRecordId);
    } catch (error) {
      throw customerSafe(error);
    }
    if (!customerRecordId) throw invitationError(409, 'customer_unavailable', 'We can’t verify this trip link. Ask your travel agent for a new invitation.');
    return customerRecordId;
  }

  private limitInternal(bucket: string): void {
    if (!this.store.consumeRateLimit(bucket, INTERNAL_INVITATIONS_PER_BOOKING_PER_HOUR, 60 * 60_000).allowed) {
      throw invitationError(429, 'send_limit', 'Too many attempts to open this trip. Please try again later.');
    }
  }

  private duplicate(invitation: StoredInvitation, reason: 'idempotency_key' | 'recent_email'): CreateCustomerInvitationResponse {
    this.log('invitation_duplicate', invitation, { reason });
    return {
      invitationId: invitation.id, status: 'duplicate', url: null, scope: invitation.scope, expiresAt: iso(invitation.expiresAt),
      emailSent: invitation.sentAt !== null, sentAt: invitation.sentAt ? iso(invitation.sentAt) : null, destinationHint: null, duplicate: true, auditRecorded: true,
    };
  }

  private async audit(baseId: string, bookingRecordId: string, text: string): Promise<boolean> {
    try {
      await this.airtable.addComment(baseId, BOOKINGS_TABLE(), bookingRecordId, text);
      return true;
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: 'invitation_audit_failed', baseId, bookingRecordId, reason: errorName(error) }));
      return false;
    }
  }

  private log(event: string, invitation: StoredInvitation, extra: Record<string, unknown> = {}): void {
    this.logger.log(JSON.stringify({ event, invitationId: invitation.id, source: invitation.source, scope: invitation.scope, baseId: invitation.baseId, bookingRecordId: invitation.bookingRecordId, ...extra }));
  }
}

interface IssueOptions {
  source: InvitationSource;
  baseId: string;
  bookingRecordId: string;
  customerRecordId: string | null;
  scope: InvitationScope;
  tenantId: string | null;
  ttlMs: number;
  verification?: 'email_otp' | 'none';
  activeKey?: string | null;
  idempotencyKey?: string | null;
  emailRequested?: boolean;
  reusable?: boolean;
  replacesSessionId?: string | null;
}

export function invitationError(status: number, code: InvitationErrorCode, message: string, extra: { retryAfterSeconds?: number; remainingAttempts?: number } = {}): HttpException {
  return new HttpException({ statusCode: status, code, message, ...extra }, status);
}

function invalidInvitation(): HttpException {
  return invitationError(404, 'invitation_invalid', 'This link isn’t valid. Check you opened the whole link from your email, or ask your travel agent for a new one.');
}

/** Customers see a plain message; Airtable and configuration details stay in the server log. */
function customerSafe(error: unknown): HttpException {
  if (error instanceof InvitationTargetError || error instanceof NotFoundException) {
    return invitationError(409, 'customer_unavailable', 'This invitation can no longer be used. Ask your travel agent for a new one.');
  }
  if (error instanceof HttpException && error.getStatus() < 500 && isInvitationBody(error.getResponse())) return error;
  return new ServiceUnavailableException('We can’t open your trip right now. Please try again in a moment.');
}

function isInvitationBody(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'code' in value;
}

function assertUsable(invitation: StoredInvitation, now: number): void {
  if (invitation.revokedAt) throw invitationError(410, 'invitation_revoked', 'This invitation has been replaced or cancelled. Use the newest link from your travel agent, or ask them for a new one.');
  if (invitation.acceptedAt && !invitation.reusable) throw invitationError(410, 'invitation_consumed', 'This invitation has already been used. Your trip is saved in My Trips on the device where you opened it. To use another device, ask your travel agent for a new invitation.');
  if (invitation.expiresAt <= now) throw invitationError(410, 'invitation_expired', 'This invitation has expired. Ask your travel agent to send you a new one.');
}

function otpState(otp: InvitationOtp, now = Date.now()): InvitationOtpState {
  const windowActive = now - otp.sendWindowStartedAt < OTP_SEND_WINDOW_MS;
  const sends = windowActive ? otp.sends : 0;
  const remainingSends = Math.max(0, OTP_MAX_SENDS_PER_WINDOW - sends);
  const cooldownEnds = otp.codeSentAt ? otp.codeSentAt + OTP_RESEND_COOLDOWN_MS : null;
  const resendAvailableAt = remainingSends === 0 ? otp.sendWindowStartedAt + OTP_SEND_WINDOW_MS : cooldownEnds;
  const codeActive = Boolean(otp.codeHash && otp.codeExpiresAt && otp.codeExpiresAt > now);
  return {
    codeSentAt: codeActive && otp.codeSentAt ? iso(otp.codeSentAt) : null,
    codeExpiresAt: codeActive && otp.codeExpiresAt ? iso(otp.codeExpiresAt) : null,
    resendAvailableAt: resendAvailableAt && resendAvailableAt > now ? iso(resendAvailableAt) : null,
    remainingSends,
    remainingAttempts: codeActive ? Math.max(0, OTP_MAX_ATTEMPTS - otp.attempts) : OTP_MAX_ATTEMPTS,
  };
}

function scopedKey(baseId: string, bookingRecordId: string, customerRecordId: string, key: string): string {
  return createHash('sha256').update(`${baseId}|${bookingRecordId}|${customerRecordId}|${key}`).digest('hex');
}

export function invitationTtlMs(): number {
  const days = Number(process.env.VISION_INVITATION_TTL_DAYS);
  return (Number.isInteger(days) && days >= 1 && days <= 90 ? days : 30) * 86_400_000;
}

function duplicateWindowMs(): number {
  const seconds = Number(process.env.VISION_INVITATION_DUPLICATE_WINDOW_SECONDS);
  return (Number.isInteger(seconds) && seconds >= 0 && seconds <= 86_400 ? seconds : 600) * 1000;
}

function assertDevelopment(): void {
  if (process.env.NODE_ENV === 'production') throw new NotFoundException();
}

type DevConfig = { ok: true; baseId: string; bookingRecordId: string; customerRecordId: string } | { ok: false; message: string };

export function devConfig(): DevConfig {
  const baseId = process.env.VISION_DEV_BASE_ID?.trim() ?? '';
  const bookingRecordId = process.env.VISION_DEV_BOOKING_RECORD_ID?.trim() ?? '';
  const customerRecordId = process.env.VISION_DEV_CUSTOMER_RECORD_ID?.trim() ?? '';
  if (!baseId && !bookingRecordId && !customerRecordId) return { ok: false, message: 'Set VISION_DEV_BASE_ID, VISION_DEV_BOOKING_RECORD_ID and VISION_DEV_CUSTOMER_RECORD_ID in apps/api/.env to enable the development test trip.' };
  const problems = [
    !AIRTABLE_BASE_ID_PATTERN.test(baseId) && 'VISION_DEV_BASE_ID must look like appXXXXXXXXXXXXXX',
    !AIRTABLE_RECORD_ID_PATTERN.test(bookingRecordId) && 'VISION_DEV_BOOKING_RECORD_ID must look like recXXXXXXXXXXXXXX',
    !AIRTABLE_RECORD_ID_PATTERN.test(customerRecordId) && 'VISION_DEV_CUSTOMER_RECORD_ID must look like recXXXXXXXXXXXXXX',
  ].filter((problem): problem is string => Boolean(problem));
  if (problems.length) return { ok: false, message: `Development test trip misconfigured: ${problems.join('; ')}.` };
  return { ok: true, baseId, bookingRecordId, customerRecordId };
}

function scopeLabel(scope: InvitationScope): string { return scope === 'fellow_traveller' ? 'fellow traveller' : 'primary customer'; }
function iso(epochMs: number): string { return new Date(epochMs).toISOString(); }
function errorName(error: unknown): string { return error instanceof Error ? error.name : 'UnknownError'; }
