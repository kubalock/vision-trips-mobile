import * as z from 'zod/mini';

/**
 * Customer App invitations.
 *
 * An agent (or an Airtable automation) creates an invitation for one Customer on one Booking. The customer receives an
 * opaque link, `https://<host>/trip/vt_<token>`, opens it, proves they own the Customer's email address with a six-digit
 * code, and only then receives a session. The link carries no Airtable identifiers, emails or booking references; the
 * server stores only a SHA-256 hash of the token.
 */

/** `vt_` followed by 24 random bytes (192 bits) in base64url. */
export const INVITATION_TOKEN_PATTERN = /^vt_[A-Za-z0-9_-]{32}$/;
export const AIRTABLE_BASE_ID_PATTERN = /^app[A-Za-z0-9]{14}$/;
export const AIRTABLE_RECORD_ID_PATTERN = /^rec[A-Za-z0-9]{14}$/;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;
export const OTP_CODE_LENGTH = 6;

const isoDateTime = z.string().check(z.refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO date-time.'));
const trimmed = (pattern: RegExp, message: string) => z.string().check(z.trim(), z.regex(pattern, message));
const count = () => z.number().check(z.int(), z.nonnegative());
const httpUrl = () => z.string().check(z.refine((value) => { try { return /^https?:$/.test(new URL(value).protocol); } catch { return false; } }, 'Expected a URL.'));

export const invitationScopeSchema = z.enum(['primary_customer', 'fellow_traveller']);
export type InvitationScope = z.infer<typeof invitationScopeSchema>;

/** How strongly a session was established. Only `otp` and `trusted_device` may perform sensitive actions. */
export const sessionAssuranceSchema = z.enum(['otp', 'trusted_device', 'link', 'legacy']);
export type SessionAssurance = z.infer<typeof sessionAssuranceSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Agent / automation API: POST /v1/customer-invitations (X-Vision-Key)
// ---------------------------------------------------------------------------------------------------------------

export const createCustomerInvitationRequestSchema = z.object({
  baseId: trimmed(AIRTABLE_BASE_ID_PATTERN, 'baseId must be an Airtable base ID.'),
  bookingRecordId: trimmed(AIRTABLE_RECORD_ID_PATTERN, 'bookingRecordId must be an Airtable record ID.'),
  customerRecordId: trimmed(AIRTABLE_RECORD_ID_PATTERN, 'customerRecordId must be an Airtable record ID.'),
  scope: z._default(invitationScopeSchema, 'primary_customer'),
  sendEmail: z._default(z.boolean(), true),
  idempotencyKey: z.optional(trimmed(IDEMPOTENCY_KEY_PATTERN, 'idempotencyKey must be 8–120 letters, digits or . _ : -')),
});
export type CreateCustomerInvitationRequest = z.input<typeof createCustomerInvitationRequestSchema>;
export type ParsedCreateCustomerInvitationRequest = z.output<typeof createCustomerInvitationRequestSchema>;

export const createCustomerInvitationResponseSchema = z.object({
  /** Opaque reference for support and audit. It cannot open the trip. */
  invitationId: z.string().check(z.minLength(8)),
  /** `created`: new link, no email; `sent`: new link emailed; `duplicate`: an earlier identical request already did the work. */
  status: z.enum(['created', 'sent', 'duplicate']),
  /** The customer-facing link. Null for a duplicate, because only the token's hash is stored. */
  url: z.nullable(httpUrl()),
  scope: invitationScopeSchema,
  expiresAt: isoDateTime,
  emailSent: z.boolean(),
  sentAt: z.nullable(isoDateTime),
  destinationHint: z.nullable(z.string()),
  duplicate: z.boolean(),
  /** False when the Booking audit comment could not be written (the invitation itself is still valid). */
  auditRecorded: z.boolean(),
});
export type CreateCustomerInvitationResponse = z.infer<typeof createCustomerInvitationResponseSchema>;

export const revokeCustomerInvitationRequestSchema = z.object({
  baseId: trimmed(AIRTABLE_BASE_ID_PATTERN, 'baseId must be an Airtable base ID.'),
  bookingRecordId: trimmed(AIRTABLE_RECORD_ID_PATTERN, 'bookingRecordId must be an Airtable record ID.'),
  customerRecordId: z.optional(trimmed(AIRTABLE_RECORD_ID_PATTERN, 'customerRecordId must be an Airtable record ID.')),
});
export type RevokeCustomerInvitationRequest = z.input<typeof revokeCustomerInvitationRequestSchema>;
export const revokeCustomerInvitationResponseSchema = z.object({ revoked: count() });
export type RevokeCustomerInvitationResponse = z.infer<typeof revokeCustomerInvitationResponseSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Customer API: /v1/link-exchanges/invitations/* (unauthenticated; the token is the only input)
// ---------------------------------------------------------------------------------------------------------------

export const invitationTokenSchema = trimmed(INVITATION_TOKEN_PATTERN, 'This link is not valid.');
const deviceTrustTokensSchema = z._default(z.array(z.string().check(z.maxLength(4096))).check(z.maxLength(25)), []);

export const resolveInvitationRequestSchema = z.object({ token: invitationTokenSchema, deviceTrustTokens: deviceTrustTokensSchema });
export const sendInvitationCodeRequestSchema = z.object({ token: invitationTokenSchema });
export const verifyInvitationCodeRequestSchema = z.object({
  token: invitationTokenSchema,
  /** Pasted codes may contain spaces or dashes; only the digits count. */
  code: z.pipe(z.pipe(z.string().check(z.maxLength(32)), z.transform((value: string) => value.replace(/\D/g, ''))), z.string().check(z.length(OTP_CODE_LENGTH, 'Enter the six-digit code.'))),
  rememberDevice: z._default(z.boolean(), false),
});
export const openInvitationRequestSchema = z.object({ token: invitationTokenSchema, deviceTrustTokens: deviceTrustTokensSchema });

export type ResolveInvitationRequest = z.input<typeof resolveInvitationRequestSchema>;
export type SendInvitationCodeRequest = z.input<typeof sendInvitationCodeRequestSchema>;
export type VerifyInvitationCodeRequest = z.input<typeof verifyInvitationCodeRequestSchema>;
export type OpenInvitationRequest = z.input<typeof openInvitationRequestSchema>;

export const invitationOtpStateSchema = z.object({
  codeSentAt: z.nullable(isoDateTime),
  codeExpiresAt: z.nullable(isoDateTime),
  resendAvailableAt: z.nullable(isoDateTime),
  remainingSends: count(),
  remainingAttempts: count(),
});
export type InvitationOtpState = z.infer<typeof invitationOtpStateSchema>;

/** What the welcome screen may show before verification: no itinerary, payments, travellers or booking details. */
export const invitationStateSchema = z.object({
  status: z.literal('pending'),
  brand: z.object({
    name: z.string().check(z.minLength(1), z.maxLength(200)),
    logoUrl: z.nullable(httpUrl()),
    primaryColor: z.nullable(z.string().check(z.regex(/^#[0-9A-Fa-f]{6}$/))),
  }),
  scope: invitationScopeSchema,
  /** `none` only for fellow-traveller share links created by a verified lead customer. */
  verification: z.enum(['email_otp', 'none']),
  destinationHint: z.nullable(z.string()),
  expiresAt: isoDateTime,
  /** This device already verified this customer for this booking, so no code is needed. */
  trustedDevice: z.boolean(),
  otp: invitationOtpStateSchema,
});
export type InvitationState = z.infer<typeof invitationStateSchema>;

export const mobileSessionSchema = z.object({
  accessToken: z.string().check(z.minLength(1)),
  accessExpiresAt: isoDateTime,
  refreshToken: z.string().check(z.minLength(1)),
  refreshExpiresAt: isoDateTime,
  identityKey: z.optional(z.string().check(z.regex(/^idk_[A-Za-z0-9_-]{22}$/))),
});

/** The trip snapshot is validated separately by the client's full TripSnapshot schema. */
export const invitationAuthorizedResponseSchema = z.object({
  status: z.literal('authorized'),
  snapshot: z.record(z.string(), z.unknown()),
  session: mobileSessionSchema,
  trustedDeviceToken: z.optional(z.string()),
});

export const invitationErrorCodes = [
  'invitation_invalid', 'invitation_expired', 'invitation_revoked', 'invitation_consumed',
  'code_invalid', 'code_expired', 'code_not_sent', 'attempts_exhausted', 'send_limit', 'resend_cooldown',
  'verification_in_progress', 'verification_required', 'delivery_failed', 'customer_unavailable',
  /** A newer invitation for the same Booking, Customer and access level replaced this one. */
  'invitation_replaced',
  /** The invited Customer's email address changed after the invitation was created; a new invitation is needed. */
  'destination_changed',
] as const;
export const invitationErrorCodeSchema = z.enum(invitationErrorCodes);
export type InvitationErrorCode = z.infer<typeof invitationErrorCodeSchema>;

/** Error body for every invitation endpoint. Messages are safe to show to customers. */
export const invitationErrorSchema = z.object({
  statusCode: z.number().check(z.int()),
  code: invitationErrorCodeSchema,
  message: z.string(),
  retryAfterSeconds: z.optional(count()),
  remainingAttempts: z.optional(count()),
});
export type InvitationError = z.infer<typeof invitationErrorSchema>;

/** A legacy signed customer link now only locates the booking: the app must continue with this invitation. */
export const invitationRequiredLinkExchangeSchema = z.object({
  status: z.literal('invitation_required'),
  invitationToken: invitationTokenSchema,
});

/** Step-up for a session that may not perform sensitive actions yet (POST /v1/link-exchanges/step-up). */
export const stepUpResponseSchema = z.object({ invitationToken: invitationTokenSchema });
export type StepUpResponse = z.infer<typeof stepUpResponseSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Local development only: /v1/link-exchanges/dev-invitation (404 when NODE_ENV=production)
// ---------------------------------------------------------------------------------------------------------------

export const devInvitationStatusSchema = z.object({
  available: z.boolean(),
  /** A developer-facing configuration hint; never shown in production because the endpoint does not exist there. */
  message: z.nullable(z.string()),
});
export type DevInvitationStatus = z.infer<typeof devInvitationStatusSchema>;
export const devInvitationResponseSchema = z.object({ invitationToken: invitationTokenSchema });
export type DevInvitationResponse = z.infer<typeof devInvitationResponseSchema>;
