import { BadRequestException, Controller, ForbiddenException, Get, Headers, Param, StreamableFile } from '@nestjs/common';
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

  @Get('documents/:kind.html')
  @ApiBearerAuth()
  @ApiProduces('text/html')
  async document(
    @Headers('authorization') authorization: string | undefined,
    @Param('kind') kind: string,
  ): Promise<StreamableFile> {
    if (kind !== 'confirmation' && kind !== 'invoice') throw new BadRequestException('Unknown document type.');
    const principal = this.sessions.validateAccess(authorization);
    if (kind === 'invoice' && principal.fellowTraveller) throw new ForbiddenException('Invoices are only available to the lead customer.');
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer');
    const html = buildDocument(snapshot, kind);
    return new StreamableFile(Buffer.from(html), {
      type: 'text/html; charset=utf-8',
      disposition: `attachment; filename="${safeFilename(snapshot.summary.reference)}-${kind}.html"`,
    });
  }
}

export function buildDocument(snapshot: Awaited<ReturnType<TripsService['snapshot']>>, kind: 'confirmation' | 'invoice'): string {
  const money = (amount: number, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  const body = kind === 'invoice' && snapshot.payments
    ? `<h2>Payment summary</h2><dl><dt>Total</dt><dd>${escapeHtml(money(snapshot.payments.total, snapshot.payments.currency))}</dd><dt>Paid</dt><dd>${escapeHtml(money(snapshot.payments.paid, snapshot.payments.currency))}</dd><dt>Balance</dt><dd>${escapeHtml(money(snapshot.payments.balance, snapshot.payments.currency))}</dd></dl>`
    : `<h2>Itinerary</h2>${snapshot.itinerary.map((item) => `<section><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml([item.startDate, item.startTime, item.from && item.to ? `${item.from} to ${item.to}` : ''].filter(Boolean).join(' · '))}</p></section>`).join('')}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(snapshot.summary.name)}</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#172033;max-width:760px;margin:40px auto;padding:0 24px}header{border-bottom:2px solid #0f766e;padding-bottom:20px}h1{margin-bottom:4px}h2{margin-top:32px}section{break-inside:avoid;border-bottom:1px solid #ddd;padding:10px 0}dl{display:grid;grid-template-columns:1fr auto;gap:10px}dd{font-weight:700}@media print{body{margin:0}}</style></head><body><header><p>${escapeHtml(snapshot.brand.name)}</p><h1>${escapeHtml(kind === 'invoice' ? 'Booking invoice' : snapshot.stage === 'quote' ? 'Trip quotation' : 'Booking confirmation')}</h1><p>${escapeHtml(snapshot.summary.reference)} · ${escapeHtml(snapshot.summary.name)}</p></header>${body}<h2>Financial protection</h2><p>${escapeHtml(snapshot.protection.summary)}</p><p>Generated ${escapeHtml(snapshot.serverTime.slice(0, 10))}</p></body></html>`;
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

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function safeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'trip';
}
