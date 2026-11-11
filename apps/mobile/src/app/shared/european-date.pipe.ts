import { Pipe, type PipeTransform } from '@angular/core';

export type EuropeanDateFormat = 'date' | 'dateTime' | 'dayMonth' | 'long';

/** Formats API ISO dates for display without changing the values used by app logic. */
export function formatEuropeanDate(
  value: string | null | undefined,
  format: EuropeanDateFormat = 'date',
): string {
  if (!value) return '';

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? calendarDate(value) : new Date(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return value;

  const options: Intl.DateTimeFormatOptions =
    format === 'dateTime'
      ? {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }
      : format === 'dayMonth'
        ? { day: '2-digit', month: '2-digit' }
        : format === 'long'
          ? { weekday: 'long', day: 'numeric', month: 'long' }
          : { day: '2-digit', month: '2-digit', year: 'numeric' };

  return new Intl.DateTimeFormat('en-GB', options).format(parsed);
}

/** Midday local time on a YYYY-MM-DD date, or null when it is not a real calendar date (such as 2026-02-30). */
export function calendarDate(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

@Pipe({ name: 'europeanDate', standalone: true })
export class EuropeanDatePipe implements PipeTransform {
  transform(value: string | null | undefined, format: EuropeanDateFormat = 'date'): string {
    return formatEuropeanDate(value, format);
  }
}
