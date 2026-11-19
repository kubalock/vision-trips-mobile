import type { ItineraryItem, TripSnapshot } from '@vision-trips/contracts';
import { formatMoney } from '../trips/field-map.js';

/*
 * What the booking confirmation / quotation and the ATOL certificate say, ported from the PHP plugin's Domain/Atol.php,
 * Domain/Legal.php (with the default texts of config/legal.php) and Views/trip/protection-text.php. Pure functions of
 * the snapshot, so the PDF and any other renderer say the same thing.
 */

// ---------------------------------------------------------------------------------------------------------------
// Dates and money
// ---------------------------------------------------------------------------------------------------------------

function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
const format = (options: Intl.DateTimeFormatOptions) => (value: string | null | undefined): string => { const day = parseDay(value); return day ? new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(day) : ''; };
/** "1 December 2026" */
export const longDate = format({ day: 'numeric', month: 'long', year: 'numeric' });
/** "1 Dec 2026" */
export const mediumDate = format({ day: 'numeric', month: 'short', year: 'numeric' });
/** "01/12/2026" */
export const numericDate = format({ day: '2-digit', month: '2-digit', year: 'numeric' });
export function dateRange(start: string | null, end: string | null): string {
  if (!start) return 'Dates to be confirmed';
  return end && end !== start ? `${longDate(start)} to ${longDate(end)}` : longDate(start);
}
const money = (amount: number | null, currency: string) => formatMoney(amount, currency);

// ---------------------------------------------------------------------------------------------------------------
// Protection wording (PHP Domain/Protection.php)
// ---------------------------------------------------------------------------------------------------------------

type Protection = TripSnapshot['protection'];
const isAgent = (protection: Protection) => protection.mode.startsWith('agent_');
const isPackage = (protection: Protection) => protection.contractType === 'package' || protection.contractType === 'package_no_flight';
const atolApplies = (protection: Protection) => protection.scheme === 'atol';

export function retailerName(snapshot: TripSnapshot): string {
  return snapshot.protection.retailerName || snapshot.brand.name;
}

/** "Sunny Days Ltd (member 1234) · Company no. 0123456 · VAT no. GB123 · Registered office: …" (PHP Brand::legalLine), or ''. */
export function legalLine(snapshot: TripSnapshot): string {
  const { retailerName: company, retailerMemberNumber, retailerCompanyNumber, retailerVatNumber, retailerAddress } = snapshot.protection;
  return [
    company ? `${company}${retailerMemberNumber ? ` (member ${retailerMemberNumber})` : ''}` : '',
    retailerCompanyNumber ? `Company no. ${retailerCompanyNumber}` : '',
    retailerVatNumber ? `VAT no. ${retailerVatNumber}` : '',
    retailerAddress?.length ? `Registered office: ${retailerAddress.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
}

export function holderLabel(protection: Protection): string {
  if (!protection.holderName && !protection.atolNumber) return '';
  return `${protection.holderName || 'the package organiser'}${protection.atolNumber ? ` (ATOL ${protection.atolNumber})` : ''}`;
}

function trustSentence(protection: Protection): string {
  if (!protection.trustLabel) return '';
  const tta = /travel trust/i.test(protection.trustLabel);
  return `Money for arrangements outside ATOL is held in ${tta ? 'the ' : 'a '}${protection.trustLabel} until it is passed to the supplier.`;
}

function trustEntity(protection: Protection): string {
  if (!protection.trustLabel) return 'the arrangements set out in your booking conditions';
  return /travel trust/i.test(protection.trustLabel) ? 'the Travel Trust Association trust account arrangements' : `a ${protection.trustLabel}`;
}

function protectionEntity(protection: Protection): string {
  if (atolApplies(protection)) return holderLabel(protection) ? `the ATOL scheme (ATOL holder ${holderLabel(protection)})` : 'the ATOL scheme';
  return trustEntity(protection);
}

/** One plain sentence for the key-information block. */
export function protectionSentence(protection: Protection): string {
  if (protection.contractType === 'ticket_agent') return 'This flight is sold as an agent of the airline and is not ATOL protected. Your payment is passed to the airline.';
  if (atolApplies(protection)) {
    const who = holderLabel(protection);
    let sentence = isPackage(protection) ? 'This flight-inclusive package is ATOL protected' : 'This flight is ATOL protected';
    if (isAgent(protection)) sentence += `${who ? `. The package organiser and ATOL holder is ${who}` : ' by the package organiser named on your ATOL Certificate'}, with your booking made through your travel agent as its retailer.`;
    else sentence += who ? ` under ${who}.` : '.';
    sentence += ' You will receive an ATOL Certificate when payment is taken.';
    const trust = trustSentence(protection);
    return trust ? `${sentence} ${trust}` : sentence;
  }
  if (protection.contractType === 'package_no_flight') return `This package does not include a flight, so ATOL does not apply. Your payments are protected through ${protectionEntity(protection)} as required by the Package Travel Regulations.`;
  return `ATOL protection does not apply to this booking. Your payments are protected through ${protectionEntity(protection)}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Standard legal texts (PHP config/legal.php defaults). Must stay in step with the plugin's compliance-reviewed copy.
// ---------------------------------------------------------------------------------------------------------------

const LEGAL_TEXTS = {
  ptr_package: "The combination of travel services offered to you is a package within the meaning of the Package Travel and Linked Travel Arrangements Regulations 2018, so you benefit from all rights that apply to packages. {organiser} is responsible for the proper performance of the package as a whole and, as required by law, has protection in place to refund your payments and, where transport is included, to bring you home if it becomes insolvent.\n\nYour key rights include: receiving all essential information before you book; one trader being liable for all the travel services in the contract; an emergency contact point; the ability to transfer the booking to another person on reasonable notice (fees may apply); limits on price increases (only for specified costs, not within 20 days of departure, with a right to cancel if an increase exceeds 8%); the right to cancel without a fee and receive a full refund if an essential element other than price is changed significantly, if the package is cancelled by the organiser, or in the event of unavoidable and extraordinary circumstances at the destination; the right to cancel at any time before departure on payment of an appropriate termination fee; suitable alternative arrangements at no extra cost if significant parts of the package cannot be provided; a price reduction and/or compensation where services are not performed or are performed improperly; assistance if you are in difficulty; and a refund (and repatriation where transport is included) if the organiser becomes insolvent.\n\nInsolvency protection for this package is provided by {protection}. If services are refused because of the organiser's insolvency you may contact that entity or the competent authority ({regulator}).\n\nFull text: https://www.legislation.gov.uk/uksi/2018/634/schedule/1",
  lta_notice: "The travel services on this booking have been arranged under separate contracts with the individual providers. They are NOT a package within the meaning of the Package Travel and Linked Travel Arrangements Regulations 2018, so you do not benefit from the rights that apply to packages, and {retailer} is not responsible for the performance of each service. If something goes wrong with a service, contact the provider of that service.\n\nWhere services were booked with {retailer} within 24 hours of each other they form a linked travel arrangement. {retailer} has, as required by law, protection in place to refund payments made to {retailer} for services not performed because of {retailer}'s insolvency. This protection does not cover the insolvency of the individual providers.\n\nFull text: https://www.legislation.gov.uk/uksi/2018/634/schedule/2",
  ticket_agent: 'This flight has been sold by {retailer} as an agent of the airline. It is not ATOL protected. Your contract for the flight is with the airline and its conditions of carriage apply. We recommend travel insurance that includes scheduled airline failure cover.',
  atol_statement: 'Many of the flights and flight-inclusive holidays on this site are financially protected by the ATOL scheme, but ATOL protection does not apply to all holiday and travel services. This booking is protected under {atol}. Please ask us to confirm what protection may apply to your booking. If you do not receive an ATOL Certificate, the booking will not be ATOL protected. If you do receive an ATOL Certificate but all the parts of your trip are not listed on it, those parts will not be ATOL protected. For more information about financial protection and the ATOL Certificate go to www.atol.org.uk/ATOLCertificate.',
  trust_statement: "Money you pay to {member} for arrangements that are not covered by ATOL is held in {protection} until it is passed to the supplier of each service, as a safeguard in the event of {member}'s insolvency.",
  cancellation: 'Holiday and travel bookings for specific dates are exempt from the 14-day cooling-off period that applies to many other distance purchases. Once you accept, cancellation charges apply as set out in the booking conditions: deposits are normally non-refundable and charges increase closer to departure. You may cancel at any time before departure on payment of the applicable charge.',
  insurance: 'We strongly recommend that everyone travelling has comprehensive travel insurance from the moment you book, covering cancellation, medical expenses and repatriation, and any activities you plan to do. We are not able to advise on individual policies.',
  entry_health: 'Entry requirements depend on your nationality and destination and can change. Check the latest advice for every country you will visit or pass through at gov.uk/foreign-travel-advice and travelhealthpro.org.uk, including passport validity rules, visa or travel-authorisation requirements and the time needed to obtain them, and recommended vaccinations.',
  assistance: 'Tell us before you book about any mobility, medical, dietary or other requirements so we can check that the arrangements are suitable and tell the providers.',
} as const;
export type LegalTextKey = keyof typeof LEGAL_TEXTS;

/** A standard text with its placeholders filled in; '' when it does not apply (trust statement without a trust account). */
export function legalText(key: LegalTextKey, snapshot: TripSnapshot): string {
  const protection = snapshot.protection;
  if (key === 'trust_statement' && !protection.trustLabel) return '';
  const member = retailerName(snapshot);
  const fields: Record<string, string> = {
    '{organiser}': protection.organiserName || member, '{retailer}': member, '{member}': member,
    '{atol}': holderLabel(protection) || 'the ATOL scheme', '{protection}': protectionEntity(protection),
    '{regulator}': atolApplies(protection) ? 'the Civil Aviation Authority, www.caa.co.uk' : 'the relevant protection provider',
  };
  return LEGAL_TEXTS[key].replace(/\{[a-z]+\}/g, (match) => fields[match] ?? match);
}

/** The statutory notice that applies to this booking, if any. */
export function legalNotice(snapshot: TripSnapshot): { title: string; text: string } | null {
  const protection = snapshot.protection;
  if (protection.contractType === 'ticket_agent') return { title: 'About this flight', text: legalText('ticket_agent', snapshot) };
  if (isPackage(protection)) return { title: 'Your rights: this is a package', text: legalText('ptr_package', snapshot) };
  // The PHP plugin offers this notice behind a setting ("lta_notice"), off unless switched on.
  if (protection.contractType === 'agent_services' && new Set(snapshot.itinerary.map((item) => item.kind)).size > 1 && process.env.LTA_NOTICE === 'true') {
    return { title: 'Your rights: separate bookings', text: legalText('lta_notice', snapshot) };
  }
  return null;
}

/** "Who you are booking with" and the protection paragraphs that follow it (PHP trip/protection-text.php). */
export function protectionParagraphs(snapshot: TripSnapshot): string[] {
  const protection = snapshot.protection;
  const company = retailerName(snapshot);
  const memberNumber = protection.retailerMemberNumber;
  const paragraphs = [`${company}${memberNumber ? ` (member ${memberNumber})` : ''} is making this booking on your behalf.`];
  if (atolApplies(protection) && holderLabel(protection)) {
    paragraphs.push(`${isAgent(protection) ? `The flight-inclusive arrangements are protected under the ATOL of ${holderLabel(protection)}, the package organiser. ${company} acts as retailer for this booking.` : `This flight-inclusive package is protected under ${holderLabel(protection)}.`} You will receive an ATOL Certificate when payment is taken. Keep it with your travel documents.`);
  } else if (atolApplies(protection)) {
    paragraphs.push('This flight-inclusive booking is ATOL protected by the package organiser. Your ATOL Certificate will name the ATOL holder.');
  }
  const trust = trustSentence(protection);
  if (trust) paragraphs.push(trust);
  if (atolApplies(protection)) paragraphs.push(legalText('atol_statement', snapshot));
  paragraphs.push(legalText('trust_statement', snapshot));
  const financial = snapshot.brand.profile.legalTemplates?.find((template) => template.id === 'financial');
  if (financial) paragraphs.push(...financial.text.split(/\n{2,}/));
  paragraphs.push(legalText('cancellation', snapshot), legalText('insurance', snapshot));
  const line = legalLine(snapshot);
  if (line) paragraphs.push(line);
  return paragraphs.filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------
// Pre-contract key information (PTR 2018 reg 5) — PHP Legal::keyInformation
// ---------------------------------------------------------------------------------------------------------------

export function destinationSummary(snapshot: TripSnapshot): string {
  let names = [...new Set(snapshot.destinations.map((destination) => destination.name).filter(Boolean))];
  if (!names.length) names = [...snapshot.summary.countries];
  names = names.slice(0, 3);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export function entryRequirementHints(countries: string[]): string {
  const lower = countries.map((country) => country.toLowerCase());
  const has = (needle: string) => lower.some((country) => country.includes(needle));
  const hints: string[] = [];
  if (has('united states')) hints.push('USA: apply for an ESTA at least 72 hours before you fly.');
  if (has('canada')) hints.push('Canada: most UK passport holders need an eTA before flying.');
  if (has('australia')) hints.push('Australia: apply for an eVisitor visa before travel.');
  if (has('new zealand')) hints.push('New Zealand: an NZeTA is required before travel.');
  if (has('india')) hints.push('India: an e-Visa must be approved before you travel.');
  if (has('türkiye') || has('turkey')) hints.push('Türkiye: UK passport holders can currently visit visa-free for tourism.');
  if (has('egypt')) hints.push('Egypt: a visa is required; an e-Visa can be bought online before travel.');
  if (has('thailand') || has('viet nam') || has('vietnam') || has('sri lanka')) hints.push('Check visa or arrival-card requirements for Asia destinations before you fly.');
  const europe = ['spain', 'france', 'italy', 'greece', 'portugal', 'germany', 'netherlands', 'croatia', 'cyprus', 'malta', 'austria', 'belgium', 'denmark', 'sweden', 'finland', 'norway', 'iceland', 'czechia', 'poland', 'hungary', 'slovenia', 'slovakia', 'estonia', 'latvia', 'lithuania', 'luxembourg', 'switzerland', 'bulgaria', 'romania'];
  if (europe.some(has)) hints.push('Europe: UK passports must be issued less than 10 years before entry and valid 3 months after departure. Check whether ETIAS pre-authorisation is live for your dates.');
  return [...new Set(hints)].join(' ');
}

const detail = (item: ItineraryItem, label: string) => item.details.find((entry) => entry.label === label)?.value ?? '';
export function roomLine(room: ItineraryItem['rooms'][number]): string { return [room.type, room.board, room.view].filter(Boolean).join(', '); }
export function cabinLine(cabin: ItineraryItem['cabins'][number]): string {
  return [cabin.name, cabin.grade && `Grade ${cabin.grade}`, cabin.number && `Cabin ${cabin.number}`, cabin.deck && `Deck ${cabin.deck}`, cabin.bed, cabin.dining].filter(Boolean).join(', ');
}

export function keyInformation(snapshot: TripSnapshot): Array<{ label: string; text: string }> {
  const { summary, protection, itinerary } = snapshot;
  const rows: Array<{ label: string; text: string }> = [];
  const destination = destinationSummary(snapshot);
  rows.push({ label: 'Destination and dates', text: `${destination ? `${destination}. ` : ''}${summary.departureDate ? `${longDate(summary.departureDate)} to ${longDate(summary.returnDate)}` : 'Dates to be confirmed'}${summary.durationDays ? ` (${summary.durationDays} nights).` : '.'}`.trim() });
  const transport = itinerary.filter((item) => ['flight', 'train', 'transfer', 'cruise', 'carhire'].includes(item.kind)).map((item) => {
    if (item.kind === 'flight') {
      const flightClass = detail(item, 'Class');
      return `Flight ${[item.carrier, item.flightNumber].filter(Boolean).join(' ')}${flightClass ? ` (${flightClass})` : ''}: ${item.from ?? ''} to ${item.to ?? ''}${item.startDate ? `, ${mediumDate(item.startDate)}` : ''}${item.startTime ? ` ${item.startTime}` : ''}${item.endTime ? ` arriving ${item.endTime}${item.arrivesNextDay ? ' next day' : ''}` : ''}`;
    }
    if (item.kind === 'cruise') return `Cruise: ${item.title}, ${dateRange(item.startDate, item.endDate)}${item.from ? `, from ${item.from}` : ''}${item.to ? ` to ${item.to}` : ''}`;
    if (item.kind === 'carhire') return `Car hire: ${item.title}, ${dateRange(item.startDate, item.endDate)}${item.from ? `, collect ${item.from}` : ''}`;
    return `${item.typeLabel}: ${[item.from, item.to].filter(Boolean).join(' to ')}${item.startDate ? `, ${mediumDate(item.startDate)}` : ''}${item.startTime ? ` ${item.startTime}` : ''}`;
  });
  if (transport.length) rows.push({ label: 'Transport', text: `${transport.join('; ')}. Times are provisional until tickets are issued and will be confirmed on your travel documents.` });
  const stays = [
    ...itinerary.filter((item) => item.kind === 'stay').map((item) => {
      const rating = detail(item, 'Rating'); const nights = Number(detail(item, 'Nights')) || 0;
      return `${item.title}${rating ? ` (${rating} star)` : ''}${item.address ? `, ${item.address}` : ''}: ${dateRange(item.startDate, item.endDate)}${nights ? `, ${nights} night${nights === 1 ? '' : 's'}` : ''}${item.rooms.length ? `, ${item.rooms.map(roomLine).join('; ')}` : ''}`;
    }),
    ...itinerary.filter((item) => item.kind === 'cruise' && item.cabins.length).map((item) => `Cabin on ${item.title}: ${item.cabins.map(cabinLine).join('; ')}`),
  ];
  if (stays.length) rows.push({ label: 'Accommodation and meals', text: `${stays.join('. ')}. Star ratings are the supplier's own unless stated.` });
  const extras = itinerary.filter((item) => ['attraction', 'misc', 'parking'].includes(item.kind)).map((item) => `${item.title}${item.startDate ? ` (${mediumDate(item.startDate)})` : ''}`);
  if (extras.length) rows.push({ label: 'Also included', text: `${extras.join('; ')}.` });
  const pax = summary.totalTravellers || snapshot.travellers.length;
  rows.push({ label: 'Travellers', text: `${pax ? `${pax} traveller${pax === 1 ? '' : 's'}` : 'Travellers to be confirmed'}${snapshot.travellers.length ? `: ${snapshot.travellers.map((person) => person.name).join(', ')}` : ''}. Services are provided in English unless stated. Arrangements are not provided as part of a group unless stated.` });
  const payments = snapshot.payments;
  if (payments) {
    let price = `Total price ${money(payments.total, payments.currency)} including all taxes and charges known at the time of booking.`;
    const local = localPayments(payments);
    if (local !== null) price += ` Local payments of ${money(local, payments.currency)} are collected by suppliers during your trip, making the total cost of the trip ${money(payments.totalIncludingResort, payments.currency)}.`;
    const schedule = [...payments.items].sort((left, right) => (left.dueDate ?? '9999').localeCompare(right.dueDate ?? '9999')).filter((item) => (item.status !== 'refund' && item.status !== 'local') && (item.amount ?? 0) > 0)
      .map((item) => `${paymentAmount(item)} ${item.label.toLowerCase()}${item.status === 'paid' ? ' (received)' : item.dueDate ? ` due ${mediumDate(item.dueDate)}` : ''}`);
    if (schedule.length) price += ` Payments: ${schedule.join('; ')}.`;
    rows.push({ label: 'Price and payment', text: price });
  }
  const member = retailerName(snapshot);
  let who = protection.organiserName && protection.organiserName !== member ? `Package organiser: ${protection.organiserName}. Retailer: ` : 'Organiser and retailer: ';
  who += `${member}${snapshot.brand.name && snapshot.brand.name !== member ? ` trading as ${snapshot.brand.name}` : ''}${protection.retailerAddress?.length ? `, ${protection.retailerAddress.join(', ')}` : ''}.`;
  const contact = [snapshot.support.phone, snapshot.support.email].filter(Boolean);
  if (contact.length) who += ` Contact: ${contact.join(', ')}.`;
  rows.push({ label: 'Who you are contracting with', text: who });
  rows.push({ label: 'Financial protection', text: protectionSentence(protection) });
  rows.push({ label: 'Cancellation', text: legalText('cancellation', snapshot) });
  const hints = entryRequirementHints(summary.countries);
  rows.push({ label: 'Passports, visas and health', text: `${legalText('entry_health', snapshot)}${hints ? ` ${hints}` : ''}` });
  rows.push({ label: 'Insurance', text: legalText('insurance', snapshot) });
  rows.push({ label: 'Special requirements', text: legalText('assistance', snapshot) });
  return rows;
}

/** Local (resort) payments, when the total including them differs from the price paid to the agent. */
export function localPayments(payments: NonNullable<TripSnapshot['payments']>): number | null {
  if (payments.total === null || payments.totalIncludingResort === null || payments.totalIncludingResort <= 0) return null;
  const difference = payments.totalIncludingResort - payments.total;
  return Math.abs(difference) > 0.01 ? difference : null;
}

export function paymentAmount(item: NonNullable<TripSnapshot['payments']>['items'][number]): string {
  if (item.kind === 'points') return item.points ? `${item.points.toLocaleString('en-GB')} points` : 'Loyalty points';
  return money(item.amount, item.currency);
}

/** "What's included" lines: the agent's own list, else a conservative one built from the booked items. */
export function inclusions(snapshot: TripSnapshot): { included: string[]; excluded: string[] } {
  const included = snapshot.content?.included.map((item) => item.text).filter(Boolean) ?? [];
  const excluded = snapshot.content?.notIncluded.map((item) => item.text).filter(Boolean) ?? [];
  if (included.length) return { included, excluded };
  const derived = snapshot.itinerary.flatMap((item) => {
    const nights = Number(detail(item, 'Nights')) || 0;
    if (item.kind === 'flight') return [`Flights ${item.from ?? ''} – ${item.to ?? ''}${detail(item, 'Class') ? ` (${detail(item, 'Class')})` : ''}`];
    if (item.kind === 'stay') return [`${nights ? `${nights} night${nights === 1 ? '' : 's'} at ` : ''}${item.title}${item.rooms.length ? ` — ${item.rooms.map((room) => room.type).join('; ')}` : ''}`];
    if (item.kind === 'cruise') return [`Cruise aboard ${item.title}${item.cabins.length ? ` — ${item.cabins.map((cabin) => cabin.name).join('; ')}` : ''}`];
    if (item.kind === 'transfer') return [`Transfer${item.from || item.to ? `: ${[item.from, item.to].filter(Boolean).join(' to ')}` : ''}`];
    if (item.kind === 'carhire') return [`Car hire: ${item.title}`];
    if (item.kind === 'train') return [`Rail: ${item.from ?? ''} – ${item.to ?? ''}`];
    return [item.title];
  });
  return { included: derived, excluded };
}

// ---------------------------------------------------------------------------------------------------------------
// ATOL certificate (PHP Domain/Atol.php)
// ---------------------------------------------------------------------------------------------------------------

export interface AtolCertificate {
  applies: boolean;
  packageLabel: 'Flight-Only' | 'Package (Multi-Contract)' | 'Package (Single-Contract)';
  flightOnly: boolean;
  multiContract: boolean;
  protectorName: string;
  issuerName: string;
  atolNumber: string;
  bookingRef: string;
  /** dd/mm/yyyy: the first customer payment, else the booking's creation, else today. */
  issueDate: string;
  passengerCount: number;
  passengerNames: string;
  whatsCovered: string;
  flightDetails: string;
  totalCost: string;
  parts: Array<{ type: string; details: string; provider: string }>;
}

const UK = new Set(['GB', 'GBR', 'UK', 'UNITED KINGDOM']);
const isUk = (country: string | null | undefined) => UK.has((country ?? '').trim().toUpperCase());

interface FlightLeg { departs: number; arrives: number; from: string; to: string; fromCountry: string; toCountry: string; carrier: string; reference: string; arrivalDate: string; departureDate: string }

function at(date: string, time: string | null): number {
  const [hours, minutes] = /^\d{2}:\d{2}$/.test(time ?? '') ? time!.split(':').map(Number) : [0, 0];
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + (hours * 60 + minutes) * 60_000;
}

/** The earliest completed customer payment, which is when an ATOL certificate is issued. */
export function firstPaymentDate(snapshot: TripSnapshot): string | null {
  return snapshot.payments?.items.filter((item) => item.status === 'paid' && item.completedDate).map((item) => item.completedDate!.slice(0, 10)).sort()[0] ?? null;
}

export function buildAtolCertificate(snapshot: TripSnapshot): AtolCertificate {
  const { protection, summary } = snapshot;
  const flightOnly = protection.mode.includes('flight_only') || protection.contractType === 'flight_only';
  const multiContract = protection.mode.includes('multi');
  const protectorName = protection.holderName || retailerName(snapshot);
  const infant = (age: number | null | undefined) => age !== null && age !== undefined && age < 2;
  const passengerCount = (summary.unnamedTravellers ?? 0) + snapshot.travellers.filter((person) => !infant(person.age)).length;

  const legs: FlightLeg[] = snapshot.itinerary.filter((item) => item.kind === 'flight' && item.startDate).map((item) => ({
    departs: at(item.startDate!, item.startTime), arrives: at(item.endDate ?? item.startDate!, item.endTime),
    from: item.from ?? '', to: item.to ?? '', fromCountry: item.fromCountry ?? '', toCountry: item.toCountry ?? '',
    carrier: item.carrier ?? '', reference: item.reference ?? '', departureDate: item.startDate!, arrivalDate: item.endDate ?? item.startDate!,
  })).sort((left, right) => left.departs - right.departs);
  // Connections within 24 hours at the same airport are one journey.
  const journeys: FlightLeg[][] = [];
  for (const leg of legs) {
    const current = journeys.at(-1); const previous = current?.at(-1);
    const gapHours = previous ? (leg.departs - previous.arrives) / 3_600_000 : -1;
    if (current && previous && previous.to !== '' && previous.to.trim().toLowerCase() === leg.from.trim().toLowerCase() && gapHours >= 0 && gapHours <= 24) current.push(leg);
    else journeys.push([leg]);
  }
  let outbound = false; let inbound = false;
  const segments = journeys.map((journey) => {
    const first = journey[0]; const last = journey.at(-1)!;
    const via = [...new Set(journey.slice(0, -1).map((leg) => leg.to).filter(Boolean))];
    let text = `${first.from} to ${last.to}${via.length ? ` via ${via.join(', ')}` : ''}`;
    if (isUk(first.fromCountry) && !isUk(last.toCountry)) outbound = true;
    if (!isUk(first.fromCountry) && isUk(last.toCountry)) {
      inbound = true;
      text += `, returning ${numericDate(last.arrivalDate)}${last.carrier ? ` with ${last.carrier}` : ''}`;
    } else {
      text += `, departing ${numericDate(first.departureDate)}${first.carrier ? ` with ${first.carrier}` : ''}`;
    }
    return text;
  });
  const flightDetails = segments.length ? `${segments.length > 1 ? 'Flights from ' : 'Flight from '}${segments.join('; ')}.` : '';
  const countries = summary.countries;
  const countriesText = countries.length <= 1 ? (countries[0] ?? destinationSummary(snapshot)) : `${countries.slice(0, -1).join(', ')} and ${countries.at(-1)}`;
  const hasKind = (...kinds: string[]) => snapshot.itinerary.some((item) => kinds.includes(item.kind));
  const whatsCovered = !flightOnly && hasKind('stay', 'cruise', 'carhire')
    ? `Package holiday to ${countriesText} for ${summary.durationDays ?? 0} nights.`
    : outbound && inbound ? `Return flights to ${countriesText}.` : `Flight to ${countriesText}.`;

  const parts: AtolCertificate['parts'] = [];
  if (multiContract) {
    if (flightDetails) {
      const references = [...new Set(legs.map((leg) => [leg.carrier, leg.reference ? `Ref: ${leg.reference}` : ''].filter(Boolean).join(', ')).filter(Boolean))];
      parts.push({ type: 'Flight', details: flightDetails, provider: references.join('; ') });
    }
    for (const item of snapshot.itinerary.filter((entry) => entry.kind !== 'flight')) {
      const details = item.kind === 'stay' ? `Stay at ${item.title}` : item.kind === 'carhire' ? `Car hire${item.from ? ` from ${item.from}` : ''}` : item.kind === 'cruise' ? `Cruise: ${item.title}` : item.title;
      parts.push({ type: item.typeLabel, details, provider: [item.supplier?.name, item.reference ? `Ref: ${item.reference}` : ''].filter(Boolean).join(', ') });
    }
  }
  const issued = firstPaymentDate(snapshot) ?? snapshot.bookingStatus.createdAt ?? snapshot.serverTime;
  return {
    applies: atolApplies(protection),
    packageLabel: flightOnly ? 'Flight-Only' : multiContract ? 'Package (Multi-Contract)' : 'Package (Single-Contract)',
    flightOnly, multiContract, protectorName,
    issuerName: protection.certificateIssuer || protectorName,
    atolNumber: protection.atolNumber ?? '',
    bookingRef: summary.reference.replace(/,.*/s, ''),
    issueDate: numericDate(issued),
    passengerCount: passengerCount || summary.totalTravellers,
    passengerNames: snapshot.travellers.map((person) => `${person.name}${infant(person.age) ? ' (infant)' : ''}`).join(', '),
    whatsCovered, flightDetails,
    totalCost: snapshot.payments ? money(snapshot.payments.total, snapshot.payments.currency) : '',
    parts,
  };
}
