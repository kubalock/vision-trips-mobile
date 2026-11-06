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
