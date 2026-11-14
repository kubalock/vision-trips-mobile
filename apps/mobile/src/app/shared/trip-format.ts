import type { TripStage } from '@vision-trips/contracts';
import { formatEuropeanDate } from './european-date.pipe';

/** Customer-facing words for a trip stage, used everywhere a trip's status is shown (My Trips, header, Account). */
export function stageLabel(stage: TripStage): string {
  switch (stage) {
    case 'quote': return 'Quotation';
    case 'quote_expired': return 'Quote expired';
    case 'closed': return 'Closed';
    case 'cancelled': return 'Cancelled';
    case 'departure': return 'Departure day';
    case 'travelling': return 'Travelling';
    case 'returning': return 'Returning home';
    case 'home': return 'Welcome home';
    case 'past': return 'Past trip';
    default: return 'Confirmed';
  }
}

export function isReturnedStage(stage: TripStage): boolean { return stage === 'home' || stage === 'past' || stage === 'closed'; }

/** "06/08/2026" for a day trip, "06/08/2026 — 13/08/2026" otherwise; never the same date twice. */
export function tripDateRange(departure: string | null, returns: string | null, unknown = 'Dates to be confirmed'): string {
  const from = formatEuropeanDate(departure);
  if (!from) return unknown;
  const to = formatEuropeanDate(returns);
  return to && to !== from ? `${from} — ${to}` : from;
}

/** "1 night", "7 nights"; nothing for zero or unknown (a day trip shouldn't say "0 nights"). */
export function nightsText(nights: number | null): string | null {
  return nights && nights > 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : null;
}

export function monthYear(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}/.test(value)) return '';
  const [year, month] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
}
