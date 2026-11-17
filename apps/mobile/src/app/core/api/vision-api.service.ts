import { HttpClient, HttpEventType, type HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { WalkthroughResponse, CallbackRequest, CallbackResponse, TravellerProfilesResponse, TravellerProfileUpdate, TravellerProfileUpdateResponse, CustomerAccount, CustomerEngagementRequest, CustomerEngagementResponse, CustomerMessageRequest, CustomerMessageResponse, CustomerPreferences, DevInvitationStatus, ExternalTripContent, FellowTravellerLinkResponse, InvitationAuthorized, InvitationOtpState, InvitationState, LinkExchangeResponse, MobileSession, OpenCustomerAccountTripResponse, OpenRelatedQuotationResponse, PaymentLinkResponse, PaymentStatusResponse, QuotationAcceptanceContext, QuotationAcceptanceRequest, QuotationAcceptanceResponse, RelatedQuotationsResponse, TripSnapshot, UpdateCustomerPreferencesResponse } from '@vision-trips/contracts';
import { walkthroughResponseSchema, callbackResponseSchema, travellerProfilesResponseSchema, travellerProfileUpdateResponseSchema, authorizedLinkExchangeSchema, customerAccountSchema, customerEngagementResponseSchema, customerMessageResponseSchema, devInvitationResponseSchema, devInvitationStatusSchema, fellowTravellerLinkResponseSchema, invitationAuthorizedResponseSchema, invitationOtpStateSchema, invitationRequiredLinkExchangeSchema, invitationStateSchema, mobileSessionSchema, paymentLinkResponseSchema, paymentStatusResponseSchema, quotationAcceptanceContextSchema, quotationAcceptanceResponseSchema, relatedQuotationsResponseSchema, stepUpResponseSchema, tripSessionResponseSchema, updateCustomerPreferencesResponseSchema } from '@vision-trips/contracts';
import { filter, firstValueFrom, map } from 'rxjs';
import { API_BASE_URL } from '../config/api-base-url';
import { isTripDataError, parseExternalContent, parseTripSnapshot } from './trip-schema';

/** Largest document the app downloads and keeps (the API applies the same limit to supplier documents). */
export const MAX_DOCUMENT_BYTES = 20_000_000;

/** An API response that doesn't match its schema: rejected before it reaches application state. */
export class ResponseFormatError extends Error {
  override readonly name = 'ResponseFormatError';
  constructor(readonly endpoint: string, cause?: unknown) { super(`Unexpected response from ${endpoint}.`, { cause }); }
}

export function isResponseFormatError(error: unknown): error is ResponseFormatError { return error instanceof ResponseFormatError; }

export class DocumentTooLargeError extends Error {
  override readonly name = 'DocumentTooLargeError';
  constructor() { super('The document is larger than the app can download.'); }
}

@Injectable({ providedIn: 'root' })
export class VisionApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** Any trip link: invitations come back as `invitation_required`; legacy signed customer links too (they now need an email code). */
  exchangeLink(linkOrCode: string): Promise<LinkExchangeResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/link-exchanges`, { linkOrCode }, this.writeOptions())), parseLinkExchange, 'link exchange');
  }

  // --- Invitations: the token travels in the body, never in a URL. Every response is checked at runtime. ---------

  /** Welcome-screen details for an invitation link. Never signs anyone in. */
  resolveInvitation(token: string, deviceTrustTokens: string[] = []): Promise<InvitationState> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/link-exchanges/invitations/resolve`, { token, deviceTrustTokens })), (value) => invitationStateSchema.parse(value));
  }

  sendInvitationCode(token: string): Promise<InvitationOtpState> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/link-exchanges/invitations/code`, { token })), (value) => invitationOtpStateSchema.parse(value));
  }

  verifyInvitationCode(token: string, code: string, rememberDevice: boolean): Promise<InvitationAuthorized> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/link-exchanges/invitations/verify`, { token, code, rememberDevice })), parseAuthorized);
  }

  /** Share links (no code) and invitations on a device already trusted for this customer. */
  openInvitation(token: string, deviceTrustTokens: string[] = []): Promise<InvitationAuthorized> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/link-exchanges/invitations/open`, { token, deviceTrustTokens })), parseAuthorized);
  }

  /** Asks for an email code before a sensitive action, for a session that was not verified by email. */
  stepUp(accessToken: string): Promise<string> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/link-exchanges/step-up`, {}, { headers: { Authorization: `Bearer ${accessToken}` } })), (value) => stepUpResponseSchema.parse(value).invitationToken);
  }

  /** Local development only: the API answers 404 in production. */
  devInvitationStatus(): Promise<DevInvitationStatus> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/link-exchanges/dev-invitation`)), (value) => devInvitationStatusSchema.parse(value));
  }

  /** Local development only: an invitation for the server's VISION_DEV_* booking. No identifiers reach the app. */
  createDevInvitation(): Promise<string> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/link-exchanges/dev-invitation`, {})), (value) => devInvitationResponseSchema.parse(value).invitationToken);
  }

  downloadCalendar(accessToken: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.baseUrl}/trips/current/calendar.ics`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'blob',
    }));
  }

  /**
   * Downloads a document, refusing it as soon as it is known to exceed MAX_DOCUMENT_BYTES: from the declared size
   * when the headers arrive, or from the running byte count. Unsubscribing aborts the request.
   */
  downloadDocument(action: string, accessToken: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.baseUrl}/trips/current/documents/${encodeURIComponent(action)}.pdf`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'blob', observe: 'events', reportProgress: true,
    }).pipe(
      map((event) => {
        const declared = event.type === HttpEventType.ResponseHeader || event.type === HttpEventType.Response ? Number(event.headers.get('content-length') ?? NaN) : NaN;
        const loaded = event.type === HttpEventType.DownloadProgress ? event.loaded : event.type === HttpEventType.Response ? event.body?.size ?? 0 : 0;
        if (declared > MAX_DOCUMENT_BYTES || loaded > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError();
        return event;
      }),
      filter((event): event is HttpResponse<Blob> => event.type === HttpEventType.Response),
      map((response) => response.body ?? new Blob()),
    ));
  }

  acceptQuotation(input: QuotationAcceptanceRequest, accessToken: string, operationId: string): Promise<QuotationAcceptanceResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/quotation-acceptance`, input, this.writeOptions(accessToken, operationId))), (value) => quotationAcceptanceResponseSchema.parse(value), 'quotation acceptance');
  }

  /** The masked verified email shown on the acceptance form (the customer is never asked for it again). */
  quotationAcceptanceContext(accessToken: string): Promise<QuotationAcceptanceContext> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current/quotation-acceptance`, this.readOptions(accessToken))), (value) => quotationAcceptanceContextSchema.parse(value), 'quotation acceptance');
  }

  /** A fresh walkthrough URL, fetched just before playback (stored Airtable URLs expire). */
  walkthrough(accessToken: string): Promise<WalkthroughResponse> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current/walkthrough`, this.readOptions(accessToken))), (value) => walkthroughResponseSchema.parse(value), 'walkthrough');
  }

  requestCallback(input: CallbackRequest, accessToken: string, operationId: string): Promise<CallbackResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/callback`, input, this.writeOptions(accessToken, operationId))), (value) => callbackResponseSchema.parse(value), 'callback');
  }

  travellerProfiles(accessToken: string): Promise<TravellerProfilesResponse> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current/account/travellers`, this.readOptions(accessToken))), (value) => travellerProfilesResponseSchema.parse(value), 'traveller details');
  }

  updateTravellerProfile(travellerId: string, update: TravellerProfileUpdate, accessToken: string, operationId: string): Promise<TravellerProfileUpdateResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/account/travellers/${encodeURIComponent(travellerId)}`, update, this.writeOptions(accessToken, operationId))), (value) => travellerProfileUpdateResponseSchema.parse(value), 'traveller details');
  }

  sendMessage(input: CustomerMessageRequest, accessToken: string, operationId: string): Promise<CustomerMessageResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/messages`, input, this.writeOptions(accessToken, operationId))), (value) => customerMessageResponseSchema.parse(value), 'messages');
  }

  refreshTrip(accessToken: string): Promise<TripSnapshot> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })), parseTripSnapshot);
  }

  paymentStatus(accessToken: string): Promise<PaymentStatusResponse> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current/payment-status`, this.readOptions(accessToken))), (value) => paymentStatusResponseSchema.parse(value), 'payment status');
  }

  externalContent(accessToken: string): Promise<ExternalTripContent> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current/external-content`, { headers: { Authorization: `Bearer ${accessToken}` } })), parseExternalContent);
  }

  engagement(input: CustomerEngagementRequest, accessToken: string, operationId: string): Promise<CustomerEngagementResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/engagement`, input, this.writeOptions(accessToken, operationId))), (value) => customerEngagementResponseSchema.parse(value), 'engagement');
  }

  relatedQuotations(accessToken: string): Promise<RelatedQuotationsResponse> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current/related-quotations`, this.readOptions(accessToken))), (value) => relatedQuotationsResponseSchema.parse(value), 'related quotations');
  }

  openRelatedQuotation(comparisonId: string, accessToken: string): Promise<OpenRelatedQuotationResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/related-quotations/${encodeURIComponent(comparisonId)}/open`, {}, this.writeOptions(accessToken))), parseTripSession, 'related quotation');
  }

  customerAccount(accessToken: string): Promise<CustomerAccount> { return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current/account`, this.readOptions(accessToken))), (value) => customerAccountSchema.parse(value), 'account'); }
  updateCustomerPreferences(preferences: CustomerPreferences, accessToken: string, operationId: string): Promise<UpdateCustomerPreferencesResponse> { return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/account/preferences`, preferences, this.writeOptions(accessToken, operationId))), (value) => updateCustomerPreferencesResponseSchema.parse(value), 'account preferences'); }
  openCustomerAccountTrip(accountTripId: string, accessToken: string): Promise<OpenCustomerAccountTripResponse> { return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/account/trips/${encodeURIComponent(accountTripId)}/open`, {}, this.writeOptions(accessToken))), parseTripSession, 'account trip'); }
  /**
   * Browsers: clears the HttpOnly trusted-device cookies — only that identity's when `identityKey` is given, otherwise
   * all of them (the installed app clears its secure storage instead).
   */
  forgetDeviceTrust(identityKey?: string): Promise<void> { return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/link-exchanges/device-trust`, { body: identityKey ? { identityKey } : {}, ...this.writeOptions() })); }
  revokeSession(refreshToken: string): Promise<void> { return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/sessions/current`, { body: { refreshToken }, ...this.writeOptions() })); }

  paymentLink(paymentId: string, accessToken: string, operationId: string): Promise<PaymentLinkResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/payments/${encodeURIComponent(paymentId)}/link`, {}, this.writeOptions(accessToken, operationId))), (value) => paymentLinkResponseSchema.parse(value), 'payment link');
  }

  customPaymentLink(amount: number, accessToken: string, operationId: string): Promise<PaymentLinkResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/payments/custom/link`, { amount }, this.writeOptions(accessToken, operationId))), (value) => paymentLinkResponseSchema.parse(value), 'payment link');
  }

  refreshSession(refreshToken: string): Promise<MobileSession> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/sessions/refresh`, { refreshToken }, this.writeOptions())), (value) => mobileSessionSchema.parse(value), 'session refresh');
  }

  fellowTravellerLink(accessToken: string): Promise<FellowTravellerLinkResponse> {
    return parsed(firstValueFrom(this.http.post<unknown>(`${this.baseUrl}/trips/current/fellow-traveller-link`, {}, this.writeOptions(accessToken))), (value) => fellowTravellerLinkResponseSchema.parse(value), 'share link');
  }

  private readOptions(accessToken: string): { headers: Record<string, string> } {
    return { headers: { Authorization: `Bearer ${accessToken}` } };
  }

  /**
   * `operationId` (the `Idempotency-Key`) is made by the caller once per operation, so every attempt of it, including
   * the retry after a token renewal, sends the same key (see OperationKeys). Only the routes the API replays take one.
   */
  private writeOptions(accessToken?: string, operationId?: string): { headers: Record<string, string> } {
    return { headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(operationId ? { 'Idempotency-Key': operationId } : {}) } };
  }
}

/**
 * Runs a response through its runtime schema: the generic on HttpClient is only a compile-time cast. A body that
 * doesn't match becomes a ResponseFormatError (trip data keeps its own TripDataError, which says what went wrong).
 */
async function parsed<T>(response: Promise<unknown>, parse: (value: unknown) => T, endpoint = 'the API'): Promise<T> {
  const value = await response;
  try {
    return parse(value);
  } catch (error) {
    if (isTripDataError(error)) throw error;
    throw new ResponseFormatError(endpoint, error);
  }
}

/** An authorised link exchange (its trip checked too), or the invitation it asks for. */
function parseLinkExchange(value: unknown): LinkExchangeResponse {
  if (value && typeof value === 'object' && (value as { status?: unknown }).status === 'invitation_required') return invitationRequiredLinkExchangeSchema.parse(value);
  const result = authorizedLinkExchangeSchema.parse(value);
  return { ...result, snapshot: parseTripSnapshot(result.snapshot) };
}

function parseTripSession(value: unknown): { snapshot: TripSnapshot; session: MobileSession } {
  const result = tripSessionResponseSchema.parse(value);
  return { snapshot: parseTripSnapshot(result.snapshot), session: result.session };
}

function parseAuthorized(value: unknown): InvitationAuthorized {
  const result = invitationAuthorizedResponseSchema.parse(value);
  return { ...result, snapshot: parseTripSnapshot(result.snapshot) };
}

