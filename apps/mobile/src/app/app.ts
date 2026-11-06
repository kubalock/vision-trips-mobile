import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import type { LinkExchangeChallenge, LinkExchangeResponse, MobileSession, TripSnapshot } from '@vision-trips/contracts';
import { VisionApiService } from './core/api/vision-api.service';
import { SavedTripsStore } from './core/storage/saved-trips.store';
import { DocumentsSection } from './features/trip/documents-section';
import { DestinationsSection } from './features/trip/destinations-section';
import { CommunicationsSection } from './features/trip/communications-section';
import { ItinerarySection } from './features/trip/itinerary-section';
import { ExtrasSection } from './features/trip/extras-section';
import { PaymentsSection } from './features/trip/payments-section';

@Component({
  selector: 'app-root',
  imports: [CommunicationsSection, DestinationsSection, DocumentsSection, ExtrasSection, ItinerarySection, PaymentsSection],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly api = inject(VisionApiService);
  private readonly savedTrips = inject(SavedTripsStore);
  protected readonly baseId = signal('');
  protected readonly recordId = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly trip = signal<TripSnapshot | null>(null);
  protected readonly challenge = signal<LinkExchangeChallenge | null>(null);
  protected readonly postcode = signal('');
  protected readonly storedSecurely = signal(false);
  private readonly session = signal<MobileSession | null>(null);
  protected readonly canContinue = computed(() => /^app[A-Za-z0-9]{14}$/.test(this.baseId().trim()) && /^rec[A-Za-z0-9]{14}$/.test(this.recordId().trim()) && !this.submitting());

  protected updateBaseId(event: Event): void {
    this.baseId.set((event.target as HTMLInputElement).value);
  }

  protected updateRecordId(event: Event): void {
    this.recordId.set((event.target as HTMLInputElement).value);
  }

  protected async openTrip(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canContinue()) return;

    this.submitting.set(true);
    this.error.set('');
    try {
      const response = await this.api.exchangeLocalTrip(this.baseId().trim(), this.recordId().trim());
      if (response.status === 'authorized') {
        await this.acceptAuthorized(response);
      } else {
        this.challenge.set(response.challenge);
      }
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not open that trip. Check the Airtable IDs and API configuration, then try again.'));
    } finally {
      this.submitting.set(false);
    }
  }

  protected updatePostcode(event: Event): void {
    this.postcode.set((event.target as HTMLInputElement).value);
  }

  protected async verifyPostcode(event: Event): Promise<void> {
    event.preventDefault();
    const challenge = this.challenge();
    if (!challenge || !this.postcode().trim()) return;
    this.submitting.set(true);
    this.error.set('');
    try {
      const response = await this.api.verifyPostcode(challenge.exchangeId, this.postcode().trim());
      if (response.status === 'authorized') await this.acceptAuthorized(response);
    } catch {
      this.error.set('That postcode did not match the booking. Please check it and try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  private async acceptAuthorized(response: Extract<LinkExchangeResponse, { status: 'authorized' }>): Promise<void> {
    this.trip.set(response.snapshot);
    this.session.set(response.session);
    this.challenge.set(null);
    this.storedSecurely.set(await this.savedTrips.save(response.snapshot, response.session));
  }

  protected async downloadCalendar(): Promise<void> {
    const session = this.session();
    const trip = this.trip();
    if (!session || !trip) return;
    this.error.set('');
    try {
      const blob = await this.api.downloadCalendar(session.accessToken);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${trip.summary.reference.replace(/[^A-Za-z0-9_-]+/g, '-')}-itinerary.ics`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not create the calendar file. Please try again.'));
    }
  }

  protected async downloadDocument(kind: 'confirmation' | 'invoice'): Promise<void> {
    const session = this.session();
    const trip = this.trip();
    if (!session || !trip) return;
    this.error.set('');
    try {
      const blob = await this.api.downloadDocument(kind, session.accessToken);
      this.downloadBlob(blob, `${trip.summary.reference.replace(/[^A-Za-z0-9_-]+/g, '-')}-${kind}.html`);
    } catch (error) {
      this.error.set(this.apiError(error, 'We could not create that document. Please try again.'));
    }
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private apiError(error: unknown, fallback: string): string {
    if (!(error instanceof HttpErrorResponse)) return fallback;
    if (error.status === 0) return 'The local API is not reachable. Make sure npm run start:api is running on port 3000.';
    const message = error.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message)) return message.filter((item): item is string => typeof item === 'string').join(' ');
    return fallback;
  }
}
