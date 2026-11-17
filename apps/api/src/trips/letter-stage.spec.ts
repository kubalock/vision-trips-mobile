import { letterFitsStage } from './trips.service.js';

describe('letterFitsStage', () => {
  it('offers only quotation and personal letters on a quotation', () => {
    for (const stage of ['quote', 'quote_expired'] as const) {
      expect(letterFitsStage('Quotation', stage)).toBe(true);
      expect(letterFitsStage('A note from Jhy', stage)).toBe(true);
      for (const name of ['Booking Confirmation', 'Amendment Confirmation', 'Cancellation Confirmation', 'Airline Schedule Change']) expect(letterFitsStage(name, stage)).toBe(false);
    }
  });

  it('offers booking letters once booked, and a cancellation letter only on a cancelled booking', () => {
    expect(letterFitsStage('Booking Confirmation', 'confirmed')).toBe(true);
    expect(letterFitsStage('Airline Schedule Change', 'countdown')).toBe(true);
    expect(letterFitsStage('Quotation', 'confirmed')).toBe(false);
    expect(letterFitsStage('Cancellation Confirmation', 'confirmed')).toBe(false);
    expect(letterFitsStage('Cancellation Confirmation', 'cancelled')).toBe(true);
  });
});
