import { TestBed } from '@angular/core/testing';
import type { ItineraryItem } from '@vision-trips/contracts';
import { calendarDate, formatEuropeanDate } from '../../shared/european-date.pipe';
import { ItinerarySection } from './itinerary-section';

const item = (id: string, startDate: string | null): ItineraryItem => ({ id, startDate, startTime: null } as unknown as ItineraryItem);

function grouped(items: ItineraryItem[]) {
  const fixture = TestBed.createComponent(ItinerarySection);
  fixture.componentRef.setInput('items', items);
  return fixture.componentInstance.groupedItems();
}

describe('ItinerarySection dates', () => {
  it('labels real dates and numbers the days', () => {
    const groups = grouped([item('a', '2027-03-01'), item('b', '2027-03-03')]);
    expect(groups.map((group) => [group.dayLabel, group.dateLabel])).toEqual([['Day 1', 'Monday 1 March'], ['Day 3', 'Wednesday 3 March']]);
  });

  it('puts impossible dates under "Date to be confirmed" instead of throwing', () => {
    const groups = grouped([item('a', '2027-03-01'), item('b', '2026-99-99'), item('c', null)]);
    expect(groups.map((group) => [group.dayLabel, group.dateLabel, group.items.map((entry) => entry.id)])).toEqual([
      ['Day 1', 'Monday 1 March', ['a']],
      ['Trip plan', 'Date to be confirmed', ['b', 'c']],
    ]);
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
