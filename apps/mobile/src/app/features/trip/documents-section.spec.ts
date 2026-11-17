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

describe('DocumentsSection download', () => {
  const ready = (id: string, title: string): TripDocument => ({ id, title, description: '', kind: 'confirmation', url: null, offlineAvailable: true, status: 'ready', downloadAction: id, version: '1', updatedAt: '2026-11-17', mimeType: 'application/pdf' });

  it('downloads only from the labelled button, never from tapping the card', () => {
    const fixture = TestBed.createComponent(DocumentsSection);
    fixture.componentRef.setInput('documents', [ready('quote', 'Your quotation (PDF)'), ready('guarantee', 'Safe Seat Plan guarantee')]);
    fixture.componentRef.setInput('statuses', { guarantee: 'saved' });
    const downloads: string[] = [];
    fixture.componentInstance.download.subscribe((document) => downloads.push(document.id));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const cards = [...element.querySelectorAll<HTMLElement>('.vt-doc-button')];
    expect(cards.every((card) => card.tagName === 'DIV')).toBe(true);
    cards[0]!.querySelector('strong')!.click();
    expect(downloads).toEqual([]);
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('.vt-doc-download')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Download Your quotation', 'Open Safe Seat Plan guarantee']);
    buttons[0]!.click();
    expect(downloads).toEqual(['quote']);
  });
});
