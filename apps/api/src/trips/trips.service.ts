import { Injectable } from '@nestjs/common';
import type { AccessScope, TripSnapshot } from '@vision-trips/contracts';
import { createHmac } from 'node:crypto';
import { AirtableService, type AirtableRecord } from '../airtable/airtable.service.js';
import { bookingFields, brandFields, firstAttachmentUrl, firstString, pick, strings } from './field-map.js';
import { resolveStage } from './stage.js';
import { themeTokens } from './theme.js';

@Injectable()
export class TripsService {
  constructor(private readonly airtable: AirtableService) {}

  async snapshot(baseId: string, recordId: string, accessScope: AccessScope): Promise<TripSnapshot> {
    const booking = await this.airtable.record(baseId, 'Bookings', recordId);
    const brandId = strings(pick(booking.fields, bookingFields.brand))[0];
    const brand = brandId ? await this.airtable.record(baseId, 'Brands & Branches', brandId) : emptyRecord();
    return this.mapSnapshot(baseId, booking, brand, accessScope);
  }

  mapSnapshot(baseId: string, booking: AirtableRecord, brand: AirtableRecord, accessScope: AccessScope): TripSnapshot {
    const bookingValue = (key: keyof typeof bookingFields) => pick(booking.fields, bookingFields[key]);
    const brandValue = (key: keyof typeof brandFields) => pick(brand.fields, brandFields[key]);
    const status = firstString(bookingValue('status')) || 'Quotation';
    const departure = dateString(bookingValue('departure'));
    const returns = dateString(bookingValue('return'));
    const quoteExpiry = dateString(bookingValue('quoteExpiry'));
    const tags = strings(bookingValue('tags'));
    const now = new Date();
    const version = dateTimeString(booking.fields['Last modified time']) ?? booking.createdTime ?? now.toISOString();
    const tripId = publicTripId(baseId, booking.id);

    return {
      schemaVersion: 1,
      tripId,
      version,
      serverTime: now.toISOString(),
      stage: resolveStage(status, departure, returns, quoteExpiry),
      accessScope,
      freshness: {
        status: 'fresh',
        sourceUpdatedAt: version,
        nextRefreshAfter: new Date(now.getTime() + 5 * 60_000).toISOString(),
      },
      brand: {
        name: firstString(brandValue('name')) || 'Your travel company',
        logoUrl: firstAttachmentUrl(brandValue('logo')),
        theme: themeTokens({
          tags,
          configuredTheme: firstString(brandValue('theme')),
          primaryColor: firstString(brandValue('colour')),
          secondaryColor: firstString(brandValue('colour2')),
          displayFont: firstString(brandValue('fontDisplay')),
          bodyFont: firstString(brandValue('fontBody')),
        }),
      },
      summary: {
        reference: firstString(bookingValue('reference')) || 'Your trip',
        name: firstString(bookingValue('name')) || 'Your trip',
        departureDate: departure,
        returnDate: returns,
        heroImageUrl: firstAttachmentUrl(bookingValue('hero')),
      },
      capabilities: {
        acceptQuotation: accessScope === 'primary_customer' && resolveStage(status, departure, returns, quoteExpiry) === 'quote',
        makePayment: accessScope === 'primary_customer' && !['closed', 'cancelled', 'quote_expired'].includes(resolveStage(status, departure, returns, quoteExpiry)),
        shareWithTraveller: accessScope === 'primary_customer',
        sendMessage: true,
      },
    };
  }
}

function publicTripId(baseId: string, recordId: string): string {
  const secret = process.env.VISION_LINK_SECRET;
  if (!secret) throw new Error('VISION_LINK_SECRET is not configured.');
  return `trp_${createHmac('sha256', secret).update(`${baseId}|${recordId}`).digest('base64url').slice(0, 22)}`;
}

function dateString(value: unknown): string | null {
  const raw = firstString(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
}

function dateTimeString(value: unknown): string | null {
  const raw = firstString(value);
  const parsed = new Date(raw);
  return raw && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
}

function emptyRecord(): AirtableRecord {
  return { id: '', fields: {} };
}
