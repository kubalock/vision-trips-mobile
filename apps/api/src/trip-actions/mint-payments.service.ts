import { BadGatewayException, BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { PaymentLinkResponse, TripSnapshot } from '@vision-trips/contracts';
import { createHmac, randomUUID } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { TripsService } from '../trips/trips.service.js';
import { bookingFields, brandFields, firstString, numberValue, paymentFields, pick, strings, truthy } from '../trips/field-map.js';

@Injectable()
export class MintPaymentsService {
  constructor(private readonly airtable: AirtableService, private readonly trips: TripsService) {}

  async link(baseId: string, recordId: string, paymentId: string, customAmount?: unknown): Promise<PaymentLinkResponse> {
    if (customAmount === undefined) {
      // A stored "Payment Link URL" needs no Mint credentials, so answer from the snapshot alone.
      const stored = (await this.trips.snapshot(baseId, recordId, 'primary_customer')).payments?.items.find((item) => item.id === paymentId);
      if (stored?.actionUrl && stored.canPay && stored.status !== 'paid') return { paymentId: stored.id, url: stored.actionUrl, amount: stored.amount, currency: stored.currency };
    }
    const context = await this.context(baseId, recordId);
    const snapshot = context.snapshot;
    if (customAmount !== undefined) {
      if (!snapshot.payments?.customPayments.enabled) throw new ForbiddenException('Custom payments are not available for this booking.');
      const amount = parseAmount(customAmount);
      const maximum = snapshot.payments.customPayments.maximum;
      if (amount < 0.01 || amount > maximum + 0.0001 || amount > 100_000) throw new BadRequestException(`Enter an amount between 0.01 and ${maximum.toFixed(2)}.`);
      return this.create(context, amount, snapshot.payments.currency, `${snapshot.summary.reference} custom payment`, `custom_${randomUUID()}`);
    }
    const payment = snapshot.payments?.items.find((item) => item.id === paymentId);
    if (!payment || !payment.canPay || payment.status === 'paid') throw new NotFoundException('This payment is no longer available. Refresh the trip and try again.');
    if (payment.actionUrl) return { paymentId: payment.id, url: payment.actionUrl, amount: payment.amount, currency: payment.currency };
    const source = context.payments.find((record) => publicPaymentId(snapshot.tripId, record.id) === payment.id);
    if (!source) throw new NotFoundException('This payment is no longer available.');
    return this.create(context, payment.amount, payment.currency, `${snapshot.summary.reference} ${payment.label}`, payment.id);
  }

  async depositLink(baseId: string, recordId: string): Promise<string | null> {
    const context = await this.context(baseId, recordId);
    const payable = context.payments.filter((record) => {
      const status = firstString(pick(record.fields, paymentFields.status));
      const type = firstString(pick(record.fields, paymentFields.type));
      return !/complete|paid|settled/i.test(status) && !/refund|resort/i.test(type) && numberValue(pick(record.fields, paymentFields.amount)) > 0;
    });
    const source = payable.find((record) => /deposit/i.test(firstString(pick(record.fields, paymentFields.customerType)))) ?? payable[0];
    if (!source) return null;
    const existingUrl = firstString(pick(source.fields, paymentFields.link));
    if (existingUrl.startsWith('https://')) return existingUrl;
    const amount = numberValue(pick(source.fields, paymentFields.amount));
    const currency = firstString(pick(source.fields, paymentFields.currency)).toUpperCase() || context.snapshot.payments?.currency || 'GBP';
    const label = firstString(pick(source.fields, paymentFields.customerType)) || 'Deposit';
    return (await this.create(context, amount, currency, `${context.snapshot.summary.reference} ${label}`, publicPaymentId(context.snapshot.tripId, source.id))).url;
  }

  private async create(context: PaymentContext, amount: number, currency: string, reference: string, paymentId: string): Promise<PaymentLinkResponse> {
    const config = context.config;
    if (!config.apiKey || !config.businessUnit || !config.bookingId.startsWith('BK.')) throw new ServiceUnavailableException('Online payments are not set up for this booking.');
    const webhookUrl = config.webhookUrl;
    if (!isHttpsUrl(webhookUrl)) throw new ServiceUnavailableException('The brand does not have a valid Mint webhook URL for Airtable reconciliation.');
    const payload: Record<string, unknown> = { business_unit: config.businessUnit, amount: amount.toFixed(2), currency, booking: config.bookingId, allowed_payment_methods: config.methods.length ? config.methods : ['CARD'], overridable_fields: ['customer'], transaction_mode: 'autocapture', pay_by_utc: payBy(context.snapshot), customer_reference: reference };
    payload.webhook_url = webhookUrl;
    const response = await fetch(process.env.MINT_PAYMENT_LINK_ENDPOINT?.trim() || 'https://secure.mintpayments.com/mpay/v5/payment-links', { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
    const body = await response.json().catch(() => ({})) as { payment_link?: { id?: string; url?: string } };
    const url = body.payment_link?.url || '';
    if (!response.ok || !isMintUrl(url)) throw new BadGatewayException('We could not create the payment link. Please try again or contact your travel agent.');
    return { paymentId, url, amount, currency };
  }

  private async context(baseId: string, recordId: string): Promise<PaymentContext> {
    const booking = await this.airtable.record(baseId, process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings', recordId);
    const brandId = strings(pick(booking.fields, bookingFields.brand))[0];
    if (!brandId) throw new ServiceUnavailableException('This booking does not have a payment brand.');
    const [brand, payments, snapshot] = await Promise.all([
      this.airtable.record(baseId, 'Brands & Branches', brandId),
      this.airtable.records(baseId, process.env.AIRTABLE_PAYMENTS_TABLE?.trim() || 'Bookings [Payments]', strings(pick(booking.fields, bookingFields.payments))),
      this.trips.snapshot(baseId, recordId, 'primary_customer'),
    ]);
    return { baseId, booking, payments, snapshot, config: { apiKey: firstString(pick(brand.fields, brandFields.mintApiKey)), businessUnit: firstString(pick(brand.fields, brandFields.mintBusinessUnit)), allowCustom: truthy(pick(brand.fields, brandFields.mintAllowCustom)), methods: strings(pick(brand.fields, brandFields.mintMethods)).map((item) => item.toUpperCase()), webhookUrl: firstString(pick(brand.fields, brandFields.mintWebhook)), bookingId: firstString(pick(booking.fields, bookingFields.mintBookingId)) } };
  }
}

interface PaymentContext { baseId: string; booking: AirtableRecord; payments: AirtableRecord[]; snapshot: TripSnapshot; config: { apiKey: string; businessUnit: string; allowCustom: boolean; methods: string[]; webhookUrl: string; bookingId: string } }
function publicPaymentId(tripId: string, recordId: string): string { return `pay_${createHmac('sha256', process.env.VISION_LINK_SECRET || '').update(`${tripId}|${recordId}`).digest('base64url').slice(0, 18)}`; }
function parseAmount(value: unknown): number { if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)) throw new BadRequestException('Enter a valid payment amount with no more than two decimal places.'); const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''; if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new BadRequestException('Enter a valid payment amount with no more than two decimal places.'); return Number(text); }
function isMintUrl(value: string): boolean { try { return new URL(value).protocol === 'https:' && new URL(value).hostname.endsWith('mintpayments.com'); } catch { return false; } }
function payBy(snapshot: TripSnapshot): string { const returnDate = snapshot.summary.returnDate ? new Date(`${snapshot.summary.returnDate}T23:59:59Z`) : null; const fallback = new Date(Date.now() + 2 * 365 * 86_400_000); return (returnDate && returnDate.getTime() > Date.now() ? returnDate : fallback).toISOString().replace('.000', ''); }
function isHttpsUrl(value: string): boolean { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
