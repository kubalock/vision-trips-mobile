import { describe, expect, it } from 'vitest';
import {
  createCustomerInvitationRequestSchema, createCustomerInvitationResponseSchema, devInvitationStatusSchema, invitationErrorSchema,
  invitationRequiredLinkExchangeSchema, invitationStateSchema, resolveInvitationRequestSchema, verifyInvitationCodeRequestSchema,
} from './index.js';

const token = 'vt_abcdefghijklmnopqrstuvwxyzABCDEF';

describe('invitation contracts', () => {
  it('validates and defaults the agent request', () => {
    expect(createCustomerInvitationRequestSchema.parse({ baseId: ' appABCDEFGHIJKLMN ', bookingRecordId: 'recABCDEFGHIJKLMN', customerRecordId: 'recCUSTOMERAAAAAA' }))
      .toEqual({ baseId: 'appABCDEFGHIJKLMN', bookingRecordId: 'recABCDEFGHIJKLMN', customerRecordId: 'recCUSTOMERAAAAAA', scope: 'primary_customer', sendEmail: true });
    for (const invalid of [
      { baseId: 'base', bookingRecordId: 'recABCDEFGHIJKLMN', customerRecordId: 'recCUSTOMERAAAAAA' },
      { baseId: 'appABCDEFGHIJKLMN', bookingRecordId: 'recABCDEFGHIJKLMN', customerRecordId: 'recCUSTOMERAAAAAA', scope: 'agent' },
      { baseId: 'appABCDEFGHIJKLMN', bookingRecordId: 'recABCDEFGHIJKLMN', customerRecordId: 'recCUSTOMERAAAAAA', idempotencyKey: 'short' },
      { baseId: 'appABCDEFGHIJKLMN', bookingRecordId: 'recABCDEFGHIJKLMN', customerRecordId: 'recCUSTOMERAAAAAA', sendEmail: 'yes' },
    ]) expect(createCustomerInvitationRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('describes a non-sensitive agent response (url may be null for duplicates)', () => {
    const response = { invitationId: 'inv_abcdefgh', status: 'duplicate', url: null, scope: 'primary_customer', expiresAt: '2026-12-12T00:00:00.000Z', emailSent: true, sentAt: null, destinationHint: null, duplicate: true, auditRecorded: true };
    expect(createCustomerInvitationResponseSchema.parse(response)).toEqual(response);
  });

  it('only accepts opaque vt_ tokens from customers', () => {
    expect(resolveInvitationRequestSchema.parse({ token })).toEqual({ token, deviceTrustTokens: [] });
    for (const bad of ['appABCDEFGHIJKLMN', 'vt_short', `${token}x`, 'payload.signature']) expect(resolveInvitationRequestSchema.safeParse({ token: bad }).success).toBe(false);
    expect(invitationRequiredLinkExchangeSchema.safeParse({ status: 'invitation_required', invitationToken: token }).success).toBe(true);
  });

  it('normalises pasted codes to six digits', () => {
    expect(verifyInvitationCodeRequestSchema.parse({ token, code: ' 123-456 ' })).toEqual({ token, code: '123456', rememberDevice: false });
    expect(verifyInvitationCodeRequestSchema.safeParse({ token, code: '12345' }).success).toBe(false);
  });

  it('keeps the welcome screen free of trip details', () => {
    const state = invitationStateSchema.parse({
      status: 'pending', brand: { name: 'Example Travel', logoUrl: null, primaryColor: '#155B75' }, scope: 'primary_customer', verification: 'email_otp',
      destinationHint: 'gr***@example.com', expiresAt: '2026-12-12T00:00:00.000Z', trustedDevice: false,
      otp: { codeSentAt: null, codeExpiresAt: null, resendAvailableAt: null, remainingSends: 5, remainingAttempts: 5 },
      itinerary: ['should be stripped'],
    });
    expect(state).not.toHaveProperty('itinerary');
  });

  it('describes customer-safe errors and the development status', () => {
    expect(invitationErrorSchema.safeParse({ statusCode: 410, code: 'invitation_expired', message: 'Ask for a new one.' }).success).toBe(true);
    expect(invitationErrorSchema.safeParse({ statusCode: 500, code: 'database_exploded', message: 'x' }).success).toBe(false);
    expect(devInvitationStatusSchema.parse({ available: false, message: 'Set VISION_DEV_BASE_ID' })).toMatchObject({ available: false });
  });
});
