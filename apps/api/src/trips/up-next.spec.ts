import type { ItineraryItem } from '@vision-trips/contracts';
import { mapTimeline } from './trips.service.js';

const item = (id: string, startDate: string, startTime: string | null) => ({ id, title: id, startDate, startTime }) as unknown as ItineraryItem;

describe('mapTimeline (Up next)', () => {
  const now = new Date('2026-11-01T09:00:00');

  it('puts a timed flight before the untimed hotel stay that starts the same day', () => {
    const timeline = mapTimeline([item('Hotel in Prague', '2026-11-20', null), item('Flight LHR to PRG', '2026-11-20', '10:20')], '2026-11-20', now);
    expect(timeline.nextItemTitle).toBe('Flight LHR to PRG');
    expect(timeline.nextItemTime).toBe('10:20');
  });

  it('still picks an untimed item on an earlier day, and orders timed items by time', () => {
    expect(mapTimeline([item('Flight', '2026-11-21', '06:00'), item('Transfer', '2026-11-20', null)], null, now).nextItemTitle).toBe('Transfer');
    expect(mapTimeline([item('Dinner', '2026-11-20', '19:00'), item('Tour', '2026-11-20', '09:30')], null, now).nextItemTitle).toBe('Tour');
  });
});
