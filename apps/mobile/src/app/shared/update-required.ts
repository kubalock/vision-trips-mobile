import { Component, inject } from '@angular/core';
import { AppUpdate } from '../core/platform/app-update';
import { VtIcon } from './lucide-icon';

/** "Update Vision Trips", shown on every screen once the API says this installed app is too old (see AppUpdate). */
@Component({
  selector: 'vt-update-required',
  imports: [VtIcon],
  template: `
    @if (update.required(); as requirement) {
      @if (!update.dismissed()) {
        <section class="vt-status-card vt-update-required" data-tone="warn" role="alert">
          <span class="vt-status-card__icon" aria-hidden="true"><vt-icon name="alert" [size]="20" /></span>
          <div class="vt-status-card__copy">
            <strong>Update Vision Trips</strong>
            <p>This version of the app is no longer supported. Update it to keep your trip up to date. Trips saved on this device are still here to read.</p>
            @if (requirement.updateUrl) {
              <a class="vt-status-card__action" [href]="requirement.updateUrl" target="_blank" rel="noopener" data-engagement="Update app">Update now</a>
            } @else {
              <p>Open the App Store to update it.</p>
            }
          </div>
          <button type="button" class="vt-status-card__close" aria-label="Not now" data-engagement="Dismiss update" (click)="update.dismissed.set(true)"><vt-icon name="close" [size]="18" /></button>
        </section>
      }
    }
  `,
})
export class VtUpdateRequired {
  protected readonly update = inject(AppUpdate);
}
