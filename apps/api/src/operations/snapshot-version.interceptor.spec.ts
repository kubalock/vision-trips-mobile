import { describe, expect, it } from 'vitest';
import { downgradeSnapshots } from './snapshot-version.interceptor.js';

describe('snapshot version negotiation', () => {
  it('labels v4 snapshots 3 for clients that have not opted in, top-level or nested', () => {
    expect(downgradeSnapshots({ schemaVersion: 4, tripId: 'trp_1', loyalty: null })).toEqual({ schemaVersion: 3, tripId: 'trp_1', loyalty: null });
    expect(downgradeSnapshots({ status: 'authorized', snapshot: { schemaVersion: 4, tripId: 'trp_1' } })).toMatchObject({ snapshot: { schemaVersion: 3 } });
    expect(downgradeSnapshots({ sent: true })).toEqual({ sent: true });
  });
});
