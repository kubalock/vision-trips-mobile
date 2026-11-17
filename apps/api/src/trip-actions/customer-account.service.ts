import { maskEmail as sharedMaskEmail } from '@vision-trips/contracts';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { CustomerAccount, CustomerAccountTrip, CustomerLoyalty, LoyaltyTransaction, CustomerPreferences, OpenCustomerAccountTripResponse, UpdateCustomerPreferencesResponse } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { withMediaLinks } from '../media/attachment-media.js';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { SessionsService, type SessionPrincipal } from '../sessions/sessions.service.js';
import { bookingFields, customerFields, dateString, firstAttachmentThumbnail, firstString, loyaltyTransactionFields, memberFields, moneyValue, pick, strings, truthy } from '../trips/field-map.js';
import { points } from '../trips/trip-extras.js';
import { resolveStage } from '../trips/stage.js';
import { publicTripId, SNAPSHOT_CACHE_MS, TripsService } from '../trips/trips.service.js';
import { accountBookings, accountTripGrant, customersTable, resolveCustomerIdentity, type AccountBooking } from './customer-identity.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const AIRPORTS = ['Belfast International Airport', 'Birmingham Airport', 'Bournemouth Airport', 'Bristol Airport', 'Cardiff Airport', 'East Midlands Airport', 'Edinburgh Airport', 'Exeter Airport', 'Glasgow Airport', 'Leeds Bradford Airport', 'Liverpool John Lennon Airport', 'London City Airport', 'London Gatwick Airport', 'London Heathrow Airport', 'London Luton Airport', 'London Stansted Airport', 'Manchester Airport', 'Newcastle International Airport', 'Norwich Airport', 'Southampton Airport'];

/**
 * The lead customer's account within one Airtable base. Rooted at the session's verified Customer Record ID; see
 * customer-identity.ts for the full policy. The Account page lists Bookings linked to that Customer; opening one
 * issues a Booking-scoped session for the same verified Customer, without another invitation or code.
 */
const MAX_AIRPORTS = 10;

@Injectable()
export class CustomerAccountService {
  private readonly logger = new Logger(CustomerAccountService.name);
  constructor(private readonly airtable: AirtableService, private readonly trips: TripsService, private readonly sessions: SessionsService) {}

  async account(principal: SessionPrincipal): Promise<CustomerAccount> {
    this.assertLead(principal);
    const identity = await resolveCustomerIdentity(this.airtable, principal);
    const bookings = await accountBookings(this.airtable, principal, identity);
    const preferences = accountPreferences(identity.root, identity.members);
    const loyalty = await this.loyalty(principal, identity.root, bookings.map((booking) => booking.record)).catch((error: unknown) => {
      // Missing or broken loyalty links give an empty state, never a failed account page.
      this.logger.warn(`Loyalty could not be read: ${error instanceof Error ? error.message : 'unknown error'}`);
      return null;
    });
    return {
      emailHint: maskEmail(identity.email), preferences, loyalty, vip: truthy(pick(identity.root.fields, customerFields.vip)),
      airportOptions: [...new Set([...AIRPORTS, ...preferences.preferredAirports])].sort(), monthOptions: MONTHS,
      trips: bookings.map((booking) => this.trip(principal, booking.record)).sort(compareTrips),
    };
  }

  async update(principal: SessionPrincipal, input: Partial<CustomerPreferences>): Promise<UpdateCustomerPreferencesResponse> {
    this.assertLead(principal);
    if (typeof input.emailMarketing !== 'boolean' || typeof input.smsMarketing !== 'boolean' || typeof input.postalMarketing !== 'boolean') throw new BadRequestException('Choose each contact preference.');
    const identity = await resolveCustomerIdentity(this.airtable, principal);
    const currentAirports = accountPreferences(identity.root, identity.members).preferredAirports;
    // Ten is the limit for new choices. A customer whose record already holds more (set by staff in Airtable) can keep
    // or trim that list, so saving a marketing switch never fails over airports they didn't touch; adding to it can't.
    const airports = cleanList(input.preferredAirports, Math.max(MAX_AIRPORTS, currentAirports.length), [...AIRPORTS, ...currentAirports], 'departure airports');
    if (airports.length > MAX_AIRPORTS && airports.some((airport) => !currentAirports.includes(airport))) throw new BadRequestException(`Choose up to ${MAX_AIRPORTS} departure airports. Remove some before adding another.`);
    const months = cleanList(input.preferredMonths, 12, MONTHS, 'travel months');
    const preferences: CustomerPreferences = { emailMarketing: input.emailMarketing, smsMarketing: input.smsMarketing, postalMarketing: input.postalMarketing, preferredAirports: airports, preferredMonths: months };
    // Only the verified Customer and records explicitly grouped with it; never records that merely share an email.
    // The verified Customer is written first (it's canonical for airports and months). Each PATCH is retried on
    // transient Airtable errors and is safe to repeat, so saving again after a partial failure converges.
    const fields = {
      'Email Marketing': preferences.emailMarketing, 'Email Marketing Unsubscribe': !preferences.emailMarketing,
      'SMS Marketing': preferences.smsMarketing, 'Postal Marketing': preferences.postalMarketing,
      'Preferred Departure Airport(s)': airports, 'Preferred Travel Month(s)': months,
    };
    const saved: string[] = [];
    let failure: unknown = null;
    for (const customer of identity.members) {
      try { await this.airtable.updateRecord(principal.baseId, customersTable(), customer.id, fields); saved.push(customer.id); }
      catch (error) { failure = error; break; }
    }
    for (const id of saved) {
      await this.airtable.addComment(principal.baseId, customersTable(), id, `Marketing preferences updated by the customer in Vision Trips · ${new Date().toISOString()} · email ${preferences.emailMarketing ? 'yes' : 'no'} · SMS ${preferences.smsMarketing ? 'yes' : 'no'} · post ${preferences.postalMarketing ? 'yes' : 'no'} · airports: ${airports.join(', ') || '—'} · months: ${months.join(', ') || '—'}${saved.length < identity.members.length ? ` · saved on ${saved.length} of ${identity.members.length} grouped records` : ''}`).catch(() => undefined);
    }
    if (failure) {
      if (!saved.length) throw failure; // Nothing changed.
      // Some grouped records changed and some didn't. Reading the account stays safe meanwhile: a channel shows as on
      // only when every grouped record agrees, so a half-applied opt-out still reads as opted out.
      this.logger.warn(`Preferences saved on ${saved.length} of ${identity.members.length} grouped Customer records: ${failure instanceof Error ? failure.message : 'unknown error'}`);
      throw new ServiceUnavailableException({ statusCode: 503, code: 'preferences_partially_saved', message: 'Some of your changes were saved, but not all of them. Please save again to finish.', savedRecords: saved.length, totalRecords: identity.members.length });
    }
    return { saved: true, updatedRecords: identity.members.length, preferences };
  }

  /**
   * Re-checks the link in Airtable on every call (an unlinked Booking can no longer be opened from the account), then
   * issues a session for that Booking in the same base for the same verified Customer and account, keeping the
   * assurance the customer already earned (see accountTripGrant).
   */
  async open(principal: SessionPrincipal, accountTripId: string): Promise<OpenCustomerAccountTripResponse> {
    this.assertLead(principal);
    const identity = await resolveCustomerIdentity(this.airtable, principal);
    const target: AccountBooking | undefined = (await accountBookings(this.airtable, principal, identity)).find((booking) => this.id(principal.baseId, booking.record.id) === accountTripId);
    if (!target) throw new NotFoundException('That trip is no longer linked to your account.');
    const snapshot = await this.trips.snapshot(principal.baseId, target.record.id, 'primary_customer', { maxAgeMs: SNAPSHOT_CACHE_MS });
    return { snapshot, session: this.sessions.issue(accountTripGrant(principal, identity, target)) };
  }

  /**
   * The verified Customer's loyalty, only when the current booking's member has its scheme enabled. Transactions are
   * read only through the verified Customer's own links in this base (never by email, never grouped duplicates), and
   * a transaction whose own Customer link names someone else is dropped. Trip names come only from this account's
   * bookings; nothing else is fetched to name them.
   */
  private async loyalty(principal: SessionPrincipal, root: AirtableRecord, accountRecords: AirtableRecord[]): Promise<CustomerLoyalty | null> {
    const current = await this.airtable.record(principal.baseId, process.env.AIRTABLE_BOOKINGS_TABLE?.trim() || 'Bookings', principal.recordId);
    const memberId = strings(pick(current.fields, bookingFields.member))[0];
    if (!memberId) return null;
    const member = await this.airtable.record(principal.baseId, 'Members', memberId);
    if (!truthy(pick(member.fields, memberFields.loyaltyEnabled))) return null;
    const ids = strings(pick(root.fields, customerFields.loyaltyTransactions)).filter((id) => /^rec[A-Za-z0-9]{14}$/.test(id)).slice(0, 100);
    const records = ids.length ? await this.airtable.records(principal.baseId, process.env.AIRTABLE_LOYALTY_TABLE?.trim() || 'Loyalty Transactions', ids).catch(() => []) : [];
    const tripNames = new Map(accountRecords.map((record) => [record.id, firstString(pick(record.fields, bookingFields.name)) || firstString(pick(record.fields, bookingFields.reference))]));
    const transactions: LoyaltyTransaction[] = records.flatMap((record) => {
      const owners = strings(pick(record.fields, loyaltyTransactionFields.customer));
      if (owners.length && !owners.includes(root.id)) return [];
      const type = transactionType(firstString(pick(record.fields, loyaltyTransactionFields.type)));
      const value = points(pick(record.fields, loyaltyTransactionFields.points));
      if (!type || value === null) return [];
      const bookingId = strings(pick(record.fields, loyaltyTransactionFields.booking))[0];
      return [{
        id: createHmac('sha256', process.env.VISION_LINK_SECRET?.trim() || 'local').update(`loyalty:${principal.baseId}:${record.id}`).digest('base64url').slice(0, 18),
        type, points: value, date: dateString(pick(record.fields, loyaltyTransactionFields.date)),
        tripName: bookingId ? tripNames.get(bookingId) || null : null,
        description: firstString(pick(record.fields, loyaltyTransactionFields.notes)).replace(/\s+/g, ' ').slice(0, 200) || null,
      }];
    }).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return {
      available: points(pick(root.fields, customerFields.pointsAvailable)),
      availableValue: moneyValue(pick(root.fields, customerFields.pointsValue)),
      currency: 'GBP',
      lifetime: points(pick(root.fields, customerFields.pointsLifetime)),
      expiresAt: dateString(pick(root.fields, customerFields.pointsExpiry)),
      transactions,
    };
  }

  private assertLead(principal: SessionPrincipal): void { if (principal.fellowTraveller) throw new ForbiddenException('Customer account settings are only available to the lead customer.'); }
  private trip(principal: SessionPrincipal, record: AirtableRecord): CustomerAccountTrip {
    const departure = date(pick(record.fields, bookingFields.departure)); const returns = date(pick(record.fields, bookingFields.return));
    return { accountTripId: this.id(principal.baseId, record.id), tripId: publicTripId(principal.baseId, record.id), reference: firstString(pick(record.fields, bookingFields.reference)) || 'Trip', name: firstString(pick(record.fields, bookingFields.name)) || 'Your trip', departureDate: departure, returnDate: returns, status: resolveStage(firstString(pick(record.fields, bookingFields.status)), departure, returns, date(pick(record.fields, bookingFields.quoteExpiry))), heroImageUrl: firstAttachmentThumbnail(pick(withMediaLinks(principal.baseId, 'Bookings', record).fields, bookingFields.hero)), current: record.id === principal.recordId };
  }
  private id(baseId: string, recordId: string): string { const secret = process.env.VISION_LINK_SECRET?.trim(); if (!secret) throw new ServiceUnavailableException('Customer accounts are not configured.'); return createHmac('sha256', secret).update(`${baseId}:${recordId}:customer-account`).digest('base64url').slice(0, 24); }
}

/**
 * The account's preferences. Consent is conservative: a channel is on only when every grouped record is opted in and
 * none is unsubscribed (an opt-out anywhere wins). Airports and months come from the verified Customer's record.
 */
export function accountPreferences(root: AirtableRecord, members: AirtableRecord[]): CustomerPreferences {
  const all = members.length ? members : [root];
  const every = (test: (customer: AirtableRecord) => boolean) => all.every(test);
  return {
    emailMarketing: every((customer) => truthy(pick(customer.fields, customerFields.marketingEmail)) && !truthy(pick(customer.fields, customerFields.marketingEmailUnsubscribe))),
    smsMarketing: every((customer) => truthy(pick(customer.fields, customerFields.marketingSms))),
    postalMarketing: every((customer) => truthy(pick(customer.fields, customerFields.marketingPost))),
    preferredAirports: [...new Set(strings(pick(root.fields, customerFields.preferredAirports)))],
    preferredMonths: [...new Set(strings(pick(root.fields, customerFields.preferredMonths)))],
  };
}
function cleanList(value: unknown, maximum: number, allowed: string[], label: string): string[] { if (!Array.isArray(value)) throw new BadRequestException(`Choose valid ${label}.`); const clean = [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]; if (clean.length > maximum || clean.some((item) => !allowed.includes(item))) throw new BadRequestException(`Choose valid ${label}.`); return clean; }
function date(value: unknown): string | null { const text = firstString(value); return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null; }
function maskEmail(value: string): string { return sharedMaskEmail(value) ?? ''; }
/**
 * The open trip first; then upcoming and in-progress trips (soonest first, undated last), quotations, and finally
 * past, closed or cancelled trips (most recent first).
 */
function compareTrips(a: CustomerAccountTrip, b: CustomerAccountTrip): number {
  if (a.current !== b.current) return a.current ? -1 : 1;
  const group = tripGroup(a) - tripGroup(b);
  if (group) return group;
  if (tripGroup(a) === 3) return (b.departureDate ?? '').localeCompare(a.departureDate ?? '');
  return (a.departureDate ?? '9999-12-31').localeCompare(b.departureDate ?? '9999-12-31');
}
function tripGroup(trip: CustomerAccountTrip): number {
  if (['home', 'past', 'closed', 'cancelled'].includes(trip.status)) return 3;
  if (trip.status === 'quote' || trip.status === 'quote_expired') return 2;
  return 1;
}

function transactionType(value: string): LoyaltyTransaction['type'] | null {
  const text = value.trim().toLowerCase();
  if (text.startsWith('earn')) return 'earn';
  if (text.startsWith('redeem')) return 'redeem';
  if (text.startsWith('adjust')) return 'adjustment';
  if (text.startsWith('expir')) return 'expiry';
  return null;
}
