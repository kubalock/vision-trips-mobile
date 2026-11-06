export const bookingFields = {
  reference: ['Booking Reference', 'iBos Reference'],
  name: ['Trip Name', 'Name', 'Title'],
  status: ['Status'],
  tags: ['Tags'],
  holidayTypes: ['Holiday Type(s)'],
  sector: ['Sector'],
  departure: ['Departure Date', 'Departure Date (All)', 'Start Date', 'Departing'],
  return: ['Return Date', 'Return Date (All)', 'End Date', 'Returning'],
  quoteExpiry: ['Quotation Expiry'],
  hero: ['Hero Image', 'Featured Image', 'Hero'],
  brand: ['Brands & Branches'],
  member: ['Members'],
  customerPostcode: ['Customers | Postcode'],
  customerEmail: ['Customers | Email'],
  enable2fa: ['Enable 2FA'],
  elements: ['Bookings [Elements]'],
  payments: ['Bookings [Payments]'],
  people: ['Customers [People]'],
  customers: ['Customers'],
  total: ['Total Price'],
  paid: ['MS Paid', 'Customer Payments Completed'],
  balance: ['MS Outstanding', 'MS Outstanding ', 'Booking Balance'],
  currency: ['Currency'],
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
} as const;

export const paymentFields = {
  amount: ['Amount'], currency: ['Mint: Currency', 'Currency'], type: ['Payment Type'], customerType: ['Customer Payment Type'],
  status: ['Status'], due: ['Date Due', 'Payment Due'], completed: ['Payment Complete', 'Date Complete', 'Receipt Date'],
  link: ['Payment Link URL', 'Payment Link', 'Payment URL'], showOnQuote: ["Show 'Pay Now' on Quotation", 'Show Pay Now on Quotation'],
} as const;

export const personFields = {
  name: ['Full Name', 'Name'], first: ['First Name', 'Preferred Name'], last: ['Last Name'], ssr: ['Special Service Request'], meal: ['Meal Request'],
} as const;

export const customerFields = { name: ['Full Name', 'Name'], first: ['First Name'], last: ['Last Name'] } as const;

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
