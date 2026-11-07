export const bookingFields = {
  reference: ['Booking Reference', 'iBos Reference'],
  name: ['Trip Name', 'Name', 'Title'],
  status: ['Status'],
  tags: ['Tags'],
  holidayTypes: ['Holiday Type(s)'],
  travellerType: ['Traveller Type'], duration: ['Trip Duration'], countries: ['Countries'],
  destinations: ['Destinations'],
  sector: ['Sector'],
  departure: ['Departure Date', 'Departure Date (All)', 'Start Date', 'Departing'],
  return: ['Return Date', 'Return Date (All)', 'End Date', 'Returning'],
  quoteExpiry: ['Quotation Expiry'],
  quotationAccepted: ['Quotation Accepted'],
  quotationAcceptedAt: ['Quotation Accepted At'], quotationAcceptedBy: ['Quotation Accepted By'], quotationAcceptanceEvidence: ['Quotation Acceptance Evidence'],
  overview: ['Trip Overview'], personalMessage: ['Personalised Message', 'Personalized Message'], includeMessage: ['Include Personalised Message'], agent: ['SinGS Agent Name', 'Created by', 'Created By'],
  cancellationDate: ['Cancellation Date'], cancellationReason: ['Cancellation Reason'],
  atol: ['ATOL'], atolNumber: ['ATOL No.'], licensing: ['Licensing'],
  leadSupplier: ['leadSupplier'], useGlobalAtol: ['Use Global ATOL'], memberProposition: ['Member | Proposition'], memberCompany: ['Members | Company Name'],
  emergencyPhone: ['Customer | Emergency Telephone'], outOfHoursLink: ['Out of Hours Link'], outOfHoursEmail: ['Out of Hours Email'],
  supplierTickets: ['Supplier Tickets Received'], supplierConfirmations: ['Supplier Confirmations Received'],
  taskConfirmation: ['Booking Confirmation'], taskReconfirmed: ['Booking Reconfirmed'], taskDocuments: ['Travel Documents'], taskPredeparture: ['Pre-Departure Call'], taskFollowup: ['Post-Travel Follow-Up'],
  group: ['Group Booking'], giftVoucher: ['Gift Voucher'], totalTravellers: ['Total Passengers & Guests', 'Total Passengers'],
  hero: ['Hero Image', 'Featured Image', 'Hero'],
  gallery: ['Gallery', 'Accommodation Gallery', 'Cruise Ship Gallery'],
  brand: ['Brands & Branches'],
  member: ['Members'],
  customerPostcode: ['Customers | Postcode'],
  customerEmail: ['Customers | Email'],
  enable2fa: ['Enable 2FA'],
  mintBookingId: ['Mint | Booking ID (BK…)', 'Mint | Booking ID'],
  elements: ['Bookings [Elements]'],
  payments: ['Bookings [Payments]'],
  people: ['Customers [People]'],
  customers: ['Customers'],
  upsells: ['Upsells', 'Bookings [Upsells]'],
  communications: ['Customer Communication', 'Bookings [Customer Communication]'],
  total: ['Total Price'],
  paid: ['MS Paid', 'Customer Payments Completed'],
  balance: ['MS Outstanding', 'MS Outstanding ', 'Booking Balance'],
  currency: ['Currency'],
  totalIncludingResort: ['Total Customer Cost including Resort Payments'], nextDueAmount: ['Next Customer Payment Amount'], nextDueDate: ['Next Customer Payment Due Date'], balanceDueDate: ['balanceDueDate'],
  alternativeCurrency: ['Alternative Currency'], alternativeCurrencyType: ['Alternative Currency Type'], usdAmount: ['USD Amount'], eurAmount: ['EUR Amount'],
} as const;

export const brandFields = {
  name: ['Trading Name', 'Brand Name', 'Name'],
  colour: ['Primary Colour', 'Brands & Branches | Colour', 'Brand Colour'],
  colour2: ['Secondary Colour'],
  fontDisplay: ['Primary Web Font'],
  fontBody: ['Secondary Web Font'],
  logo: ['Transparent Logo', 'Logo'],
  tone: ['Member Tone'],
  theme: ['Theme'],
  company: ['Company Name'], proposition: ['Proposition'], trustNumber: ['Trust Account | Account Number'],
  slogan: ['Slogan'], about: ['About & Bio'], physicalAddress: ['Physical Address'], address1: ['Shop | Address Line 1', 'Address Line 1'], address2: ['Address Line 2'], town: ['Shop | Town/City', 'Town/City'], postcode: ['Shop | Post Code', 'Post Code'], country: ['Shop | Country', 'Country'], hours: ['Opening Hours'],
  instagram: ['Social Media: Instagram'], facebook: ['Social Media: Facebook'], linkedin: ['Social Media: LinkedIn'], x: ['Social Media: X/Twitter'], trustpilot: ['Trustpilot Reviews URL'], googleReviews: ['Google Reviews URL'], privacy: ['Privacy Policy'], complaints: ['Complaints'],
  phone: ['Customer | Telephone', 'Telephone', 'Phone'], email: ['Customer | Email Address', 'Email'], website: ['Customer | Website', 'Website'],
  emergencyPhone: ['Customer | Emergency Telephone'], outOfHoursLink: ['Out of Hours Link'], outOfHoursEmail: ['Out of Hours Email'],
  mintApiKey: ['Mint | API Key'], mintBusinessUnit: ['Mint | Business Unit'], mintAllowCustom: ['Mint | Allow Custom Payments'], mintMethods: ['Mint | Custom Payment Methods'], mintWebhook: ['Webhook URL'],
} as const;

export const elementFields = {
  type: ['Type', 'Element Type', 'Category'], status: ['Status'], heading: ['Trip Element Heading', 'Name', 'Title'],
  start: ['Pick Up Date', 'Check-in', 'Start Date', 'From Date', 'From'], end: ['Return Date', 'Check-out', 'End Date', 'To Date', 'Cruise End Date'],
  departTime: ['Depart Time', 'Departure Time', 'Start Time'], arriveTime: ['Arrival Time', 'End Time'],
  from: ['Dep. Airport Name', 'Departure Port', 'Dep. Station Name', 'Pick Up Location', 'From', 'Origin'],
  to: ['Arr. Airport Name', 'Disembark Port', 'Arr. Station Name', 'Drop Off Location', 'To', 'Destination'],
  carrier: ['Carrier', 'Airline'], flightNumber: ['Flight No.', 'Flight Number'], accommodation: ['Accommodation Name', 'Hotel Name', 'Hotel'],
  cruiseName: ['Cruise Name'], ship: ['Cruise Ship', 'Cruise Ships', 'Ship'], supplierReference: ['Supplier Reference', 'Supplier Ref', 'Supplier Ref.'],
  address: ['Address'], notes: ['Important Information', 'Further Information'], docs: ['Customer Documentation'],
  supplier: ['Supplier', 'Suppliers'], hideSupplier: ['Hide Supplier Info'], images: ['Image Gallery', 'Featured Image(s)', 'Featured Images', 'Featured Image', 'Images', 'Photos'],
  rooms: ['Rooms', 'Bookings [Rooms]'], cabins: ['Cabin Details', 'Bookings [Cabins]'], passengers: ['Passengers & Guests', 'Bookings [Passengers]'],
  visitingPorts: ['Visiting Ports'], cruiseLine: ['Cruise Line'], location: ['Location', 'Destinations', 'Destination', 'Top Destination'],
  emergencyName: ['Emergency Supplier Name'], emergencyPhone: ['Emergency Phone Number(s)'],
  rating: ['Rating'], nights: ['Nights'], flightClass: ['Flight Class'], direction: ['Direction'], voyageCode: ['Voyage Code'],
  vehicleType: ['Vehicle Type'], pickupInstructions: ['Pick Up Instructions', 'Pickup Instructions'], dropoffInstructions: ['Drop Off Instructions', 'Dropoff Instructions'],
  trainName: ['Train Name/Number'], carriageClass: ['Carriage Class(es)'], seatNumbers: ['Seat Number(s)'],
  onboardCredit: ['Onboard Credit'], onboardCreditCurrency: ['Onboard Credit Currency'],
  eventName: ['Event Name'], miscName: ['Misc. Name', 'Misc Name'], parkingName: ['Car Parking Name'], parkingCode: ['Car Parking Code'],
  carMake: ['Car Make'], carModel: ['Car Model'], carRegistration: ['Car Registration'], carType: ['Car Type'], childSeats: ['Child Seats'],
  fromCode: ['Dep. IATA Code'], toCode: ['Arr. IATA Code'], iata: ['IATA', 'IATA Code'], package: ['Package'], termsUrl: ['Customers T&Cs'],
  confirmationReceived: ['Confirmation Received'], ticketsReceived: ['Tickets Received'],
} as const;

export const supplierFields = { name: ['Name', 'Supplier Name(s)'], logo: ['Logo'], terms: ['Legal Notices URL'] } as const;
export const airportFields = { name: ['Name', 'Airport'], iata: ['IATA Code'] } as const;
export const airlineFields = { name: ['Airline', 'Name'], iata: ['iata'], logo: ['Logo', 'Airline Logo', 'logo'] } as const;
export const roomFields = { type: ['Room Type', 'Name', 'Room'], board: ['Board Basis', 'Board', 'Meal Plan'], view: ['Room Views'], requests: ['Special Requests'] } as const;
export const cabinFields = { name: ['Cabin Name', 'Name'], grade: ['Cabin Grade'], number: ['Cabin Number'], deck: ['Cabin Deck', 'Deck'], side: ['Ship Side'], position: ['Cabin Position'], bed: ['Bed Type'], seating: ['Seating'], table: ['Table Size'], dining: ['Dining Option'] } as const;
export const passengerFields = { name: ['Passenger', 'Passenger Name'], pnr: ['PNR'], class: ['Flight Class'], seat: ['Seat Number'], cabinBag: ['Cabin Baggage Allowance'], checkedBag: ['Checked Baggage Allowance'], extras: ['Extras'], meal: ['Meal Request'], ssr: ['Special Requests'] } as const;
export const shipFields = { name: ['Name'], cover: ['Cover Image', 'cover_image'], profile: ['Profile Image', 'profile_image'] } as const;
export const operatorFields = { name: ['Name', 'Operator'], logo: ['Logo', 'logo', 'Profile Image', 'profile_image'] } as const;
export const locationFields = {
  name: ['Name', 'Resort', 'Area', 'Country'], country: ['Country'], overview: ['Destination Overview', 'Summary (HTML)'],
  attractions: ['Key Attractions/Experiences'], practical: ['Practical Information'], culture: ['Cultural & Local Insights'],
  travelAdvice: ['FCDO Travel Advice'], image: ['Featured Image'], latitude: ['Latitude'], longitude: ['Longitude'],
} as const;
export const cruisePortFields = { day: ['Day'], port: ['Port'], description: ['Port (SinGS)', 'Overview'], arrive: ['Arrive'], depart: ['Depart'] } as const;
export const upsellFields = { name: ['Name', 'Title'], description: ['Further Information', 'Description'], image: ['Upsell Featured Image', 'Featured Image', 'Image'], supplier: ['Supplier'] } as const;
export const communicationFields = { type: ['Type'], subject: ['Custom Subject', 'Subject', 'Name'], content: ['Custom Content', 'Email Template'], date: ['Sent At', 'Scheduled For', 'Date'], sent: ['Sent'], status: ['Status'], selfOnly: ['Send To Self Only'] } as const;

export const paymentFields = {
  amount: ['Amount'], currency: ['Mint: Currency', 'Currency'], type: ['Payment Type'], customerType: ['Customer Payment Type'],
  status: ['Status'], due: ['Date Due', 'Payment Due'], completed: ['Payment Complete', 'Date Complete', 'Receipt Date'],
  link: ['Payment Link URL', 'Payment Link', 'Payment URL'], showOnQuote: ["Show 'Pay Now' on Quotation", 'Show Pay Now on Quotation'],
  method: ['Payment Method', 'Method'], reference: ['paymentReference', 'Receipt Number', 'Payment Reference'],
} as const;

export const personFields = {
  name: ['Full Name', 'Name'], first: ['First Name', 'Preferred Name'], last: ['Last Name'], ssr: ['Special Service Request'], meal: ['Meal Request'],
  nationality: ['Nationality'], passportExpiry: ['Expiry Date'], insurance: ['Travel Insurance'],
} as const;

export const customerFields = { name: ['Full Name', 'Name'], first: ['First Name'], last: ['Last Name'] } as const;
export const memberFields = { company: ['Company Name'], proposition: ['Proposition'], tAtolEnabled: ['T-ATOL Enabled'], tAtolNumber: ['T-ATOL Number'], number: ['Members | Number', 'Member Number'] } as const;

export function pick(fields: Record<string, unknown>, candidates: readonly string[]): unknown {
  for (const name of candidates) {
    const value = fields[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export function firstString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return firstString(value[0]);
  return '';
}

export function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(firstString).filter(Boolean);
  const valueString = firstString(value);
  return valueString ? [valueString] : [];
}

export function firstAttachmentUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const attachment = value[0] as { url?: unknown } | undefined;
  return typeof attachment?.url === 'string' && attachment.url.startsWith('https://') ? attachment.url : null;
}

export function numberValue(value: unknown): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = typeof candidate === 'number' ? candidate : Number(String(candidate ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function truthy(value: unknown): boolean {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === true || candidate === 1 || /^(yes|true|1|checked)$/i.test(String(candidate ?? '').trim());
}
