import { Component, input, signal } from '@angular/core';
import type { TripCommunication } from '@vision-trips/contracts';
import { EuropeanDatePipe } from '../../shared/european-date.pipe';
import { VtIcon } from '../../shared/lucide-icon';

@Component({
  selector: 'app-communications-section',
  imports: [EuropeanDatePipe, VtIcon],
  template: `
    @if (communications().length) {
      <section class="vt-updates-section" aria-labelledby="updates-title">
        <header class="vt-lower-section__header"><p>Messages we’ve sent</p><h2 id="updates-title">Trip updates</h2></header>
        <div class="vt-update-feed">
          @for (message of communications(); track message.id) {
            <article class="vt-update-card">
              <header><span class="vt-update-card__icon"><vt-icon name="mail" [size]="19" /></span><div><h3>{{ message.subject }}</h3><p>{{ message.type }}@if (message.sentAt) { · {{ message.sentAt | europeanDate }} }</p></div><span class="vt-update-card__status" [class.is-pending]="!message.sentAt">{{ message.sentAt ? 'Sent' : 'Pending' }}</span></header>
              @if (message.content) { <div class="vt-update-card__preview" [class.is-long]="isLong(message.content)" [class.is-expanded]="isExpanded(message.id)"><p>{{ message.content }}</p></div>@if (isLong(message.content)) { <button type="button" class="vt-update-card__toggle" [attr.aria-expanded]="isExpanded(message.id)" (click)="toggle(message.id)">{{ isExpanded(message.id) ? 'Show less' : 'Read full update' }} <vt-icon name="chevron-down" [size]="15" /></button> } }
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class CommunicationsSection {
  readonly communications = input.required<TripCommunication[]>();
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  isLong(content: string): boolean { return content.length > 180; }
  isExpanded(id: string): boolean { return this.expanded().has(id); }
  toggle(id: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
}
