import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { isResponseFormatError, VisionApiService } from './vision-api.service';
import { customerErrorMessage } from '../../app';

/** Every JSON response is checked at runtime; a malformed one never reaches application state. */
describe('VisionApiService response validation', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));
  const respond = (body: unknown) => TestBed.inject(HttpTestingController).expectOne(() => true).flush(body as never);

  it.each([
    ['payment status', (api: VisionApiService) => api.paymentStatus('token')],
    ['account', (api: VisionApiService) => api.customerAccount('token')],
    ['session refresh', (api: VisionApiService) => api.refreshSession('refresh')],
    ['related quotations', (api: VisionApiService) => api.relatedQuotations('token')],
    ['messages', (api: VisionApiService) => api.sendMessage({ topic: 'other', message: 'Hello there, a question' }, 'token', 'op-messages-1')],
    ['payment link', (api: VisionApiService) => api.paymentLink('pay_1', 'token', 'op-payment-1')],
    ['account trip', (api: VisionApiService) => api.openCustomerAccountTrip('acc_1', 'token')],
  ])('rejects a null %s response with a ResponseFormatError', async (_name, call) => {
    const result = call(TestBed.inject(VisionApiService));
    respond(null);
    const error = await result.catch((reason: unknown) => reason);
    expect(isResponseFormatError(error)).toBe(true);
    expect(customerErrorMessage(error, 'fallback')).toBe('This information is temporarily unavailable. Please try again in a moment.');
  });

  it('returns a valid response, without unknown keys', async () => {
    const result = TestBed.inject(VisionApiService).refreshSession('refresh');
    respond({ accessToken: 'a', accessExpiresAt: '2026-11-15T10:00:00Z', refreshToken: 'r', refreshExpiresAt: '2026-12-15T10:00:00Z', debug: 'x' });
    expect(await result).toEqual({ accessToken: 'a', accessExpiresAt: '2026-11-15T10:00:00Z', refreshToken: 'r', refreshExpiresAt: '2026-12-15T10:00:00Z' });
  });

  it('tells the traveller when only some preference records saved, instead of the generic busy message', () => {
    const partial = new HttpErrorResponse({ status: 503, error: { code: 'preferences_partially_saved', message: 'ignored' } });
    expect(customerErrorMessage(partial, 'fallback')).toBe('Some of your changes were saved, but not all of them. Please save again to finish.');
    expect(customerErrorMessage(new HttpErrorResponse({ status: 503 }), 'fallback')).toBe('Our booking system is busy right now. Please try again in a minute.');
  });
});
