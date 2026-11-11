import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { OpenRelatedQuotationResponse, RelatedQuotationSummary, RelatedQuotationsResponse } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { SessionsService, type SessionPrincipal } from '../sessions/sessions.service.js';
import { bookingFields, customerFields, firstAttachmentThumbnail, firstString, numberValue, pick, strings, truthy } from '../trips/field-map.js';
import { resolveStage } from '../trips/stage.js';
import { TripsService } from '../trips/trips.service.js';

@Injectable()
export class RelatedQuotationsService {
  constructor(private readonly airtable: AirtableService, private readonly trips: TripsService, private readonly sessions: SessionsService) {}

  async list(principal: SessionPrincipal): Promise<RelatedQuotationsResponse> {
    if (principal.fellowTraveller) throw new ForbiddenException('Quotation comparison is only available to the lead customer.');
    const records = await this.relatedBookings(principal);
    return { quotations: records.map((record) => this.summary(principal, record)).sort(compareQuotes) };
  }

  async open(principal: SessionPrincipal, comparisonId: string): Promise<OpenRelatedQuotationResponse> {
    if (principal.fellowTraveller) throw new ForbiddenException('Quotation comparison is only available to the lead customer.');
    const target = (await this.relatedBookings(principal)).find((record) => this.id(principal.baseId, record.id) === comparisonId);
    if (!target) throw new NotFoundException('That quotation is no longer available for this customer.');
    const snapshot = await this.trips.snapshot(principal.baseId, target.id, 'primary_customer');
    return { snapshot, session: this.sessions.issue({ baseId: principal.baseId, recordId: target.id, fellowTraveller: false }) };
  }

  private async relatedBookings(principal: SessionPrincipal): Promise<AirtableRecord[]> {
    const profile = await this.trips.verificationProfile(principal.baseId, principal.recordId);
    const email = profile.email.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [];
    const safe = email.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const customers = await this.airtable.list(principal.baseId, process.env.AIRTABLE_CUSTOMERS_TABLE?.trim() || 'Customers', {
      filterByFormula: `OR(LOWER({Primary Email})='${safe}',LOWER({Secondary Email})='${safe}')`,
      fields: ['Trips'], maxRecords: 20,
    });
    const ids = [...new Set(customers.flatMap((customer) => strings(pick(customer.fields, customerFields.trips))))];
    const bookings = await this.airtable.records(principal.baseId, process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings', ids);
    return bookings.filter((record) => {
      if (truthy(record.fields['Soft Delete'])) return false;
      const stage = resolveStage(firstString(pick(record.fields, bookingFields.status)), date(pick(record.fields, bookingFields.departure)), date(pick(record.fields, bookingFields.return)), date(pick(record.fields, bookingFields.quoteExpiry)));
      return stage === 'quote' || stage === 'quote_expired';
    }).slice(0, 20);
  }

  private summary(principal: SessionPrincipal, record: AirtableRecord): RelatedQuotationSummary {
    const departure = date(pick(record.fields, bookingFields.departure));
    const returns = date(pick(record.fields, bookingFields.return));
    const stage = resolveStage(firstString(pick(record.fields, bookingFields.status)), departure, returns, date(pick(record.fields, bookingFields.quoteExpiry)));
    return {
      comparisonId: this.id(principal.baseId, record.id),
      reference: firstString(pick(record.fields, bookingFields.reference)) || 'Quotation',
      name: firstString(pick(record.fields, bookingFields.name)) || 'Your trip',
      departureDate: departure, returnDate: returns,
      durationDays: duration(departure, returns, pick(record.fields, bookingFields.duration)),
      total: numberValue(pick(record.fields, bookingFields.total)),
      currency: firstString(pick(record.fields, bookingFields.currency)) || 'GBP',
      heroImageUrl: firstAttachmentThumbnail(pick(record.fields, bookingFields.hero)),
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
