import { Injectable } from '@nestjs/common';
import type { AccessScope, CabinDetail, CruisePort, ItineraryItem, ItineraryKind, PassengerAllocation, PaymentItem, RoomDetail, TravellerSummary, TripDocument, TripSnapshot } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { airlineFields, airportFields, bookingFields, brandFields, cabinFields, cruisePortFields, customerFields, elementFields, firstAttachmentUrl, firstString, locationFields, numberValue, passengerFields, paymentFields, personFields, pick, roomFields, shipFields, strings, supplierFields, truthy } from './field-map.js';
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
    const ids = linkedRecordIds(elements);
    const [suppliers, airports, airlines, rooms, cabins, passengers, ships, cruisePorts, locations, operators] = await Promise.all([
      this.airtable.records(baseId, 'Suppliers', ids.suppliers),
      this.airtable.records(baseId, 'CMS [Airports]', ids.airports),
      this.airtable.records(baseId, 'CMS [Airlines]', ids.airlines),
      this.airtable.records(baseId, 'Bookings [Rooms]', ids.rooms),
      this.airtable.records(baseId, 'Bookings [Cabin]', ids.cabins),
      this.airtable.records(baseId, 'Bookings [Passengers]', ids.passengers),
      this.airtable.records(baseId, 'CMS [Cruise Ships]', ids.ships),
      this.airtable.records(baseId, 'Bookings [Cruise Itinerary]', ids.cruisePorts),
      this.airtable.records(baseId, 'CMS [Locations]', ids.locations),
      this.airtable.records(baseId, 'CMS [Cruise Operators]', ids.operators),
    ]);
    const portLocationIds = cruisePorts.flatMap((record) => recordIds(pick(record.fields, cruisePortFields.port)));
    const portLocations = await this.airtable.records(baseId, 'CMS [Locations]', portLocationIds);
    return this.mapSnapshot(baseId, booking, brand, accessScope, {
      elements, payments, people, customers, suppliers, airports, airlines, rooms, cabins, passengers, ships,
      cruisePorts, locations: [...locations, ...portLocations], operators,
    });
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
    related: Partial<RelatedRecords> = {},
  ): TripSnapshot {
    const allRelated = { ...emptyRelated(), ...related };
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
    const stage = resolveStage(status, departure, returns, quoteExpiry);
    const hideSupplierInfo = accessScope === 'fellow_traveller' || stage === 'quote' || stage === 'quote_expired';
    const graph = recordGraph(allRelated);
    const itinerary = allRelated.elements.map((record, index) => mapElement(record, tripId, index, graph, hideSupplierInfo)).filter((item) => item.status.toLowerCase() !== 'cancelled');
    const travellers = mapTravellers(allRelated.customers, allRelated.people);
    const documents = mapDocuments(allRelated.elements, itinerary, tripId);
    const payments = accessScope === 'primary_customer'
      ? mapPayments(booking, allRelated.payments, stage, tripId)
      : undefined;

    return {
      schemaVersion: 1,
      tripId,
      version,
      serverTime: now.toISOString(),
      stage,
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
        acceptQuotation: accessScope === 'primary_customer' && stage === 'quote',
        makePayment: accessScope === 'primary_customer' && !['closed', 'cancelled', 'quote_expired'].includes(stage),
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

interface RelatedRecords {
  elements: AirtableRecord[];
  payments: AirtableRecord[];
  people: AirtableRecord[];
  customers: AirtableRecord[];
  suppliers: AirtableRecord[];
  airports: AirtableRecord[];
  airlines: AirtableRecord[];
  rooms: AirtableRecord[];
  cabins: AirtableRecord[];
  passengers: AirtableRecord[];
  ships: AirtableRecord[];
  cruisePorts: AirtableRecord[];
  locations: AirtableRecord[];
  operators: AirtableRecord[];
}

type RecordGraph = { [K in Exclude<keyof RelatedRecords, 'elements' | 'payments' | 'people' | 'customers'>]: Map<string, AirtableRecord> };

function emptyRelated(): RelatedRecords {
  return { elements: [], payments: [], people: [], customers: [], suppliers: [], airports: [], airlines: [], rooms: [], cabins: [], passengers: [], ships: [], cruisePorts: [], locations: [], operators: [] };
}

function recordGraph(related: RelatedRecords): RecordGraph {
  const index = (records: AirtableRecord[]) => new Map(records.map((record) => [record.id, record]));
  return {
    suppliers: index(related.suppliers), airports: index(related.airports), airlines: index(related.airlines), rooms: index(related.rooms),
    cabins: index(related.cabins), passengers: index(related.passengers), ships: index(related.ships), cruisePorts: index(related.cruisePorts),
    locations: index(related.locations), operators: index(related.operators),
  };
}

function linkedRecordIds(elements: AirtableRecord[]) {
  const collect = (key: keyof typeof elementFields) => elements.flatMap((record) => recordIds(pick(record.fields, elementFields[key])));
  return {
    suppliers: collect('supplier'), airports: [...collect('from'), ...collect('to')], airlines: collect('carrier'), rooms: collect('rooms'),
    cabins: collect('cabins'), passengers: collect('passengers'), ships: collect('ship'), cruisePorts: collect('visitingPorts'),
    locations: collect('location'), operators: collect('cruiseLine'),
  };
}

function mapElement(record: AirtableRecord, tripId: string, index: number, graph: RecordGraph, hideSupplierInfo: boolean): ItineraryItem {
  const value = (key: keyof typeof elementFields) => pick(record.fields, elementFields[key]);
  const typeLabel = safeText(value('type')) || 'Trip item';
  const kind = kindFor(typeLabel);
  const from = resolveLinkedText(value('from'), graph.airports, airportFields.name);
  const to = resolveLinkedText(value('to'), graph.airports, airportFields.name);
  const accommodation = safeText(value('accommodation'));
  const ship = firstLinked(value('ship'), graph.ships);
  const cruiseName = safeText(value('cruiseName')) || recordText(ship, shipFields.name);
  const heading = cleanHeading(safeText(value('heading')));
  const title = kind === 'flight' && (from || to) ? `${from || 'Flight'} to ${to || 'destination'}`
    : kind === 'stay' && accommodation ? accommodation
    : kind === 'cruise' && cruiseName ? cruiseName
    : kind === 'transfer' && (from || to) ? `Transfer: ${from}${to ? ` to ${to}` : ''}`
    : heading || typeLabel;
  const supplierRecord = firstLinked(value('supplier'), graph.suppliers);
  const supplierName = recordText(supplierRecord, supplierFields.name);
  const supplierHidden = hideSupplierInfo || truthy(value('hideSupplier'));
  const carrierRecord = firstLinked(value('carrier'), graph.airlines);
  const rooms = linked(value('rooms'), graph.rooms).map(mapRoom).filter((item): item is RoomDetail => Boolean(item));
  const cabins = linked(value('cabins'), graph.cabins).map(mapCabin).filter((item): item is CabinDetail => Boolean(item));
  const passengers = linked(value('passengers'), graph.passengers).map(mapPassenger).filter((item): item is PassengerAllocation => Boolean(item));
  const cruisePorts = linked(value('visitingPorts'), graph.cruisePorts).map((port) => mapCruisePort(port, graph.locations)).filter((item): item is CruisePort => Boolean(item));
  return {
    id: publicChildId(tripId, record.id || String(index), 'itm'), kind, typeLabel, title,
    status: safeText(value('status')),
    startDate: dateString(value('start')), endDate: dateString(value('end')),
    startTime: timeString(value('departTime')), endTime: timeString(value('arriveTime')),
    from: from || null, to: to || null, carrier: recordText(carrierRecord, airlineFields.name) || safeText(value('carrier')) || null,
    flightNumber: safeText(value('flightNumber')).replace(/\s/g, '') || null,
    reference: supplierHidden ? null : safeText(value('supplierReference')) || null,
    address: safeText(value('address')) || null,
    notes: safeText(value('notes')) || null,
    supplier: supplierHidden || !supplierName ? null : { name: supplierName, logoUrl: firstAttachmentUrl(supplierRecord?.fields ? pick(supplierRecord.fields, supplierFields.logo) : undefined), termsUrl: safeUrl(supplierRecord?.fields ? pick(supplierRecord.fields, supplierFields.terms) : undefined) },
    images: attachmentImages(value('images')),
    rooms, cabins, passengers, cruisePorts,
    emergencyContact: emergencyContact(value('emergencyName'), value('emergencyPhone')),
    details: elementDetails(kind, value),
  };
}

function mapRoom(record: AirtableRecord): RoomDetail | null {
  const type = recordText(record, roomFields.type);
  if (!type) return null;
  return { type, board: nullableRecordText(record, roomFields.board), view: nullableRecordText(record, roomFields.view), requests: nullableRecordText(record, roomFields.requests) };
}

function mapCabin(record: AirtableRecord): CabinDetail | null {
  const name = recordText(record, cabinFields.name);
  if (!name) return null;
  const dining = [recordText(record, cabinFields.seating), recordText(record, cabinFields.table), recordText(record, cabinFields.dining)].filter(Boolean).join(' · ');
  return { name, grade: nullableRecordText(record, cabinFields.grade), number: nullableRecordText(record, cabinFields.number), deck: nullableRecordText(record, cabinFields.deck), side: nullableRecordText(record, cabinFields.side), position: nullableRecordText(record, cabinFields.position), bed: nullableRecordText(record, cabinFields.bed), dining: dining || null };
}

function mapPassenger(record: AirtableRecord): PassengerAllocation | null {
  const name = recordText(record, passengerFields.name);
  if (!name) return null;
  return { name, bookingReference: nullableRecordText(record, passengerFields.pnr), travelClass: nullableRecordText(record, passengerFields.class), seat: nullableRecordText(record, passengerFields.seat), cabinBaggage: nullableRecordText(record, passengerFields.cabinBag), checkedBaggage: nullableRecordText(record, passengerFields.checkedBag), extras: nullableRecordText(record, passengerFields.extras), meal: nullableRecordText(record, passengerFields.meal), assistance: nullableRecordText(record, passengerFields.ssr) };
}

function mapCruisePort(record: AirtableRecord, locations: Map<string, AirtableRecord>): CruisePort | null {
  const port = resolveLinkedText(pick(record.fields, cruisePortFields.port), locations, locationFields.name);
  if (!port) return null;
  return { day: safeText(pick(record.fields, cruisePortFields.day)), port, arrivalTime: timeString(pick(record.fields, cruisePortFields.arrive)), departureTime: timeString(pick(record.fields, cruisePortFields.depart)), description: safeText(pick(record.fields, cruisePortFields.description)) || null };
}

function elementDetails(kind: ItineraryKind, value: (key: keyof typeof elementFields) => unknown) {
  const candidates: Array<[string, keyof typeof elementFields]> = kind === 'flight'
    ? [['Class', 'flightClass'], ['Direction', 'direction']]
    : kind === 'stay' ? [['Rating', 'rating'], ['Nights', 'nights']]
    : kind === 'cruise' ? [['Voyage', 'voyageCode'], ['Onboard credit', 'onboardCredit']]
    : kind === 'transfer' || kind === 'carhire' ? [['Vehicle', 'vehicleType'], ['Pick-up instructions', 'pickupInstructions'], ['Drop-off instructions', 'dropoffInstructions']]
    : kind === 'train' ? [['Train', 'trainName'], ['Class', 'carriageClass'], ['Seats', 'seatNumbers']]
    : [];
  return candidates.map(([label, key]) => ({ label, value: safeText(value(key)) })).filter((detail) => detail.value);
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

function recordIds(value: unknown): string[] {
  return strings(value).filter((id) => /^rec[A-Za-z0-9]{14}$/.test(id));
}

function linked(value: unknown, records: Map<string, AirtableRecord>): AirtableRecord[] {
  return recordIds(value).map((id) => records.get(id)).filter((record): record is AirtableRecord => Boolean(record));
}

function firstLinked(value: unknown, records: Map<string, AirtableRecord>): AirtableRecord | undefined {
  return linked(value, records)[0];
}

function recordText(record: AirtableRecord | undefined, fields: readonly string[]): string {
  return record ? safeText(pick(record.fields, fields)) : '';
}

function nullableRecordText(record: AirtableRecord, fields: readonly string[]): string | null {
  return recordText(record, fields) || null;
}

function resolveLinkedText(value: unknown, records: Map<string, AirtableRecord>, fields: readonly string[]): string {
  const resolved = linked(value, records).map((record) => recordText(record, fields)).filter(Boolean).join(', ');
  return resolved || safeText(value);
}

function attachmentImages(value: unknown): Array<{ url: string; alt: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attachment) => {
    const file = attachment as { url?: unknown; filename?: unknown };
    return typeof file.url === 'string' && file.url.startsWith('https://')
      ? [{ url: file.url, alt: safeText(file.filename) || 'Trip image' }]
      : [];
  }).slice(0, 12);
}

function safeUrl(value: unknown): string | null {
  const url = safeText(value);
  return /^https:\/\//i.test(url) ? url : null;
}

function emergencyContact(nameValue: unknown, phoneValue: unknown): { name: string; phone: string } | null {
  const phone = safeText(phoneValue).replace(/[^0-9+() .-]/g, '').slice(0, 40);
  if (!phone) return null;
  return { name: safeText(nameValue) || 'Supplier emergency line', phone };
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
