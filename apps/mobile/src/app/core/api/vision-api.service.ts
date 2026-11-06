import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { LinkExchangeResponse } from '@vision-trips/contracts';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VisionApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:3000/v1';

  exchangeLink(linkOrCode: string): Promise<LinkExchangeResponse> {
    return firstValueFrom(
      this.http.post<LinkExchangeResponse>(`${this.baseUrl}/link-exchanges`, { linkOrCode }),
    );
  }
}
