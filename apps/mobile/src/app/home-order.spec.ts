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

  it('tucks the message button away while scrolling down and brings it back on scroll up', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { trip: { set: (value: unknown) => void } };
    const element = fixture.nativeElement as HTMLElement;
    app.trip.set(parseTripSnapshot({ schemaVersion: 4, tripId: 'trp_1', stage: 'confirmed', accessScope: 'primary_customer', summary: { name: 'Prague', reference: 'R' } }));
    fixture.detectChanges();
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
    const scrollTo = (y: number) => { Object.defineProperty(window, 'scrollY', { configurable: true, value: y }); window.dispatchEvent(new Event('scroll')); fixture.detectChanges(); return element.querySelector('.vt-message-fab')!.classList.contains('is-tucked'); };
    expect(scrollTo(600)).toBe(true);
    expect(scrollTo(400)).toBe(false);
    expect(scrollTo(4990)).toBe(false); // At the end of the page nothing is left for it to cover.
    expect(scrollTo(0)).toBe(false);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    delete (document.documentElement as unknown as Record<string, unknown>)['scrollHeight'];
  });

  it('says "Departs tomorrow" rather than "1 days until departure"', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const app = fixture.componentInstance as unknown as { trip: { set: (value: unknown) => void } };
    const element = fixture.nativeElement as HTMLElement;
    const countdown = (days: number, stage = 'confirmed') => {
      app.trip.set(parseTripSnapshot({ schemaVersion: 4, tripId: 'trp_1', stage, accessScope: 'primary_customer', summary: { name: 'Prague', reference: 'R', departureDate: '2030-01-01' }, timeline: { daysUntilDeparture: days, nextItemTitle: 'Flight' } }));
      fixture.detectChanges();
      return element.querySelector('.vt-home-up-next__countdown')?.textContent?.trim();
    };
    expect(countdown(1)).toBe('Departs tomorrow');
    expect(countdown(5)).toBe('5 days until departure');
    // Beside the "Until you leave" card a whole-day count would disagree with it, so only "Departs tomorrow" stays.
    expect(countdown(5, 'countdown')).toBeUndefined();
    expect(countdown(1, 'countdown')).toBe('Departs tomorrow');
  });
});

