import { Injectable } from '@nestjs/common';
import type { AccessScope, CabinDetail, CruisePort, ItineraryItem, ItineraryKind, PassengerAllocation, PaymentItem, RoomDetail, TravellerSummary, TripDocument, TripSnapshot } from '@vision-trips/contracts';
import { createHash, createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { airlineFields, airportFields, bookingFields, brandFields, cabinFields, communicationFields, cruisePortFields, customerFields, elementFields, firstAttachmentUrl, firstString, locationFields, memberFields, numberValue, passengerFields, paymentFields, personFields, pick, roomFields, shipFields, strings, supplierFields, truthy, upsellFields } from './field-map.js';
import { resolveStage } from './stage.js';
import { themeTokens } from './theme.js';

@Injectable()
export class TripsService {
  constructor(private readonly airtable: AirtableService) {}

  async snapshot(baseId: string, recordId: string, accessScope: AccessScope): Promise<TripSnapshot> {
    const booking = await this.airtable.record(baseId, 'Bookings', recordId);
    const brandId = strings(pick(booking.fields, bookingFields.brand))[0];
    const [brand, members, elements, payments, people, customers, upsells, communications] = await Promise.all([
      brandId ? this.airtable.record(baseId, 'Brands & Branches', brandId) : Promise.resolve(emptyRecord()),
      this.airtable.records(baseId, 'Members', strings(pick(booking.fields, bookingFields.member))),
      this.airtable.records(baseId, 'Bookings [Elements]', strings(pick(booking.fields, bookingFields.elements))),
      this.airtable.records(baseId, 'Bookings [Payments]', strings(pick(booking.fields, bookingFields.payments))),
      this.airtable.records(baseId, 'Customers [People]', strings(pick(booking.fields, bookingFields.people))),
      this.airtable.records(baseId, 'Customers', strings(pick(booking.fields, bookingFields.customers))),
      this.airtable.records(baseId, 'Bookings [Upsells]', strings(pick(booking.fields, bookingFields.upsells))),
      this.airtable.records(baseId, 'Bookings [Customer Communication]', strings(pick(booking.fields, bookingFields.communications)).slice(-40)),
    ]);
    const ids = linkedRecordIds(elements);
    ids.suppliers.push(...recordIds(pick(booking.fields, bookingFields.leadSupplier)));
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
      elements, payments, people, customers, upsells, communications, members, suppliers, airports, airlines, rooms, cabins, passengers, ships,
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
    const quotationAccepted = truthy(bookingValue('quotationAccepted')) || truthy(booking.fields[process.env.AIRTABLE_ACCEPTED_FIELD?.trim() || 'Quotation Accepted']);
    const tags = strings(bookingValue('tags'));
    const now = new Date();
    const version = dateTimeString(booking.fields['Last modified time']) ?? booking.createdTime ?? now.toISOString();
    const tripId = publicTripId(baseId, booking.id);
    const stage = resolveStage(status, departure, returns, quoteExpiry);
    const hideSupplierInfo = accessScope === 'fellow_traveller' || stage === 'quote' || stage === 'quote_expired';
    const graph = recordGraph(allRelated);
    const itinerary = allRelated.elements.map((record, index) => mapElement(record, tripId, index, graph, hideSupplierInfo)).filter((item) => item.status.toLowerCase() !== 'cancelled');
    const travellers = mapTravellers(allRelated.customers, allRelated.people, accessScope);
    const documents = mapDocuments(allRelated.elements, itinerary, tripId, stage, accessScope, version);
    if (quotationAccepted && accessScope === 'primary_customer') {
      documents.push(document(`${tripId}:acceptance`, 'Quotation acceptance receipt', 'Evidence of your online acceptance', 'confirmation', 'acceptance', version));
    }
    const mintReady = Boolean(firstString(brandValue('mintApiKey')) && firstString(brandValue('mintBusinessUnit')) && firstString(bookingValue('mintBookingId')).startsWith('BK.'));
    const payments = accessScope === 'primary_customer'
      ? mapPayments(booking, allRelated.payments, stage, tripId, mintReady, truthy(brandValue('mintAllowCustom')))
      : undefined;
    const destinations = mapDestinations(allRelated.locations, tripId);
    const extras = mapExtras(allRelated.upsells, graph.suppliers, tripId, hideSupplierInfo);
    const communications = mapCommunications(allRelated.communications, tripId, accessScope);
    const brandName = firstString(brandValue('name')) || 'Your travel company';
    const protection = mapProtection(bookingValue, itinerary, brand, allRelated.members[0], graph.suppliers);
    if (accessScope === 'primary_customer') {
      for (const payment of payments?.items.filter((item) => item.status === 'paid') ?? []) {
        documents.push(document(`${tripId}:receipt:${payment.id}`, `Payment receipt · ${payment.label}`, `${payment.completedDate ?? 'Payment received'} · ${formatMoney(payment.amount, payment.currency)}`, 'receipt', `receipt:${payment.id}`, `${version}:${payment.completedDate ?? payment.id}`));
      }
      if (protection.scheme === 'atol' && ((payments?.paid ?? 0) > 0 || !['quote', 'quote_expired'].includes(stage))) {
        documents.push(document(`${tripId}:atol`, 'ATOL Certificate', `Financial protection · ATOL ${protection.atolNumber ?? ''}`.trim(), 'atol', 'atol', version));
      }
    }
    const summary = {
      reference: firstString(bookingValue('reference')) || 'Your trip', name: firstString(bookingValue('name')) || 'Your trip',
      departureDate: departure, returnDate: returns, heroImageUrl: firstAttachmentUrl(bookingValue('hero')), gallery: attachmentImages(bookingValue('gallery')),
      durationDays: tripDuration(bookingValue('duration'), departure, returns), countries: strings(bookingValue('countries')).map(safeText).filter(Boolean),
      holidayTypes: strings(bookingValue('holidayTypes')).map(safeText).filter(Boolean), travellerType: safeText(bookingValue('travellerType')) || null,
      sector: safeText(bookingValue('sector')) || null, totalTravellers: Math.max(numberValue(bookingValue('totalTravellers')), travellers.length),
      groupBooking: truthy(bookingValue('group')), giftVoucher: truthy(bookingValue('giftVoucher')),
    };

    return {
      schemaVersion: 3,
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
        name: brandName,
        logoUrl: firstAttachmentUrl(brandValue('logo')),
        theme: themeTokens({
          tags,
          configuredTheme: firstString(brandValue('theme')),
          primaryColor: firstString(brandValue('colour')),
          secondaryColor: firstString(brandValue('colour2')),
          displayFont: firstString(brandValue('fontDisplay')),
          bodyFont: firstString(brandValue('fontBody')),
        }),
        profile: mapBrandProfile(brandValue),
      },
      summary,
      experience: {
        overview: safeText(bookingValue('overview')) || null,
        personalisedMessage: bookingValue('includeMessage') === undefined || truthy(bookingValue('includeMessage'))
          ? safeText(bookingValue('personalMessage')) || null
          : null,
        agentName: safeText(bookingValue('agent')) || null,
      },
      support: {
        companyName: brandName,
        phone: safePhone(brandValue('phone')),
        email: safeEmail(brandValue('email')),
        websiteUrl: safeWebUrl(brandValue('website')),
        emergencyPhone: safePhone(bookingValue('emergencyPhone')) ?? safePhone(brandValue('emergencyPhone')),
        outOfHoursUrl: safeWebUrl(bookingValue('outOfHoursLink')) ?? safeWebUrl(brandValue('outOfHoursLink')),
        outOfHoursEmail: safeEmail(bookingValue('outOfHoursEmail')) ?? safeEmail(brandValue('outOfHoursEmail')),
      },
      protection,
      bookingStatus: {
        sourceStatus: status,
        cancellationDate: dateString(bookingValue('cancellationDate')),
        cancellationReason: stage === 'cancelled' ? safeText(bookingValue('cancellationReason')) || null : null,
        supplierTicketsReceived: truthy(bookingValue('supplierTickets')),
        supplierConfirmationsReceived: truthy(bookingValue('supplierConfirmations')),
        tasks: {
          confirmation: truthy(bookingValue('taskConfirmation')),
          reconfirmed: truthy(bookingValue('taskReconfirmed')),
          travelDocuments: truthy(bookingValue('taskDocuments')),
          preDepartureCall: truthy(bookingValue('taskPredeparture')),
          followUp: truthy(bookingValue('taskFollowup')),
        },
      },
      quotation: {
        status: stage === 'quote' ? 'available' : stage === 'quote_expired' ? 'expired' : 'not_applicable',
        expiresAt: quoteExpiry,
        canAccept: accessScope === 'primary_customer' && stage === 'quote' && !quotationAccepted,
        requiredConfirmations: stage === 'quote' ? ['package', 'names', 'important', 'protection', 'terms'] : [],
        reviewSections: stage === 'quote' ? mapQuotationReview(summary, travellers, itinerary, payments, protection, brandName) : [],
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
        acceptQuotation: accessScope === 'primary_customer' && stage === 'quote' && !quotationAccepted,
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

function mapBrandProfile(brandValue: (key: keyof typeof brandFields) => unknown): TripSnapshot['brand']['profile'] {
  const socialLinks = ([['instagram', 'instagram'], ['facebook', 'facebook'], ['linkedin', 'linkedin'], ['x', 'x']] as const)
    .flatMap(([network, key]) => { const url = safeWebUrl(brandValue(key)); return url ? [{ network, url }] : []; });
  const reviewLinks = ([['trustpilot', 'trustpilot'], ['google', 'googleReviews']] as const)
    .flatMap(([provider, key]) => { const url = safeWebUrl(brandValue(key)); return url ? [{ provider, url }] : []; });
  const physical = safeText(brandValue('physicalAddress'));
  const address = physical || [safeText(brandValue('address1')), safeText(brandValue('address2')), safeText(brandValue('town')), safeText(brandValue('postcode')), safeText(brandValue('country'))].filter(Boolean).join(', ');
  return {
    slogan: safeText(brandValue('slogan')) || null,
    about: safeText(brandValue('about')) || null,
    address: address || null,
    openingHours: safeText(brandValue('hours')) || null,
    socialLinks,
    reviewLinks,
    privacyUrl: safeWebUrl(brandValue('privacy')),
    complaintsUrl: safeWebUrl(brandValue('complaints')),
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

function mapTravellers(customers: AirtableRecord[], people: AirtableRecord[], accessScope: AccessScope): TravellerSummary[] {
  const rows: TravellerSummary[] = [];
  const lead = customers[0];
  if (lead) {
    const first = firstString(pick(lead.fields, customerFields.first));
    const last = firstString(pick(lead.fields, customerFields.last));
    rows.push({ name: firstString(pick(lead.fields, customerFields.name)) || `${first} ${last}`.trim(), firstName: first, isLead: true, assistance: [], meals: [], nationality: null, passportExpiry: null, insuranceStatus: null });
  }
  for (const person of people) {
    const first = firstString(pick(person.fields, personFields.first));
    const last = firstString(pick(person.fields, personFields.last));
    const name = firstString(pick(person.fields, personFields.name)) || `${first} ${last}`.trim();
    if (!name || rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) continue;
    rows.push({ name, firstName: first, isLead: false, assistance: strings(pick(person.fields, personFields.ssr)), meals: strings(pick(person.fields, personFields.meal)), nationality: accessScope === 'primary_customer' ? safeText(pick(person.fields, personFields.nationality)) || null : null, passportExpiry: accessScope === 'primary_customer' ? dateString(pick(person.fields, personFields.passportExpiry)) : null, insuranceStatus: accessScope === 'primary_customer' ? safeText(pick(person.fields, personFields.insurance)) || null : null });
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
  members: AirtableRecord[];
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

type RecordGraph = { [K in Exclude<keyof RelatedRecords, 'elements' | 'payments' | 'people' | 'customers' | 'upsells' | 'communications' | 'members'>]: Map<string, AirtableRecord> };

function emptyRelated(): RelatedRecords {
  return { elements: [], payments: [], people: [], customers: [], upsells: [], communications: [], members: [], suppliers: [], airports: [], airlines: [], rooms: [], cabins: [], passengers: [], ships: [], cruisePorts: [], locations: [], operators: [] };
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
  const fromAirport = firstLinked(value('from'), graph.airports);
  const toAirport = firstLinked(value('to'), graph.airports);
  const flightNumber = safeText(value('flightNumber')).replace(/\s/g, '') || null;
  const carrierCode = (recordText(carrierRecord, airlineFields.iata) || safeText(value('iata')) || flightNumber?.match(/^([A-Z0-9]{2})/i)?.[1] || '').toUpperCase() || null;
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
    flightNumber,
    reference: supplierHidden ? null : safeText(value('supplierReference')) || null,
    address: safeText(value('address')) || null,
    notes: safeText(value('notes')) || null,
    supplier: supplierHidden || !supplierName ? null : { name: supplierName, logoUrl: firstAttachmentUrl(supplierRecord?.fields ? pick(supplierRecord.fields, supplierFields.logo) : undefined), termsUrl: safeUrl(supplierRecord?.fields ? pick(supplierRecord.fields, supplierFields.terms) : undefined) },
    images: attachmentImages(value('images')),
    rooms, cabins, passengers, cruisePorts,
    emergencyContact: emergencyContact(value('emergencyName'), value('emergencyPhone')),
    details: elementDetails(kind, value),
    fromCode: (recordText(fromAirport, airportFields.iata) || safeText(value('fromCode'))).toUpperCase() || null,
    toCode: (recordText(toAirport, airportFields.iata) || safeText(value('toCode'))).toUpperCase() || null,
    carrierCode,
    carrierLogoUrl: firstAttachmentUrl(carrierRecord?.fields ? pick(carrierRecord.fields, airlineFields.logo) : undefined),
    arrivesNextDay: kind === 'flight' && Boolean(dateString(value('start')) && dateString(value('end')) && dateString(value('start')) !== dateString(value('end'))),
    packageIncluded: truthy(value('package')),
    termsUrl: safeWebUrl(value('termsUrl')),
    confirmationReceived: truthy(value('confirmationReceived')),
    ticketsReceived: truthy(value('ticketsReceived')),
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
  brand: AirtableRecord,
  member: AirtableRecord | undefined,
  suppliers: Map<string, AirtableRecord>,
): TripSnapshot['protection'] {
  const selection = safeText(bookingValue('atol'));
  const atolNumber = safeText(bookingValue('atolNumber')) || null;
  const licensing = safeText(bookingValue('licensing')) || null;
  const normalized = (licensing ?? '').toLowerCase();
  const hasFlight = itinerary.some((item) => item.kind === 'flight');
  const proposition = (safeText(bookingValue('memberProposition')) || recordText(brand, brandFields.proposition) || recordText(member, memberFields.proposition)).toLowerCase();
  const memberName = safeText(bookingValue('memberCompany')) || recordText(member, memberFields.company) || recordText(brand, brandFields.company) || recordText(brand, brandFields.name);
  const leadSupplier = firstLinked(bookingValue('leadSupplier'), suppliers);
  const leadSupplierName = recordText(leadSupplier, supplierFields.name);
  let mode = resolveProtectionMode(selection, hasFlight, proposition === 'global');
  let contractType: TripSnapshot['protection']['contractType'] = mode === 'principal_package_no_flight' ? 'package_no_flight' : mode.includes('flight_only') ? 'flight_only' : mode.startsWith('agent_') || mode.startsWith('principal_') ? 'package' : 'unknown';
  if (normalized.includes('airline ticket agent')) { mode = 'not_applicable'; contractType = 'ticket_agent'; }
  else if (normalized.includes('accommodation only')) { mode = 'not_applicable'; contractType = 'accommodation_only'; }
  else if (normalized.includes('non-air package')) { mode = 'principal_package_no_flight'; contractType = 'package_no_flight'; }
  else if (normalized.includes('other sales as an agent')) { mode = 'not_applicable'; contractType = 'agent_services'; }
  else if (normalized.includes("other atol holders' packages") || normalized.includes('atol to atol')) { mode = normalized.includes('multi') ? 'agent_multi_contract' : 'agent_single_contract'; contractType = 'package'; }
  else if (normalized.includes('flight-only sales as agent')) { mode = 'agent_flight_only'; contractType = 'flight_only'; }
  else if (normalized.includes('flight-only')) { mode = 'principal_flight_only'; contractType = 'flight_only'; }
  else if (normalized.includes('package (principal')) { mode = normalized.includes('multi') ? 'principal_multi_contract' : 'principal_single_contract'; contractType = 'package'; }

  const tAtolEnabled = member ? truthy(pick(member.fields, memberFields.tAtolEnabled)) : false;
  const tAtolNumber = member ? recordText(member, memberFields.tAtolNumber) : '';
  const memberHoldsAtol = proposition === 'global' || proposition === 'ite' || truthy(bookingValue('useGlobalAtol')) || (tAtolEnabled && Boolean(tAtolNumber));
  if (mode.startsWith('principal_') && mode !== 'principal_package_no_flight' && !memberHoldsAtol) mode = mode.includes('flight_only') ? 'agent_flight_only' : mode.includes('multi') ? 'agent_multi_contract' : 'agent_single_contract';
  let holderName = mode.startsWith('agent_') ? leadSupplierName : memberName;
  let holderNumber = atolNumber;
  if (mode.startsWith('principal_') && (proposition === 'global' || truthy(bookingValue('useGlobalAtol')))) { holderName = 'The Global Travel Group Ltd'; holderNumber = '3973'; }
  else if (mode.startsWith('principal_') && proposition === 'ite') { holderName = 'Independent Travel Experts Ltd'; holderNumber = 'T7400'; }
  else if (mode.startsWith('principal_') && tAtolEnabled && tAtolNumber) holderNumber = tAtolNumber;
  const atolApplies = hasFlight && (mode.startsWith('agent_') || (mode.startsWith('principal_') && mode !== 'principal_package_no_flight')) && contractType !== 'ticket_agent';
  const scheme: TripSnapshot['protection']['scheme'] = atolApplies ? 'atol' : contractType === 'package_no_flight' ? 'non_air_package' : ['accommodation_only', 'agent_services', 'ticket_agent'].includes(contractType) || /not applicable/i.test(selection) ? 'not_applicable' : 'unknown';
  const summary = scheme === 'atol'
    ? `This flight-inclusive booking is protected by ${holderName || 'the package organiser'}${holderNumber ? ` under ATOL ${holderNumber}` : ''}. See your ATOL certificate for full details.`
    : scheme === 'non_air_package' ? 'This is a package without a flight; check your booking confirmation for its financial protection.'
    : scheme === 'not_applicable' ? 'ATOL protection does not apply to this booking.'
    : 'See your booking confirmation for the financial protection that applies to this trip.';
  return { scheme, atolNumber: holderNumber, licensing, summary, mode, contractType, holderName: holderName || null, organiserName: (mode.startsWith('agent_') ? leadSupplierName : memberName) || null, hasFlight };
}

function resolveProtectionMode(selection: string, hasFlight: boolean, isGlobal: boolean): string {
  const value = selection.toLowerCase().replace(/\s+/g, ' ').trim();
  if (value.includes('agent of atol holder')) return value.includes('flight only') ? 'agent_flight_only' : value.includes('multi') ? 'agent_multi_contract' : 'agent_single_contract';
  if (value.includes('not applicable') || ['n/a', 'na'].includes(value)) return 'not_applicable';
  if (value.includes('single') && value.includes('no flight')) return 'principal_package_no_flight';
  if (value.includes('multi')) return 'principal_multi_contract';
  if (value.includes('single')) return 'principal_single_contract';
  if (value.includes('flight only') || value.includes('flight-only')) return 'principal_flight_only';
  if (isGlobal && hasFlight) return 'principal_single_contract';
  return hasFlight ? 'agent_single_contract' : 'not_applicable';
}

function mapPayments(booking: AirtableRecord, records: AirtableRecord[], stage: string, tripId: string, mintReady: boolean, allowCustom: boolean) {
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
      canPay: !paid && !local && !refund && amount > 0 && (Boolean(paymentUrl) || mintReady) && (stage !== 'quote' || truthy(value('showOnQuote'))),
      actionUrl: !paid && !local && !refund && amount > 0 && (stage !== 'quote' || truthy(value('showOnQuote'))) ? paymentUrl : null,
    };
  }).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const alternativeType = safeText(pick(booking.fields, bookingFields.alternativeCurrencyType)).toUpperCase();
  const alternativeAmount = alternativeType === 'USD' ? optionalNumber(pick(booking.fields, bookingFields.usdAmount)) : alternativeType === 'EUR' ? optionalNumber(pick(booking.fields, bookingFields.eurAmount)) : null;
  return {
    currency,
    total: numberValue(pick(booking.fields, bookingFields.total)),
    paid: numberValue(pick(booking.fields, bookingFields.paid)),
    balance: numberValue(pick(booking.fields, bookingFields.balance)),
    items,
    totalIncludingResort: optionalNumber(pick(booking.fields, bookingFields.totalIncludingResort)),
    nextDueAmount: optionalNumber(pick(booking.fields, bookingFields.nextDueAmount)),
    nextDueDate: dateString(pick(booking.fields, bookingFields.nextDueDate)),
    balanceDueDate: dateString(pick(booking.fields, bookingFields.balanceDueDate)),
    alternativeCurrency: truthy(pick(booking.fields, bookingFields.alternativeCurrency)) && ['USD', 'EUR'].includes(alternativeType) && alternativeAmount !== null
      ? { currency: alternativeType, amount: alternativeAmount }
      : null,
    customPayments: { enabled: mintReady && allowCustom && !['quote_expired', 'closed', 'cancelled', 'past'].includes(stage) && numberValue(pick(booking.fields, bookingFields.balance)) > 0, minimum: 0.01, maximum: Math.min(100_000, Math.max(0, numberValue(pick(booking.fields, bookingFields.balance)))) },
  };
}

function mapQuotationReview(
  summary: TripSnapshot['summary'],
  travellers: TravellerSummary[],
  itinerary: ItineraryItem[],
  payments: TripSnapshot['payments'],
  protection: TripSnapshot['protection'],
  brandName: string,
): TripSnapshot['quotation']['reviewSections'] {
  const money = (amount: number, currency: string) => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
  const terms = new Map<string, string>();
  for (const item of itinerary) {
    if (item.termsUrl) terms.set(`${item.typeLabel} terms`, item.termsUrl);
    if (item.supplier?.termsUrl) terms.set(`${item.supplier.name} terms`, item.supplier.termsUrl);
  }
  const packageNotice = ['package', 'package_no_flight'].includes(protection.contractType)
    ? `The combination of travel services is a package under the Package Travel and Linked Travel Arrangements Regulations 2018. ${protection.organiserName || brandName} is responsible for proper performance of the package.`
    : `The travel services may be arranged under separate contracts. ${brandName} acts in the capacity described in your quotation and each provider remains responsible for its service.`;
  return [
    {
      id: 'package', title: 'What you are booking', introduction: 'Check the dates, itinerary, total price and payment schedule before accepting.',
      items: [
        `${summary.name} · ${summary.departureDate || 'Dates to be confirmed'}${summary.returnDate ? ` to ${summary.returnDate}` : ''}`,
        ...itinerary.map((item) => `${item.typeLabel}: ${item.title}${item.startDate ? ` · ${item.startDate}` : ''}`),
        ...(payments ? [`Total price: ${money(payments.total, payments.currency)}`, ...payments.items.filter((item) => item.status === 'outstanding' || item.status === 'overdue').map((item) => `${item.label}: ${money(item.amount, item.currency)}${item.dueDate ? ` due ${item.dueDate}` : ''}`)] : []),
      ], links: [],
    },
    {
      id: 'names', title: 'Traveller names', introduction: 'Names must match the travel documents that will be used for the trip.',
      items: travellers.length ? travellers.map((traveller) => `${traveller.name}${traveller.isLead ? ' · lead traveller' : ''}`) : ['Traveller names are shown on the quotation supplied by your travel agent.'], links: [],
    },
    {
      id: 'important', title: 'Important information', introduction: 'Travel bookings for specific dates do not have a general 14-day cooling-off period.',
      items: ['Cancellation charges apply as set out in the booking conditions and usually increase closer to departure.', 'Check passport, visa and health requirements for every traveller.', 'Comprehensive travel insurance is strongly recommended from the time of booking.', 'Tell your travel agent about assistance needs, dietary requirements or other special requests before accepting.'], links: [],
    },
    {
      id: 'protection', title: 'Who you are booking with and financial protection', introduction: packageNotice,
      items: [protection.summary, `Organiser: ${protection.organiserName || brandName}`, ...(protection.holderName ? [`Protection holder: ${protection.holderName}`] : []), ...(protection.atolNumber ? [`ATOL number: ${protection.atolNumber}`] : [])],
      links: [{ label: 'Package Travel Regulations 2018', url: protection.contractType === 'package' || protection.contractType === 'package_no_flight' ? 'https://www.legislation.gov.uk/uksi/2018/634/schedule/1' : 'https://www.legislation.gov.uk/uksi/2018/634/schedule/2' }],
    },
    {
      id: 'terms', title: 'Terms and conditions', introduction: 'Open the applicable booking conditions and make sure you understand them before accepting.',
      items: terms.size ? ['The links below form part of your quotation and acceptance.'] : ['No separate online terms links were supplied. Contact your travel agent if you need a copy before accepting.'],
      links: [...terms].map(([label, url]) => ({ label, url })),
    },
  ];
}

function mapDocuments(records: AirtableRecord[], itinerary: ItineraryItem[], tripId: string, stage: string, accessScope: AccessScope, version: string): TripDocument[] {
  const isQuote = stage === 'quote' || stage === 'quote_expired';
  const documents: TripDocument[] = [document(`${tripId}:confirmation`, isQuote ? 'Trip quotation' : 'Booking confirmation', 'Full itinerary and important information', 'confirmation', 'confirmation', version)];
  if (accessScope === 'primary_customer' && !isQuote) {
    documents.push(document(`${tripId}:invoice`, 'Booking invoice', 'Your booking costs and payment history', 'invoice', 'invoice', version));
  }
  records.forEach((record, index) => {
    const attachments = pick(record.fields, elementFields.docs);
    if (!Array.isArray(attachments)) return;
    attachments.forEach((attachment, attachmentIndex) => {
      const file = attachment as { url?: unknown; filename?: unknown };
      if (typeof file.url !== 'string' || !file.url.startsWith('https://')) return;
      const id = publicChildId(tripId, `${record.id}:${attachmentIndex}`, 'doc');
      documents.push({ ...document(id, safeText(file.filename) || 'Travel document', itinerary[index]?.title ?? 'Trip document', 'supplier', `supplier:${id}`, `${version}:${file.url}`), url: file.url, mimeType: safeText((attachment as { type?: unknown }).type) || 'application/octet-stream' });
    });
  });
  return documents;
}

function document(id: string, title: string, description: string, kind: TripDocument['kind'], action: string, version: string): TripDocument {
  return { id, title, description, kind, url: null, offlineAvailable: true, status: 'ready', downloadAction: action, version: createHash('sha256').update(version).digest('base64url').slice(0, 16), updatedAt: /^\d{4}-/.test(version) ? version.slice(0, 24) : new Date().toISOString(), mimeType: 'application/pdf' };
}

function formatMoney(amount: number, currency: string): string { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount); }

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

function tripDuration(value: unknown, departure: string | null, returns: string | null): number | null {
  const configured = optionalNumber(value);
  if (configured !== null && configured >= 0) return Math.round(configured);
  if (!departure || !returns) return null;
  return Math.max(0, Math.round((Date.parse(`${returns}T00:00:00Z`) - Date.parse(`${departure}T00:00:00Z`)) / 86_400_000));
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
