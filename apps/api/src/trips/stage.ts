import type { TripStage } from '@vision-trips/contracts';

const dayMs = 86_400_000;

export function resolveStage(
  status: string,
  departureValue: string | null,
  returnValue: string | null,
  quoteExpiryValue: string | null,
  now = new Date(),
): TripStage {
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedStatus === 'closed quotation') return 'closed';
  if (normalizedStatus === 'cancelled') return 'cancelled';

  const today = dateOnly(now);
  if (normalizedStatus === 'quotation' || normalizedStatus === '') {
    const expiry = parseDate(quoteExpiryValue);
    return expiry && expiry.getTime() < today.getTime() ? 'quote_expired' : 'quote';
  }

  const departure = parseDate(departureValue);
  if (!departure) return 'confirmed';
  const daysToDeparture = differenceInDays(today, departure);
  if (daysToDeparture > 14) return 'countdown';
  if (daysToDeparture > 0) return 'prep';
  if (daysToDeparture === 0) return 'departure';

  const returns = parseDate(returnValue);
  if (!returns) return daysToDeparture >= -30 ? 'travelling' : 'past';
  const daysToReturn = differenceInDays(today, returns);
  if (daysToReturn > 0) return 'travelling';
  if (daysToReturn === 0) return 'returning';
  return daysToReturn >= -30 ? 'home' : 'past';
}

function differenceInDays(from: Date, to: Date): number {
  return Math.round((dateOnly(to).getTime() - dateOnly(from).getTime()) / dayMs);
}

function dateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
