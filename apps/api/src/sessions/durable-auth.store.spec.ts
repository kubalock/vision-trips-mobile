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
});
