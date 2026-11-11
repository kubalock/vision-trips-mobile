import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { CustomerAccount, CustomerAccountTrip, CustomerPreferences, OpenCustomerAccountTripResponse, UpdateCustomerPreferencesResponse } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { SessionsService, type SessionPrincipal } from '../sessions/sessions.service.js';
import { bookingFields, customerFields, firstAttachmentThumbnail, firstString, pick, strings, truthy } from '../trips/field-map.js';
import { resolveStage } from '../trips/stage.js';
import { TripsService } from '../trips/trips.service.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const AIRPORTS = ['Belfast International Airport', 'Birmingham Airport', 'Bournemouth Airport', 'Bristol Airport', 'Cardiff Airport', 'East Midlands Airport', 'Edinburgh Airport', 'Exeter Airport', 'Glasgow Airport', 'Leeds Bradford Airport', 'Liverpool John Lennon Airport', 'London City Airport', 'London Gatwick Airport', 'London Heathrow Airport', 'London Luton Airport', 'London Stansted Airport', 'Manchester Airport', 'Newcastle International Airport', 'Norwich Airport', 'Southampton Airport'];

@Injectable()
export class CustomerAccountService {
  constructor(private readonly airtable: AirtableService, private readonly trips: TripsService, private readonly sessions: SessionsService) {}

  async account(principal: SessionPrincipal): Promise<CustomerAccount> {
    this.assertLead(principal);
    const { email, customers } = await this.customers(principal);
    const bookings = await this.bookings(principal.baseId, customers);
    const preferences = mergePreferences(customers);
    return {
      emailHint: maskEmail(email), preferences,
      airportOptions: [...new Set([...AIRPORTS, ...preferences.preferredAirports])].sort(), monthOptions: MONTHS,
      trips: bookings.map((record) => this.trip(principal, record)).sort(compareTrips),
    };
  }

  async update(principal: SessionPrincipal, input: Partial<CustomerPreferences>): Promise<UpdateCustomerPreferencesResponse> {
    this.assertLead(principal);
    if (typeof input.emailMarketing !== 'boolean' || typeof input.smsMarketing !== 'boolean' || typeof input.postalMarketing !== 'boolean') throw new BadRequestException('Choose each contact preference.');
    const { email, customers } = await this.customers(principal);
    if (!customers.length) throw new NotFoundException('No customer profile was found for this booking.');
    const currentAirports = mergePreferences(customers).preferredAirports;
    const airports = cleanList(input.preferredAirports, 10, [...AIRPORTS, ...currentAirports], 'departure airports');
    const months = cleanList(input.preferredMonths, 12, MONTHS, 'travel months');
    const preferences: CustomerPreferences = { emailMarketing: input.emailMarketing, smsMarketing: input.smsMarketing, postalMarketing: input.postalMarketing, preferredAirports: airports, preferredMonths: months };
    const table = process.env.AIRTABLE_CUSTOMERS_TABLE?.trim() || 'Customers';
    for (const customer of customers) {
      await this.airtable.updateRecord(principal.baseId, table, customer.id, {
        'Email Marketing': preferences.emailMarketing, 'Email Marketing Unsubscribe': !preferences.emailMarketing,
        'SMS Marketing': preferences.smsMarketing, 'Postal Marketing': preferences.postalMarketing,
        'Preferred Departure Airport(s)': airports, 'Preferred Travel Month(s)': months,
      });
      await this.airtable.addComment(principal.baseId, table, customer.id, `Marketing preferences updated by the customer in Vision Trips · ${new Date().toISOString()} · email ${preferences.emailMarketing ? 'yes' : 'no'} · SMS ${preferences.smsMarketing ? 'yes' : 'no'} · post ${preferences.postalMarketing ? 'yes' : 'no'} · airports: ${airports.join(', ') || '—'} · months: ${months.join(', ') || '—'}`).catch(() => undefined);
    }
    void email;
    return { saved: true, updatedRecords: customers.length, preferences };
  }

  async open(principal: SessionPrincipal, accountTripId: string): Promise<OpenCustomerAccountTripResponse> {
    this.assertLead(principal);
    const { customers } = await this.customers(principal);
    const target = (await this.bookings(principal.baseId, customers)).find((record) => this.id(principal.baseId, record.id) === accountTripId);
    if (!target) throw new NotFoundException('That trip is no longer linked to this customer.');
    return { snapshot: await this.trips.snapshot(principal.baseId, target.id, 'primary_customer'), session: this.sessions.issue({ baseId: principal.baseId, recordId: target.id, fellowTraveller: false }) };
  }

  private assertLead(principal: SessionPrincipal): void { if (principal.fellowTraveller) throw new ForbiddenException('Customer account settings are only available to the lead customer.'); }
  private async customers(principal: SessionPrincipal): Promise<{ email: string; customers: AirtableRecord[] }> {
    const email = (await this.trips.verificationProfile(principal.baseId, principal.recordId)).email.trim().toLowerCase();
    if (!email) return { email, customers: [] };
    const safe = email.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const customers = await this.airtable.list(principal.baseId, process.env.AIRTABLE_CUSTOMERS_TABLE?.trim() || 'Customers', { filterByFormula: `OR(LOWER({Primary Email})='${safe}',LOWER({Secondary Email})='${safe}')`, maxRecords: 20 });
    return { email, customers };
  }
  private bookings(baseId: string, customers: AirtableRecord[]): Promise<AirtableRecord[]> { return this.airtable.records(baseId, process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings', [...new Set(customers.flatMap((record) => strings(pick(record.fields, customerFields.trips))))]); }
  private trip(principal: SessionPrincipal, record: AirtableRecord): CustomerAccountTrip {
    const departure = date(pick(record.fields, bookingFields.departure)); const returns = date(pick(record.fields, bookingFields.return));
    return { accountTripId: this.id(principal.baseId, record.id), reference: firstString(pick(record.fields, bookingFields.reference)) || 'Trip', name: firstString(pick(record.fields, bookingFields.name)) || 'Your trip', departureDate: departure, returnDate: returns, status: resolveStage(firstString(pick(record.fields, bookingFields.status)), departure, returns, date(pick(record.fields, bookingFields.quoteExpiry))), heroImageUrl: firstAttachmentThumbnail(pick(record.fields, bookingFields.hero)), current: record.id === principal.recordId };
  }
  private id(baseId: string, recordId: string): string { const secret = process.env.VISION_LINK_SECRET?.trim(); if (!secret) throw new ServiceUnavailableException('Customer accounts are not configured.'); return createHmac('sha256', secret).update(`${baseId}:${recordId}:customer-account`).digest('base64url').slice(0, 24); }
}

function mergePreferences(customers: AirtableRecord[]): CustomerPreferences {
  const result: CustomerPreferences = { emailMarketing: false, smsMarketing: false, postalMarketing: false, preferredAirports: [], preferredMonths: [] };
  for (const customer of customers) { result.emailMarketing ||= truthy(pick(customer.fields, customerFields.marketingEmail)) && !truthy(pick(customer.fields, customerFields.marketingEmailUnsubscribe)); result.smsMarketing ||= truthy(pick(customer.fields, customerFields.marketingSms)); result.postalMarketing ||= truthy(pick(customer.fields, customerFields.marketingPost)); result.preferredAirports.push(...strings(pick(customer.fields, customerFields.preferredAirports))); result.preferredMonths.push(...strings(pick(customer.fields, customerFields.preferredMonths))); }
  result.preferredAirports = [...new Set(result.preferredAirports)]; result.preferredMonths = [...new Set(result.preferredMonths)]; return result;
}
function cleanList(value: unknown, maximum: number, allowed: string[], label: string): string[] { if (!Array.isArray(value)) throw new BadRequestException(`Choose valid ${label}.`); const clean = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]; if (clean.length > maximum || clean.some((item) => !allowed.includes(item))) throw new BadRequestException(`Choose valid ${label}.`); return clean; }
function date(value: unknown): string | null { const text = firstString(value); return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null; }
function maskEmail(value: string): string { const [local = '', domain = ''] = value.split('@'); return local && domain ? `${local.slice(0, 2)}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}` : ''; }
function compareTrips(a: CustomerAccountTrip, b: CustomerAccountTrip): number { if (a.current !== b.current) return a.current ? -1 : 1; return (b.departureDate ?? '').localeCompare(a.departureDate ?? ''); }
