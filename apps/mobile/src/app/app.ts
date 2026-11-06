import { Component, computed, inject, signal } from '@angular/core';
import type { TripSnapshot } from '@vision-trips/contracts';
import { VisionApiService } from './core/api/vision-api.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly api = inject(VisionApiService);
  protected readonly linkOrCode = signal('');
  protected readonly submitting = signal(false);
  protected readonly error = signal('');
  protected readonly trip = signal<TripSnapshot | null>(null);
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
        this.trip.set(response.snapshot);
      } else {
        this.error.set('This trip needs identity verification. The verification screen is the next milestone.');
      }
    } catch {
      this.error.set('We could not open that trip. Check the link and try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
