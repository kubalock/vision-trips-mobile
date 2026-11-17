import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { TravellerProfile, TravellerProfilesResponse, TravellerProfileUpdate, TravellerProfileUpdateResponse } from '@vision-trips/contracts';
import { maskDocumentNumber } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import type { SessionPrincipal } from '../sessions/sessions.service.js';
import { customerFields, dateString, firstString, personFields, pick, strings } from '../trips/field-map.js';
import { customersTable, resolveCustomerIdentity } from './customer-identity.js';

export const peopleTable = (): string => process.env.AIRTABLE_PEOPLE_TABLE?.trim() || 'Customers [People]';

/** Profile updates have their own allowance, apart from messages and acceptance (as in the PHP plugin: 20 an hour). */
export const PROFILE_UPDATES_PER_HOUR = 20;

/**
 * The only fields a customer may change, each mapped to a fixed list of Airtable field names. Names, dates of birth
 * and contact details are not here: they change every linked booking, so they go through the agent. Field names never
 * come from the client.
 */
const WRITABLE: Record<keyof TravellerProfileUpdate, readonly string[] | null> = {
  passportNumber: personFields.passportNumber,
  nationality: personFields.nationality,
  passportIssuingCountry: personFields.passportIssuingCountry,
  passportIssueDate: personFields.passportIssueDate,
  passportExpiryDate: personFields.passportExpiry,
  drivingLicenceNumber: personFields.licenceNumber,
  drivingLicenceExpiryDate: personFields.licenceExpiry,
  nextOfKinName: personFields.nextOfKinName,
  nextOfKinPhone: personFields.nextOfKinPhone,
  // Airline/cruise loyalty are linked records in Vision (CMS [Loyalty]); editing them needs a reviewed design for
  // choosing a programme without exposing record IDs, so they are read-only for now.
  airlineLoyalty: null,
  cruiseLoyalty: null,
};

const LABELS: Record<keyof TravellerProfileUpdate, string> = {
  passportNumber: 'passport number', nationality: 'nationality', passportIssuingCountry: 'passport issuing country', passportIssueDate: 'passport issue date',
  passportExpiryDate: 'passport expiry date', drivingLicenceNumber: 'driving licence number', drivingLicenceExpiryDate: 'driving licence expiry date',
  nextOfKinName: 'next of kin name', nextOfKinPhone: 'next of kin phone', airlineLoyalty: 'airline loyalty', cruiseLoyalty: 'cruise loyalty',
};

/**
 * Account → Traveller details. Ownership is proved only through the verified Customer's own People links in the
 * session's base, checked both ways (the Customer lists the person and the person lists the Customer). Nothing is
 * found by name or email, and grouped duplicates are not widened into.
 */
@Injectable()
export class TravellerProfilesService {
  private readonly logger = new Logger(TravellerProfilesService.name);
  constructor(private readonly airtable: AirtableService, private readonly store: DurableAuthStore) {}

  async list(principal: SessionPrincipal): Promise<TravellerProfilesResponse> {
    const { people, customerId } = await this.owned(principal);
    return { travellers: people.map((person) => this.profile(principal, customerId, person)) };
  }

  async update(principal: SessionPrincipal, travellerId: string, body: unknown): Promise<TravellerProfileUpdateResponse> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Nothing to update.');
    const input = body as Record<string, unknown>;
    // Unknown keys are refused, never passed through: the client cannot name Airtable fields.
    const unknown = Object.keys(input).filter((key) => !(key in WRITABLE));
    if (unknown.length) throw new BadRequestException('Some of those details can only be changed by your travel agent.');
    const readOnly = (Object.keys(input) as Array<keyof TravellerProfileUpdate>).filter((key) => WRITABLE[key] === null);
    if (readOnly.length) throw new BadRequestException(`Ask your travel agent to change the ${readOnly.map((key) => LABELS[key]).join(' and ')}.`);
    const values = validate(input as TravellerProfileUpdate);
    const rate = this.store.consumeRateLimit(`profile:${principal.baseId}:${principal.customerRecordId ?? 'none'}`, PROFILE_UPDATES_PER_HOUR, 3_600_000);
    if (!rate.allowed) throw new HttpException('You have made a lot of changes. Please try again in a little while.', HttpStatus.TOO_MANY_REQUESTS);
    const { people, customerId } = await this.owned(principal);
    const person = people.find((candidate) => this.travellerId(principal, customerId, candidate.id) === travellerId);
    if (!person) throw new NotFoundException('That traveller is not on your account.');
    const payload: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const [key, value] of Object.entries(values) as Array<[keyof TravellerProfileUpdate, string]>) {
      const candidates = WRITABLE[key]!;
      // Write to the field the record already uses, otherwise the first (canonical) name.
      const field = candidates.find((name) => name in person.fields) ?? candidates[0]!;
      const before = firstString(person.fields[field]);
      if (before === value) continue;
      payload[field] = value === '' ? null : value;
      changed.push(LABELS[key]);
    }
    if (changed.length) {
      await this.airtable.updateRecord(principal.baseId, peopleTable(), person.id, payload);
      // Audit on the Customer record: what changed, never the new values (passport numbers stay out of comments).
      await this.airtable.addComment(principal.baseId, customersTable(), customerId, `Traveller details updated by the customer in Vision Trips · ${new Date().toISOString()} · ${firstString(pick(person.fields, personFields.name)) || 'traveller'}: ${changed.join(', ')} · verified by ${principal.assurance}`)
        .catch((error: unknown) => this.logger.warn(`Traveller update saved but its audit comment failed: ${error instanceof Error ? error.message : 'unknown error'}`));
    }
    const updated = changed.length ? await this.airtable.record(principal.baseId, peopleTable(), person.id) : person;
    return { saved: true, traveller: this.profile(principal, customerId, updated) };
  }

  private async owned(principal: SessionPrincipal): Promise<{ customerId: string; people: AirtableRecord[] }> {
    if (principal.fellowTraveller) throw new ForbiddenException('Traveller details are only available to the lead customer.');
    const identity = await resolveCustomerIdentity(this.airtable, principal);
    const root = identity.root;
    const ids = strings(pick(root.fields, customerFields.people)).slice(0, 30);
    if (!ids.length) return { customerId: root.id, people: [] };
    const records = await this.airtable.records(principal.baseId, peopleTable(), ids);
    // Linked both ways: a person whose own Customers field doesn't name the verified Customer is not theirs.
    return { customerId: root.id, people: records.filter((person) => strings(pick(person.fields, personFields.customers)).includes(root.id)) };
  }

  private profile(principal: SessionPrincipal, customerId: string, person: AirtableRecord): TravellerProfile {
    const text = (fields: readonly string[], max = 60) => clean(pick(person.fields, fields), max) || null;
    const first = firstString(pick(person.fields, personFields.first));
    const last = firstString(pick(person.fields, personFields.last));
    return {
      travellerId: this.travellerId(principal, customerId, person.id),
      name: clean(pick(person.fields, personFields.name), 120) || `${first} ${last}`.trim() || 'Traveller',
      dateOfBirth: dateString(pick(person.fields, personFields.dateOfBirth)),
      passport: {
        numberHint: maskDocumentNumber(firstString(pick(person.fields, personFields.passportNumber))),
        nationality: text(personFields.nationality), issuingCountry: text(personFields.passportIssuingCountry),
        issueDate: dateString(pick(person.fields, personFields.passportIssueDate)), expiryDate: dateString(pick(person.fields, personFields.passportExpiry)),
      },
      drivingLicence: { numberHint: maskDocumentNumber(firstString(pick(person.fields, personFields.licenceNumber))), expiryDate: dateString(pick(person.fields, personFields.licenceExpiry)) },
      nextOfKin: { name: text(personFields.nextOfKinName), phone: text(personFields.nextOfKinPhone, 30) },
      airlineLoyalty: strings(pick(person.fields, personFields.airlineLoyalty)).map((value) => clean(value, 80)).filter(Boolean).join(', ') || null,
      cruiseLoyalty: strings(pick(person.fields, personFields.cruiseLoyalty)).map((value) => clean(value, 80)).filter(Boolean).join(', ') || null,
    };
  }

  /** Opaque and scoped to base, verified Customer and person: never an Airtable record ID. */
  private travellerId(principal: SessionPrincipal, customerId: string, personId: string): string {
    const secret = process.env.VISION_LINK_SECRET?.trim();
    if (!secret) throw new ServiceUnavailableException('Traveller details are not configured.');
    return `tvl_${createHmac('sha256', secret).update(`traveller:${principal.baseId}:${customerId}:${personId}`).digest('base64url').slice(0, 22)}`;
  }
}

/** Strict validation of the allow-listed fields; '' clears a value. Returns the normalised values. */
export function validate(input: TravellerProfileUpdate, today = new Date()): Partial<Record<keyof TravellerProfileUpdate, string>> {
  const errors: string[] = [];
  const out: Partial<Record<keyof TravellerProfileUpdate, string>> = {};
  for (const [key, raw] of Object.entries(input) as Array<[keyof TravellerProfileUpdate, unknown]>) {
    if (typeof raw !== 'string') { errors.push(`Enter a valid ${LABELS[key]}.`); continue; }
    let value = raw.replace(/\s+/g, ' ').trim();
    if (value.length > 120) { errors.push(`The ${LABELS[key]} is too long.`); continue; }
    switch (key) {
      case 'passportNumber':
        value = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (value && !/^[A-Z0-9]{5,12}$/.test(value)) errors.push('A passport number is 5 to 12 letters and numbers.');
        break;
      case 'drivingLicenceNumber':
        value = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (value && !/^[A-Z0-9]{5,20}$/.test(value)) errors.push('That does not look like a driving licence number.');
        break;
      case 'nationality': case 'passportIssuingCountry': case 'nextOfKinName':
        if (value && (value.length < 2 || value.length > 60 || !/^[\p{L}\p{M} '’.-]+$/u.test(value))) errors.push(`Use letters only for the ${LABELS[key]}.`);
        break;
      case 'nextOfKinPhone': {
        value = value.replace(/[^0-9+ ()-]/g, '');
        const digits = value.replace(/\D/g, '');
        if (value && (digits.length < 7 || digits.length > 15)) errors.push('Enter a full phone number for your next of kin.');
        break;
      }
      case 'passportIssueDate': case 'passportExpiryDate': case 'drivingLicenceExpiryDate': {
        if (!value) break;
        const date = dateString(value);
        if (!date) { errors.push(`Enter the ${LABELS[key]} as a date.`); break; }
        value = date;
        const todayText = today.toISOString().slice(0, 10);
        if (key === 'passportIssueDate' && date > todayText) errors.push('A passport issue date cannot be in the future.');
        if (key !== 'passportIssueDate' && date < `${today.getUTCFullYear() - 20}-01-01`) errors.push(`Please check the ${LABELS[key]}.`);
        break;
      }
      default:
        errors.push(`Ask your travel agent to change the ${LABELS[key]}.`);
    }
    out[key] = value;
  }
  if (out.passportIssueDate && out.passportExpiryDate && out.passportExpiryDate <= out.passportIssueDate) errors.push('The passport expiry date must be after its issue date.');
  if (errors.length) throw new BadRequestException(errors.join(' '));
  if (!Object.keys(out).length) throw new BadRequestException('Nothing to update.');
  return out;
}

function clean(value: unknown, max: number): string {
  const text = firstString(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(rec|usr)[A-Za-z0-9]{14}$/.test(text) ? '' : text.slice(0, max);
}
