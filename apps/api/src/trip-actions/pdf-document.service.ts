import { Injectable } from '@nestjs/common';
import type { TripSnapshot } from '@vision-trips/contracts';
import PDFDocument from 'pdfkit';
import { formatMoney } from '../trips/field-map.js';
import { type AcceptanceEvidence, signedInRows } from './acceptance-evidence.js';
import { buildAtolCertificate, cabinLine, inclusions, keyInformation, legalLine, legalNotice, localPayments, longDate as documentDate, numericDate, paymentAmount, protectionParagraphs, roomLine } from './document-content.js';

@Injectable()
export class PdfDocumentService {
  create(snapshot: TripSnapshot, action: string, acceptance?: AcceptanceEvidence | null): Promise<Buffer> {
    return render((pdf) => {
      header(pdf, snapshot, title(action, snapshot));
      if (action === 'confirmation') confirmation(pdf, snapshot);
      else if (action === 'invoice') invoice(pdf, snapshot);
      else if (action === 'atol') atol(pdf, snapshot);
      else if (action === 'acceptance' && acceptance) acceptanceReceipt(pdf, snapshot, acceptance);
      else if (action.startsWith('receipt:')) paymentReceipt(pdf, snapshot, action.slice(8));
      else if (action === 'front-file') frontFile(pdf, snapshot);
      else if (action === 'guarantee') guarantee(pdf, snapshot);
      else if (action.startsWith('letter:')) letter(pdf, snapshot, action.slice(7));
      footer(pdf, snapshot);
    });
  }
}

function render(write: (pdf: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const pdf = new PDFDocument({ size: 'A4', margin: 54, info: { Creator: 'Vision Trips', Producer: 'Vision Trips' } });
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    write(pdf); pdf.end();
  });
}

function header(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot, heading: string): void {
  pdf.fillColor('#0f766e').fontSize(11).text(snapshot.brand.name.toUpperCase(), { characterSpacing: 1.2 });
  pdf.moveDown(0.5).fillColor('#172033').fontSize(25).text(heading);
  pdf.fontSize(10).fillColor('#64748b').text(`${snapshot.summary.reference} · ${snapshot.summary.name}`);
  pdf.moveDown().strokeColor('#0f766e').lineWidth(2).moveTo(54, pdf.y).lineTo(541, pdf.y).stroke().moveDown();
}

const QUOTE_STAGES = new Set(['quote', 'quote_expired']);

/** The booking confirmation or quotation, as the PHP documents/confirmation.php view. */
function confirmation(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void {
  const quote = QUOTE_STAGES.has(snapshot.stage);
  const { summary, payments } = snapshot;
  const lead = snapshot.travellers.find((person) => person.isLead);
  paragraph(pdf, `${summary.departureDate ? `${documentDate(summary.departureDate)} to ${documentDate(summary.returnDate) || 'to be confirmed'}` : 'Dates to be confirmed'}${summary.durationDays ? ` · ${summary.durationDays} nights` : ''}`);
  field(pdf, 'Issued', documentDate(snapshot.serverTime)); field(pdf, 'Reference', summary.reference); field(pdf, 'Status', snapshot.bookingStatus.sourceStatus || (quote ? 'Quotation' : 'Booked'));
  if (lead) field(pdf, 'Lead passenger', lead.name);
  if (snapshot.travellers.length) field(pdf, 'Travellers', snapshot.travellers.map((person) => person.name).join(', '));
  const message = snapshot.experience.personalisedMessage || snapshot.experience.overview;
  if (message) { pdf.moveDown(0.5); paragraph(pdf, message); }

  if (snapshot.itinerary.length) {
    section(pdf, 'Itinerary');
    let day: string | null | undefined;
    for (const item of [...snapshot.itinerary].sort((left, right) => (left.startDate ?? '9999').localeCompare(right.startDate ?? '9999'))) {
      if (item.startDate !== day) {
        day = item.startDate;
        const number = day && summary.departureDate ? Math.round((Date.parse(day) - Date.parse(summary.departureDate)) / 86_400_000) + 1 : null;
        subheading(pdf, `${day ? documentDate(day) : 'Date to be confirmed'}${number && number > 0 ? `  ·  Day ${number}` : ''}`);
      }
      itineraryElement(pdf, item, quote);
    }
  }

  section(pdf, quote ? 'Price' : 'Price and payments');
  if (!payments) paragraph(pdf, 'Price details are shown to the lead customer.');
  else {
    const perPerson = payments.perPerson ?? (payments.total !== null && snapshot.travellers.length > 1 ? Math.round((payments.total / snapshot.travellers.length) * 100) / 100 : null);
    row(pdf, `Total price payable to ${snapshot.brand.name}${perPerson && snapshot.travellers.length > 1 ? ` (${money(perPerson, payments.currency)} per person, ${snapshot.travellers.length} travellers)` : ''}`, money(payments.total, payments.currency));
    if (localPayments(payments) !== null) row(pdf, 'Total cost including payments made locally', money(payments.totalIncludingResort, payments.currency));
    if (!quote) { row(pdf, 'Paid to us', money(payments.paid, payments.currency)); row(pdf, `Balance due to us${payments.balanceDueDate ? ` by ${documentDate(payments.balanceDueDate)}` : ''}`, money(payments.balance, payments.currency)); }
  }
  const { included, excluded } = inclusions(snapshot);
  if (included.length) {
    subheading(pdf, "What's included");
    for (const line of included) paragraph(pdf, `•  ${line}`, true);
    if (excluded.length) paragraph(pdf, `Not included: ${excluded.join('; ')}`);
  }
  if (payments?.items.length) {
    subheading(pdf, 'Payment schedule');
    for (const item of payments.items) {
      const local = item.status === 'local';
      const status = local ? 'Paid locally' : item.status === 'paid' ? `Received ${item.completedDate ? numericDate(item.completedDate) : ''}`.trim() : item.status === 'refund' ? 'Refund' : `${item.status === 'overdue' ? 'Overdue' : 'Due'}${item.dueDate ? ` ${numericDate(item.dueDate)}` : ''}`;
      row(pdf, `${item.label} · ${status}`, paymentAmount(item));
    }
  }
  const bank = payments?.bankTransfer;
  if (bank && !quote && (payments?.balance ?? 0) > 0.009) paragraph(pdf, `Bank transfer: ${[bank.accountName, bank.sortCode ? `sort code ${bank.sortCode}` : null, `account ${bank.accountNumber}`].filter(Boolean).join(', ')}, reference ${summary.reference}.`);

  section(pdf, 'Key information');
  for (const item of keyInformation(snapshot)) { subheading(pdf, item.label, 10); paragraph(pdf, item.text, true); }
  const notice = legalNotice(snapshot);
  if (notice) { section(pdf, notice.title); for (const block of notice.text.split(/\n{2,}/)) paragraph(pdf, block); }

  const templates = (snapshot.brand.profile.legalTemplates ?? []).filter((template) => template.id !== 'financial');
  if (snapshot.protection.scheme === 'atol' || snapshot.brand.profile.legalTemplates?.length) {
    section(pdf, 'Important information');
    subheading(pdf, 'Who you are booking with');
    for (const block of protectionParagraphs(snapshot)) paragraph(pdf, block);
    for (const template of templates) { subheading(pdf, template.title); for (const block of template.text.split(/\n{2,}/)) paragraph(pdf, block); }
  }
}

function itineraryElement(pdf: PDFKit.PDFDocument, item: TripSnapshot['itinerary'][number], quote: boolean): void {
  ensureSpace(pdf, 60);
  const heading = item.kind === 'flight' ? `${item.from ?? 'Departure'} to ${item.to ?? 'arrival'}` : item.title;
  pdf.fillColor('#172033').font('Helvetica-Bold').fontSize(11).text(heading, { continued: true }).font('Helvetica').fillColor('#64748b').fontSize(9).text(`   ${item.typeLabel}${/request/i.test(item.status) ? ' (on request)' : ''}`);
  pdf.moveDown(0.4);
  const code = (value: string | null) => (value ? ` (${value})` : '');
  const terminal = (value: string | null | undefined) => (value ? ` · Terminal ${value.replace(/^T/i, '')}` : '');
  const shown = new Set<string>();
  if (item.kind === 'flight') {
    if (item.carrier || item.flightNumber) field(pdf, 'Flight', [item.carrier, item.flightNumber].filter(Boolean).join(' '));
    field(pdf, 'Departs', `${documentDate(item.startDate) || 'To be confirmed'}${item.startTime ? ` at ${item.startTime}` : ''}${code(item.fromCode)}${terminal(item.departureTerminal)}`);
    field(pdf, 'Arrives', `${documentDate(item.endDate ?? item.startDate) || 'To be confirmed'}${item.endTime ? ` at ${item.endTime}` : ''}${code(item.toCode)}${terminal(item.arrivalTerminal)}`);
  } else {
    const ranged = ['stay', 'cruise', 'carhire', 'parking'].includes(item.kind);
    const nights = item.details.find((entry) => entry.label === 'Nights')?.value;
    shown.add('Nights');
    field(pdf, 'Dates', `${ranged && item.endDate && item.endDate !== item.startDate ? `${documentDate(item.startDate)} to ${documentDate(item.endDate)}` : documentDate(item.startDate) || 'To be confirmed'}${item.startTime ? `, ${item.startTime}${item.endTime ? `–${item.endTime}` : ''}` : ''}${nights ? ` (${nights} nights)` : ''}`);
    if (item.from && item.kind !== 'stay') field(pdf, 'From', `${item.from}${code(item.fromCode)}`);
    if (item.to && item.kind !== 'stay') field(pdf, 'To', `${item.to}${code(item.toCode)}`);
  }
  if (item.address) field(pdf, 'Address', item.address);
  if (item.rooms.length) field(pdf, 'Room', item.rooms.map(roomLine).join('; '));
  for (const room of item.rooms.filter((entry) => entry.requests)) field(pdf, 'Requests', room.requests!);
  for (const cabin of item.cabins) field(pdf, 'Cabin', cabinLine(cabin));
  for (const entry of item.details.filter((detail) => !shown.has(detail.label))) field(pdf, entry.label, entry.value);
  if (item.supplier) field(pdf, 'Provided by', item.supplier.name);
  if (item.reference) field(pdf, 'Reference', item.reference);
  if (item.passengers.length && !quote) field(pdf, 'Travelling', item.passengers.map((person) => `${person.name}${person.seat ? ` (seat ${person.seat})` : ''}`).join('; '));
  if (item.cruisePorts.length) field(pdf, 'Ports', item.cruisePorts.map((port) => `Day ${port.day} ${port.port}`).join(' · '));
  if (item.emergencyContact) field(pdf, 'Emergency contact', `${item.emergencyContact.name} · ${item.emergencyContact.phone}`);
  if (item.notes) paragraph(pdf, item.notes);
  pdf.moveDown(0.4);
}

function invoice(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void {
  const payments = snapshot.payments;
  if (!payments) return paragraph(pdf, 'Payment details are not available for this access level.');
  section(pdf, 'Payment summary');
  row(pdf, 'Booking total', money(payments.total, payments.currency)); row(pdf, 'Paid', money(payments.paid, payments.currency)); row(pdf, 'Balance', money(payments.balance, payments.currency));
  section(pdf, 'Payment schedule');
  for (const item of payments.items) row(pdf, `${item.label}${item.dueDate ? ` · due ${item.dueDate}` : ''}`, `${money(item.amount, item.currency)} · ${item.status}`);
}

function paymentReceipt(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot, paymentId: string): void {
  const payment = snapshot.payments?.items.find((item) => item.id === paymentId && item.status === 'paid');
  if (!payment) return paragraph(pdf, 'Payment receipt unavailable.');
  section(pdf, 'Payment received'); row(pdf, 'Payment', payment.label); row(pdf, 'Amount', money(payment.amount, payment.currency)); row(pdf, 'Received', payment.completedDate ?? 'Recorded on booking'); row(pdf, 'Status', 'Paid');
  pdf.moveDown().fontSize(10).fillColor('#475569').text('This receipt confirms payment received towards your booking. Please keep it for your records.');
}

/** The CAA ATOL Certificate, as the PHP documents/atol.php view built from Domain/Atol. */
function atol(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void {
  const certificate = buildAtolCertificate(snapshot);
  const protector = certificate.protectorName;
  pdf.fontSize(9).fillColor('#475569').text('This is an important document. Make sure that you take it with you when you travel.');
  pdf.moveDown(0.5);
  pdf.font('Helvetica-Bold').fillColor('#172033').fontSize(12).text('This confirms that your money is protected by the ATOL scheme if your travel company collapses.').font('Helvetica');
  pdf.moveDown(0.3);
  paragraph(pdf, 'This certificate sets out how the ATOL scheme will protect the people named on it for the parts of their trip listed below.');
  subheading(pdf, 'Who is protected?');
  row(pdf, 'Number of passengers', String(certificate.passengerCount));
  if (certificate.passengerNames) paragraph(pdf, certificate.passengerNames);
  subheading(pdf, 'What is protected?');
  paragraph(pdf, [certificate.whatsCovered, certificate.flightDetails].filter(Boolean).join('\n'));
  if (!certificate.flightOnly) paragraph(pdf, `You can find more detailed information on your booking, including price, on the confirmation you will receive from ${protector}.`);
  subheading(pdf, `Who is protecting your ${certificate.flightOnly ? 'flight' : 'trip'}?`);
  paragraph(pdf, `${protector} – ATOL No. ${certificate.atolNumber}\nBooking Reference ${certificate.bookingRef}`);
  if (certificate.flightOnly) { subheading(pdf, 'ATOL protected cost'); paragraph(pdf, certificate.totalCost); }
  section(pdf, 'Your protection');
  if (certificate.flightOnly) {
    paragraph(pdf, `You are protected from when you were given this certificate until you return to the UK. If ${protector} stops trading, the passengers named above will either:`);
    paragraph(pdf, '1. be returned to the UK; or\n2. receive a refund for the amount above (or your deposit if that is all you have paid so far).');
  } else {
    paragraph(pdf, 'You are protected from when you were given this certificate to the end of your trip.');
    paragraph(pdf, `If ${protector} stops trading, the passengers named above will either:`);
    paragraph(pdf, '1. take and complete their trip; or\n2. receive a refund.');
  }
  paragraph(pdf, 'Your protection depends on the terms of the ATOL scheme and the specifics of the ATOL holder failure (available at www.atol.org.uk).');
  paragraph(pdf, `If ${protector} stops trading, you must follow the instructions at www.atol.org.uk (where there will be details of repatriation arrangements, and information on how people can claim their money back) or you can call (+44) 333 103 6350.`);
  if (certificate.flightOnly) { section(pdf, 'Warning'); paragraph(pdf, 'This certificate only protects the above flights you have booked. Any other travel services you booked are not protected by this certificate.'); }
  pdf.moveDown(0.5).fontSize(8.5).fillColor('#475569')
    .text(`By issuing this ATOL Certificate, under Regulation 17 of the Civil Aviation (Air Travel Organisers' Licensing) Regulations 2012 (as amended), ${protector} confirms that the trip to which it applies is sold in line with the ATOL held by the organiser named above.`, { lineGap: 2 })
    .moveDown(0.4).text('The ATOL scheme is run by the Civil Aviation Authority and paid for by the Air Travel Trust. To see what that is and what you can expect, together with full information on its terms and conditions go to www.atol.org.uk.', { lineGap: 2 })
    .moveDown(0.4).text('As well as the protection of the ATOL scheme, you have protection under the Package Travel and Linked Travel Arrangements Regulations. For more information see www.direct.gov.uk in the Travel and Transport section.', { lineGap: 2 });
  atolFooter(pdf, certificate);
  if (certificate.parts.length) {
    pdf.addPage();
    pdf.fontSize(9).fillColor('#475569').text('This is an important document. Make sure that you take it with you when you travel.');
    pdf.moveDown(0.3).fillColor('#172033').fontSize(22).text('ATOL Certificate');
    section(pdf, 'Parts of your trip covered by this certificate');
    for (const part of certificate.parts) { subheading(pdf, part.type, 10); paragraph(pdf, part.details, true); if (part.provider) field(pdf, 'Provider and reference', part.provider); }
    row(pdf, 'Total ATOL protected cost', certificate.totalCost);
    atolFooter(pdf, certificate);
  }
}

function atolFooter(pdf: PDFKit.PDFDocument, certificate: ReturnType<typeof buildAtolCertificate>): void {
  ensureSpace(pdf, 170); // the reference table stays in one piece
  pdf.moveDown();
  row(pdf, 'Unique reference number', certificate.bookingRef); row(pdf, 'Date of issue', certificate.issueDate); row(pdf, 'ATOL Certificate Issuer', certificate.issuerName); row(pdf, 'ATOL number', certificate.atolNumber); row(pdf, 'Type', certificate.packageLabel);
  pdf.moveDown(0.3).fontSize(8).fillColor('#94a3b8').text('Copyright UK Civil Aviation Authority. The ATOL Logo is a registered trade mark.');
}

function acceptanceReceipt(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot, evidence: AcceptanceEvidence): void {
  section(pdf, 'Acceptance evidence'); row(pdf, 'Accepted by (as entered)', `${evidence.name} · ${evidence.email}`); row(pdf, 'Accepted at', evidence.acceptedAt); row(pdf, 'Quotation version', evidence.snapshotVersion || snapshot.version);
  for (const [label, value] of signedInRows(evidence)) row(pdf, label, value);
  section(pdf, 'Reviewed sections');
  for (const item of snapshot.quotation.reviewSections.filter((entry) => evidence.confirmations.includes(entry.id))) paragraph(pdf, item.title, true);
}

function frontFile(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void {
  paragraph(pdf, 'Customer-safe booking summary. Supplier net costs and internal booking notes are intentionally excluded.');
  section(pdf, 'Booking overview');
  row(pdf, 'Status', snapshot.bookingStatus.sourceStatus || snapshot.stage); row(pdf, 'Travel dates', dateRange(snapshot)); row(pdf, 'Passengers', String(snapshot.summary.totalTravellers));
  if (snapshot.payments) { row(pdf, 'Total price', money(snapshot.payments.total, snapshot.payments.currency)); row(pdf, 'Balance', money(snapshot.payments.balance, snapshot.payments.currency)); }
  section(pdf, 'Passengers');
  for (const traveller of snapshot.travellers) paragraph(pdf, `${traveller.name}${traveller.isLead ? ' · lead traveller' : ''}${traveller.nationality ? ` · ${traveller.nationality}` : ''}`, true);
  section(pdf, 'Travel arrangements');
  for (const item of snapshot.itinerary) {
    paragraph(pdf, `${item.startDate ?? 'Date to be confirmed'} · ${item.typeLabel} · ${item.title}`, true);
    if (item.supplier || item.reference) paragraph(pdf, [item.supplier?.name, item.reference ? `Reference ${item.reference}` : ''].filter(Boolean).join(' · '), true);
  }
  if (snapshot.payments) { section(pdf, 'Payments'); for (const item of snapshot.payments.items) row(pdf, `${item.label}${item.dueDate ? ` · ${item.dueDate}` : ''}`, `${money(item.amount, item.currency)} · ${item.status}`); }
  section(pdf, 'Financial protection'); paragraph(pdf, snapshot.protection.summary);
}

function guarantee(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void {
  section(pdf, 'Stand Alone Safe Seat Plan Guarantee Certificate');
  paragraph(pdf, 'Travel Trust Association');
  row(pdf, 'Reference', snapshot.summary.reference); row(pdf, 'Date of issue', snapshot.serverTime.slice(0, 10));
  row(pdf, 'Lead passenger', snapshot.travellers.find((person) => person.isLead)?.name ?? snapshot.travellers[0]?.name ?? 'See booking');
  row(pdf, 'Number of passengers', String(snapshot.summary.totalTravellers)); row(pdf, 'Departure', snapshot.summary.departureDate ?? 'To be confirmed'); row(pdf, 'Return', snapshot.summary.returnDate ?? 'To be confirmed');
  row(pdf, 'TTA member', snapshot.protection.organiserName ?? snapshot.brand.name);
  section(pdf, 'Certificate of guarantee');
  paragraph(pdf, 'This certificate is issued to the customers named above by the Travel Trust Association, guaranteeing the due performance by a TTA member of its financial obligations under the customer contract where fraud or dishonesty results in a third-party travel provider not being paid for protected components.');
  paragraph(pdf, 'Travel Trust Association members operate trust accounts to provide financial protection for consumers. Member status can be confirmed at thetravelnetworkgroup.co.uk/verify-a-member or by calling 01483 545 780.');
  paragraph(pdf, 'Travel Trust Association is a trading name of TTA Management Ltd, St Andrews House, West Street, Woking, Surrey, GU21 6EB. Company registration number 2884750.');
}

function letter(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot, templateId: string): void {
  const template = snapshot.brand.profile.letterTemplates.find((item) => item.id === templateId);
  if (!template) return paragraph(pdf, 'Letter template unavailable.');
  const lead = snapshot.travellers.find((person) => person.isLead) ?? snapshot.travellers[0];
  paragraph(pdf, lead?.name ?? 'Customer'); paragraph(pdf, longDate(snapshot.serverTime.slice(0, 10)));
  paragraph(pdf, `Re: ${snapshot.summary.name} — ${snapshot.summary.reference}`, true);
  paragraph(pdf, `Dear ${lead?.firstName || 'Sir/Madam'},`);
  for (const block of mergeLetter(template.body, snapshot).split(/\n{2,}/)) paragraph(pdf, block);
  paragraph(pdf, 'Yours sincerely,');
  paragraph(pdf, `${snapshot.experience.agentName || snapshot.brand.name}\n${snapshot.brand.name}`);
}

export function mergeLetter(value: string, snapshot: TripSnapshot): string {
  const lead = snapshot.travellers.find((person) => person.isLead) ?? snapshot.travellers[0];
  const fields: Record<string, string> = {
    first_name: lead?.firstName ?? '', full_name: lead?.name ?? '', booking_ref: snapshot.summary.reference, trip_name: snapshot.summary.name,
    departure_date: longDate(snapshot.summary.departureDate), return_date: longDate(snapshot.summary.returnDate),
    total: snapshot.payments ? money(snapshot.payments.total, snapshot.payments.currency) : '', balance: snapshot.payments ? money(snapshot.payments.balance, snapshot.payments.currency) : '',
    balance_due: longDate(snapshot.payments?.balanceDueDate ?? null), brand: snapshot.brand.name, agent: snapshot.experience.agentName ?? snapshot.brand.name,
  };
  return value.replace(/\{\{([a-z_]+)\}\}/g, (match, key: string) => Object.hasOwn(fields, key) ? fields[key] : match);
}

function ensureSpace(pdf: PDFKit.PDFDocument, height: number): void { if (pdf.y + height > pdf.page.height - pdf.page.margins.bottom) pdf.addPage(); }
function subheading(pdf: PDFKit.PDFDocument, value: string, size = 11.5): void { ensureSpace(pdf, 40); pdf.moveDown(0.4).fillColor('#172033').font('Helvetica-Bold').fontSize(size).text(value).font('Helvetica'); pdf.moveDown(0.25); }
/** A label beside a left-aligned value that may wrap (addresses, rooms, notes). */
function field(pdf: PDFKit.PDFDocument, label: string, value: string): void {
  pdf.fontSize(9.5);
  ensureSpace(pdf, Math.max(14, pdf.heightOfString(value, { width: 357 })));
  const y = pdf.y;
  pdf.font('Helvetica').fillColor('#64748b').text(label, 54, y, { width: 120 });
  pdf.fillColor('#172033').text(value, 184, y, { width: 357, lineGap: 1.5 });
  pdf.x = 54; pdf.moveDown(0.3);
}
function section(pdf: PDFKit.PDFDocument, value: string): void { ensureSpace(pdf, 60); pdf.moveDown().fillColor('#172033').font('Helvetica-Bold').fontSize(14).text(value).font('Helvetica'); pdf.moveDown(0.35); }
function paragraph(pdf: PDFKit.PDFDocument, value: string, compact = false): void { pdf.fillColor('#334155').fontSize(10).text(value, { lineGap: 3 }); pdf.moveDown(compact ? 0.35 : 0.7); }
function row(pdf: PDFKit.PDFDocument, label: string, value: string): void {
  pdf.fontSize(10);
  const height = Math.max(pdf.heightOfString(label, { width: 235 }), pdf.font('Helvetica-Bold').heightOfString(value, { width: 251 }));
  pdf.font('Helvetica'); ensureSpace(pdf, height + 8);
  const y = pdf.y;
  pdf.fillColor('#64748b').text(label, 54, y, { width: 235 });
  pdf.font('Helvetica-Bold').fillColor('#172033').text(value, 290, y, { width: 251, align: 'right' }).font('Helvetica');
  pdf.x = 54; pdf.y = y + height; pdf.moveDown(0.55);
}
function footer(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void {
  pdf.moveDown(2).fontSize(8).fillColor('#94a3b8');
  // The member's legal identity on every document, as the PHP documents/_close.php footer.
  const line = legalLine(snapshot);
  if (line) pdf.text(line, { lineGap: 1.5 }).moveDown(0.3);
  pdf.text(`Generated ${snapshot.serverTime} · ${snapshot.brand.name}`);
}
const money = formatMoney;
function dateRange(snapshot: TripSnapshot): string { return `${snapshot.summary.departureDate ?? 'To be confirmed'} to ${snapshot.summary.returnDate ?? 'To be confirmed'}`; }
function longDate(value: string | null): string { if (!value) return ''; const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parsed); }
function title(action: string, snapshot: TripSnapshot): string { if (action === 'atol') return 'ATOL Certificate'; if (action === 'invoice') return 'Booking invoice'; if (action === 'acceptance') return 'Quotation acceptance receipt'; if (action === 'front-file') return 'Booking front file'; if (action === 'guarantee') return 'Safe Seat Plan guarantee'; if (action.startsWith('letter:')) return 'Customer letter'; if (action.startsWith('receipt:')) return 'Payment receipt'; return QUOTE_STAGES.has(snapshot.stage) ? 'Quotation' : 'Booking confirmation'; }
