import { Injectable } from '@nestjs/common';
import type { AccessScope, ItineraryImage, PaymentStatusResponse, CabinDetail, CruisePort, ItineraryItem, ItineraryKind, PassengerAllocation, PaymentItem, RoomDetail, TravellerSummary, TripDocument, TripSnapshot } from '@vision-trips/contracts';
import { createHash, createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { airlineFields, airportFields, bookingFields, brandFields, brandTemplateFields, cabinFields, communicationFields, cruisePortFields, customerFields, elementFields, attachmentImage, firstAttachmentImage, firstAttachmentThumbnail, firstAttachmentUrl, firstString, locationFields, memberFields, numberValue, passengerFields, paymentFields, personFields, pick, roomFields, shipFields, strings, supplierFields, truthy, upsellFields, currencyCode, moneyValue, paymentAmount, PAYABLE_CURRENCIES, formatMoney, dateString } from './field-map.js';
import { resolveStage } from './stage.js';
import { themeTokens } from './theme.js';

export interface InvitationContext {
  tenantId: string | null;
  tripName: string;
  customer: { email: string; firstName: string | null } | null;
  brand: { name: string; logoUrl: string | null; primaryColor: string | null; supportEmail: string | null; supportPhone: string | null };
}

export class InvitationTargetError extends Error {
  constructor(readonly reason: 'customer_not_linked' | 'customer_email_missing') { super(reason); this.name = 'InvitationTargetError'; }
}

@Injectable()
export class TripsService {
  constructor(private readonly airtable: AirtableService) {}

  /**
   * Payment totals and per-instalment status from just the booking and its payment records (2 Airtable reads instead
   * of ~20 for a full snapshot). IDs and statuses match the snapshot, so the app can compare them directly.
   */
  async paymentStatus(baseId: string, recordId: string): Promise<PaymentStatusResponse> {
    const booking = await this.airtable.record(baseId, 'Bookings', recordId);
    const records = await this.airtable.records(baseId, 'Bookings [Payments]', strings(pick(booking.fields, bookingFields.payments)));
    const tripId = publicTripId(baseId, booking.id);
    // Stage and Mint readiness only affect whether "Pay now" is offered, not the status, so neutral values are fine here.
    const payments = mapPayments(booking, records, 'confirmed', tripId, false, false);
    return {
      tripId, checkedAt: new Date().toISOString(), currency: payments.currency, total: payments.total, paid: payments.paid, balance: payments.balance,
      items: payments.items.map(({ id, status, completedDate }) => ({ id, status, completedDate })),
    };
  }

  async snapshot(baseId: string, recordId: string, accessScope: AccessScope): Promise<TripSnapshot> {
    const booking = await this.airtable.record(baseId, 'Bookings', recordId);
    const brandId = strings(pick(booking.fields, bookingFields.brand))[0];
    const [brand, members, elements, payments, people, customers, upsells, communications] = await Promise.all([
      // Only the booking itself is required; an unreadable brand falls back to defaults like a booking without one.
      brandId ? this.airtable.record(baseId, 'Brands & Branches', brandId).catch(() => emptyRecord()) : Promise.resolve(emptyRecord()),
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
    const [suppliers, airports, airlines, rooms, cabins, passengers, ships, cruisePorts, locations, operators, brandTemplates] = await Promise.all([
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
      this.airtable.records(baseId, process.env.AIRTABLE_BRAND_TEMPLATES_TABLE?.trim() || 'Brands & Branches [Templates]', strings(pick(brand.fields, brandFields.templates))),
    ]);
    const portLocationIds = cruisePorts.flatMap((record) => recordIds(pick(record.fields, cruisePortFields.port)));
    const portLocations = await this.airtable.records(baseId, 'CMS [Locations]', portLocationIds);
    return this.mapSnapshot(baseId, booking, brand, accessScope, {
      elements, payments, people, customers, upsells, communications, members, suppliers, airports, airlines, rooms, cabins, passengers, ships,
      cruisePorts, locations: [...locations, ...portLocations], operators, brandTemplates,
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

  /**
   * The minimum needed to invite a Customer to a Booking and to brand the invitation pages and emails: the Booking,
   * its Brand and the Customer (three Airtable reads, not a full snapshot). Throws InvitationTargetError when the
   * Customer is not linked to the Booking or has no usable email address.
   */
  async invitationContext(baseId: string, bookingRecordId: string, customerRecordId: string | null): Promise<InvitationContext> {
    const booking = await this.airtable.record(baseId, 'Bookings', bookingRecordId);
    const brandId = strings(pick(booking.fields, bookingFields.brand))[0] ?? null;
    const linkedCustomers = strings(pick(booking.fields, bookingFields.customers));
    if (customerRecordId && !linkedCustomers.includes(customerRecordId)) throw new InvitationTargetError('customer_not_linked');
    const [brand, customer] = await Promise.all([
      brandId ? this.airtable.record(baseId, 'Brands & Branches', brandId).catch(() => emptyRecord()) : Promise.resolve(emptyRecord()),
      customerRecordId ? this.airtable.record(baseId, process.env.AIRTABLE_CUSTOMERS_TABLE?.trim() || 'Customers', customerRecordId) : Promise.resolve(null),
    ]);
    const email = customer ? safeEmail(pick(customer.fields, customerFields.primaryEmail)) ?? safeEmail(pick(customer.fields, customerFields.secondaryEmail)) : null;
    if (customer && !email) throw new InvitationTargetError('customer_email_missing');
    const colour = firstString(pick(brand.fields, brandFields.colour)).trim();
    return {
      tenantId: brandId,
      tripName: safeText(pick(booking.fields, bookingFields.name)) || 'Your trip',
      customer: customer && email ? { email, firstName: safeText(pick(customer.fields, customerFields.first)) || null } : null,
      brand: {
        name: safeText(pick(brand.fields, brandFields.name)) || 'Your travel company',
        logoUrl: safeHttpsUrl(firstAttachmentUrl(pick(brand.fields, brandFields.logo))),
        primaryColor: /^#[0-9A-Fa-f]{6}$/.test(colour) ? colour : null,
        supportEmail: safeEmail(pick(brand.fields, brandFields.email)),
        supportPhone: safeText(pick(brand.fields, brandFields.phone)) || null,
      },
    };
  }

  /**
   * The Customer a legacy link or an older session most likely belongs to: the linked Customer whose email matches the
   * Booking's `Customers | Email`, otherwise the first linked Customer with an email address.
   */
  async primaryCustomerRecordId(baseId: string, bookingRecordId: string): Promise<string | null> {
    const booking = await this.airtable.record(baseId, 'Bookings', bookingRecordId);
    const bookingEmail = safeEmail(pick(booking.fields, bookingFields.customerEmail));
    const customers = await this.airtable.records(baseId, process.env.AIRTABLE_CUSTOMERS_TABLE?.trim() || 'Customers', strings(pick(booking.fields, bookingFields.customers)));
    const withEmail = customers.filter((record) => safeEmail(pick(record.fields, customerFields.primaryEmail)) ?? safeEmail(pick(record.fields, customerFields.secondaryEmail)));
    const matching = bookingEmail ? withEmail.find((record) => [customerFields.primaryEmail, customerFields.secondaryEmail].some((field) => safeEmail(pick(record.fields, field)) === bookingEmail)) : undefined;
    return (matching ?? withEmail[0])?.id ?? null;
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
    const surpriseEnabled = process.env.SURPRISE_MODE !== 'false' && truthy(bookingValue('surprise'));
    const surpriseConcealed = surpriseEnabled && ['confirmed', 'countdown', 'prep'].includes(stage);
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
      if (!['quote', 'quote_expired'].includes(stage)) documents.push(document(`${tripId}:front-file`, 'Booking front file', 'Printable booking overview, travellers, itinerary and payments', 'front_file', 'front-file', version));
      if (protection.guaranteeAvailable) documents.push(document(`${tripId}:guarantee`, 'Safe Seat Plan guarantee', 'Travel Trust Association financial guarantee certificate', 'guarantee', 'guarantee', version));
      for (const template of mapLetterTemplates(allRelated.brandTemplates, tripId)) documents.push(document(`${tripId}:letter:${template.id}`, template.name, template.subject || 'Personal letter from your travel expert', 'letter', `letter:${template.id}`, `${version}:${template.id}:${template.body}`));
      for (const payment of payments?.items.filter((item) => item.status === 'paid') ?? []) {
        documents.push(document(`${tripId}:receipt:${payment.id}`, `Payment receipt · ${payment.label}`, `${payment.completedDate ?? 'Payment received'} · ${formatMoney(payment.amount, payment.currency)}`, 'receipt', `receipt:${payment.id}`, `${version}:${payment.completedDate ?? payment.id}`));
      }
      if (protection.scheme === 'atol' && ((payments?.paid ?? 0) > 0 || !['quote', 'quote_expired'].includes(stage))) {
        documents.push(document(`${tripId}:atol`, 'ATOL Certificate', `Financial protection · ATOL ${protection.atolNumber ?? ''}`.trim(), 'atol', 'atol', version));
      }
    }
    const summary = {
      reference: firstString(bookingValue('reference')) || 'Your trip', name: firstString(bookingValue('name')) || 'Your trip',
      departureDate: departure, returnDate: returns, heroImageUrl: firstAttachmentUrl(bookingValue('hero')), heroImage: heroImage(firstAttachmentImage(bookingValue('hero'))), gallery: attachmentImages(bookingValue('gallery')),
      durationDays: tripDuration(bookingValue('duration'), departure, returns), countries: strings(bookingValue('countries')).map(safeText).filter(Boolean),
      holidayTypes: strings(bookingValue('holidayTypes')).map(safeText).filter(Boolean), travellerType: safeText(bookingValue('travellerType')) || null,
      sector: safeText(bookingValue('sector')) || null, totalTravellers: Math.max(numberValue(bookingValue('totalTravellers')), travellers.length),
      groupBooking: truthy(bookingValue('group')), giftVoucher: truthy(bookingValue('giftVoucher')),
    };
    const visibleSummary = surpriseConcealed ? {
      ...summary, name: 'Your surprise trip', heroImageUrl: null, heroImage: null, gallery: [], countries: [], holidayTypes: [], travellerType: null, sector: null,
    } : summary;
    const visibleItinerary = surpriseConcealed ? [] : itinerary;
    const visibleDestinations = surpriseConcealed ? [] : destinations;
    const visibleExtras = surpriseConcealed ? [] : extras;
    const visibleDocuments = surpriseConcealed ? documents.filter((item) => item.kind !== 'supplier') : documents;

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
        profile: mapBrandProfile(brandValue, allRelated.brandTemplates, tripId),
      },
      summary: visibleSummary,
      experience: {
        overview: surpriseConcealed ? null : safeText(bookingValue('overview')) || null,
        personalisedMessage: !surpriseConcealed && (bookingValue('includeMessage') === undefined || truthy(bookingValue('includeMessage')))
          ? safeText(bookingValue('personalMessage')) || null
          : null,
        agentName: safeText(bookingValue('agent')) || null,
        surprise: { enabled: surpriseEnabled, concealed: surpriseConcealed, revealAt: surpriseEnabled ? departure : null },
      },
      support: {
        companyName: brandName,
        phone: safePhone(brandValue('phone')),
        email: safeEmail(brandValue('email')),
        websiteUrl: safeWebUrl(brandValue('website')),
        emergencyPhone: safePhone(bookingValue('emergencyPhone')) ?? safePhone(brandValue('emergencyPhone')),
        outOfHoursUrl: safeWebUrl(bookingValue('outOfHoursLink')) ?? safeWebUrl(brandValue('outOfHoursLink')),
        outOfHoursEmail: safeEmail(bookingValue('outOfHoursEmail')) ?? safeEmail(brandValue('outOfHoursEmail')),
        whatsappUrl: whatsappUrl(safePhone(brandValue('phone'))),
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
      timeline: mapTimeline(visibleItinerary, departure, now),
      bookingJourney: mapBookingJourney({
        stage, departure, returns, itinerary: visibleItinerary, payments, extras: visibleExtras,
        tasks: {
          confirmation: truthy(bookingValue('taskConfirmation')),
          reconfirmed: truthy(bookingValue('taskReconfirmed')),
          travelDocuments: truthy(bookingValue('taskDocuments')),
          preDepartureCall: truthy(bookingValue('taskPredeparture')),
          followUp: truthy(bookingValue('taskFollowup')),
        },
      }),
      destinations: visibleDestinations,
      extras: visibleExtras,
      communications,
      integrations: {
        liveFlightStatus: visibleItinerary.some((item) => item.kind === 'flight') ? (process.env.FLIGHT_API_KEY ? 'available' : 'not_configured') : 'not_applicable',
        weather: visibleDestinations.length ? (process.env.WEATHER_ENABLED === 'false' ? 'not_configured' : 'available') : 'not_applicable',
        destinationGuides: visibleDestinations.length && (process.env.AI_API_KEY || visibleDestinations.some((destination) => destination.overview || destination.imageUrl)) ? 'available' : 'not_available',
      },
      travellers,
      itinerary: visibleItinerary,
      ...(payments ? { payments } : {}),
      documents: visibleDocuments,
      capabilities: {
        acceptQuotation: accessScope === 'primary_customer' && stage === 'quote' && !quotationAccepted,
        makePayment: accessScope === 'primary_customer' && !['closed', 'cancelled', 'quote_expired'].includes(stage),
        shareWithTraveller: accessScope === 'primary_customer',
        sendMessage: true,
      },
    };
  }
}

function mapBookingJourney(input: {
  stage: TripSnapshot['stage']; departure: string | null; returns: string | null; itinerary: ItineraryItem[];
  payments: TripSnapshot['payments']; extras: TripSnapshot['extras']; tasks: TripSnapshot['bookingStatus']['tasks'];
}): TripSnapshot['bookingJourney'] {
  // An unknown balance is neither paid nor owed: say so instead of guessing.
  const balanceKnown = input.payments?.balance !== null && input.payments?.balance !== undefined;
  const balanceDone = !input.payments || (balanceKnown && input.payments.balance! <= 0);
  const balanceDate = input.payments?.balanceDueDate ?? input.payments?.nextDueDate ?? null;
  const raw = [
    { id: 'confirmation' as const, title: 'Confirmation', description: 'We confirm every part of your booking with the suppliers.', date: null, done: input.tasks.confirmation || !['quote', 'quote_expired'].includes(input.stage) },
    { id: 'balance' as const, title: 'Balance payment', description: balanceDone ? 'Your booking balance is paid.' : balanceKnown ? `Your remaining balance is ${formatMoney(input.payments?.balance, input.payments?.currency ?? 'GBP')}.` : 'Your travel agent will confirm your remaining balance.', date: balanceDate, done: balanceDone },
    { id: 'reconfirmation' as const, title: 'Reconfirmation', description: 'We recheck the important arrangements shortly before travel.', date: shiftDate(input.departure, -14), done: input.tasks.reconfirmed },
    { id: 'documents' as const, title: 'Travel documents', description: 'Your final documents are prepared and added to your travel wallet.', date: shiftDate(input.departure, -10), done: input.tasks.travelDocuments },
    { id: 'pre_departure_call' as const, title: 'Pre-departure call', description: 'Your travel expert checks that you are ready and answers final questions.', date: shiftDate(input.departure, -3), done: input.tasks.preDepartureCall },
    { id: 'post_trip_follow_up' as const, title: 'Post-trip follow-up', description: 'We get in touch after you return to hear how everything went.', date: shiftDate(input.returns, 5), done: input.tasks.followUp },
  ];
  const firstIncomplete = raw.findIndex((step) => !step.done);
  const steps = raw.map((step, index) => ({ ...step, status: step.done ? 'complete' as const : index === firstIncomplete ? 'current' as const : 'upcoming' as const }));
  const hasFlight = input.itinerary.some((item) => item.kind === 'flight');
  const hasStay = input.itinerary.some((item) => item.kind === 'stay');
  const hasCruise = input.itinerary.some((item) => item.kind === 'cruise');
  const has = (kind: ItineraryKind) => input.itinerary.some((item) => item.kind === kind);
  const faqs: TripSnapshot['bookingJourney']['faqs'] = [
    { id: 'changes', question: 'Can I make changes to this trip?', answer: input.stage === 'quote' ? 'Yes. Ask your travel expert before accepting and they can revise the quotation, subject to availability.' : 'Ask your travel expert as soon as possible. Supplier availability, amendment charges and fare rules may apply.' },
    ...(input.payments && (!balanceKnown || input.payments.balance! > 0) ? [{ id: 'balance', question: 'When is my balance due?', answer: balanceDate ? `Your current balance due date is ${balanceDate}. The Payments screen shows the latest amount and payment options.` : 'Open the Payments screen for the latest balance, or ask your travel expert to confirm the due date.' }] : []),
    { id: 'documents', question: 'When will I receive my travel documents?', answer: input.tasks.travelDocuments ? 'Your available documents are already in the Documents wallet.' : 'Final documents are normally added after supplier reconfirmation, usually around 7–14 days before departure.' },
    ...(hasFlight ? [{ id: 'flight', question: 'What if my flight time changes?', answer: 'The airline or your travel expert will confirm material schedule changes. Live operational updates also appear in the app when the provider is configured.' }] : []),
    { id: 'help', question: 'Who do I contact if I need help?', answer: 'Use Help to message your travel expert. While travelling, the emergency contact is shown prominently on your Today screen.' },
  ];
  const suggestions: TripSnapshot['bookingJourney']['suggestedExtras'] = [];
  const add = (id: TripSnapshot['bookingJourney']['suggestedExtras'][number]['id'], title: string, description: string) => suggestions.push({ id, title, description, enquiry: `I would like to know more about ${title.toLowerCase()} for this trip.` });
  if (hasFlight && (hasStay || hasCruise) && !has('transfer')) add('transfers', 'Private or shared transfers', 'Make the journey between the airport, hotel or port easier.');
  if (hasFlight && !has('parking')) add('airport', 'Airport parking and lounges', 'Start the trip smoothly with parking, fast-track or lounge access.');
  if (hasFlight) add('flight_upgrade', 'Flight upgrades', 'Ask about extra legroom, premium cabins, seats and baggage.');
  if (hasStay) add('room_upgrade', 'Room upgrades', 'Explore better room categories, views or board arrangements.');
  if ((hasStay || hasCruise) && !has('attraction')) add('experiences', 'Tours and experiences', 'Pre-book memorable activities and local experiences.');
  if (hasCruise) add('cruise_packages', 'Cruise packages', 'Ask about drinks, dining, Wi-Fi and shore-excursion packages.');
  if (input.payments && balanceKnown && input.payments.balance! > 200) add('instalments', 'Instalment payments', 'Spread the remaining balance across manageable payments where available.');
  add('insurance', 'Travel insurance', 'Protect the booking with suitable cover from the day you book.');
  if ((input.itinerary.length > 0) && !['departure', 'travelling', 'returning', 'home', 'past'].includes(input.stage)) add('extra_nights', 'Extra nights', 'Extend the trip before departure or after your main itinerary.');
  return { steps, faqs, suggestedExtras: suggestions };
}

function shiftDate(value: string | null, days: number): string | null {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
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

function mapBrandProfile(brandValue: (key: keyof typeof brandFields) => unknown, brandTemplates: AirtableRecord[], tripId: string): TripSnapshot['brand']['profile'] {
  const socialLinks = ([['instagram', 'instagram'], ['facebook', 'facebook'], ['linkedin', 'linkedin'], ['x', 'x']] as const)
    .flatMap(([network, key]) => { const url = safeWebUrl(brandValue(key)); return url ? [{ network, url }] : []; });
  const reviewLinks = ([['trustpilot', 'trustpilot'], ['google', 'googleReviews']] as const)
    .flatMap(([provider, key]) => { const url = safeWebUrl(brandValue(key)); return url ? [{ provider, url }] : []; });
  const physical = safeText(brandValue('physicalAddress'));
  const address = physical || [safeText(brandValue('address1')), safeText(brandValue('address2')), safeText(brandValue('town')), safeText(brandValue('postcode')), safeText(brandValue('country'))].filter(Boolean).join(', ');
  const whyBook = ([['reason1', 'reason1Text'], ['reason2', 'reason2Text'], ['reason3', 'reason3Text'], ['reason4', 'reason4Text']] as const).flatMap(([titleKey, textKey]) => { const title = safeText(brandValue(titleKey)); return title ? [{ title, text: safeText(brandValue(textKey)) || null }] : []; });
  const gallery = (['image1', 'image2', 'image3', 'image4', 'image5', 'image6', 'image7', 'image8', 'image9', 'image10'] as const).flatMap((key) => { const image = firstAttachmentImage(brandValue(key)); return image ? [{ ...image, alt: safeText(brandValue('name')) || 'Travel inspiration' }] : []; });
  const reassurance = [
    { title: 'Your own travel expert', text: safeText(brandValue('name')) || 'Personal support before, during and after travel' },
    { title: 'Built around you', text: 'Tailored, not off the shelf' },
    { title: 'Financially protected', text: 'Protection as set out in your booking documents' },
    ...(safePhone(brandValue('emergencyPhone')) ? [{ title: 'With you while away', text: 'Out-of-hours support when you need it' }] : []),
  ];
  return {
    slogan: safeText(brandValue('slogan')) || null,
    about: safeText(brandValue('about')) || null,
    address: address || null,
    openingHours: safeText(brandValue('hours')) || null,
    socialLinks,
    reviewLinks,
    privacyUrl: safeWebUrl(brandValue('privacy')),
    complaintsUrl: safeWebUrl(brandValue('complaints')),
    whyBook,
    teamPhotoUrl: firstAttachmentThumbnail(brandValue('teamPhoto')),
    gallery,
    mapUrl: safeWebUrl(brandValue('mapsLink')),
    reassurance,
    footerImages: attachmentImages(brandValue('footerImages')).map((image) => image.url),
    footerText: safeText(brandValue('footerContent')) || null,
    letterTemplates: mapLetterTemplates(brandTemplates, tripId),
  };
}

function mapLetterTemplates(records: AirtableRecord[], tripId: string): TripSnapshot['brand']['profile']['letterTemplates'] {
  return records.flatMap((record) => {
    const type = safeText(pick(record.fields, brandTemplateFields.type));
    const body = letterText(pick(record.fields, brandTemplateFields.letter));
    if (!body || (type && type.toLowerCase() !== 'letter')) return [];
    return [{
      id: publicChildId(tripId, record.id, 'ltr'),
      name: safeText(pick(record.fields, brandTemplateFields.name)) || 'Letter',
      subject: safeText(pick(record.fields, brandTemplateFields.subject)) || null,
      body,
    }];
  }).slice(0, 30);
}

function letterText(value: unknown): string {
  return firstString(value)
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n\n')
    .replace(/<\s*li(?:\s[^>]*)?>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 12_000);
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
      imageUrl: firstAttachmentThumbnail(pick(record.fields, locationFields.image)),
      coordinates: latitude !== null && longitude !== null ? { latitude, longitude } : null,
      directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(latitude !== null && longitude !== null ? `${latitude},${longitude}` : name)}`,
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
      imageUrl: firstAttachmentThumbnail(pick(record.fields, upsellFields.image)),
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
  brandTemplates: AirtableRecord[];
}

type RecordGraph = { [K in Exclude<keyof RelatedRecords, 'elements' | 'payments' | 'people' | 'customers' | 'upsells' | 'communications' | 'members' | 'brandTemplates'>]: Map<string, AirtableRecord> };

function emptyRelated(): RelatedRecords {
  return { elements: [], payments: [], people: [], customers: [], upsells: [], communications: [], members: [], suppliers: [], airports: [], airlines: [], rooms: [], cabins: [], passengers: [], ships: [], cruisePorts: [], locations: [], operators: [], brandTemplates: [] };
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
    supplier: supplierHidden || !supplierName ? null : { name: supplierName, logoUrl: firstAttachmentThumbnail(supplierRecord?.fields ? pick(supplierRecord.fields, supplierFields.logo) : undefined), termsUrl: safeUrl(supplierRecord?.fields ? pick(supplierRecord.fields, supplierFields.terms) : undefined) },
    images: attachmentImages(value('images')),
    rooms, cabins, passengers, cruisePorts,
    emergencyContact: emergencyContact(value('emergencyName'), value('emergencyPhone')),
    details: elementDetails(kind, value),
    fromCode: (recordText(fromAirport, airportFields.iata) || safeText(value('fromCode'))).toUpperCase() || null,
    toCode: (recordText(toAirport, airportFields.iata) || safeText(value('toCode'))).toUpperCase() || null,
    carrierCode,
    carrierLogoUrl: firstAttachmentThumbnail(carrierRecord?.fields ? pick(carrierRecord.fields, airlineFields.logo) : undefined),
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
  return { scheme, atolNumber: holderNumber, licensing, summary, mode, contractType, holderName: holderName || null, organiserName: (mode.startsWith('agent_') ? leadSupplierName : memberName) || null, hasFlight, guaranteeAvailable: proposition.includes('tta') || proposition.includes('travel trust') };
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
  // Missing currency means the business default (GBP, as in the PHP plugin); a value that isn't a currency makes the
  // booking-level figures unavailable rather than silently relabelling them.
  const bookingCode = currencyCode(pick(booking.fields, bookingFields.currency));
  const currency = bookingCode ?? 'GBP';
  const bookingMoney = (key: keyof typeof bookingFields) => (bookingCode === null ? null : moneyValue(pick(booking.fields, bookingFields[key])));
  const now = new Date().toISOString().slice(0, 10);
  const items: PaymentItem[] = records.map((record, index) => {
    const value = (key: keyof typeof paymentFields) => pick(record.fields, paymentFields[key]);
    const itemCode = currencyCode(value('currency'));
    const itemCurrency = itemCode ?? currency;
    const signed = itemCode === null ? null : paymentAmount(record.fields, itemCurrency);
    const type = safeText(value('type')) || ((signed ?? 0) < 0 ? 'Customer Refund' : 'Customer Payment');
    const rawStatus = safeText(value('status'));
    const dueDate = dateString(value('due'));
    const paid = /complete|paid|settled/i.test(rawStatus);
    const local = /^\s*resort\s+payment\s*$/i.test(type);
    const refund = /refund/i.test(type) || (signed ?? 0) < 0;
    const paymentUrl = safeUrl(value('link'));
    const status: PaymentItem['status'] = refund ? 'refund' : local ? 'local' : paid ? 'paid' : dueDate && dueDate < now ? 'overdue' : 'outstanding';
    // Only offer "Pay now" when the amount is known and in a currency the payment provider supports.
    const payable = !paid && !local && !refund && signed !== null && signed > 0 && (PAYABLE_CURRENCIES as readonly string[]).includes(itemCurrency) && (stage !== 'quote' || truthy(value('showOnQuote')));
    return {
      id: publicChildId(tripId, record.id || String(index), 'pay'),
      label: safeText(value('customerType')) || (paid ? 'Payment received' : 'Payment due'),
      amount: signed === null ? null : Math.abs(signed), currency: itemCurrency, status, dueDate,
      completedDate: dateString(value('completed')),
      canPay: payable && (Boolean(paymentUrl) || mintReady),
      actionUrl: payable ? paymentUrl : null,
    };
  }).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const alternativeType = safeText(pick(booking.fields, bookingFields.alternativeCurrencyType)).toUpperCase();
  const alternativeAmount = alternativeType === 'USD' ? moneyValue(pick(booking.fields, bookingFields.usdAmount)) : alternativeType === 'EUR' ? moneyValue(pick(booking.fields, bookingFields.eurAmount)) : null;
  const balance = bookingMoney('balance');
  return {
    currency,
    total: bookingMoney('total'),
    paid: bookingMoney('paid'),
    balance,
    items,
    totalIncludingResort: bookingMoney('totalIncludingResort'),
    nextDueAmount: bookingMoney('nextDueAmount'),
    nextDueDate: dateString(pick(booking.fields, bookingFields.nextDueDate)),
    balanceDueDate: dateString(pick(booking.fields, bookingFields.balanceDueDate)),
    alternativeCurrency: truthy(pick(booking.fields, bookingFields.alternativeCurrency)) && ['USD', 'EUR'].includes(alternativeType) && alternativeAmount !== null
      ? { currency: alternativeType, amount: alternativeAmount }
      : null,
    // Paying "another amount" needs a known balance in a supported currency.
    customPayments: { enabled: mintReady && allowCustom && !['quote_expired', 'closed', 'cancelled', 'past'].includes(stage) && balance !== null && balance > 0 && (PAYABLE_CURRENCIES as readonly string[]).includes(currency), minimum: 0.01, maximum: Math.min(100_000, Math.max(0, balance ?? 0)) },
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
  const money = formatMoney;
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
        `${summary.name} · ${summary.departureDate ? displayDate(summary.departureDate) : 'Dates to be confirmed'}${summary.returnDate ? ` to ${displayDate(summary.returnDate)}` : ''}`,
        ...itinerary.map((item) => `${item.typeLabel}: ${item.title}${item.startDate ? ` · ${displayDate(item.startDate)}` : ''}`),
        ...(payments ? [`Total price: ${money(payments.total, payments.currency)}`, ...payments.items.filter((item) => item.status === 'outstanding' || item.status === 'overdue').map((item) => `${item.label}: ${money(item.amount, item.currency)}${item.dueDate ? ` due ${displayDate(item.dueDate)}` : ''}`)] : []),
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

function attachmentImages(value: unknown): ItineraryImage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((attachment) => {
    const image = attachmentImage(attachment);
    return image ? [{ ...image, alt: safeText((attachment as { filename?: unknown }).filename) || 'Trip image' }] : [];
  }).slice(0, 12);
}

function heroImage(image: ReturnType<typeof firstAttachmentImage>): ItineraryImage | null {
  return image ? { ...image, alt: '' } : null;
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

function whatsappUrl(phone: string | null): string | null {
  if (!phone) return null;
  const compact = phone.replace(/\D/g, '');
  if (!/^(?:44|0)7\d{8,10}$/.test(compact)) return null;
  return `https://wa.me/${compact.startsWith('0') ? `44${compact.slice(1)}` : compact}`;
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

function dateTimeString(value: unknown): string | null {
  const raw = firstString(value);
  const parsed = new Date(raw);
  return raw && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

function emptyRecord(): AirtableRecord {
  return { id: '', fields: {} };
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/.test(value) ? value : null;
}

/** Dates in customer-facing text use the app's format, DD/MM/YYYY (e.g. 19/08/2026); anything unparseable is left as is. */
export function displayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
