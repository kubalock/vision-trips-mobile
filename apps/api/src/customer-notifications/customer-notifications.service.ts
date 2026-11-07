import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { TripSnapshot } from '@vision-trips/contracts';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AirtableService } from '../airtable/airtable.service.js';
import { LinkTokenService } from '../security/link-token.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { TripsService } from '../trips/trips.service.js';

export const customerEmailTemplates = ['balance_reminder', 'documents_issued', 'payment_received', 'welcome_home', 'quote_reminder', 'custom'] as const;
export type CustomerEmailTemplate = typeof customerEmailTemplates[number];
export interface CustomerEmailRequest { baseId?: unknown; recordId?: unknown; template?: unknown; subject?: unknown; heading?: unknown; body?: unknown; idempotencyKey?: unknown }

@Injectable()
export class CustomerNotificationsService {
  private readonly logger = new Logger(CustomerNotificationsService.name);
  constructor(private readonly trips: TripsService, private readonly airtable: AirtableService, private readonly links: LinkTokenService, private readonly store: DurableAuthStore) {}

  async send(automationKey: string | undefined, input: CustomerEmailRequest): Promise<{ delivered: true; duplicate: boolean; to: string; template: CustomerEmailTemplate; providerId: string }> {
    assertAutomationKey(automationKey);
    const baseId = text(input.baseId); const recordId = text(input.recordId); const template = text(input.template) as CustomerEmailTemplate;
    if (!/^app[A-Za-z0-9]{14}$/.test(baseId) || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) throw new BadRequestException('Enter valid Airtable booking identifiers.');
    if (!customerEmailTemplates.includes(template)) throw new BadRequestException('Unknown customer email template.');
    const profile = await this.trips.verificationProfile(baseId, recordId);
    const to = profile.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new BadRequestException('This booking does not have a customer email address.');
    const snapshot = await this.trips.snapshot(baseId, recordId, 'primary_customer');
    const content = this.content(template, snapshot, baseId, recordId, input);
    const suppliedKey = text(input.idempotencyKey);
    if (suppliedKey && !/^[A-Za-z0-9._:-]{8,120}$/.test(suppliedKey)) throw new BadRequestException('The idempotency key is not valid.');
    const deliveryKey = createHash('sha256').update(`${baseId}|${recordId}|${template}|${suppliedKey || content.eventKey}`).digest('base64url');
    const state = this.store.beginNotificationDelivery(deliveryKey);
    if (state === 'complete') return { delivered: true, duplicate: true, to, template, providerId: 'previous-delivery' };
    if (state === 'pending') throw new BadGatewayException('This email delivery is already in progress.');
    let providerId = 'previous-delivery';
    if (state === 'new') {
      try { providerId = await this.deliver(to, snapshot, content); this.store.markNotificationDelivered(deliveryKey); }
      catch (error) { this.store.releaseNotificationDelivery(deliveryKey); throw error; }
    }
    try {
      await this.airtable.addComment(baseId, process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings', recordId, `📨 Email delivered via Vision Trips · ${template} · to ${to} · ${new Date().toISOString()} · provider ${providerId}`);
      this.store.completeNotificationDelivery(deliveryKey);
    } catch { throw new BadGatewayException('The email was delivered, but its Airtable audit comment is still pending. Retry this request to record it without resending.'); }
    return { delivered: true, duplicate: state !== 'new', to, template, providerId };
  }

  private content(template: CustomerEmailTemplate, snapshot: TripSnapshot, baseId: string, recordId: string, input: CustomerEmailRequest): EmailContent {
    const first = snapshot.travellers.find((traveller) => traveller.isLead)?.firstName || snapshot.travellers[0]?.firstName || 'there';
    const tripUrl = this.links.mintCustomerLink(baseId, recordId, Math.floor(Date.now() / 1000) + 30 * 86_400);
    const dates = [snapshot.summary.departureDate, snapshot.summary.returnDate].filter(Boolean).join(' – ') || 'Dates to be confirmed';
    const facts = [{ label: 'Trip', value: snapshot.summary.name }, { label: 'Dates', value: dates }];
    const money = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: snapshot.payments?.currency || 'GBP' }).format(amount);
    if (template === 'balance_reminder') return { subject: `Your balance for ${snapshot.summary.name}`, heading: `Hello ${first}, your balance is due${snapshot.payments?.balanceDueDate ? ` on ${longDate(snapshot.payments.balanceDueDate)}` : ' soon'}`, body: `Your remaining balance of ${money(snapshot.payments?.balance ?? 0)} is due${snapshot.payments?.balanceDueDate ? ` by ${longDate(snapshot.payments.balanceDueDate)}` : ' shortly'}. You can pay online in full or in part whenever suits you.`, buttons: [{ label: 'Pay now', url: tripUrl }], facts, eventKey: `${snapshot.payments?.balance}:${snapshot.payments?.balanceDueDate}` };
    if (template === 'documents_issued') return { subject: `Your travel documents are ready — ${snapshot.summary.name}`, heading: 'Your travel documents are ready', body: `Hello ${first}, your available tickets and travel documents are now in your travel wallet. Keep it handy—it includes the latest information and who to call.`, buttons: [{ label: 'View your documents', url: tripUrl }], facts, eventKey: snapshot.documents.map((document) => `${document.id}:${document.version}`).sort().join('|') };
    if (template === 'payment_received') { const latest = snapshot.payments?.items.filter((item) => item.status === 'paid').sort((a, b) => (b.completedDate ?? '').localeCompare(a.completedDate ?? ''))[0]; return { subject: 'Thank you — payment received', heading: 'Payment received, thank you', body: `Hello ${first}, we have received your payment. ${snapshot.payments && snapshot.payments.balance > 0 ? `Your remaining balance is ${money(snapshot.payments.balance)}${snapshot.payments.balanceDueDate ? `, due by ${longDate(snapshot.payments.balanceDueDate)}` : ''}.` : 'Your trip is now paid in full.'}`, buttons: [{ label: 'View your trip', url: tripUrl }], facts, eventKey: `${latest?.id}:${latest?.completedDate}:${snapshot.payments?.balance}` }; }
    if (template === 'welcome_home') { const review = snapshot.brand.profile.reviewLinks.find((link) => link.provider === 'google') ?? snapshot.brand.profile.reviewLinks[0]; return { subject: `Welcome home from ${snapshot.summary.name}`, heading: `Welcome home, ${first}`, body: 'We hope it was everything you wanted. We would love to hear how it went—and whenever you are ready to start dreaming about the next one, we are here.', buttons: [{ label: 'View your trip', url: tripUrl }, ...(review ? [{ label: 'Leave a review', url: review.url }] : [])], facts, eventKey: snapshot.summary.returnDate ?? snapshot.version }; }
    if (template === 'quote_reminder') return { subject: `Your quotation is waiting — ${snapshot.summary.name}`, heading: `Still thinking it over, ${first}?`, body: `Your quotation for ${snapshot.summary.name} is ready whenever you are${snapshot.quotation.expiresAt ? `, and the price is held until ${longDate(snapshot.quotation.expiresAt)}` : ''}. If anything needs changing, reply to this email.`, buttons: [{ label: 'View your quotation', url: tripUrl }], facts: [...facts, { label: 'Total', value: money(snapshot.payments?.total ?? 0) }], eventKey: snapshot.quotation.expiresAt ?? snapshot.version };
    const subject = cleanCustom(input.subject, 160, 'A message from your travel expert'); const heading = cleanCustom(input.heading, 160, subject); const body = cleanCustom(input.body, 10_000, '');
    if (!body) throw new BadRequestException('Custom emails require a message body.');
    return { subject, heading, body, buttons: [{ label: 'View your trip', url: tripUrl }], facts, eventKey: createHash('sha256').update(`${subject}|${heading}|${body}`).digest('base64url') };
  }

  private async deliver(to: string, snapshot: TripSnapshot, content: EmailContent): Promise<string> {
    const apiKey = process.env.RESEND_API_KEY?.trim(); if (!apiKey) throw new ServiceUnavailableException('Customer email delivery is not configured. Set RESEND_API_KEY.');
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': createHash('sha256').update(`${to}|${content.eventKey}`).digest('base64url') }, body: JSON.stringify({ from: process.env.VISION_EMAIL_FROM?.trim() || 'Vision Trips <onboarding@resend.dev>', to: [to], ...(snapshot.support.email ? { reply_to: snapshot.support.email } : {}), subject: content.subject, html: renderEmail(snapshot, content) }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) { this.logger.warn(`Customer email provider returned ${response.status}`); throw new BadGatewayException('The customer email could not be delivered.'); }
    const result = await response.json().catch(() => ({})) as { id?: unknown }; return typeof result.id === 'string' ? result.id : 'accepted';
  }
}

interface EmailContent { subject: string; heading: string; body: string; buttons: Array<{ label: string; url: string }>; facts: Array<{ label: string; value: string }>; eventKey: string }
function renderEmail(snapshot: TripSnapshot, content: EmailContent): string { const accent = /^#[0-9A-F]{6}$/i.test(snapshot.brand.theme.primaryColor) ? snapshot.brand.theme.primaryColor : '#0f766e'; const logo = snapshot.brand.logoUrl ? `<img src="${escapeHtml(snapshot.brand.logoUrl)}" alt="${escapeHtml(snapshot.brand.name)}" style="max-height:48px;max-width:220px">` : `<strong style="font-size:20px">${escapeHtml(snapshot.brand.name)}</strong>`; const facts = content.facts.map((fact) => `<tr><td style="padding:10px 14px;background:#f6f6f3;border-radius:10px"><small style="color:#6b7178">${escapeHtml(fact.label)}</small><br><strong>${escapeHtml(fact.value)}</strong></td></tr>`).join(''); const buttons = content.buttons.map((button, index) => `<a href="${escapeHtml(button.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:13px 20px;border-radius:999px;text-decoration:none;font-weight:700;${index === 0 ? `background:${accent};color:#fff` : 'border:1px solid #ccc;color:#172033'}">${escapeHtml(button.label)}</a>`).join(''); return `<!doctype html><html lang="en-GB"><body style="margin:0;background:#f2f2ef;font-family:Arial,sans-serif;color:#172033"><table role="presentation" width="100%"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" style="max-width:600px;width:100%"><tr><td style="padding-bottom:18px">${logo}</td></tr><tr><td style="background:#fff;border-radius:20px;overflow:hidden"><div style="height:6px;background:${accent}"></div><div style="padding:30px 32px"><h1 style="margin:0 0 14px">${escapeHtml(content.heading)}</h1>${textParagraphs(content.body)}<table role="presentation" width="100%" cellspacing="0" style="border-spacing:0 6px;margin:18px 0">${facts}</table>${buttons}</div></td></tr><tr><td style="padding:20px 8px;font-size:12px;line-height:1.6;color:#6b7178"><strong>${escapeHtml(snapshot.brand.name)}</strong>${snapshot.support.phone ? ` · ${escapeHtml(snapshot.support.phone)}` : ''}${snapshot.support.email ? ` · ${escapeHtml(snapshot.support.email)}` : ''}<br>You are receiving this because you have a trip or quotation with ${escapeHtml(snapshot.brand.name)}.</td></tr></table></td></tr></table></body></html>`; }
function assertAutomationKey(supplied: string | undefined): void { const expected = process.env.VISION_AUTOMATION_KEY?.trim(); if (!expected) throw new ServiceUnavailableException('Customer notification automation is not configured.'); const left = Buffer.from(supplied ?? ''); const right = Buffer.from(expected); if (left.length !== right.length || !timingSafeEqual(left, right)) throw new ForbiddenException('Invalid automation key.'); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function cleanCustom(value: unknown, maximum: number, fallback: string): string {
  const raw = text(value); let result = '';
  for (let index = 0; index < raw.length; index += 1) { const code = raw.charCodeAt(index); if (code === 9 || code === 10 || code === 13 || code >= 32) result += raw[index]; }
  return result.slice(0, maximum) || fallback;
}
function textParagraphs(value: string): string { return value.split(/\n{2,}/).map((part) => `<p style="font-size:16px;line-height:1.6">${escapeHtml(part).replaceAll('\n', '<br>')}</p>`).join(''); }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function longDate(value: string): string { const parsed = new Date(`${value.slice(0, 10)}T12:00:00Z`); return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parsed); }
