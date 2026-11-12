import { ForbiddenException } from '@nestjs/common';
import type { SessionAssurance } from '@vision-trips/contracts';
import type { SessionPrincipal } from '../sessions/sessions.service.js';

/** Sessions that proved control of the customer's email (now, or earlier on this trusted device). */
const VERIFIED: ReadonlySet<SessionAssurance> = new Set(['otp', 'trusted_device']);

export function isVerified(principal: Pick<SessionPrincipal, 'assurance'>): boolean {
  return VERIFIED.has(principal.assurance);
}

/**
 * Quotation acceptance, payments, account preferences and sharing need an email-verified (or trusted-device)
 * session. A session opened from a legacy link or a share link is refused with `verification_required`, which the
 * app answers by asking for a code (POST /v1/link-exchanges/step-up).
 */
export function requireVerified(principal: Pick<SessionPrincipal, 'assurance'>): void {
  if (isVerified(principal)) return;
  throw new ForbiddenException({
    statusCode: 403,
    code: 'verification_required',
    message: 'For your security, confirm it’s you with a code sent to your email before continuing.',
  });
}
