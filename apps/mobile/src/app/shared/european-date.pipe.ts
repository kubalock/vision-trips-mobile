import { Pipe, type PipeTransform } from '@angular/core';

export type EuropeanDateFormat = 'date' | 'dateTime' | 'dayMonth' | 'long';

/** Formats API ISO dates for display without changing the values used by app logic. */
export function formatEuropeanDate(
  value: string | null | undefined,
  format: EuropeanDateFormat = 'date',
): string {
  if (!value) return '';

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

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

@Pipe({ name: 'europeanDate', standalone: true })
export class EuropeanDatePipe implements PipeTransform {
  transform(value: string | null | undefined, format: EuropeanDateFormat = 'date'): string {
    return formatEuropeanDate(value, format);
  }
}
