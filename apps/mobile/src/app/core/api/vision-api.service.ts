import { HttpClient, HttpEventType, type HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CustomerAccount, CustomerEngagementRequest, CustomerEngagementResponse, CustomerMessageRequest, CustomerMessageResponse, CustomerPreferences, DevInvitationStatus, ExternalTripContent, FellowTravellerLinkResponse, InvitationAuthorized, InvitationOtpState, InvitationState, LinkExchangeResponse, MobileSession, OpenCustomerAccountTripResponse, OpenRelatedQuotationResponse, PaymentLinkResponse, PaymentStatusResponse, QuotationAcceptanceRequest, QuotationAcceptanceResponse, RelatedQuotationsResponse, TripSnapshot, UpdateCustomerPreferencesResponse } from '@vision-trips/contracts';
import { devInvitationResponseSchema, devInvitationStatusSchema, invitationAuthorizedResponseSchema, invitationOtpStateSchema, invitationRequiredLinkExchangeSchema, invitationStateSchema, stepUpResponseSchema } from '@vision-trips/contracts';
import { filter, firstValueFrom, map } from 'rxjs';
import { API_BASE_URL } from '../config/api-base-url';
import { parseExternalContent, parseTripSnapshot } from './trip-schema';

/** Largest document the app downloads and keeps (the API applies the same limit to supplier documents). */
export const MAX_DOCUMENT_BYTES = 20_000_000;

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
    return this.exchange(firstValueFrom(
      this.http.post<LinkExchangeResponse>(`${this.baseUrl}/link-exchanges`, { linkOrCode }, this.writeOptions()),
    ));
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

  acceptQuotation(input: QuotationAcceptanceRequest, accessToken: string): Promise<QuotationAcceptanceResponse> {
    return firstValueFrom(this.http.post<QuotationAcceptanceResponse>(`${this.baseUrl}/trips/current/quotation-acceptance`, input, {
      ...this.writeOptions(accessToken),
    }));
  }

  sendMessage(input: CustomerMessageRequest, accessToken: string): Promise<CustomerMessageResponse> {
    return firstValueFrom(this.http.post<CustomerMessageResponse>(`${this.baseUrl}/trips/current/messages`, input, {
      ...this.writeOptions(accessToken),
    }));
  }

  refreshTrip(accessToken: string): Promise<TripSnapshot> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })), parseTripSnapshot);
  }

  paymentStatus(accessToken: string): Promise<PaymentStatusResponse> {
    return firstValueFrom(this.http.get<PaymentStatusResponse>(`${this.baseUrl}/trips/current/payment-status`, { headers: { Authorization: `Bearer ${accessToken}` } }));
  }

  externalContent(accessToken: string): Promise<ExternalTripContent> {
    return parsed(firstValueFrom(this.http.get<unknown>(`${this.baseUrl}/trips/current/external-content`, { headers: { Authorization: `Bearer ${accessToken}` } })), parseExternalContent);
  }

  engagement(input: CustomerEngagementRequest, accessToken: string): Promise<CustomerEngagementResponse> {
    return firstValueFrom(this.http.post<CustomerEngagementResponse>(`${this.baseUrl}/trips/current/engagement`, input, this.writeOptions(accessToken)));
  }

  relatedQuotations(accessToken: string): Promise<RelatedQuotationsResponse> {
    return firstValueFrom(this.http.get<RelatedQuotationsResponse>(`${this.baseUrl}/trips/current/related-quotations`, { headers: { Authorization: `Bearer ${accessToken}` } }));
  }

  openRelatedQuotation(comparisonId: string, accessToken: string): Promise<OpenRelatedQuotationResponse> {
    return withParsedSnapshot(firstValueFrom(this.http.post<OpenRelatedQuotationResponse>(`${this.baseUrl}/trips/current/related-quotations/${encodeURIComponent(comparisonId)}/open`, {}, this.writeOptions(accessToken))));
  }

  customerAccount(accessToken: string): Promise<CustomerAccount> { return firstValueFrom(this.http.get<CustomerAccount>(`${this.baseUrl}/trips/current/account`, { headers: { Authorization: `Bearer ${accessToken}` } })); }
  updateCustomerPreferences(preferences: CustomerPreferences, accessToken: string): Promise<UpdateCustomerPreferencesResponse> { return firstValueFrom(this.http.post<UpdateCustomerPreferencesResponse>(`${this.baseUrl}/trips/current/account/preferences`, preferences, this.writeOptions(accessToken))); }
  openCustomerAccountTrip(accountTripId: string, accessToken: string): Promise<OpenCustomerAccountTripResponse> { return withParsedSnapshot(firstValueFrom(this.http.post<OpenCustomerAccountTripResponse>(`${this.baseUrl}/trips/current/account/trips/${encodeURIComponent(accountTripId)}/open`, {}, this.writeOptions(accessToken)))); }
  /**
   * Browsers: clears the HttpOnly trusted-device cookies — only that identity's when `identityKey` is given, otherwise
   * all of them (the installed app clears its secure storage instead).
   */
  forgetDeviceTrust(identityKey?: string): Promise<void> { return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/link-exchanges/device-trust`, { body: identityKey ? { identityKey } : {}, ...this.writeOptions() })); }
  revokeSession(refreshToken: string): Promise<void> { return firstValueFrom(this.http.delete<void>(`${this.baseUrl}/sessions/current`, { body: { refreshToken }, ...this.writeOptions() })); }

  paymentLink(paymentId: string, accessToken: string): Promise<PaymentLinkResponse> {
    return firstValueFrom(this.http.post<PaymentLinkResponse>(`${this.baseUrl}/trips/current/payments/${encodeURIComponent(paymentId)}/link`, {}, {
      ...this.writeOptions(accessToken),
    }));
  }

  customPaymentLink(amount: number, accessToken: string): Promise<PaymentLinkResponse> {
    return firstValueFrom(this.http.post<PaymentLinkResponse>(`${this.baseUrl}/trips/current/payments/custom/link`, { amount }, this.writeOptions(accessToken)));
  }

  refreshSession(refreshToken: string): Promise<MobileSession> {
    return firstValueFrom(this.http.post<MobileSession>(`${this.baseUrl}/sessions/refresh`, { refreshToken }, this.writeOptions()));
  }

  fellowTravellerLink(accessToken: string): Promise<FellowTravellerLinkResponse> {
    return firstValueFrom(this.http.post<FellowTravellerLinkResponse>(`${this.baseUrl}/trips/current/fellow-traveller-link`, {}, {
      ...this.writeOptions(accessToken),
    }));
  }

  /** Checks the trip in an authorised link exchange (or the invitation it asks for) before the app uses it. */
  private async exchange(response: Promise<LinkExchangeResponse>): Promise<LinkExchangeResponse> {
    const result = await response;
    if (result.status === 'invitation_required') return invitationRequiredLinkExchangeSchema.parse(result);
    return { ...result, snapshot: parseTripSnapshot(result.snapshot) };
  }

  private writeOptions(accessToken?: string): { headers: Record<string, string> } {
    return { headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), 'Idempotency-Key': crypto.randomUUID() } };
  }
}

/** Runs a response through its runtime schema: the generic on HttpClient is only a compile-time cast. */
async function parsed<T>(response: Promise<unknown>, parse: (value: unknown) => T): Promise<T> {
  return parse(await response);
}

function parseAuthorized(value: unknown): InvitationAuthorized {
  const result = invitationAuthorizedResponseSchema.parse(value);
  return { ...result, snapshot: parseTripSnapshot(result.snapshot) };
}

async function withParsedSnapshot<T extends { snapshot: TripSnapshot }>(response: Promise<T>): Promise<T> {
  const result = await response;
  return { ...result, snapshot: parseTripSnapshot(result.snapshot) };
}
