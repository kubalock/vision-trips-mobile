import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CustomerMessageRequest, CustomerMessageResponse, FellowTravellerLinkResponse, LinkExchangeResponse, MobileSession, PaymentLinkResponse, QuotationAcceptanceRequest, QuotationAcceptanceResponse, TripSnapshot } from '@vision-trips/contracts';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VisionApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3000/v1';

  exchangeLink(linkOrCode: string, deviceTrustToken?: string | null): Promise<LinkExchangeResponse> {
    return firstValueFrom(
      this.http.post<LinkExchangeResponse>(`${this.baseUrl}/link-exchanges`, { linkOrCode, deviceTrustToken }),
    );
  }

  exchangeLocalTrip(baseId: string, recordId: string): Promise<LinkExchangeResponse> {
    return firstValueFrom(
      this.http.post<LinkExchangeResponse>(`${this.baseUrl}/link-exchanges/local`, { baseId, recordId }),
    );
  }

  verifyPostcode(exchangeId: string, postcode: string, rememberDevice: boolean): Promise<LinkExchangeResponse> {
    return firstValueFrom(
      this.http.post<LinkExchangeResponse>(`${this.baseUrl}/link-exchanges/${exchangeId}/verify/knowledge`, { postcode, rememberDevice }),
    );
  }

  sendOtp(exchangeId: string): Promise<import('@vision-trips/contracts').LinkExchangeChallenge> {
    return firstValueFrom(this.http.post<import('@vision-trips/contracts').LinkExchangeChallenge>(`${this.baseUrl}/link-exchanges/${exchangeId}/otp/send`, {}));
  }

  verifyOtp(exchangeId: string, code: string, rememberDevice: boolean): Promise<LinkExchangeResponse> {
    return firstValueFrom(this.http.post<LinkExchangeResponse>(`${this.baseUrl}/link-exchanges/${exchangeId}/verify/otp`, { code, rememberDevice }));
  }

  downloadCalendar(accessToken: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.baseUrl}/trips/current/calendar.ics`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'blob',
    }));
  }

  downloadDocument(action: string, accessToken: string): Promise<Blob> {
    return firstValueFrom(this.http.get(`${this.baseUrl}/trips/current/documents/${encodeURIComponent(action)}.pdf`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'blob',
    }));
  }

  acceptQuotation(input: QuotationAcceptanceRequest, accessToken: string): Promise<QuotationAcceptanceResponse> {
    return firstValueFrom(this.http.post<QuotationAcceptanceResponse>(`${this.baseUrl}/trips/current/quotation-acceptance`, input, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  }

  sendMessage(input: CustomerMessageRequest, accessToken: string): Promise<CustomerMessageResponse> {
    return firstValueFrom(this.http.post<CustomerMessageResponse>(`${this.baseUrl}/trips/current/messages`, input, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  }

  refreshTrip(accessToken: string): Promise<TripSnapshot> {
    return firstValueFrom(this.http.get<TripSnapshot>(`${this.baseUrl}/trips/current`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  }

  paymentLink(paymentId: string, accessToken: string): Promise<PaymentLinkResponse> {
    return firstValueFrom(this.http.post<PaymentLinkResponse>(`${this.baseUrl}/trips/current/payments/${encodeURIComponent(paymentId)}/link`, {}, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  }

  refreshSession(refreshToken: string): Promise<MobileSession> {
    return firstValueFrom(this.http.post<MobileSession>(`${this.baseUrl}/sessions/refresh`, { refreshToken }));
  }

  fellowTravellerLink(accessToken: string): Promise<FellowTravellerLinkResponse> {
    return firstValueFrom(this.http.post<FellowTravellerLinkResponse>(`${this.baseUrl}/trips/current/fellow-traveller-link`, {}, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }));
  }
}
