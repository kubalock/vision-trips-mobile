import { TestBed } from '@angular/core/testing';
import type { BookingJourney, RelatedQuotationSummary } from '@vision-trips/contracts';
import { BookingJourneySection } from './booking-journey-section';

const journey: BookingJourney = { steps: [], faqs: [], suggestedExtras: [] };
const quotations: RelatedQuotationSummary[] = [
  {
    comparisonId: 'current', reference: 'VT-100', name: 'Current option', departureDate: null,
    returnDate: null, durationDays: null, total: 0, currency: 'GBP', heroImageUrl: null,
    status: 'available', current: true,
  },
  {
    comparisonId: 'alternative', reference: 'VT-101', name: 'Alternative option', departureDate: '2027-05-12',
    returnDate: null, durationDays: 7, total: 1499, currency: 'GBP', heroImageUrl: null,
    status: 'available', current: false,
  },
];

describe('BookingJourneySection quotation comparison', () => {
  function render(): HTMLElement {
    const fixture = TestBed.createComponent(BookingJourneySection);
    fixture.componentRef.setInput('journey', journey);
    fixture.componentRef.setInput('related', quotations);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders each quotation as a semantic modular card with structured metadata', () => {
    const element = render();
    const cards = element.querySelectorAll<HTMLElement>('.vt-quotation-card');

    expect(cards).toHaveLength(2);
    expect(cards[0].classList.contains('is-current')).toBe(true);
    expect(cards[0].querySelectorAll('dl > div')).toHaveLength(2);
    expect(cards[0].textContent).toContain('To be confirmed');
    expect(cards[0].textContent).toContain('£0');
  });

  it('uses one filled action with a trailing arrow for each non-current option', () => {
    const element = render();
    const actions = element.querySelectorAll<HTMLButtonElement>('.vt-quotation-card__action');

    expect(actions).toHaveLength(1);
    expect(actions[0].textContent).toContain('View');
    expect(actions[0].querySelector('vt-icon')).not.toBeNull();
  });
});

describe('BookingJourneySection quotation layouts', () => {
  const alternatives = (count: number): RelatedQuotationSummary[] => [quotations[0]!, ...Array.from({ length: count }, (_, index) => ({
    ...quotations[1]!, comparisonId: `alt-${index}`, name: `Option ${index}`, nights: 7, perPerson: 749.5,
  }))];
  const render = (related: RelatedQuotationSummary[]) => {
    const fixture = TestBed.createComponent(BookingJourneySection);
    fixture.componentRef.setInput('journey', journey);
    fixture.componentRef.setInput('related', related);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows one alternative side by side, two or three as cards, four or more as compact rows', () => {
    expect(render(alternatives(1)).querySelector('.vt-quotation-grid--pair')).not.toBeNull();
    const three = render(alternatives(3));
    expect(three.querySelectorAll('.vt-quotation-card')).toHaveLength(4);
    expect(three.querySelector('.vt-quotation-grid--pair')).toBeNull();
    const many = render(alternatives(5));
    expect(many.querySelectorAll('.vt-quotation-row')).toHaveLength(6);
    expect(many.querySelector('.vt-quotation-card')).toBeNull();
    expect(many.textContent).toContain('7 nights');
    expect(many.textContent).toContain('£749.50 pp');
    expect(many.querySelectorAll('.vt-quotation-row button')).toHaveLength(5);
    const unpriced = render([quotations[0]!, { ...quotations[1]!, total: null }]);
    expect(unpriced.textContent).toContain('Price to be confirmed');
    expect(unpriced.querySelectorAll('.vt-quotation-card')[1]?.textContent).not.toContain('£0');
  });
});

describe('BookingJourneySection heading', () => {
  const heading = (stage: string | null) => {
    const fixture = TestBed.createComponent(BookingJourneySection);
    fixture.componentRef.setInput('journey', journey);
    fixture.componentRef.setInput('stage', stage);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('#booking-journey-title')?.textContent?.trim();
  };

  it('looks back after the trip and ahead before it', () => {
    expect(heading('past')).toBe('From booking to home');
    expect(heading('home')).toBe('From booking to home');
    expect(heading('countdown')).toBe('What happens next');
    expect(heading(null)).toBe('What happens next');
  });
});
