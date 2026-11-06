import { resolveStage } from './stage.js';

describe('resolveStage', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');

  it.each([
    ['Quotation', '2027-03-01', '2027-03-12', '2026-11-10', 'quote'],
    ['Quotation', '2027-03-01', '2027-03-12', '2026-10-10', 'quote_expired'],
    ['Confirmed', '2027-03-01', '2027-03-12', null, 'countdown'],
    ['Confirmed', '2026-11-09', '2026-11-20', null, 'prep'],
    ['Confirmed', '2026-11-03', '2026-11-20', null, 'departure'],
    ['Confirmed', '2026-10-30', '2026-11-20', null, 'travelling'],
    ['Confirmed', '2026-10-10', '2026-10-25', null, 'home'],
    ['Closed Quotation', null, null, null, 'closed'],
    ['Cancelled', null, null, null, 'cancelled'],
  ])('matches PHP stage rules for %s', (status, departure, returns, quoteExpiry, expected) => {
    expect(resolveStage(status, departure, returns, quoteExpiry, now)).toBe(expected);
  });
});
