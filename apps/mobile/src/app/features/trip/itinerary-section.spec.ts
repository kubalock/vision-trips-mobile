import { TestBed } from '@angular/core/testing';
import type { ItineraryItem } from '@vision-trips/contracts';
import { calendarDate, formatEuropeanDate } from '../../shared/european-date.pipe';
import { ItinerarySection } from './itinerary-section';

const item = (id: string, startDate: string | null, extra: Partial<ItineraryItem> = {}): ItineraryItem => ({
  id, startDate, startTime: null, typeLabel: 'Hotel', title: `Item ${id}`, images: [], details: [], rooms: [], cabins: [], passengers: [], cruisePorts: [],
  from: null, to: null, carrier: null, flightNumber: null, address: null, supplier: null, reference: null, emergencyContact: null, notes: null, ...extra,
} as unknown as ItineraryItem);

function grouped(items: ItineraryItem[]) {
  const fixture = TestBed.createComponent(ItinerarySection);
  fixture.componentRef.setInput('items', items);
  return fixture.componentInstance.days();
}

/** One item per day for `days` days from 1 March 2027. */
function longTrip(days: number, extra: Partial<ItineraryItem> = {}): ItineraryItem[] {
  return Array.from({ length: days }, (_, index) => item(`d${index}`, new Date(Date.UTC(2027, 2, 1 + index)).toISOString().slice(0, 10), extra));
}

function render(items: ItineraryItem[]) {
  const fixture = TestBed.createComponent(ItinerarySection);
  fixture.componentRef.setInput('items', items);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const buttons = () => [...element.querySelectorAll<HTMLButtonElement>('.vt-days__more')];
  return { fixture, element, buttons, dayLabels: () => [...element.querySelectorAll('.vt-day__n')].map((node) => node.textContent?.trim()) };
}

describe('ItinerarySection dates', () => {
  it('labels real dates and numbers the days', () => {
    const groups = grouped([item('a', '2027-03-01'), item('b', '2027-03-03')]);
    expect(groups.map((group) => [group.dayLabel, group.dateLabel])).toEqual([['Day 1', 'Monday 1 March'], ['Day 3', 'Wednesday 3 March']]);
  });

  it('puts impossible dates under "Date to be confirmed" instead of throwing', () => {
    const groups = grouped([item('a', '2027-03-01'), item('b', '2026-99-99'), item('c', null)]);
    expect(groups.map((group) => [group.dayLabel, group.dateLabel, group.items.map((entry) => entry.item.id)])).toEqual([
      ['Day 1', 'Monday 1 March', ['a']],
      ['Trip plan', 'Date to be confirmed', ['b', 'c']],
    ]);
  });

  it('groups once per itinerary rather than on every change-detection pass', () => {
    const fixture = TestBed.createComponent(ItinerarySection);
    fixture.componentRef.setInput('items', longTrip(3));
    const first = fixture.componentInstance.days();
    fixture.detectChanges(); fixture.detectChanges();
    expect(fixture.componentInstance.days()).toBe(first);
  });
});

describe('ItinerarySection long trips', () => {
  afterEach(() => vi.useRealTimers());

  it('renders 20 days at first and adds 20 more on request', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T12:00:00'));
    const view = render(longTrip(170));

    expect(view.dayLabels()).toHaveLength(20);
    expect(view.buttons().map((button) => button.textContent?.trim())).toEqual(['Show next 20 days 150 more in this trip']);

    view.buttons()[0].click(); view.fixture.detectChanges();
    expect(view.dayLabels()).toHaveLength(40);
    expect(view.dayLabels().at(-1)).toBe('Day 40');
  });

  it('opens at today while the trip is under way, with earlier days one tap away', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-06-08T09:00:00')); // Day 100.
    const view = render(longTrip(170));

    expect(view.dayLabels()[0]).toBe('Day 100');
    expect(view.dayLabels()).toHaveLength(20);
    expect(view.buttons()[0].textContent).toContain('Show earlier days');

    view.buttons()[0].click(); view.fixture.detectChanges();
    expect(view.dayLabels()[0]).toBe('Day 80');
    expect(view.dayLabels().at(-1)).toBe('Day 119');
  });

  it('starts again from the top when another trip is shown', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-11T12:00:00'));
    const view = render(longTrip(170));
    view.buttons()[0].click(); view.fixture.detectChanges();

    view.fixture.componentRef.setInput('items', longTrip(60)); view.fixture.detectChanges();
    expect(view.dayLabels()).toHaveLength(20);
  });

  it('builds cruise ports and passenger lists only when their disclosure is opened', () => {
    const ports = Array.from({ length: 120 }, (_, index) => ({ day: String(index + 1), port: `Port ${index}`, arrivalTime: null, departureTime: null, description: null }));
    const passengers = [{ name: 'Alex', bookingReference: null, travelClass: 'Economy', seat: '12A', cabinBaggage: null, checkedBaggage: null, extras: null, meal: null, assistance: null }];
    const view = render([item('cruise', '2027-03-01', { cruisePorts: ports, passengers } as Partial<ItineraryItem>)]);
    const [passengerDetails, portDetails] = [...view.element.querySelectorAll('details')];

    expect(view.element.querySelectorAll('.vt-cruise-timeline li')).toHaveLength(0);
    expect(view.element.querySelector('.vt-passenger-list')).toBeNull();
    expect(portDetails.querySelector('summary')?.textContent).toContain('120 stops');

    portDetails.open = true; portDetails.dispatchEvent(new Event('toggle')); view.fixture.detectChanges();
    passengerDetails.open = true; passengerDetails.dispatchEvent(new Event('toggle')); view.fixture.detectChanges();

    expect(view.element.querySelectorAll('.vt-cruise-timeline li')).toHaveLength(120);
    expect(view.element.querySelector('.vt-passenger-list')?.textContent).toContain('Economy · Seat 12A');
  });
});

describe('calendarDate', () => {
  it('rejects dates that roll over', () => {
    expect(calendarDate('2026-02-30')).toBeNull();
    expect(calendarDate('2026-99-99')).toBeNull();
    expect(calendarDate('2028-02-29')?.getDate()).toBe(29);
  });

  it('keeps the pipe from showing a rolled-over date', () => {
    expect(formatEuropeanDate('2026-02-30')).toBe('2026-02-30');
    expect(formatEuropeanDate('2026-02-28')).toBe('28/02/2026');
  });
});
