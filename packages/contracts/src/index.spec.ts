import { describe, expect, it } from 'vitest';
import { tripStages } from './index.js';

describe('tripStages', () => {
  it('keeps the legacy journey states as stable API values', () => {
    expect(tripStages).toEqual([
      'quote',
      'quote_expired',
      'closed',
      'cancelled',
      'confirmed',
      'countdown',
      'prep',
      'departure',
      'travelling',
      'returning',
      'home',
      'past',
    ]);
  });
});
