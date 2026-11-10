import { describe, expect, it } from 'vitest';
import { formatEuropeanDate } from './european-date.pipe';

describe('formatEuropeanDate', () => {
  it('formats ISO dates in day/month/year order', () => {
    expect(formatEuropeanDate('2026-11-10')).toBe('10/11/2026');
  });

  it('formats date-times with a 24-hour time', () => {
    expect(formatEuropeanDate('2026-11-10T09:05:00', 'dateTime')).toBe('10/11/2026, 09:05');
  });

  it('leaves unrecognised display values unchanged', () => {
    expect(formatEuropeanDate('To be confirmed')).toBe('To be confirmed');
  });
});
