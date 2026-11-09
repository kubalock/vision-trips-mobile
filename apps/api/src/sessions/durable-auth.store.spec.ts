import { describe, expect, it } from 'vitest';
import { DurableAuthStore } from './durable-auth.store.js';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

describe('DurableAuthStore', () => {
  it('persists verification challenges between store instances', () => {
    const path = `/tmp/vision-trips-challenge-${randomUUID()}.sqlite`;
    const first = new DurableAuthStore(path);
    first.putChallenge('exchange-1', { attempts: 2, sends: 1 }, Date.now() + 60_000);
    first.onModuleDestroy();

    const second = new DurableAuthStore(path);
    expect(second.challenge('exchange-1')).toEqual({ attempts: 2, sends: 1 });
    second.onModuleDestroy();
    rmSync(path);
  });

  it('removes expired challenges', () => {
    const store = new DurableAuthStore(':memory:');
    store.putChallenge('expired', { value: true }, Date.now() - 1);
    expect(store.challenge('expired')).toBeNull();
    store.onModuleDestroy();
  });

  it('persists rate-limit counters across store instances', () => {
    const path = `/tmp/vision-trips-rate-${randomUUID()}.sqlite`;
    const first = new DurableAuthStore(path);
    expect(first.consumeRateLimit('api:client', 2, 60_000, 1_000).allowed).toBe(true);
    first.onModuleDestroy();
    const second = new DurableAuthStore(path);
    expect(second.consumeRateLimit('api:client', 2, 60_000, 1_001).remaining).toBe(0);
    expect(second.consumeRateLimit('api:client', 2, 60_000, 1_002).allowed).toBe(false);
    second.onModuleDestroy();
    rmSync(path);
  });

  it('persists completed idempotency responses', () => {
    const store = new DurableAuthStore(':memory:');
    expect(store.beginIdempotency('POST:/messages', 'request-123', 'hash-a')).toBe(true);
    store.completeIdempotency('POST:/messages', 'request-123', { sent: true });
    expect(store.idempotency('POST:/messages', 'request-123')).toEqual({ requestHash: 'hash-a', status: 'complete', responseJson: '{"sent":true}' });
    store.onModuleDestroy();
  });

  it('retries durable background jobs without losing their payload', () => {
    const store = new DurableAuthStore(':memory:');
    expect(store.enqueueJob('job-1', 'engagement', { event: 'opened' }, 1)).toBe(true);
    const [claimed] = store.claimJobs('engagement');
    expect(claimed).toEqual({ id: 'job-1', payload: { event: 'opened' }, attempts: 1 });
    store.retryJob('job-1', 'temporary', Date.now() - 1);
    expect(store.claimJobs('engagement')[0]?.attempts).toBe(2);
    store.onModuleDestroy();
  });
});
