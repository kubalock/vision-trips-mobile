import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { OpenRelatedQuotationResponse, RelatedQuotationSummary, RelatedQuotationsResponse } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { withMediaLinks } from '../media/attachment-media.js';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { SessionsService, type SessionPrincipal } from '../sessions/sessions.service.js';
import { bookingFields, firstAttachmentThumbnail, firstString, moneyValue, numberValue, pick } from '../trips/field-map.js';

/** At most this many quotations are compared (as in the PHP plugin). */
export const MAX_RELATED = 12;
import { accountBookings, accountTripGrant, resolveCustomerIdentity, type AccountBooking, type CustomerIdentity } from './customer-identity.js';
import { resolveStage } from '../trips/stage.js';
import { SNAPSHOT_CACHE_MS, TripsService } from '../trips/trips.service.js';

@Injectable()
export class RelatedQuotationsService {
  constructor(private readonly airtable: AirtableService, private readonly trips: TripsService, private readonly sessions: SessionsService) {}

  async list(principal: SessionPrincipal): Promise<RelatedQuotationsResponse> {
    if (principal.fellowTraveller) throw new ForbiddenException('Quotation comparison is only available to the lead customer.');
    const records = (await this.related(principal)).map((booking) => booking.record);
    return { quotations: records.map((record) => this.summary(principal, record)).sort(compareQuotes) };
  }

  async open(principal: SessionPrincipal, comparisonId: string): Promise<OpenRelatedQuotationResponse> {
    if (principal.fellowTraveller) throw new ForbiddenException('Quotation comparison is only available to the lead customer.');
    const related = await this.relatedWithIdentity(principal);
    const target = related?.bookings.find((booking) => this.id(principal.baseId, booking.record.id) === comparisonId);
    if (!related || !target) throw new NotFoundException('That quotation is no longer available for this customer.');
    const snapshot = await this.trips.snapshot(principal.baseId, target.record.id, 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
    // Same verified Customer and account, same base, same assurance.
    return { snapshot, session: this.sessions.issue(accountTripGrant(principal, related.identity, target)) };
  }

  /**
   * Quotations linked to the session's own Customer (see customer-identity.ts). Sessions without a verified Customer
   * see none: the Booking's rolled-up email never selects Customer records.
   */
  private async related(principal: SessionPrincipal): Promise<AccountBooking[]> {
    return (await this.relatedWithIdentity(principal))?.bookings ?? [];
  }

  private async relatedWithIdentity(principal: SessionPrincipal): Promise<{ identity: CustomerIdentity; bookings: AccountBooking[] } | null> {
    if (!principal.customerRecordId) return null;
    const identity = await resolveCustomerIdentity(this.airtable, principal);
    // Only bookings whose actual Status is Quotation (a blank status is not one) and which haven't expired.
    const bookings = (await accountBookings(this.airtable, principal, identity)).filter(({ record }) => {
      if (firstString(pick(record.fields, bookingFields.status)).trim().toLowerCase() !== 'quotation') return false;
      return resolveStage('Quotation', date(pick(record.fields, bookingFields.departure)), date(pick(record.fields, bookingFields.return)), date(pick(record.fields, bookingFields.quoteExpiry))) === 'quote';
    });
    // The current quotation first, then by departure; never more than MAX_RELATED.
    bookings.sort((a, b) => Number(b.record.id === principal.recordId) - Number(a.record.id === principal.recordId)
      || (date(pick(a.record.fields, bookingFields.departure)) ?? '9999').localeCompare(date(pick(b.record.fields, bookingFields.departure)) ?? '9999'));
    bookings.splice(MAX_RELATED);
    return { identity, bookings };
  }

  private summary(principal: SessionPrincipal, record: AirtableRecord): RelatedQuotationSummary {
    const departure = date(pick(record.fields, bookingFields.departure));
    const returns = date(pick(record.fields, bookingFields.return));
    const stage = resolveStage(firstString(pick(record.fields, bookingFields.status)), departure, returns, date(pick(record.fields, bookingFields.quoteExpiry)));
    // A missing or unreadable total stays null: never shown as £0.
    const total = moneyValue(pick(record.fields, bookingFields.total));
    const travellers = numberValue(pick(record.fields, bookingFields.totalTravellers));
    const ownPerPerson = moneyValue(pick(record.fields, bookingFields.pricePerPerson));
    return {
      nights: departure && returns ? Math.max(0, Math.round((Date.parse(`${returns}T00:00:00Z`) - Date.parse(`${departure}T00:00:00Z`)) / 86_400_000)) : null,
      perPerson: ownPerPerson ?? (travellers > 1 && total !== null && total > 0 ? Math.round(total / travellers * 100) / 100 : null),
      comparisonId: this.id(principal.baseId, record.id),
      reference: firstString(pick(record.fields, bookingFields.reference)) || 'Quotation',
      name: firstString(pick(record.fields, bookingFields.name)) || 'Your trip',
      departureDate: departure, returnDate: returns,
      durationDays: duration(departure, returns, pick(record.fields, bookingFields.duration)),
      total,
      currency: firstString(pick(record.fields, bookingFields.currency)) || 'GBP',
      heroImageUrl: firstAttachmentThumbnail(pick(withMediaLinks(principal.baseId, 'Bookings', record).fields, bookingFields.hero)),
      status: stage === 'quote' ? 'available' : 'expired', current: record.id === principal.recordId,
    };
  }

  private id(baseId: string, recordId: string): string {
    const secret = process.env.VISION_LINK_SECRET?.trim();
    if (!secret) throw new ServiceUnavailableException('Quotation discovery is not configured.');
    return createHmac('sha256', secret).update(`${baseId}:${recordId}:quotation-comparison`).digest('base64url').slice(0, 24);
  }
}

function date(value: unknown): string | null { const text = firstString(value); return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null; }
function duration(departure: string | null, returns: string | null, value: unknown): number | null {
  const explicit = numberValue(value); if (explicit > 0) return explicit;
  if (!departure || !returns) return null;
  return Math.max(0, Math.round((Date.parse(`${returns}T00:00:00Z`) - Date.parse(`${departure}T00:00:00Z`)) / 86_400_000));
}
function compareQuotes(a: RelatedQuotationSummary, b: RelatedQuotationSummary): number {
  if (a.current !== b.current) return a.current ? -1 : 1;
  return (a.departureDate ?? '9999').localeCompare(b.departureDate ?? '9999');
}
