import { Injectable } from '@nestjs/common';
import type { AccessScope, CabinDetail, CruisePort, ItineraryItem, ItineraryKind, PassengerAllocation, PaymentItem, RoomDetail, TravellerSummary, TripDocument, TripSnapshot } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { airlineFields, airportFields, bookingFields, brandFields, cabinFields, communicationFields, cruisePortFields, customerFields, elementFields, firstAttachmentUrl, firstString, locationFields, numberValue, passengerFields, paymentFields, personFields, pick, roomFields, shipFields, strings, supplierFields, truthy, upsellFields } from './field-map.js';
import { resolveStage } from './stage.js';
import { themeTokens } from './theme.js';

@Injectable()
export class TripsService {
  constructor(private readonly airtable: AirtableService) {}

  async snapshot(baseId: string, recordId: string, accessScope: AccessScope): Promise<TripSnapshot> {
    const booking = await this.airtable.record(baseId, 'Bookings', recordId);
    const brandId = strings(pick(booking.fields, bookingFields.brand))[0];
    const [brand, elements, payments, people, customers, upsells, communications] = await Promise.all([
      brandId ? this.airtable.record(baseId, 'Brands & Branches', brandId) : Promise.resolve(emptyRecord()),
      this.airtable.records(baseId, 'Bookings [Elements]', strings(pick(booking.fields, bookingFields.elements))),
      this.airtable.records(baseId, 'Bookings [Payments]', strings(pick(booking.fields, bookingFields.payments))),
      this.airtable.records(baseId, 'Customers [People]', strings(pick(booking.fields, bookingFields.people))),
      this.airtable.records(baseId, 'Customers', strings(pick(booking.fields, bookingFields.customers))),
      this.airtable.records(baseId, 'Bookings [Upsells]', strings(pick(booking.fields, bookingFields.upsells))),
      this.airtable.records(baseId, 'Bookings [Customer Communication]', strings(pick(booking.fields, bookingFields.communications)).slice(-40)),
    ]);
    const ids = linkedRecordIds(elements);
    ids.suppliers.push(...upsells.flatMap((record) => recordIds(pick(record.fields, upsellFields.supplier))));
    ids.locations.push(...recordIds(pick(booking.fields, bookingFields.destinations)));
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
      elements, payments, people, customers, upsells, communications, suppliers, airports, airlines, rooms, cabins, passengers, ships,
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
    const documents = mapDocuments(allRelated.elements, itinerary, tripId, stage, accessScope);
    const payments = accessScope === 'primary_customer'
      ? mapPayments(booking, allRelated.payments, stage, tripId)
      : undefined;
    const destinations = mapDestinations(allRelated.locations, tripId);
    const extras = mapExtras(allRelated.upsells, graph.suppliers, tripId, hideSupplierInfo);
    const communications = mapCommunications(allRelated.communications, tripId, accessScope);

    return {
      schemaVersion: 2,
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
        gallery: attachmentImages(bookingValue('gallery')),
      },
      experience: {
        overview: safeText(bookingValue('overview')) || null,
        personalisedMessage: bookingValue('includeMessage') === undefined || truthy(bookingValue('includeMessage'))
          ? safeText(bookingValue('personalMessage')) || null
          : null,
        agentName: safeText(bookingValue('agent')) || null,
      },
      support: {
        companyName: firstString(brandValue('name')) || 'Your travel company',
        phone: safePhone(brandValue('phone')),
        email: safeEmail(brandValue('email')),
        websiteUrl: safeWebUrl(brandValue('website')),
        emergencyPhone: safePhone(bookingValue('emergencyPhone')) ?? safePhone(brandValue('emergencyPhone')),
        outOfHoursUrl: safeWebUrl(bookingValue('outOfHoursLink')) ?? safeWebUrl(brandValue('outOfHoursLink')),
        outOfHoursEmail: safeEmail(bookingValue('outOfHoursEmail')) ?? safeEmail(brandValue('outOfHoursEmail')),
      },
      protection: mapProtection(bookingValue, itinerary),
      bookingStatus: {
        sourceStatus: status,
        cancellationDate: dateString(bookingValue('cancellationDate')),
        cancellationReason: stage === 'cancelled' ? safeText(bookingValue('cancellationReason')) || null : null,
        supplierTicketsReceived: truthy(bookingValue('supplierTickets')),
        supplierConfirmationsReceived: truthy(bookingValue('supplierConfirmations')),
      },
      quotation: {
        status: stage === 'quote' ? 'available' : stage === 'quote_expired' ? 'expired' : 'not_applicable',
        expiresAt: quoteExpiry,
        canAccept: accessScope === 'primary_customer' && stage === 'quote',
        requiredConfirmations: stage === 'quote' ? ['package details', 'traveller names', 'important information', 'financial protection', 'terms and conditions'] : [],
      },
      timeline: mapTimeline(itinerary, departure, now),
      destinations,
      extras,
      communications,
      integrations: {
        liveFlightStatus: itinerary.some((item) => item.kind === 'flight') ? (process.env.FLIGHT_API_KEY ? 'available' : 'not_configured') : 'not_applicable',
        weather: destinations.some((destination) => destination.coordinates) ? (process.env.WEATHER_API_KEY ? 'available' : 'not_configured') : 'not_applicable',
        destinationGuides: destinations.length ? 'available' : 'not_available',
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

function mapTimeline(itinerary: ItineraryItem[], departure: string | null, now: Date): TripSnapshot['timeline'] {
  const today = now.toISOString().slice(0, 10);
  const currentTime = now.toTimeString().slice(0, 5);
  const next = [...itinerary]
    .filter((item) => item.startDate && (item.startDate > today || (item.startDate === today && (!item.startTime || item.startTime >= currentTime))))
    .sort((a, b) => `${a.startDate}${a.startTime ?? ''}`.localeCompare(`${b.startDate}${b.startTime ?? ''}`))[0];
  const daysUntilDeparture = departure ? Math.ceil((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
  return {
    daysUntilDeparture,
    nextItemId: next?.id ?? null,
    nextItemTitle: next?.title ?? null,
    nextItemDate: next?.startDate ?? null,
    nextItemTime: next?.startTime ?? null,
  };
}

function mapDestinations(records: AirtableRecord[], tripId: string): TripSnapshot['destinations'] {
  const seen = new Set<string>();
  return records.flatMap((record) => {
    if (seen.has(record.id)) return [];
    seen.add(record.id);
    const name = recordText(record, locationFields.name);
    if (!name) return [];
    const latitude = optionalNumber(pick(record.fields, locationFields.latitude));
    const longitude = optionalNumber(pick(record.fields, locationFields.longitude));
    return [{
      id: publicChildId(tripId, record.id, 'dst'),
      name,
      country: nullableRecordText(record, locationFields.country),
      overview: nullableRecordText(record, locationFields.overview),
      attractions: strings(pick(record.fields, locationFields.attractions)).map(safeText).filter(Boolean).slice(0, 12),
      practicalInformation: nullableRecordText(record, locationFields.practical),
      culturalInformation: nullableRecordText(record, locationFields.culture),
      travelAdviceUrl: safeWebUrl(pick(record.fields, locationFields.travelAdvice)),
      imageUrl: firstAttachmentUrl(pick(record.fields, locationFields.image)),
      coordinates: latitude !== null && longitude !== null ? { latitude, longitude } : null,
    }];
  }).slice(0, 12);
}

function mapExtras(records: AirtableRecord[], suppliers: Map<string, AirtableRecord>, tripId: string, hideSupplierInfo: boolean): TripSnapshot['extras'] {
  return records.flatMap((record, index) => {
    const name = safeText(pick(record.fields, upsellFields.name));
    if (!name) return [];
    const supplier = firstLinked(pick(record.fields, upsellFields.supplier), suppliers);
    return [{
      id: publicChildId(tripId, record.id || String(index), 'ext'),
      name,
      description: safeText(pick(record.fields, upsellFields.description)) || null,
      imageUrl: firstAttachmentUrl(pick(record.fields, upsellFields.image)),
      supplierName: hideSupplierInfo ? null : recordText(supplier, supplierFields.name) || null,
    }];
  });
}

function mapCommunications(records: AirtableRecord[], tripId: string, accessScope: AccessScope): TripSnapshot['communications'] {
  if (accessScope !== 'primary_customer') return [];
  return records.flatMap((record, index) => {
    const sent = truthy(pick(record.fields, communicationFields.sent)) || /success|sent|complete/i.test(safeText(pick(record.fields, communicationFields.status)));
    if (!sent || truthy(pick(record.fields, communicationFields.selfOnly))) return [];
    const subject = safeText(pick(record.fields, communicationFields.subject));
    if (!subject) return [];
    return [{
      id: publicChildId(tripId, record.id || String(index), 'com'),
      type: safeText(pick(record.fields, communicationFields.type)) || 'Update',
      subject,
      content: safeText(pick(record.fields, communicationFields.content)) || null,
      sentAt: dateTimeString(pick(record.fields, communicationFields.date)),
    }];
  }).sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? '')).slice(0, 20);
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
  upsells: AirtableRecord[];
  communications: AirtableRecord[];
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

type RecordGraph = { [K in Exclude<keyof RelatedRecords, 'elements' | 'payments' | 'people' | 'customers' | 'upsells' | 'communications'>]: Map<string, AirtableRecord> };

function emptyRelated(): RelatedRecords {
  return { elements: [], payments: [], people: [], customers: [], upsells: [], communications: [], suppliers: [], airports: [], airlines: [], rooms: [], cabins: [], passengers: [], ships: [], cruisePorts: [], locations: [], operators: [] };
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
  const specificName = safeText(value('eventName')) || safeText(value('parkingName')) || safeText(value('miscName'));
  const title = kind === 'flight' && (from || to) ? `${from || 'Flight'} to ${to || 'destination'}`
    : kind === 'stay' && accommodation ? accommodation
    : kind === 'cruise' && cruiseName ? cruiseName
    : kind === 'transfer' && (from || to) ? `Transfer: ${from}${to ? ` to ${to}` : ''}`
    : heading || specificName || typeLabel;
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
    : kind === 'transfer' ? [['Vehicle', 'vehicleType'], ['Pick-up instructions', 'pickupInstructions'], ['Drop-off instructions', 'dropoffInstructions']]
    : kind === 'carhire' ? [['Vehicle', 'carType'], ['Make', 'carMake'], ['Model', 'carModel'], ['Registration', 'carRegistration'], ['Child seats', 'childSeats'], ['Pick-up instructions', 'pickupInstructions']]
    : kind === 'parking' ? [['Parking code', 'parkingCode'], ['Registration', 'carRegistration'], ['Pick-up instructions', 'pickupInstructions']]
    : kind === 'train' ? [['Train', 'trainName'], ['Class', 'carriageClass'], ['Seats', 'seatNumbers']]
    : [];
  return candidates.map(([label, key]) => ({ label, value: safeText(value(key)) })).filter((detail) => detail.value);
}

function mapProtection(
  bookingValue: (key: keyof typeof bookingFields) => unknown,
  itinerary: ItineraryItem[],
): TripSnapshot['protection'] {
  const selection = safeText(bookingValue('atol'));
  const atolNumber = safeText(bookingValue('atolNumber')) || null;
  const licensing = safeText(bookingValue('licensing')) || null;
  const normalized = `${selection} ${licensing ?? ''}`.toLowerCase();
  const hasFlight = itinerary.some((item) => item.kind === 'flight');
  if (/not applicable|accommodation only|airline ticket agent/.test(normalized)) {
    return { scheme: 'not_applicable', atolNumber: null, licensing, summary: 'ATOL protection does not apply to this booking.' };
  }
  if (/non-air package/.test(normalized)) {
    return { scheme: 'non_air_package', atolNumber: null, licensing, summary: 'This is a package without a flight; check your booking confirmation for its financial protection.' };
  }
  if (hasFlight && atolNumber) {
    return { scheme: 'atol', atolNumber, licensing, summary: `This flight-inclusive booking records ATOL number ${atolNumber}. See your ATOL certificate for the protection details.` };
  }
  return { scheme: 'unknown', atolNumber, licensing, summary: 'See your booking confirmation for the financial protection that applies to this trip.' };
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
    const paymentUrl = safeUrl(value('link'));
    const status: PaymentItem['status'] = refund ? 'refund' : local ? 'local' : paid ? 'paid' : dueDate && dueDate < now ? 'overdue' : 'outstanding';
    return {
      id: publicChildId(tripId, record.id || String(index), 'pay'),
      label: safeText(value('customerType')) || (paid ? 'Payment received' : 'Payment due'),
      amount: Math.abs(amount), currency: safeCurrency(value('currency')) || currency, status, dueDate,
      completedDate: dateString(value('completed')),
      canPay: !paid && !local && !refund && amount > 0 && Boolean(paymentUrl) && (stage !== 'quote' || truthy(value('showOnQuote'))),
      actionUrl: !paid && !local && !refund && amount > 0 && (stage !== 'quote' || truthy(value('showOnQuote'))) ? paymentUrl : null,
    };
  }).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  return { currency, total: numberValue(pick(booking.fields, bookingFields.total)), paid: numberValue(pick(booking.fields, bookingFields.paid)), balance: numberValue(pick(booking.fields, bookingFields.balance)), items };
}

function mapDocuments(records: AirtableRecord[], itinerary: ItineraryItem[], tripId: string, stage: string, accessScope: AccessScope): TripDocument[] {
  const isQuote = stage === 'quote' || stage === 'quote_expired';
  const documents: TripDocument[] = [{ id: `${tripId}:confirmation`, title: isQuote ? 'Trip quotation' : 'Booking confirmation', description: 'Full itinerary and important information', kind: 'confirmation', url: null, offlineAvailable: false, status: 'ready', downloadAction: 'confirmation' }];
  if (accessScope === 'primary_customer' && !isQuote) {
    documents.push({ id: `${tripId}:invoice`, title: 'Booking invoice', description: 'Your booking costs and payment history', kind: 'invoice', url: null, offlineAvailable: false, status: 'ready', downloadAction: 'invoice' });
  }
  records.forEach((record, index) => {
    const attachments = pick(record.fields, elementFields.docs);
    if (!Array.isArray(attachments)) return;
    attachments.forEach((attachment, attachmentIndex) => {
      const file = attachment as { url?: unknown; filename?: unknown };
      if (typeof file.url !== 'string' || !file.url.startsWith('https://')) return;
      documents.push({ id: publicChildId(tripId, `${record.id}:${attachmentIndex}`, 'doc'), title: safeText(file.filename) || 'Travel document', description: itinerary[index]?.title ?? 'Trip document', kind: 'supplier', url: file.url, offlineAvailable: false, status: 'ready', downloadAction: null });
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

function safeWebUrl(value: unknown): string | null {
  const raw = safeText(value);
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeEmail(value: unknown): string | null {
  const email = safeText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function safePhone(value: unknown): string | null {
  const phone = safeText(value).replace(/[^0-9+() .-]/g, '').slice(0, 40);
  return /\d{5}/.test(phone.replace(/\D/g, '')) ? phone : null;
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

function optionalNumber(value: unknown): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === undefined || candidate === null || candidate === '') return null;
  const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
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
