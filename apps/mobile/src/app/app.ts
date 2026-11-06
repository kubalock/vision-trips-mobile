import { Component, computed, signal } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly linkOrCode = signal('');
  protected readonly canContinue = computed(() => this.linkOrCode().trim().length >= 6);

  protected updateLink(event: Event): void {
    this.linkOrCode.set((event.target as HTMLInputElement).value);
  }

  protected openTrip(event: Event): void {
    event.preventDefault();
    if (!this.canContinue()) return;

    // The link-exchange API will replace this placeholder in the authentication milestone.
    this.linkOrCode.set(this.linkOrCode().trim());
  }
}
