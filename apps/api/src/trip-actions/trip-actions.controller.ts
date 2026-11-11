import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Logger, NotFoundException, Optional, Param, Post, Req, ServiceUnavailableException, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { CustomerAccount, CustomerMessageRequest, CustomerMessageResponse, CustomerMessageTopic, CustomerPreferences, FellowTravellerLinkResponse, OpenCustomerAccountTripResponse, OpenRelatedQuotationResponse, PaymentLinkResponse, QuotationAcceptanceRequest, QuotationAcceptanceResponse, RelatedQuotationsResponse, UpdateCustomerPreferencesResponse, PaymentStatusResponse } from '@vision-trips/contracts';
import type { Request } from 'express';
import { AirtableService } from '../airtable/airtable.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { TripsService } from '../trips/trips.service.js';
import { LinkTokenService } from '../security/link-token.service.js';
import { AcceptanceNotificationsService } from './acceptance-notifications.service.js';
import { PdfDocumentService } from './pdf-document.service.js';
import { MintPaymentsService } from './mint-payments.service.js';
import { RelatedQuotationsService } from './related-quotations.service.js';
import { CustomerAccountService } from './customer-account.service.js';

@ApiTags('trip actions')
@Controller('trips/current')
export class TripActionsController {
  private readonly logger = new Logger(TripActionsController.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly trips: TripsService,
    private readonly airtable: AirtableService,
    private readonly linkTokens: LinkTokenService,
    private readonly notifications: AcceptanceNotificationsService,
    private readonly pdf: PdfDocumentService,
    private readonly mintPayments: MintPaymentsService,
    @Optional() private readonly relatedQuotations?: RelatedQuotationsService,
    @Optional() private readonly customerAccount?: CustomerAccountService,
  ) {}

  @Get('account')
  @ApiBearerAuth()
  account(@Headers('authorization') authorization: string | undefined): Promise<CustomerAccount> {
    if (!this.customerAccount) throw new ServiceUnavailableException('Customer accounts are not available.');
    return this.customerAccount.account(this.sessions.validateAccess(authorization));
  }

  @Post('account/preferences')
  @ApiBearerAuth()
  updatePreferences(@Headers('authorization') authorization: string | undefined, @Body() body: Partial<CustomerPreferences>): Promise<UpdateCustomerPreferencesResponse> {
    if (!this.customerAccount) throw new ServiceUnavailableException('Customer accounts are not available.');
    return this.customerAccount.update(this.sessions.validateAccess(authorization), body);
  }

  @Post('account/trips/:accountTripId/open')
  @ApiBearerAuth()
  openAccountTrip(@Headers('authorization') authorization: string | undefined, @Param('accountTripId') accountTripId: string): Promise<OpenCustomerAccountTripResponse> {
    if (!this.customerAccount) throw new ServiceUnavailableException('Customer accounts are not available.');
    return this.customerAccount.open(this.sessions.validateAccess(authorization), accountTripId);
  }

  @Get('related-quotations')
  @ApiBearerAuth()
  related(@Headers('authorization') authorization: string | undefined): Promise<RelatedQuotationsResponse> {
    if (!this.relatedQuotations) throw new ServiceUnavailableException('Quotation comparison is not available.');
    return this.relatedQuotations.list(this.sessions.validateAccess(authorization));
  }

  @Post('related-quotations/:comparisonId/open')
  @ApiBearerAuth()
  openRelated(@Headers('authorization') authorization: string | undefined, @Param('comparisonId') comparisonId: string): Promise<OpenRelatedQuotationResponse> {
    if (!this.relatedQuotations) throw new ServiceUnavailableException('Quotation comparison is not available.');
    return this.relatedQuotations.open(this.sessions.validateAccess(authorization), comparisonId);
  }

  @Get()
  @ApiBearerAuth()
  snapshot(@Headers('authorization') authorization: string | undefined) {
    const principal = this.sessions.validateAccess(authorization);
    return this.trips.snapshot(
      principal.baseId,
      principal.recordId,
      principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer',
    );
  }

  @Get('payment-status')
  @ApiBearerAuth()
  paymentStatus(@Headers('authorization') authorization: string | undefined): Promise<PaymentStatusResponse> {
    const principal = this.sessions.validateAccess(authorization);
    if (principal.fellowTraveller) throw new ForbiddenException('Payment details are only available to the lead customer.');
    return this.trips.paymentStatus(principal.baseId, principal.recordId);
  }

  @Post('fellow-traveller-link')
  @ApiBearerAuth()
  async fellowTravellerLink(@Headers('authorization') authorization: string | undefined): Promise<FellowTravellerLinkResponse> {
    const principal = this.sessions.validateAccess(authorization);
    if (principal.fellowTraveller) throw new ForbiddenException('Only the lead customer can share this trip.');
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, 'primary_customer');
    if (!snapshot.capabilities.shareWithTraveller) throw new ForbiddenException('This trip cannot be shared.');
    const expiresAtSeconds = Math.floor(Date.now() / 1_000) + 7 * 86_400;
    return {
      url: this.linkTokens.mintFellowTravellerLink(principal.baseId, principal.recordId, expiresAtSeconds),
      expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    };
  }

  @Post('payments/custom/link')
  @ApiBearerAuth()
  async customPaymentLink(@Headers('authorization') authorization: string | undefined, @Body() body: { amount?: unknown }): Promise<PaymentLinkResponse> {
    const principal = this.sessions.validateAccess(authorization);
    if (principal.fellowTraveller) throw new ForbiddenException('Payments are only available to the lead customer.');
    return this.mintPayments.link(principal.baseId, principal.recordId, 'custom', body?.amount);
  }

  @Post('payments/:paymentId/link')
  @ApiBearerAuth()
  async paymentLink(
    @Headers('authorization') authorization: string | undefined,
    @Param('paymentId') paymentId: string,
  ): Promise<PaymentLinkResponse> {
    const principal = this.sessions.validateAccess(authorization);
    if (principal.fellowTraveller) throw new ForbiddenException('Payments are only available to the lead customer.');
    return this.mintPayments.link(principal.baseId, principal.recordId, paymentId);
  }

  @Post('messages')
  @ApiBearerAuth()
  async sendMessage(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Partial<CustomerMessageRequest>,
  ): Promise<CustomerMessageResponse> {
    const principal = this.sessions.validateAccess(authorization);
    const topics: CustomerMessageTopic[] = ['itinerary', 'payment', 'documents', 'accessibility', 'other'];
    if (!topics.includes(body.topic as CustomerMessageTopic)) throw new BadRequestException('Choose a message topic.');
    const message = typeof body.message === 'string' ? body.message.replace(/\s+/g, ' ').trim() : '';
    if (message.length < 10 || message.length > 800) throw new BadRequestException('Enter a message between 10 and 800 characters.');
    const sentAt = new Date().toISOString();
    const accessLabel = principal.fellowTraveller ? 'fellow traveller' : 'lead customer';
    const table = process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings';
    await this.airtable.addComment(
      principal.baseId,
      table,
      principal.recordId,
      `Customer question via Vision Trips · ${body.topic} · ${accessLabel} · ${sentAt}\n${message}`,
    );
    return { sent: true, sentAt };
  }

  @Post('quotation-acceptance')
  @ApiBearerAuth()
  async acceptQuotation(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Partial<QuotationAcceptanceRequest>,
    @Req() request: Request,
  ): Promise<QuotationAcceptanceResponse> {
    const principal = this.sessions.validateAccess(authorization);
    if (principal.fellowTraveller) throw new ForbiddenException('Only the lead customer can accept this quotation.');
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (name.length < 2 || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.agreed !== true) {
      throw new BadRequestException('Enter your full name and email address, then confirm that you agree.');
    }
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, 'primary_customer');
    if (!snapshot.quotation.canAccept || snapshot.stage !== 'quote') {
      throw new ConflictException('This quotation can no longer be accepted online.');
    }
    const confirmations = Array.isArray(body.confirmations) ? body.confirmations.filter((item): item is string => typeof item === 'string') : [];
    if (!snapshot.quotation.requiredConfirmations.every((item) => confirmations.includes(item))) {
      throw new BadRequestException('Open and confirm every quotation section before accepting.');
    }
    const acceptedAt = new Date().toISOString();
    const table = process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings';
    const evidence = JSON.stringify({
      acceptedAt, name, email, ip: request.ip || 'unknown', userAgent: request.get('user-agent') || 'unknown',
      snapshotVersion: snapshot.version, confirmations, reference: snapshot.summary.reference,
    });
    await this.airtable.updateRecord(principal.baseId, table, principal.recordId, {
      [process.env.AIRTABLE_ACCEPTED_FIELD?.trim() || 'Quotation Accepted']: true,
      [process.env.AIRTABLE_ACCEPTED_AT_FIELD?.trim() || 'Quotation Accepted At']: acceptedAt,
      [process.env.AIRTABLE_ACCEPTED_BY_FIELD?.trim() || 'Quotation Accepted By']: `${name} <${email}>`,
      [process.env.AIRTABLE_ACCEPTED_IP_FIELD?.trim() || 'Quotation Accepted IP']: request.ip || 'unknown',
      [process.env.AIRTABLE_ACCEPTANCE_EVIDENCE_FIELD?.trim() || 'Quotation Acceptance Evidence']: evidence,
    });
    try {
      await this.airtable.addComment(principal.baseId, table, principal.recordId, `Quotation accepted online by ${name} <${email}> at ${acceptedAt}. Reviewed: ${confirmations.join(', ')}. Snapshot: ${snapshot.version}. Booking status was not changed.`);
    } catch (error) {
      this.logger.warn(`Acceptance was saved but its Airtable comment failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const notifications = await this.notifications.send(snapshot, { name, email }, acceptedAt);
    const paymentUrl = await this.mintPayments.depositLink(principal.baseId, principal.recordId).catch(() => null);
    return { accepted: true, acceptedAt, receiptAvailable: true, paymentUrl, notifications };
  }

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
    if (kind !== 'confirmation' && kind !== 'invoice' && kind !== 'acceptance') throw new BadRequestException('Unknown document type.');
    const principal = this.sessions.validateAccess(authorization);
    if ((kind === 'invoice' || kind === 'acceptance') && principal.fellowTraveller) throw new ForbiddenException('This document is only available to the lead customer.');
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer');
    let html: string;
    if (kind === 'acceptance') {
      const booking = await this.airtable.record(principal.baseId, process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings', principal.recordId);
      const evidenceField = process.env.AIRTABLE_ACCEPTANCE_EVIDENCE_FIELD?.trim() || 'Quotation Acceptance Evidence';
      const evidence = parseAcceptanceEvidence(booking.fields[evidenceField]);
      if (!evidence) throw new ConflictException('No quotation acceptance receipt is available.');
      html = buildAcceptanceReceipt(snapshot, evidence);
    } else {
      html = buildDocument(snapshot, kind);
    }
    return new StreamableFile(Buffer.from(html), {
      type: 'text/html; charset=utf-8',
      disposition: `attachment; filename="${safeFilename(snapshot.summary.reference)}-${kind}.html"`,
    });
  }

  @Get('documents/:action.pdf')
  @ApiBearerAuth()
  @ApiProduces('application/pdf')
  async pdfDocument(
    @Headers('authorization') authorization: string | undefined,
    @Param('action') action: string,
  ): Promise<StreamableFile> {
    const principal = this.sessions.validateAccess(authorization);
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer');
    const walletDocument = snapshot.documents.find((item) => item.downloadAction === action);
    if (!walletDocument || walletDocument.status !== 'ready') throw new NotFoundException('This document is not available.');
    if (action.startsWith('supplier:')) {
      if (!walletDocument.url?.startsWith('https://')) throw new NotFoundException('This supplier document is not available.');
      const response = await fetch(walletDocument.url, { signal: AbortSignal.timeout(15_000) });
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (!response.ok || contentLength > 20_000_000) throw new BadGatewayException('The supplier document could not be downloaded.');
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 20_000_000) throw new BadGatewayException('The supplier document is too large.');
      return new StreamableFile(body, { type: response.headers.get('content-type') || walletDocument.mimeType, disposition: `attachment; filename="${safeFilename(walletDocument.title)}"` });
    }
    let evidence: AcceptanceEvidence | null = null;
    if (action === 'acceptance') {
      const booking = await this.airtable.record(principal.baseId, process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings', principal.recordId);
      evidence = parseAcceptanceEvidence(booking.fields[process.env.AIRTABLE_ACCEPTANCE_EVIDENCE_FIELD?.trim() || 'Quotation Acceptance Evidence']);
      if (!evidence) throw new ConflictException('No quotation acceptance receipt is available.');
    }
    const body = await this.pdf.create(snapshot, action, evidence);
    return new StreamableFile(body, { type: 'application/pdf', disposition: `attachment; filename="${safeFilename(walletDocument.title)}.pdf"` });
  }
}

interface AcceptanceEvidence { acceptedAt: string; name: string; email: string; ip: string; userAgent: string; snapshotVersion: string; confirmations: string[]; reference: string }

function parseAcceptanceEvidence(value: unknown): AcceptanceEvidence | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Partial<AcceptanceEvidence>;
    return typeof parsed.acceptedAt === 'string' && typeof parsed.name === 'string' && typeof parsed.email === 'string' && Array.isArray(parsed.confirmations) ? parsed as AcceptanceEvidence : null;
  } catch { return null; }
}

export function buildAcceptanceReceipt(snapshot: Awaited<ReturnType<TripsService['snapshot']>>, evidence: AcceptanceEvidence): string {
  const reviewed = snapshot.quotation.reviewSections.filter((section) => evidence.confirmations.includes(section.id));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quotation acceptance receipt</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#172033;max-width:760px;margin:40px auto;padding:0 24px}header{border-bottom:2px solid #0f766e;padding-bottom:20px}h1{margin-bottom:4px}section{border-bottom:1px solid #ddd;padding:14px 0}dt{color:#64748b}dd{font-weight:600;margin:0 0 10px}@media print{body{margin:0}}</style></head><body><header><p>${escapeHtml(snapshot.brand.name)}</p><h1>Quotation acceptance receipt</h1><p>${escapeHtml(snapshot.summary.reference)} · ${escapeHtml(snapshot.summary.name)}</p></header><dl><dt>Accepted by</dt><dd>${escapeHtml(evidence.name)} · ${escapeHtml(evidence.email)}</dd><dt>Accepted at</dt><dd>${escapeHtml(evidence.acceptedAt)}</dd><dt>Quotation version</dt><dd>${escapeHtml(evidence.snapshotVersion)}</dd></dl><h2>Reviewed sections</h2>${reviewed.map((section) => `<section><strong>${escapeHtml(section.title)}</strong><p>${escapeHtml(section.introduction)}</p></section>`).join('')}<p>This receipt records online acceptance. It does not by itself confirm supplier availability or change the booking status.</p></body></html>`;
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
