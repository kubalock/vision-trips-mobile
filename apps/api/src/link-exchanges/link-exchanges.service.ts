import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { LinkExchangeChallenge, LinkExchangeResponse } from '@vision-trips/contracts';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DeviceTrustService } from '../security/device-trust.service.js';
import { LinkTokenService } from '../security/link-token.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { TripsService } from '../trips/trips.service.js';
import { OtpDeliveryService } from './otp-delivery.service.js';

interface PendingExchange { baseId: string; recordId: string; fellowTraveller: boolean; postcode: string; email: string; forceOtp: boolean; expiresAt: number; otpHash: string | null; otpExpiresAt: number; attempts: number; postcodeAttempts?: number; sends: number; lastSentAt: number }

@Injectable()
export class LinkExchangesService {
  constructor(private readonly tokens: LinkTokenService, private readonly trips: TripsService, private readonly sessions: SessionsService, private readonly trust: DeviceTrustService, private readonly delivery: OtpDeliveryService, private readonly store: DurableAuthStore) {}

  async create(linkOrCode: unknown, deviceTrustTokens: unknown[] = []): Promise<LinkExchangeResponse> {
    if (typeof linkOrCode !== 'string' || linkOrCode.trim().length < 16) throw new BadRequestException('Enter a valid itinerary link.');
    const token = this.tokens.parseLinkOrToken(linkOrCode);
    if (token.scope === 'agent') throw new BadRequestException('Agent links cannot be saved in the customer app.');
    const exchangeId = randomUUID();
    if (deviceTrustTokens.slice(0, 20).some((trusted) => this.trust.valid(trusted, token.baseId, token.recordId))) return this.authorize(exchangeId, token.baseId, token.recordId, token.fellowTraveller, false);
    const profile = await this.trips.verificationProfile(token.baseId, token.recordId);
    if (token.legacy || profile.forceOtp) {
      if (profile.forceOtp && !profile.email) throw new ConflictException('Email verification is required, but this booking has no customer email address. Contact your travel agent.');
      const pending: PendingExchange = { baseId: token.baseId, recordId: token.recordId, fellowTraveller: token.fellowTraveller, postcode: profile.postcode, email: profile.email, forceOtp: profile.forceOtp, expiresAt: Date.now() + 600_000, otpHash: null, otpExpiresAt: 0, attempts: 0, sends: 0, lastSentAt: 0 };
      if (profile.forceOtp) await this.sendOtpInternal(pending);
      this.store.putChallenge(exchangeId, pending, pending.expiresAt);
      return { status: 'verification_required', challenge: this.challenge(exchangeId, pending) };
    }
    return this.authorize(exchangeId, token.baseId, token.recordId, token.fellowTraveller, false);
  }

  async createLocal(baseId: unknown, recordId: unknown): Promise<LinkExchangeResponse> {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException('Not found.');
    if (typeof baseId !== 'string' || !/^app[A-Za-z0-9]{14}$/.test(baseId.trim())) throw new BadRequestException('Enter a valid Airtable base ID.');
    if (typeof recordId !== 'string' || !/^rec[A-Za-z0-9]{14}$/.test(recordId.trim())) throw new BadRequestException('Enter a valid Airtable booking record ID.');
    return this.authorize(randomUUID(), baseId.trim(), recordId.trim(), false, false);
  }

  async sendOtp(exchangeId: string): Promise<LinkExchangeChallenge> {
    const pending = this.getPending(exchangeId);
    if (!pending.email) throw new BadRequestException('This booking does not have an email address for verification.');
    if (pending.sends >= 3) throw rateLimited('The maximum number of codes has been sent. Start again later.');
    if (Date.now() - pending.lastSentAt < 60_000) throw rateLimited('Please wait before requesting another code.');
    await this.sendOtpInternal(pending);
    this.store.putChallenge(exchangeId, pending, pending.expiresAt);
    return this.challenge(exchangeId, pending);
  }

  async verifyOtp(exchangeId: string, code: unknown, rememberDevice: unknown): Promise<LinkExchangeResponse> {
    const pending = this.getPending(exchangeId);
    if (!pending.otpHash || pending.otpExpiresAt < Date.now()) throw new UnauthorizedException('This code has expired. Request a new code.');
    if (pending.attempts >= 5) throw rateLimited('Too many incorrect attempts. Start verification again.');
    pending.attempts += 1;
    const candidate = hashCode(typeof code === 'string' ? code.replace(/\D/g, '') : '');
    if (!timingSafeEqual(Buffer.from(candidate), Buffer.from(pending.otpHash))) {
      this.store.putChallenge(exchangeId, pending, pending.expiresAt);
      throw new UnauthorizedException(`That code was not correct. ${5 - pending.attempts} attempts remain.`);
    }
    this.store.deleteChallenge(exchangeId);
    return this.authorize(exchangeId, pending.baseId, pending.recordId, pending.fellowTraveller, rememberDevice === true);
  }

  async verifyPostcode(exchangeId: string, postcode: unknown, rememberDevice?: unknown): Promise<LinkExchangeResponse> {
    const pending = this.getPending(exchangeId);
    if (pending.forceOtp) throw new BadRequestException('This booking requires email verification; postcode fallback is not permitted.');
    // Limit guesses per verification attempt and per booking, so starting a new verification doesn't reset the count.
    const bookingBucket = `postcode-failures:${pending.baseId}:${pending.recordId}`;
    if (this.store.rateLimitExhausted(bookingBucket, POSTCODE_FAILURES_PER_BOOKING, POSTCODE_FAILURE_WINDOW_MS)) {
      throw rateLimited('Too many incorrect postcodes for this booking. Try again later or use the email code.');
    }
    if ((pending.postcodeAttempts ?? 0) >= POSTCODE_ATTEMPTS_PER_EXCHANGE) {
      throw rateLimited('Too many incorrect postcodes. Open your trip link again to start over.');
    }
    if (!pending.postcode || typeof postcode !== 'string' || normalizePostcode(postcode) !== normalizePostcode(pending.postcode)) {
      pending.postcodeAttempts = (pending.postcodeAttempts ?? 0) + 1;
      this.store.putChallenge(exchangeId, pending, pending.expiresAt);
      this.store.consumeRateLimit(bookingBucket, POSTCODE_FAILURES_PER_BOOKING, POSTCODE_FAILURE_WINDOW_MS);
      const remaining = POSTCODE_ATTEMPTS_PER_EXCHANGE - pending.postcodeAttempts;
      throw new UnauthorizedException(remaining > 0 ? `That postcode didn't match the booking. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left.` : 'That postcode didn\'t match the booking.');
    }
    this.store.deleteChallenge(exchangeId);
    return this.authorize(exchangeId, pending.baseId, pending.recordId, pending.fellowTraveller, rememberDevice === true);
  }

  private getPending(exchangeId: string): PendingExchange {
    const pending = this.store.challenge<PendingExchange>(exchangeId);
    if (!pending || pending.expiresAt < Date.now()) { this.store.deleteChallenge(exchangeId); throw new NotFoundException('This verification request has expired.'); }
    return pending;
  }

  private async sendOtpInternal(pending: PendingExchange): Promise<void> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.delivery.send(pending.email, code);
    pending.otpHash = hashCode(code); pending.otpExpiresAt = Date.now() + 600_000; pending.attempts = 0; pending.sends += 1; pending.lastSentAt = Date.now();
  }

  private challenge(exchangeId: string, pending: PendingExchange): LinkExchangeChallenge {
    const methods: Array<'postcode' | 'otp'> = [];
    if (pending.postcode && !pending.forceOtp) methods.push('postcode');
    if (pending.email) methods.push('otp');
    return { exchangeId, brandName: 'Vision Trips', tripHint: 'Verify your identity to open this trip', methods, expiresAt: new Date(pending.expiresAt).toISOString(), destinationHint: maskEmail(pending.email), resendAvailableAt: pending.lastSentAt ? new Date(pending.lastSentAt + 60_000).toISOString() : null, remainingSends: 3 - pending.sends };
  }

  private async authorize(exchangeId: string, baseId: string, recordId: string, fellowTraveller: boolean, remember: boolean): Promise<LinkExchangeResponse> {
    const snapshot = await this.trips.snapshot(baseId, recordId, fellowTraveller ? 'fellow_traveller' : 'primary_customer');
    const session = this.sessions.issue({ baseId, recordId, fellowTraveller });
    return { status: 'authorized', exchangeId, expiresAt: new Date(Date.now() + 600_000).toISOString(), snapshot, session, ...(remember ? { trustedDeviceToken: this.trust.issue(baseId, recordId) } : {}) };
  }
}

function normalizePostcode(value: string): string { return value.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function hashCode(value: string): string { return createHash('sha256').update(`vision-otp:${value}`).digest('hex'); }
function maskEmail(email: string): string | null { const [name, domain] = email.split('@'); return name && domain ? `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}` : null; }
const POSTCODE_ATTEMPTS_PER_EXCHANGE = 5;
const POSTCODE_FAILURES_PER_BOOKING = 10;
const POSTCODE_FAILURE_WINDOW_MS = 60 * 60_000;

function rateLimited(message: string): HttpException { return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS); }
