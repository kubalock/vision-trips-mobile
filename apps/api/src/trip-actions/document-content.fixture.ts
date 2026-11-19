import type { ItineraryItem, TripSnapshot } from '@vision-trips/contracts';

/** A complete itinerary item for document tests; override what the test is about. */
export function item(extra: Partial<ItineraryItem>): ItineraryItem {
  return {
    id: 'itm', kind: 'misc', typeLabel: 'Item', title: 'Item', status: 'Confirmed', startDate: null, endDate: null, startTime: null, endTime: null,
    from: null, to: null, carrier: null, flightNumber: null, reference: null, address: null, notes: null, supplier: null, images: [], rooms: [], cabins: [],
    passengers: [], cruisePorts: [], emergencyContact: null, details: [], fromCode: null, toCode: null, carrierCode: null, carrierLogoUrl: null,
    arrivesNextDay: false, packageIncluded: true, termsUrl: null, confirmationReceived: false, ticketsReceived: false, ...extra,
  };
}

const outbound = item({ id: 'f1', kind: 'flight', typeLabel: 'Flight', title: 'London Gatwick to Lisbon', startDate: '2027-03-01', startTime: '07:00', endDate: '2027-03-01', endTime: '09:45', from: 'London Gatwick', to: 'Lisbon', fromCountry: 'GB', toCountry: 'PT', carrier: 'British Airways', flightNumber: 'BA2662', reference: 'PNR123', fromCode: 'LGW', toCode: 'LIS', details: [{ label: 'Class', value: 'Economy' }] });
const inbound = item({ id: 'f2', kind: 'flight', typeLabel: 'Flight', title: 'Lisbon to London Gatwick', startDate: '2027-03-08', startTime: '18:00', endDate: '2027-03-08', endTime: '20:40', from: 'Lisbon', to: 'London Gatwick', fromCountry: 'PT', toCountry: 'GB', carrier: 'British Airways', flightNumber: 'BA2663', reference: 'PNR123', fromCode: 'LIS', toCode: 'LGW' });
const stay = item({ id: 's1', kind: 'stay', typeLabel: 'Accommodation', title: 'Avenida Palace', startDate: '2027-03-01', endDate: '2027-03-08', address: 'Rua 1º de Dezembro 123, Lisbon', supplier: { name: 'Hotel Partners', logoUrl: null, termsUrl: null }, reference: 'HP-77', rooms: [{ type: 'Deluxe Double', board: 'Bed & breakfast', view: null, requests: 'High floor' }], details: [{ label: 'Rating', value: '5' }, { label: 'Nights', value: '7' }] });

export function documentSnapshot(extra: Partial<TripSnapshot> = {}): TripSnapshot {
  return {
    schemaVersion: 4, tripId: 'trp', version: 'v1', serverTime: '2026-11-19T12:00:00.000Z', stage: 'confirmed', accessScope: 'primary_customer',
    freshness: { status: 'fresh', sourceUpdatedAt: '2026-11-19T12:00:00.000Z', nextRefreshAfter: null },
    brand: { name: 'Sunny Days Travel', logoUrl: null, theme: {} as TripSnapshot['brand']['theme'], profile: {
      slogan: null, about: null, address: null, openingHours: null, socialLinks: [], reviewLinks: [], privacyUrl: null, complaintsUrl: null, whyBook: [], teamPhotoUrl: null,
      gallery: [], mapUrl: null, reassurance: [], footerImages: [], footerText: null, letterTemplates: [],
      legalTemplates: [{ id: 'financial', title: 'Financial protection', text: 'Our own protection wording.' }, { id: 'correct_names', title: 'Correct names notice', text: 'Names must match passports.' }],
    } },
    summary: { reference: 'VT-100, VT-100A', name: 'Lisbon Escape', departureDate: '2027-03-01', returnDate: '2027-03-08', heroImageUrl: null, gallery: [], durationDays: 7, countries: ['Portugal'], holidayTypes: [], travellerType: null, sector: null, totalTravellers: 3, unnamedTravellers: 0, groupBooking: false, giftVoucher: false },
    experience: { overview: 'A week in Lisbon.', personalisedMessage: null, agentName: 'Jamie Agent', surprise: { enabled: false, concealed: false, revealAt: null } },
    support: { companyName: 'Sunny Days Travel', phone: '01234 567890', email: 'hello@sunny.example', websiteUrl: null, emergencyPhone: null, outOfHoursUrl: null, outOfHoursEmail: null },
    protection: { scheme: 'atol', atolNumber: '3973', licensing: null, summary: 'Protected.', mode: 'principal_single_contract', contractType: 'package', holderName: 'The Global Travel Group Ltd', organiserName: 'Sunny Days Ltd', hasFlight: true, guaranteeAvailable: false, retailerName: 'Sunny Days Ltd', certificateIssuer: 'The Global Travel Group Ltd', trustLabel: 'client trust account', retailerAddress: ['1 High Street', 'Guildford', 'GU1 1AA'], retailerMemberNumber: 'W1234', retailerCompanyNumber: '01234567', retailerVatNumber: 'GB123456789' },
    bookingStatus: { sourceStatus: 'Confirmed', createdAt: '2026-10-01T09:00:00.000Z', cancellationDate: null, cancellationReason: null, supplierTicketsReceived: false, supplierConfirmationsReceived: false, tasks: { confirmation: false, reconfirmed: false, travelDocuments: false, preDepartureCall: false, followUp: false } },
    quotation: { status: 'not_applicable', expiresAt: null, canAccept: false, requiredConfirmations: [], reviewSections: [] },
    timeline: {} as TripSnapshot['timeline'], bookingJourney: {} as TripSnapshot['bookingJourney'],
    destinations: [], extras: [], communications: [], integrations: { liveFlightStatus: 'not_applicable', weather: 'not_applicable', destinationGuides: 'not_available' },
    travellers: [
      { name: 'Alex Traveller', firstName: 'Alex', isLead: true, assistance: [], meals: [], nationality: null, passportExpiry: null, insuranceStatus: null, age: 40 },
      { name: 'Sam Traveller', firstName: 'Sam', isLead: false, assistance: [], meals: [], nationality: null, passportExpiry: null, insuranceStatus: null, age: 38 },
      { name: 'Baby Traveller', firstName: 'Baby', isLead: false, assistance: [], meals: [], nationality: null, passportExpiry: null, insuranceStatus: null, age: 1 },
    ],
    itinerary: [outbound, stay, inbound],
    payments: {
      currency: 'GBP', total: 2500, paid: 500, balance: 2000, totalIncludingResort: 2560, nextDueAmount: 2000, nextDueDate: '2027-01-15', balanceDueDate: '2027-01-15', alternativeCurrency: null,
      customPayments: { enabled: false, minimum: 0, maximum: 0 }, perPerson: null,
      bankTransfer: { accountName: 'Sunny Days Client Account', sortCode: '12-34-56', accountNumber: '12345678' },
      items: [
        { id: 'p2', label: 'Balance', amount: 2000, currency: 'GBP', status: 'outstanding', dueDate: '2027-01-15', completedDate: null, canPay: true, actionUrl: null },
        { id: 'p1', label: 'Deposit', amount: 500, currency: 'GBP', status: 'paid', dueDate: '2026-10-05', completedDate: '2026-10-04', canPay: false, actionUrl: null },
        { id: 'p3', label: 'Tourist tax', amount: 60, currency: 'GBP', status: 'local', dueDate: null, completedDate: null, canPay: false, actionUrl: null },
      ],
    },
    documents: [], capabilities: { acceptQuotation: false, makePayment: true, shareWithTraveller: true, sendMessage: true },
    content: { included: [], notIncluded: [{ text: 'Travel insurance' }], includedSource: 'none', videoMessage: null, walkthrough: null },
    ...extra,
  };
}
