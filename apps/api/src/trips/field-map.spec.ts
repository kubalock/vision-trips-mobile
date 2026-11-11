import { describe, expect, it } from 'vitest';
import { dateString } from './field-map.js';

describe('dateString', () => {
  it('keeps real calendar dates, trimming any time part', () => {
    expect(dateString('2026-03-01')).toBe('2026-03-01');
    expect(dateString(['2028-02-29T10:30:00.000Z'])).toBe('2028-02-29');
  });

  it('rejects dates that only look like dates', () => {
    for (const value of ['2026-99-99', '2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-1-1', 'soon', '', null]) {
      expect(dateString(value)).toBeNull();
    }
  });
});
