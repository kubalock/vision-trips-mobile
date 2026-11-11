import { Injectable } from '@nestjs/common';
import type { TripSnapshot } from '@vision-trips/contracts';
import PDFDocument from 'pdfkit';
import { formatMoney } from '../trips/field-map.js';

@Injectable()
export class PdfDocumentService {
  create(snapshot: TripSnapshot, action: string, acceptance?: { acceptedAt: string; name: string; email: string; confirmations: string[] } | null): Promise<Buffer> {
    return render((pdf) => {
      header(pdf, snapshot, title(action));
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

function confirmation(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void {
  paragraph(pdf, snapshot.experience.overview || 'Your booking details and travel arrangements.');
  section(pdf, 'Travel dates'); paragraph(pdf, `${snapshot.summary.departureDate ?? 'To be confirmed'} to ${snapshot.summary.returnDate ?? 'To be confirmed'}`);
  section(pdf, 'Travellers'); paragraph(pdf, snapshot.travellers.map((person) => person.name).join(', ') || 'See booking record');
  section(pdf, 'Itinerary');
  for (const item of snapshot.itinerary) paragraph(pdf, `${item.startDate ?? ''} ${item.startTime ?? ''}  ${item.title}${item.reference ? ` · Ref ${item.reference}` : ''}`.trim(), true);
  section(pdf, 'Financial protection'); paragraph(pdf, snapshot.protection.summary);
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

function atol(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void {
  section(pdf, 'Your protection');
  paragraph(pdf, 'This confirms that your money is protected by the ATOL scheme if your travel company collapses. This certificate applies to the people and arrangements shown on this booking.');
  row(pdf, 'Unique reference number', snapshot.summary.reference); row(pdf, 'Date of issue', snapshot.serverTime.slice(0, 10)); row(pdf, 'ATOL holder', snapshot.protection.holderName ?? snapshot.protection.organiserName ?? snapshot.brand.name); row(pdf, 'ATOL number', snapshot.protection.atolNumber ?? 'See organiser');
  row(pdf, 'Certificate issuer', snapshot.brand.name); row(pdf, 'Protected passengers', snapshot.travellers.map((person) => person.name).join(', ') || 'Passengers named on booking');
  if (snapshot.payments) row(pdf, 'Protected booking cost', money(snapshot.payments.total, snapshot.payments.currency));
  section(pdf, 'Protected arrangements');
  for (const item of snapshot.itinerary.filter((entry) => entry.packageIncluded)) paragraph(pdf, `${item.typeLabel}: ${item.title}${item.startDate ? ` · ${item.startDate}` : ''}`, true);
  pdf.moveDown().fontSize(9).fillColor('#475569').text('Your protection is subject to the terms of the ATOL scheme. The scheme is run by the Civil Aviation Authority and paid for by the Air Travel Trust. Full information is available at www.atol.org.uk.');
}

function acceptanceReceipt(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot, evidence: { acceptedAt: string; name: string; email: string; confirmations: string[] }): void {
  section(pdf, 'Acceptance evidence'); row(pdf, 'Accepted by', `${evidence.name} · ${evidence.email}`); row(pdf, 'Accepted at', evidence.acceptedAt); row(pdf, 'Quotation version', snapshot.version);
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

function section(pdf: PDFKit.PDFDocument, value: string): void { pdf.moveDown().fillColor('#172033').font('Helvetica-Bold').fontSize(14).text(value).font('Helvetica'); pdf.moveDown(0.35); }
function paragraph(pdf: PDFKit.PDFDocument, value: string, compact = false): void { pdf.fillColor('#334155').fontSize(10).text(value, { lineGap: 3 }); pdf.moveDown(compact ? 0.35 : 0.7); }
function row(pdf: PDFKit.PDFDocument, label: string, value: string): void { const y = pdf.y; pdf.font('Helvetica').fillColor('#64748b').fontSize(10).text(label, 54, y, { width: 235 }); pdf.font('Helvetica-Bold').fillColor('#172033').text(value, 290, y, { width: 251, align: 'right' }).font('Helvetica'); pdf.moveDown(0.8); }
function footer(pdf: PDFKit.PDFDocument, snapshot: TripSnapshot): void { pdf.moveDown(2).fontSize(8).fillColor('#94a3b8').text(`Generated ${snapshot.serverTime} · ${snapshot.brand.name}`); }
const money = formatMoney;
function dateRange(snapshot: TripSnapshot): string { return `${snapshot.summary.departureDate ?? 'To be confirmed'} to ${snapshot.summary.returnDate ?? 'To be confirmed'}`; }
function longDate(value: string | null): string { if (!value) return ''; const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parsed); }
function title(action: string): string { if (action === 'atol') return 'ATOL Certificate'; if (action === 'invoice') return 'Booking invoice'; if (action === 'acceptance') return 'Quotation acceptance receipt'; if (action === 'front-file') return 'Booking front file'; if (action === 'guarantee') return 'Safe Seat Plan guarantee'; if (action.startsWith('letter:')) return 'Customer letter'; if (action.startsWith('receipt:')) return 'Payment receipt'; return 'Booking confirmation'; }
