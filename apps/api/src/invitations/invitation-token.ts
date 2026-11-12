import { ServiceUnavailableException } from '@nestjs/common';
import { INVITATION_TOKEN_PATTERN } from '@vision-trips/contracts';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 24 bytes = 192 bits of CSPRNG output. */
export const INVITATION_TOKEN_BYTES = 24;

export function generateInvitationToken(): string {
  return `vt_${randomBytes(INVITATION_TOKEN_BYTES).toString('base64url')}`;
}

/** The only form in which an invitation token is ever stored. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && INVITATION_TOKEN_PATTERN.test(value);
}

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Codes are hashed with a server secret and bound to their invitation, so a leaked database row cannot be reversed by
 * trying all one million codes offline, and a code for one invitation never matches another.
 */
export function hashOtpCode(invitationId: string, code: string): string {
  return createHmac('sha256', otpSecret()).update(`vision-invitation-otp:${invitationId}:${code}`).digest('hex');
}

export function otpMatches(invitationId: string, candidate: string, storedHash: string): boolean {
  const supplied = Buffer.from(hashOtpCode(invitationId, candidate), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/** `https://<VISION_TRIP_LINK_BASE_URL>/vt_<token>`; production refuses to fall back to localhost. */
export function invitationUrl(token: string): string {
  const configured = process.env.VISION_TRIP_LINK_BASE_URL?.trim();
  if (!configured && process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Customer invitations are not configured.');
  const base = (configured || 'http://localhost:4200/trip').replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production' && !base.startsWith('https://')) throw new ServiceUnavailableException('Customer invitations are not configured.');
  return `${base}/${token}`;
}

export function maskEmail(email: string): string | null {
  const [name, domain] = email.split('@');
  return name && domain ? `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}` : null;
}

function otpSecret(): string {
  const secret = process.env.VISION_OTP_SECRET?.trim() || process.env.VISION_LINK_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Email verification is not configured.');
  return 'local-development-only';
}
