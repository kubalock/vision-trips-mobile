import { Component, input } from '@angular/core';
import type { TripCommunication } from '@vision-trips/contracts';

@Component({
  selector: 'app-communications-section',
  template: `
    @if (communications().length) {
      <section class="vt-section" aria-labelledby="updates-title">
        <h2 id="updates-title" class="vt-h2">Trip updates</h2>
        <div class="vt-msgs">
          @for (message of communications(); track message.id) {
            <article class="vt-msg__row"><span class="vt-msg__icon">✉</span><div class="vt-msg__main"><strong>{{ message.subject }}</strong><em>{{ message.type }}@if (message.sentAt) { · {{ message.sentAt.slice(0, 10) }} }</em>@if (message.content) { <p class="vt-small">{{ message.content }}</p> }</div><span class="vt-msg__sent">Sent</span>
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class CommunicationsSection {
  readonly communications = input.required<TripCommunication[]>();
}
