import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';
import { VisionApiService } from './core/api/vision-api.service';
import { parseTripSnapshot } from './core/api/trip-schema';

/** Home tells the story in order: what you get and the price, then Accept, then the trip, then everything optional. */
describe('Home order', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const api = TestBed.inject(VisionApiService);
    vi.spyOn(api, 'externalContent').mockReturnValue(new Promise(() => undefined));
  });
  afterEach(() => vi.restoreAllMocks());

  it('puts what’s included and the price before Accept, and the booking journey, extras and FAQs after it', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { trip: { set: (value: unknown) => void } };
    app.trip.set(parseTripSnapshot({
      schemaVersion: 4, tripId: 'trp_1', stage: 'quote', accessScope: 'primary_customer', summary: { name: 'Prague', reference: 'R', totalTravellers: 2 },
      quotation: { status: 'available', canAccept: true },
      payments: { currency: 'GBP', total: 2000, perPerson: 1000, paid: 0, balance: 2000, items: [], customPayments: { enabled: false, minimum: 0, maximum: 0 } },
      content: { included: [{ text: 'Flights' }], notIncluded: [], includedSource: 'quotation', walkthrough: null, videoMessage: null },
      bookingJourney: { steps: [{ id: 'confirmation', title: 'Confirmation', description: 'We confirm.', status: 'current', date: null }], suggestedExtras: [{ id: 'experiences', title: 'Spa', description: 'Relax', enquiry: 'Spa please' }], faqs: [{ id: 'f', question: 'When?', answer: 'Soon.' }] },
    }));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const order = ['.vt-inclusions', '.vt-accept-card', '.vt-booking-journey-card', '.vt-tailor-section', '.vt-faq-card']
      .map((selector) => { const found = element.querySelector(selector); expect(found, selector).not.toBeNull(); return found!; });
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(element.querySelector('.vt-accept-card__price')?.textContent).toContain('£2,000.00');
    expect(element.querySelector('.vt-accept-card__price')?.textContent).toContain('£1,000.00 per person');
  });

  it('shows the floating Message button on a booked trip but not on a quotation, which has its own Message card', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { trip: { set: (value: unknown) => void } };
    const element = fixture.nativeElement as HTMLElement;
    const show = (stage: string) => { app.trip.set(parseTripSnapshot({ schemaVersion: 4, tripId: 'trp_1', stage, accessScope: 'primary_customer', summary: { name: 'Prague', reference: 'R' } })); fixture.detectChanges(); return element.querySelector('.vt-message-fab'); };
    expect(show('quote')).toBeNull();
    expect(show('confirmed')).not.toBeNull();
  });

  it('says "Departs tomorrow" rather than "1 days until departure"', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { trip: { set: (value: unknown) => void } };
    const element = fixture.nativeElement as HTMLElement;
    const countdown = (days: number) => {
      app.trip.set(parseTripSnapshot({ schemaVersion: 4, tripId: 'trp_1', stage: 'countdown', accessScope: 'primary_customer', summary: { name: 'Prague', reference: 'R' }, timeline: { daysUntilDeparture: days, nextItemTitle: 'Flight' } }));
      fixture.detectChanges();
      return element.querySelector('.vt-home-up-next__countdown')?.textContent?.trim();
    };
    expect(countdown(1)).toBe('Departs tomorrow');
    expect(countdown(5)).toBe('5 days until departure');
  });
});

