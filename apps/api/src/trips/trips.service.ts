import { Injectable } from '@nestjs/common';
import type { AccessScope, ItineraryItem, ItineraryKind, PaymentItem, TravellerSummary, TripDocument, TripSnapshot } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { bookingFields, brandFields, customerFields, elementFields, firstAttachmentUrl, firstString, numberValue, paymentFields, personFields, pick, strings, truthy } from './field-map.js';
import { resolveStage } from './stage.js';
import { themeTokens } from './theme.js';

@Injectable()
export class TripsService {
  constructor(private readonly airtable: AirtableService) {}

  async snapshot(baseId: string, recordId: string, accessScope: AccessScope): Promise<TripSnapshot> {
    const booking = await this.airtable.record(baseId, 'Bookings', recordId);
    const brandId = strings(pick(booking.fields, bookingFields.brand))[0];
    const [brand, elements, payments, people, customers] = await Promise.all([
      brandId ? this.airtable.record(baseId, 'Brands & Branches', brandId) : Promise.resolve(emptyRecord()),
      this.airtable.records(baseId, 'Bookings [Elements]', strings(pick(booking.fields, bookingFields.elements))),
      this.airtable.records(baseId, 'Bookings [Payments]', strings(pick(booking.fields, bookingFields.payments))),
      this.airtable.records(baseId, 'Customers [People]', strings(pick(booking.fields, bookingFields.people))),
      this.airtable.records(baseId, 'Customers', strings(pick(booking.fields, bookingFields.customers))),
    ]);
    return this.mapSnapshot(baseId, booking, brand, accessScope, { elements, payments, people, customers });
  }

  async verificationProfile(baseId: string, recordId: string): Promise<{
    postcode: string;
    email: string;
    forceOtp: boolean;
  }> {
    const booking = await this.airtable.record(baseId, 'Bookings', recordId);
    return {
      postcode: firstString(pick(booking.fields, bookingFields.customerPostcode)),
      email: firstString(pick(booking.fields, bookingFields.customerEmail)),
      forceOtp: Boolean(pick(booking.fields, bookingFields.enable2fa)),
    };
  }

  mapSnapshot(
    baseId: string,
    booking: AirtableRecord,
    brand: AirtableRecord,
    accessScope: AccessScope,
    related: { elements: AirtableRecord[]; payments: AirtableRecord[]; people: AirtableRecord[]; customers: AirtableRecord[] } = { elements: [], payments: [], people: [], customers: [] },
  ): TripSnapshot {
    const bookingValue = (key: keyof typeof bookingFields) => pick(booking.fields, bookingFields[key]);
    const brandValue = (key: keyof typeof brandFields) => pick(brand.fields, brandFields[key]);
    const status = firstString(bookingValue('status')) || 'Quotation';
    const departure = dateString(bookingValue('departure'));
    const returns = dateString(bookingValue('return'));
    const quoteExpiry = dateString(bookingValue('quoteExpiry'));
    const tags = strings(bookingValue('tags'));
    const now = new Date();
    const version = dateTimeString(booking.fields['Last modified time']) ?? booking.createdTime ?? now.toISOString();
    const tripId = publicTripId(baseId, booking.id);
    const itinerary = related.elements.map((record, index) => mapElement(record, tripId, index)).filter((item) => item.status.toLowerCase() !== 'cancelled');
    const travellers = mapTravellers(related.customers, related.people);
    const documents = mapDocuments(related.elements, itinerary, tripId);
    const payments = accessScope === 'primary_customer'
      ? mapPayments(booking, related.payments, resolveStage(status, departure, returns, quoteExpiry), tripId)
      : undefined;

    return {
      schemaVersion: 1,
      tripId,
      version,
      serverTime: now.toISOString(),
      stage: resolveStage(status, departure, returns, quoteExpiry),
      accessScope,
      freshness: {
        status: 'fresh',
        sourceUpdatedAt: version,
        nextRefreshAfter: new Date(now.getTime() + 5 * 60_000).toISOString(),
      },
      brand: {
        name: firstString(brandValue('name')) || 'Your travel company',
        logoUrl: firstAttachmentUrl(brandValue('logo')),
        theme: themeTokens({
          tags,
          configuredTheme: firstString(brandValue('theme')),
          primaryColor: firstString(brandValue('colour')),
          secondaryColor: firstString(brandValue('colour2')),
          displayFont: firstString(brandValue('fontDisplay')),
          bodyFont: firstString(brandValue('fontBody')),
        }),
      },
      summary: {
        reference: firstString(bookingValue('reference')) || 'Your trip',
        name: firstString(bookingValue('name')) || 'Your trip',
        departureDate: departure,
        returnDate: returns,
        heroImageUrl: firstAttachmentUrl(bookingValue('hero')),
      },
      travellers,
      itinerary,
      ...(payments ? { payments } : {}),
      documents,
      capabilities: {
        acceptQuotation: accessScope === 'primary_customer' && resolveStage(status, departure, returns, quoteExpiry) === 'quote',
        makePayment: accessScope === 'primary_customer' && !['closed', 'cancelled', 'quote_expired'].includes(resolveStage(status, departure, returns, quoteExpiry)),
        shareWithTraveller: accessScope === 'primary_customer',
        sendMessage: true,
      },
    };
  }
}

function mapTravellers(customers: AirtableRecord[], people: AirtableRecord[]): TravellerSummary[] {
  const rows: TravellerSummary[] = [];
  const lead = customers[0];
  if (lead) {
    const first = firstString(pick(lead.fields, customerFields.first));
    const last = firstString(pick(lead.fields, customerFields.last));
    rows.push({ name: firstString(pick(lead.fields, customerFields.name)) || `${first} ${last}`.trim(), firstName: first, isLead: true, assistance: [], meals: [] });
  }
  for (const person of people) {
    const first = firstString(pick(person.fields, personFields.first));
    const last = firstString(pick(person.fields, personFields.last));
    const name = firstString(pick(person.fields, personFields.name)) || `${first} ${last}`.trim();
    if (!name || rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) continue;
    rows.push({ name, firstName: first, isLead: false, assistance: strings(pick(person.fields, personFields.ssr)), meals: strings(pick(person.fields, personFields.meal)) });
  }
  return rows;
}

function mapElement(record: AirtableRecord, tripId: string, index: number): ItineraryItem {
  const value = (key: keyof typeof elementFields) => pick(record.fields, elementFields[key]);
  const typeLabel = safeText(value('type')) || 'Trip item';
  const kind = kindFor(typeLabel);
  const from = safeText(value('from'));
  const to = safeText(value('to'));
  const accommodation = safeText(value('accommodation'));
  const cruiseName = safeText(value('cruiseName')) || safeText(value('ship'));
  const heading = cleanHeading(safeText(value('heading')));
  const title = kind === 'flight' && (from || to) ? `${from || 'Flight'} to ${to || 'destination'}`
    : kind === 'stay' && accommodation ? accommodation
    : kind === 'cruise' && cruiseName ? cruiseName
    : kind === 'transfer' && (from || to) ? `Transfer: ${from}${to ? ` to ${to}` : ''}`
    : heading || typeLabel;
  return {
    id: publicChildId(tripId, record.id || String(index), 'itm'), kind, typeLabel, title,
    status: safeText(value('status')),
    startDate: dateString(value('start')), endDate: dateString(value('end')),
    startTime: timeString(value('departTime')), endTime: timeString(value('arriveTime')),
    from: from || null, to: to || null, carrier: safeText(value('carrier')) || null,
    flightNumber: safeText(value('flightNumber')).replace(/\s/g, '') || null,
    reference: safeText(value('supplierReference')) || null,
    address: safeText(value('address')) || null,
    notes: safeText(value('notes')) || null,
  };
}

function mapPayments(booking: AirtableRecord, records: AirtableRecord[], stage: string, tripId: string) {
  const currency = safeCurrency(pick(booking.fields, bookingFields.currency));
  const now = new Date().toISOString().slice(0, 10);
  const items: PaymentItem[] = records.map((record, index) => {
    const value = (key: keyof typeof paymentFields) => pick(record.fields, paymentFields[key]);
    const amount = numberValue(value('amount'));
    const type = safeText(value('type')) || (amount < 0 ? 'Customer Refund' : 'Customer Payment');
    const rawStatus = safeText(value('status'));
    const dueDate = dateString(value('due'));
    const paid = /complete|paid|settled/i.test(rawStatus);
    const local = /^\s*resort\s+payment\s*$/i.test(type);
    const refund = /refund/i.test(type) || amount < 0;
    const status: PaymentItem['status'] = refund ? 'refund' : local ? 'local' : paid ? 'paid' : dueDate && dueDate < now ? 'overdue' : 'outstanding';
    return {
      id: publicChildId(tripId, record.id || String(index), 'pay'),
      label: safeText(value('customerType')) || (paid ? 'Payment received' : 'Payment due'),
      amount: Math.abs(amount), currency: safeCurrency(value('currency')) || currency, status, dueDate,
      completedDate: dateString(value('completed')),
      canPay: !paid && !local && !refund && amount > 0 && Boolean(safeText(value('link'))) && (stage !== 'quote' || truthy(value('showOnQuote'))),
    };
  }).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  return { currency, total: numberValue(pick(booking.fields, bookingFields.total)), paid: numberValue(pick(booking.fields, bookingFields.paid)), balance: numberValue(pick(booking.fields, bookingFields.balance)), items };
}

function mapDocuments(records: AirtableRecord[], itinerary: ItineraryItem[], tripId: string): TripDocument[] {
  const documents: TripDocument[] = [{ id: `${tripId}:confirmation`, title: 'Booking confirmation', description: 'Full itinerary and important information', kind: 'confirmation', url: null, offlineAvailable: false }];
  records.forEach((record, index) => {
    const attachments = pick(record.fields, elementFields.docs);
    if (!Array.isArray(attachments)) return;
    attachments.forEach((attachment, attachmentIndex) => {
      const file = attachment as { url?: unknown; filename?: unknown };
      if (typeof file.url !== 'string' || !file.url.startsWith('https://')) return;
      documents.push({ id: publicChildId(tripId, `${record.id}:${attachmentIndex}`, 'doc'), title: safeText(file.filename) || 'Travel document', description: itinerary[index]?.title ?? 'Trip document', kind: 'supplier', url: file.url, offlineAvailable: false });
    });
  });
  return documents;
}

function publicTripId(baseId: string, recordId: string): string {
  const secret = process.env.VISION_LINK_SECRET;
  if (!secret) throw new Error('VISION_LINK_SECRET is not configured.');
  return `trp_${createHmac('sha256', secret).update(`${baseId}|${recordId}`).digest('base64url').slice(0, 22)}`;
}

function publicChildId(tripId: string, sourceId: string, prefix: string): string {
  const secret = process.env.VISION_LINK_SECRET;
  if (!secret) throw new Error('VISION_LINK_SECRET is not configured.');
  return `${prefix}_${createHmac('sha256', secret).update(`${tripId}|${sourceId}`).digest('base64url').slice(0, 18)}`;
}

function safeText(value: unknown): string {
  const text = firstString(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(rec|usr)[A-Za-z0-9]{14}$/.test(text) ? '' : text.slice(0, 4000);
}

function safeCurrency(value: unknown): string {
  const currency = safeText(value).toUpperCase();
  return ['GBP', 'EUR', 'USD'].includes(currency) ? currency : 'GBP';
}

function timeString(value: unknown): string | null {
  const raw = safeText(value);
  const match = raw.match(/(?:T|\s)?(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function cleanHeading(value: string): string {
  return value
    .replace(/\s*[—–-]\s*\d+\s*nights?\s*$/iu, '')
    .replace(/\s*\(\s*\d+\s*(?:nights?|pax|passengers?|guests?)\s*\)\s*$/iu, '')
    .trim();
}

function kindFor(type: string): ItineraryKind {
  const value = type.toLowerCase();
  if (value.includes('flight')) return 'flight';
  if (/accom|hotel|villa/.test(value)) return 'stay';
  if (value.includes('cruise')) return 'cruise';
  if (value.includes('transfer')) return 'transfer';
  if (/car hire|car rental/.test(value)) return 'carhire';
  if (value.includes('parking')) return 'parking';
  if (/train|rail/.test(value)) return 'train';
  if (/attraction|excursion|tour/.test(value)) return 'attraction';
  return 'misc';
}

function dateString(value: unknown): string | null {
  const raw = firstString(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function dateTimeString(value: unknown): string | null {
  const raw = firstString(value);
  const parsed = new Date(raw);
  return raw && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

function emptyRecord(): AirtableRecord {
  return { id: '', fields: {} };
}
