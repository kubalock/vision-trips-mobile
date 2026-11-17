import { BadGatewayException, BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers, Logger, NotFoundException, Optional, Param, Post, Req, ServiceUnavailableException, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { CallbackRequest, CallbackResponse, TravellerProfilesResponse, TravellerProfileUpdateResponse, CustomerAccount, CustomerMessageRequest, CustomerMessageResponse, CustomerMessageTopic, CustomerPreferences, FellowTravellerLinkResponse, OpenCustomerAccountTripResponse, OpenRelatedQuotationResponse, PaymentLinkResponse, QuotationAcceptanceContext, QuotationAcceptanceRequest, QuotationAcceptanceResponse, QuotationReviewSectionId, RelatedQuotationsResponse, UpdateCustomerPreferencesResponse, PaymentStatusResponse } from '@vision-trips/contracts';
import type { Request } from 'express';
import { AirtableService } from '../airtable/airtable.service.js';
import { SessionsService, type SessionPrincipal } from '../sessions/sessions.service.js';
import { TripEntitlementsService } from '../sessions/trip-entitlements.service.js';
import { SNAPSHOT_CACHE_MS, TripsService } from '../trips/trips.service.js';
import { isVerified, requireVerified } from '../security/assurance.js';
import { CustomerInvitationsService } from '../invitations/customer-invitations.service.js';
import { Idempotent } from '../operations/idempotent.js';
import { NoStoredReplay } from '../operations/no-stored-replay.js';
import { AcceptanceNotificationsService } from './acceptance-notifications.service.js';
import { PdfDocumentService } from './pdf-document.service.js';
import { MintPaymentsService } from './mint-payments.service.js';
import { RelatedQuotationsService } from './related-quotations.service.js';
import { CustomerAccountService } from './customer-account.service.js';
import { TravellerProfilesService } from './traveller-profiles.service.js';
import { formatMoney } from '../trips/field-map.js';
import { openSupplierDocument, SupplierDocumentError } from './supplier-document.js';
import { type AcceptanceEvidence, parseAcceptanceEvidence, signedInAs, signedInAuditText, signedInRows } from './acceptance-evidence.js';
import { customerEmail, customersTable } from './customer-identity.js';
import { maskEmail } from '@vision-trips/contracts';

const REVIEW_SECTION_IDS: readonly QuotationReviewSectionId[] = ['package', 'names', 'important', 'protection', 'terms'];
const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

@ApiTags('trip actions')
@Controller('trips/current')
export class TripActionsController {
  private readonly logger = new Logger(TripActionsController.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly trips: TripsService,
    private readonly airtable: AirtableService,
    private readonly invitations: CustomerInvitationsService,
    private readonly notifications: AcceptanceNotificationsService,
    private readonly pdf: PdfDocumentService,
    private readonly mintPayments: MintPaymentsService,
    @Optional() private readonly relatedQuotations?: RelatedQuotationsService,
    @Optional() private readonly customerAccount?: CustomerAccountService,
    @Optional() private readonly entitlements?: TripEntitlementsService,
    @Optional() private readonly travellerProfiles?: TravellerProfilesService,
  ) {}

  /**
   * The session, once Airtable confirms its holder is still linked to the trip (see TripEntitlementsService). Reads
   * may reuse a check from the last minute; `fresh` re-checks before payments, sharing, acceptance and other writes.
   */
  private async live(authorization: string | undefined, fresh = false): Promise<SessionPrincipal> {
    const principal = this.sessions.validateAccess(authorization);
    await this.entitlements?.assertCurrent(principal, { fresh });
    return principal;
  }

  /** Account settings, and trips or quotations opened from the account, need an email-verified (or trusted-device) session. */
  private async verified(authorization: string | undefined, fresh = false): Promise<SessionPrincipal> {
    const principal = this.sessions.validateAccess(authorization);
    if (principal.fellowTraveller) throw new ForbiddenException('This is only available to the lead customer.');
    requireVerified(principal);
    await this.entitlements?.assertCurrent(principal, { fresh });
    return principal;
  }

  @Get('account')
  @ApiBearerAuth()
  async account(@Headers('authorization') authorization: string | undefined): Promise<CustomerAccount> {
    if (!this.customerAccount) throw new ServiceUnavailableException('Customer accounts are not available.');
    return this.customerAccount.account(await this.verified(authorization));
  }

  @Post('account/preferences')
  @Idempotent()
  @ApiBearerAuth()
  async updatePreferences(@Headers('authorization') authorization: string | undefined, @Body() body: Partial<CustomerPreferences>): Promise<UpdateCustomerPreferencesResponse> {
    if (!this.customerAccount) throw new ServiceUnavailableException('Customer accounts are not available.');
    return this.customerAccount.update(await this.verified(authorization, true), body);
  }

  /** Account → Traveller details: the verified customer's own people, sensitive numbers masked. */
  @Get('account/travellers')
  @ApiBearerAuth()
  async travellers(@Headers('authorization') authorization: string | undefined): Promise<TravellerProfilesResponse> {
    if (!this.travellerProfiles) throw new ServiceUnavailableException('Traveller details are not available.');
    return this.travellerProfiles.list(await this.verified(authorization));
  }

  /** Updates only the allow-listed passport, licence and next-of-kin fields, after a fresh ownership check. */
  @Post('account/travellers/:travellerId')
  @Idempotent()
  @ApiBearerAuth()
  async updateTraveller(@Headers('authorization') authorization: string | undefined, @Param('travellerId') travellerId: string, @Body() body: unknown): Promise<TravellerProfileUpdateResponse> {
    if (!this.travellerProfiles) throw new ServiceUnavailableException('Traveller details are not available.');
    if (!/^tvl_[A-Za-z0-9_-]{22}$/.test(travellerId)) throw new NotFoundException('That traveller is not on your account.');
    return this.travellerProfiles.update(await this.verified(authorization, true), travellerId, body);
  }

  @Post('account/trips/:accountTripId/open')
  @ApiBearerAuth()
  @NoStoredReplay()
  async openAccountTrip(@Headers('authorization') authorization: string | undefined, @Param('accountTripId') accountTripId: string): Promise<OpenCustomerAccountTripResponse> {
    if (!this.customerAccount) throw new ServiceUnavailableException('Customer accounts are not available.');
    return this.customerAccount.open(await this.verified(authorization, true), accountTripId);
  }

  @Get('related-quotations')
  @ApiBearerAuth()
  async related(@Headers('authorization') authorization: string | undefined): Promise<RelatedQuotationsResponse> {
    if (!this.relatedQuotations) throw new ServiceUnavailableException('Quotation comparison is not available.');
    return this.relatedQuotations.list(await this.live(authorization));
  }

  @Post('related-quotations/:comparisonId/open')
  @ApiBearerAuth()
  @NoStoredReplay()
  async openRelated(@Headers('authorization') authorization: string | undefined, @Param('comparisonId') comparisonId: string): Promise<OpenRelatedQuotationResponse> {
    if (!this.relatedQuotations) throw new ServiceUnavailableException('Quotation comparison is not available.');
    return this.relatedQuotations.open(await this.verified(authorization, true), comparisonId);
  }

  @Get()
  @ApiBearerAuth()
  async snapshot(@Headers('authorization') authorization: string | undefined) {
    const principal = await this.live(authorization);
    const snapshot = await this.trips.snapshot(
      principal.baseId,
      principal.recordId,
      principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer',
      { maxAgeMs: SNAPSHOT_CACHE_MS },
    );
    // Stored payment-page URLs would bypass the verified-session check on payment links: an unverified session gets
    // none, so tapping "Pay" asks the API, which asks the customer to confirm by email first.
    if (isVerified(principal)) return snapshot;
    // Dates of birth are only shown on sessions verified by email (or a trusted device).
    const withoutDob = snapshot.travellers?.some((traveller) => traveller.dateOfBirth)
      ? { ...snapshot, travellers: snapshot.travellers.map((traveller) => ({ ...traveller, dateOfBirth: null })) } : snapshot;
    if (!withoutDob.payments) return withoutDob;
    return { ...withoutDob, payments: { ...withoutDob.payments, items: withoutDob.payments.items.map((item) => ({ ...item, actionUrl: null })) } };
  }

  @Get('payment-status')
  @ApiBearerAuth()
  async paymentStatus(@Headers('authorization') authorization: string | undefined): Promise<PaymentStatusResponse> {
    const principal = await this.live(authorization);
    if (principal.fellowTraveller) throw new ForbiddenException('Payment details are only available to the lead customer.');
    return this.trips.paymentStatus(principal.baseId, principal.recordId);
  }

  @Post('fellow-traveller-link')
  @ApiBearerAuth()
  @NoStoredReplay()
  async fellowTravellerLink(@Headers('authorization') authorization: string | undefined): Promise<FellowTravellerLinkResponse> {
    const principal = await this.live(authorization, true);
    if (principal.fellowTraveller) throw new ForbiddenException('Only the lead customer can share this trip.');
    requireVerified(principal);
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, 'primary_customer');
    if (!snapshot.capabilities.shareWithTraveller) throw new ForbiddenException('This trip cannot be shared.');
    return this.invitations.shareLink(principal);
  }

  @Post('payments/custom/link')
  @Idempotent()
  @ApiBearerAuth()
  async customPaymentLink(@Headers('authorization') authorization: string | undefined, @Body() body: { amount?: unknown }): Promise<PaymentLinkResponse> {
    const principal = await this.live(authorization, true);
    if (principal.fellowTraveller) throw new ForbiddenException('Payments are only available to the lead customer.');
    requireVerified(principal);
    return this.mintPayments.link(principal.baseId, principal.recordId, 'custom', body?.amount);
  }

  @Post('payments/:paymentId/link')
  @Idempotent()
  @ApiBearerAuth()
  async paymentLink(
    @Headers('authorization') authorization: string | undefined,
    @Param('paymentId') paymentId: string,
  ): Promise<PaymentLinkResponse> {
    const principal = await this.live(authorization, true);
    if (principal.fellowTraveller) throw new ForbiddenException('Payments are only available to the lead customer.');
    requireVerified(principal);
    return this.mintPayments.link(principal.baseId, principal.recordId, paymentId);
  }

  @Post('messages')
  @Idempotent()
  @ApiBearerAuth()
  async sendMessage(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Partial<CustomerMessageRequest>,
  ): Promise<CustomerMessageResponse> {
    const principal = await this.live(authorization, true);
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

  /** What the acceptance form shows: the verified customer's email, masked. Never asks for it again. */
  @Get('quotation-acceptance')
  @ApiBearerAuth()
  async acceptanceContext(@Headers('authorization') authorization: string | undefined): Promise<QuotationAcceptanceContext> {
    const principal = await this.live(authorization);
    if (principal.fellowTraveller) throw new ForbiddenException('Only the lead customer can accept this quotation.');
    requireVerified(principal);
    return { emailHint: maskEmail(await this.verifiedEmail(principal)) };
  }

  /**
   * Acceptance needs a verified lead-customer session, the signer's full name and one explicit agreement. Which
   * review sections were opened is recorded as evidence but never required. The receipt goes to the verified
   * customer's own email unless the signer gives another address, which is recorded only as the declared
   * signer/receipt address: it never selects a Customer, changes the session's identity or widens access.
   */
  /** "Call me back": a validated preferred time (and optional number) for the agent, as a booking comment. */
  @Post('callback')
  @Idempotent()
  @ApiBearerAuth()
  async requestCallback(@Headers('authorization') authorization: string | undefined, @Body() body: Partial<CallbackRequest>): Promise<CallbackResponse> {
    const principal = await this.live(authorization, true);
    const times: Record<CallbackRequest['preferredTime'], string> = { morning: 'morning (9am–12pm)', afternoon: 'afternoon (12–5pm)', evening: 'early evening (5–7pm)', anytime: 'any time' };
    if (!body || typeof body.preferredTime !== 'string' || !(body.preferredTime in times)) throw new BadRequestException('Choose when you would like a call.');
    const phone = typeof body.phone === 'string' ? body.phone.replace(/[^0-9+ ()-]/g, '').trim() : '';
    if (phone && (phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15)) throw new BadRequestException('Enter a full phone number, or leave it blank to use the number on your booking.');
    const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
    const sentAt = new Date().toISOString();
    const accessLabel = principal.fellowTraveller ? 'fellow traveller' : 'lead customer';
    await this.airtable.addComment(principal.baseId, process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings', principal.recordId,
      `Callback requested via Vision Trips · ${accessLabel} · ${sentAt}\nPreferred time: ${times[body.preferredTime as CallbackRequest['preferredTime']]}${phone ? `\nNumber: ${phone}` : '\nNumber: the one on the booking'}${note ? `\n${note}` : ''}`);
    return { sent: true, sentAt };
  }

  @Post('quotation-acceptance')
  @Idempotent()
  @ApiBearerAuth()
  async acceptQuotation(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Partial<QuotationAcceptanceRequest>,
    @Req() request: Request,
  ): Promise<QuotationAcceptanceResponse> {
    const principal = await this.live(authorization, true);
    if (principal.fellowTraveller) throw new ForbiddenException('Only the lead customer can accept this quotation.');
    requireVerified(principal);
    const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 120 || body.agreed !== true) {
      throw new BadRequestException('Enter your full name and confirm that you agree.');
    }
    // `email` is what v3 clients send; both are only ever the declared signer/receipt address.
    const declaredRaw = typeof body.signerEmail === 'string' && body.signerEmail.trim() ? body.signerEmail : typeof body.email === 'string' ? body.email : '';
    const declaredEmail = declaredRaw.trim().toLowerCase();
    if (declaredEmail && (declaredEmail.length > 254 || !EMAIL_PATTERN.test(declaredEmail))) throw new BadRequestException('Enter a valid email address for your receipt, or use your account email.');
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, 'primary_customer');
    if (!snapshot.quotation.canAccept || snapshot.stage !== 'quote') {
      throw new ConflictException('This quotation can no longer be accepted online.');
    }
    const openedRaw = Array.isArray(body.openedSections) ? body.openedSections : Array.isArray(body.confirmations) ? body.confirmations : [];
    const openedSections = REVIEW_SECTION_IDS.filter((id) => openedRaw.includes(id));
    const verifiedEmail = await this.verifiedEmail(principal);
    const email = declaredEmail || verifiedEmail;
    if (!email) throw new BadRequestException('Enter an email address for your receipt.');
    const acceptedAt = new Date().toISOString();
    const table = process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings';
    // Who was signed in, recorded apart from the declared signer (they may sign on someone's behalf).
    const signedIn = signedInAs(principal, verifiedEmail, email);
    const evidence = JSON.stringify({
      acceptedAt, name, email, ip: request.ip || 'unknown', userAgent: request.get('user-agent') || 'unknown',
      snapshotVersion: snapshot.version, confirmations: [], openedSections, reference: snapshot.summary.reference, signedInAs: signedIn,
    } satisfies AcceptanceEvidence);
    await this.airtable.updateRecord(principal.baseId, table, principal.recordId, {
      [process.env.AIRTABLE_ACCEPTED_FIELD?.trim() || 'Quotation Accepted']: true,
      [process.env.AIRTABLE_ACCEPTED_AT_FIELD?.trim() || 'Quotation Accepted At']: acceptedAt,
      [process.env.AIRTABLE_ACCEPTED_BY_FIELD?.trim() || 'Quotation Accepted By']: `${name} <${email}>`,
      [process.env.AIRTABLE_ACCEPTED_IP_FIELD?.trim() || 'Quotation Accepted IP']: request.ip || 'unknown',
      [process.env.AIRTABLE_ACCEPTANCE_EVIDENCE_FIELD?.trim() || 'Quotation Acceptance Evidence']: evidence,
    });
    // The quotation is now accepted: the next refresh must not get the cached quote.
    this.trips.invalidate(principal.baseId, principal.recordId);
    try {
      const opened = openedSections.length ? openedSections.join(', ') : 'none';
      await this.airtable.addComment(principal.baseId, table, principal.recordId, `Quotation accepted online by ${name} <${email}> at ${acceptedAt}. Sections opened (not required): ${opened}. Snapshot: ${snapshot.version}. ${signedInAuditText(principal, signedIn)} Booking status was not changed.`);
    } catch (error) {
      this.logger.warn(`Acceptance was saved but its Airtable comment failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const notifications = await this.notifications.send(snapshot, { name, email }, acceptedAt);
    const depositUrl = await this.mintPayments.depositLink(principal.baseId, principal.recordId).catch(() => null);
    // The app only opens https payment pages; anything else is left out so the acceptance response stays valid.
    const paymentUrl = depositUrl && /^https:\/\//i.test(depositUrl) ? depositUrl : null;
    return { accepted: true, acceptedAt, receiptAvailable: true, paymentUrl, notifications };
  }

  /** The verified Customer's own email (lower case), read from the session's Customer record in its own base. */
  private async verifiedEmail(principal: SessionPrincipal): Promise<string> {
    if (!principal.customerRecordId) return '';
    return this.airtable.record(principal.baseId, customersTable(), principal.customerRecordId).then(customerEmail, () => '').then((value) => (value || '').trim().toLowerCase());
  }

  @Get('calendar.ics')
  @ApiBearerAuth()
  @ApiProduces('text/calendar')
  async calendar(@Headers('authorization') authorization: string | undefined): Promise<StreamableFile> {
    const principal = await this.live(authorization);
    const snapshot = await this.trips.snapshot(
      principal.baseId,
      principal.recordId,
      principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer',
      { maxAgeMs: SNAPSHOT_CACHE_MS },
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
    const principal = await this.live(authorization);
    if ((kind === 'invoice' || kind === 'acceptance') && principal.fellowTraveller) throw new ForbiddenException('This document is only available to the lead customer.');
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
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
    const principal = await this.live(authorization);
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
    const walletDocument = snapshot.documents.find((item) => item.downloadAction === action);
    if (!walletDocument || walletDocument.status !== 'ready') throw new NotFoundException('This document is not available.');
    if (action.startsWith('supplier:')) {
      if (!walletDocument.url?.startsWith('https://')) throw new NotFoundException('This supplier document is not available.');
      // Streamed through a byte counter rather than read into memory; see openSupplierDocument.
      const document = await openSupplierDocument(walletDocument.url).catch((error: unknown) => {
        throw new BadGatewayException(error instanceof SupplierDocumentError && error.reason === 'too_large'
          ? 'The supplier document is too large to download in the app.'
          : 'The supplier document could not be downloaded.');
      });
      return new StreamableFile(document.stream, {
        type: document.contentType || walletDocument.mimeType,
        disposition: `attachment; filename="${safeFilename(walletDocument.title)}"`,
        ...(document.length !== null ? { length: document.length } : {}),
      });
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

export function buildAcceptanceReceipt(snapshot: Awaited<ReturnType<TripsService['snapshot']>>, evidence: AcceptanceEvidence): string {
  const opened = evidence.openedSections ?? evidence.confirmations;
  const reviewed = snapshot.quotation.reviewSections.filter((section) => opened.includes(section.id));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quotation acceptance receipt</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#172033;max-width:760px;margin:40px auto;padding:0 24px}header{border-bottom:2px solid #0f766e;padding-bottom:20px}h1{margin-bottom:4px}section{border-bottom:1px solid #ddd;padding:14px 0}dt{color:#64748b}dd{font-weight:600;margin:0 0 10px}@media print{body{margin:0}}</style></head><body><header><p>${escapeHtml(snapshot.brand.name)}</p><h1>Quotation acceptance receipt</h1><p>${escapeHtml(snapshot.summary.reference)} · ${escapeHtml(snapshot.summary.name)}</p></header><dl><dt>Accepted by (as entered)</dt><dd>${escapeHtml(evidence.name)} · ${escapeHtml(evidence.email)}</dd><dt>Accepted at</dt><dd>${escapeHtml(evidence.acceptedAt)}</dd><dt>Quotation version</dt><dd>${escapeHtml(evidence.snapshotVersion)}</dd>${signedInRows(evidence).map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl><h2>Sections opened before accepting</h2>${reviewed.length ? '' : '<p>None recorded. Every section was available to review.</p>'}${reviewed.map((section) => `<section><strong>${escapeHtml(section.title)}</strong><p>${escapeHtml(section.introduction)}</p></section>`).join('')}<p>This receipt records online acceptance. It does not by itself confirm supplier availability or change the booking status.</p></body></html>`;
}

export function buildDocument(snapshot: Awaited<ReturnType<TripsService['snapshot']>>, kind: 'confirmation' | 'invoice'): string {
  const money = formatMoney;
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
