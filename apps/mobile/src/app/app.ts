import { Component, computed, inject, signal } from '@angular/core';
import type { LinkExchangeChallenge, LinkExchangeResponse, TripSnapshot } from '@vision-trips/contracts';
import { VisionApiService } from './core/api/vision-api.service';
import { SavedTripsStore } from './core/storage/saved-trips.store';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly api = inject(VisionApiService);
  private readonly savedTrips = inject(SavedTripsStore);
  protected readonly linkOrCode = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly trip = signal<TripSnapshot | null>(null);
  protected readonly challenge = signal<LinkExchangeChallenge | null>(null);
  protected readonly postcode = signal('');
  protected readonly storedSecurely = signal(false);
  protected readonly canContinue = computed(() => this.linkOrCode().trim().length >= 16 && !this.submitting());

  protected updateLink(event: Event): void {
    this.linkOrCode.set((event.target as HTMLInputElement).value);
  }

  protected async openTrip(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canContinue()) return;

    this.submitting.set(true);
    this.error.set('');
    try {
      const response = await this.api.exchangeLink(this.linkOrCode().trim());
      if (response.status === 'authorized') {
        await this.acceptAuthorized(response);
      } else {
        this.challenge.set(response.challenge);
      }
    } catch {
      this.error.set('We could not open that trip. Check the link and try again.');
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
    this.challenge.set(null);
    this.storedSecurely.set(await this.savedTrips.save(response.snapshot, response.session));
  }
}
