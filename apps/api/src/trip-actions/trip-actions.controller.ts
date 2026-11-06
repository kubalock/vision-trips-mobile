import { Controller, Get, Headers, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { SessionsService } from '../sessions/sessions.service.js';
import { TripsService } from '../trips/trips.service.js';

@ApiTags('trip actions')
@Controller('trips/current')
export class TripActionsController {
  constructor(private readonly sessions: SessionsService, private readonly trips: TripsService) {}

  @Get('calendar.ics')
  @ApiBearerAuth()
  @ApiProduces('text/calendar')
  async calendar(@Headers('authorization') authorization: string | undefined): Promise<StreamableFile> {
    const principal = this.sessions.validateAccess(authorization);
    const snapshot = await this.trips.snapshot(
      principal.baseId,
      principal.recordId,
      principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer',
    );
    const calendar = buildCalendar(snapshot);
    return new StreamableFile(Buffer.from(calendar), {
      type: 'text/calendar; charset=utf-8',
      disposition: `attachment; filename="${safeFilename(snapshot.summary.reference)}-itinerary.ics"`,
    });
  }
}

export function buildCalendar(snapshot: Awaited<ReturnType<TripsService['snapshot']>>): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const events = snapshot.itinerary.flatMap((item) => {
    if (!item.startDate) return [];
    const start = calendarDate(item.startDate, item.startTime);
    const end = item.endTime
      ? calendarDate(item.endDate ?? item.startDate, item.endTime)
      : calendarDate(addDays(item.endDate ?? item.startDate, 1), null);
    const description = [item.typeLabel, item.from && item.to ? `${item.from} to ${item.to}` : '', item.reference ? `Reference ${item.reference}` : '', item.notes ?? ''].filter(Boolean).join('\\n');
    return [
      'BEGIN:VEVENT',
      `UID:${escapeIcs(`${snapshot.tripId}-${item.id}`)}@vision-trips.local`,
      `DTSTAMP:${now}`,
      `${item.startTime ? 'DTSTART' : 'DTSTART;VALUE=DATE'}:${start}`,
      `${item.endTime ? 'DTEND' : 'DTEND;VALUE=DATE'}:${end}`,
      `SUMMARY:${escapeIcs(item.title)}`,
      ...(item.address ? [`LOCATION:${escapeIcs(item.address)}`] : []),
      ...(description ? [`DESCRIPTION:${escapeIcs(description)}`] : []),
      'END:VEVENT',
    ];
  });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vision Trips//Mobile Itinerary//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeIcs(snapshot.summary.name)}`, ...events, 'END:VCALENDAR', ''].join('\r\n');
}

function calendarDate(date: string, time: string | null): string {
  return time ? `${date.replaceAll('-', '')}T${time.replace(':', '')}00` : date.replaceAll('-', '');
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function escapeIcs(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'trip';
}
