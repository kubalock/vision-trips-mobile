import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { OperationKeys } from './operation-keys';
import { VisionApiService } from './vision-api.service';

describe('OperationKeys', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));

  it('keeps one key for an operation whose attempt went unanswered, and forgets it on success', async () => {
    const keys = TestBed.inject(OperationKeys);
    const seen: string[] = [];
    await expect(keys.run('accept:trp_1', { name: 'Grace' }, async (key) => { seen.push(key); throw new HttpErrorResponse({ status: 0 }); })).rejects.toBeTruthy();
    await keys.run('accept:trp_1', { name: 'Grace' }, async (key) => { seen.push(key); return 'ok'; });
    await keys.run('accept:trp_1', { name: 'Grace' }, async (key) => { seen.push(key); return 'ok'; });
    expect(seen[1]).toBe(seen[0]); // The retry may get the reply the server stored for the first attempt.
    expect(seen[2]).not.toBe(seen[0]); // A new acceptance after a success is a new operation.
  });

  it('starts again after a clear refusal or with different details', async () => {
    const keys = TestBed.inject(OperationKeys);
    const seen: string[] = [];
    await expect(keys.run('pay:trp_1', 10, async (key) => { seen.push(key); throw new HttpErrorResponse({ status: 422 }); })).rejects.toBeTruthy();
    await expect(keys.run('pay:trp_1', 10, async (key) => { seen.push(key); throw new HttpErrorResponse({ status: 503 }); })).rejects.toBeTruthy();
    await keys.run('pay:trp_1', 20, async (key) => { seen.push(key); return 'ok'; });
    expect(new Set(seen).size).toBe(3);
  });

  it('asks again with the same key while the server is still running the first attempt, and keeps the key if it still is', async () => {
    const keys = TestBed.inject(OperationKeys);
    keys.retryDelaysMs = [0, 0];
    const inProgress = () => new HttpErrorResponse({ status: 409, error: { code: 'idempotency_in_progress' } });
    const seen: string[] = [];
    let answers = 0;
    await expect(keys.run('accept:trp_1', 'Grace', async (key) => { seen.push(key); if (++answers < 3) throw inProgress(); return 'stored'; })).resolves.toBe('stored');
    expect(new Set(seen).size).toBe(1);

    seen.length = 0;
    await expect(keys.run('accept:trp_2', 'Grace', async (key) => { seen.push(key); throw inProgress(); })).rejects.toMatchObject({ status: 409 });
    await keys.run('accept:trp_2', 'Grace', async (key) => { seen.push(key); return 'stored'; });
    expect(seen).toHaveLength(4); // Three tries, then the traveller's own retry...
    expect(new Set(seen).size).toBe(1); // ...all with the one key, so the operation never runs twice.
  });

  it('still forgets the key after any other 409 (a key reused for a different request)', async () => {
    const keys = TestBed.inject(OperationKeys);
    const seen: string[] = [];
    await expect(keys.run('pay:trp_1', 10, async (key) => { seen.push(key); throw new HttpErrorResponse({ status: 409, error: { message: 'different request' } }); })).rejects.toBeTruthy();
    await keys.run('pay:trp_1', 10, async (key) => { seen.push(key); return 'ok'; });
    expect(seen[1]).not.toBe(seen[0]);
  });
});

describe('Idempotency-Key headers', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));

  it('sends the caller’s key on replayable writes and none on session refresh', () => {
    const api = TestBed.inject(VisionApiService);
    const http = TestBed.inject(HttpTestingController);
    void api.paymentLink('pay_1', 'token', 'op-1234567890').catch(() => undefined);
    void api.paymentLink('pay_1', 'renewed-token', 'op-1234567890').catch(() => undefined);
    void api.refreshSession('refresh').catch(() => undefined);
    const [first, retry] = http.match((request) => request.url.endsWith('/payments/pay_1/link'));
    expect(first.request.headers.get('Idempotency-Key')).toBe('op-1234567890');
    expect(retry.request.headers.get('Idempotency-Key')).toBe('op-1234567890');
    expect(http.expectOne((request) => request.url.endsWith('/sessions/refresh')).request.headers.has('Idempotency-Key')).toBe(false);
  });
});
