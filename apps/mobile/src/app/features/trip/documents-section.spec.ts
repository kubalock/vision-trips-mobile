import { TestBed } from '@angular/core/testing';
import type { TripDocument } from '@vision-trips/contracts';
import { DocumentsSection } from './documents-section';

const doc = (title: string, description: string, mimeType = 'application/pdf'): TripDocument => ({ id: title, title, description, mimeType } as unknown as TripDocument);

describe('DocumentsSection wording', () => {
  const section = () => TestBed.createComponent(DocumentsSection).componentInstance;

  it('drops a trailing file type from the title, since the badge already shows it', () => {
    expect(section().displayTitle(doc('Your quotation (PDF)', ''))).toBe('Your quotation');
    expect(section().displayTitle(doc('Quotation (Letter)', ''))).toBe('Quotation (Letter)');
  });

  it('hides a description that only repeats the title', () => {
    expect(section().showDescription(doc('Quotation (Letter)', 'Your Quotation'))).toBe(false);
    expect(section().showDescription(doc('Safe Seat Plan guarantee', 'Travel Trust Association financial guarantee certificate'))).toBe(true);
    expect(section().showDescription(doc('Booking Confirmation (Letter)', ''))).toBe(false);
  });
});
