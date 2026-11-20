import type { PaymentItem, TripDocument, TripSnapshot } from './index.js';

/*
 * The customer notifications ("Payment received", "Document ready", payment and departure reminders) are worked out
 * on the device by comparing two versions of a trip. The app does it after each refresh, and the background check
 * (apps/mobile/src/background) does it between app uses with the small `NotificationBasis` the API returns from
 * `GET /v1/trips/current/watch`. Both use these functions, so the same change never produces two different messages,
 * and a notification's id is the same wherever it was found (which is how each side skips what the other showed).
 */

export type CustomerNotificationKind = 'quote_accepted' | 'payment_received' | 'documents_ready' | 'balance_reminder' | 'departure_reminder';

/** Only what the notification rules read from a trip: no prices beyond the balance, no links, no personal details. */
export interface NotificationBasis {
  tripId: string;
  version: string;
  /** A quotation not yet accepted owes nothing, so a lapsed due date is not a reminder. */
  awaitingAcceptance: boolean;
  departureDate: string | null;
  tripName: string;
  /** Null for views without payments (fellow travellers). */
  payments: {
    currency: string;
    balance: number | null;
    items: Array<Pick<PaymentItem, 'id' | 'label' | 'status' | 'dueDate' | 'completedDate'>>;
  } | null;
  documents: Array<Pick<TripDocument, 'id' | 'title' | 'status' | 'version'>>;
}

/** A notification to record (and show): `id` is `<kind>:<dedupe key>`, the same for the same event every time. */
export interface NotificationDraft {
  id: string;
  kind: CustomerNotificationKind;
  title: string;
  body: string;
}

export function notificationBasis(snapshot: TripSnapshot): NotificationBasis {
  return {
    tripId: snapshot.tripId,
    version: snapshot.version,
    awaitingAcceptance: snapshot.stage === 'quote' && !snapshot.quotation?.accepted,
    departureDate: snapshot.summary.departureDate,
    tripName: snapshot.summary.name,
    payments: snapshot.payments ? {
      currency: snapshot.payments.currency,
      balance: snapshot.payments.balance,
      items: snapshot.payments.items.map(({ id, label, status, dueDate, completedDate }) => ({ id, label, status, dueDate, completedDate })),
    } : null,
    documents: snapshot.documents.map(({ id, title, status, version }) => ({ id, title, status, version })),
  };
}

/**
 * Notifications for moving from `previous` to `next` (null when there is no earlier version to compare: then only the
 * date-based reminders apply). `today` is the device's local date.
 */
export function tripNotifications(previous: NotificationBasis | null, next: NotificationBasis, today: Date = new Date()): NotificationDraft[] {
  const drafts: NotificationDraft[] = [];
  const add = (kind: CustomerNotificationKind, title: string, body: string, dedupeKey: string) => drafts.push({ id: `${kind}:${dedupeKey}`, kind, title, body });

  if (previous?.payments && next.payments) {
    const previousItems = new Map(previous.payments.items.map((item) => [item.id, item]));
    for (const payment of next.payments.items) {
      if (payment.status === 'paid' && previousItems.get(payment.id)?.status !== 'paid') {
        add('payment_received', 'Payment received', `${payment.label} has been received.${next.payments.balance === null ? '' : ` Your balance is now ${money(next.payments.balance, next.payments.currency)}.`}`, `payment:${payment.id}:${payment.completedDate ?? next.version}`);
      }
    }
  }

  if (previous) {
    const previousDocuments = new Map(previous.documents.map((document) => [document.id, document]));
    const ready = next.documents.filter((document) => document.status === 'ready' && (previousDocuments.get(document.id)?.status !== 'ready' || previousDocuments.get(document.id)?.version !== document.version));
    if (ready.length) add('documents_ready', ready.length === 1 ? 'Document ready' : 'Documents ready', ready.length === 1 ? `${ready[0].title} is ready to download.` : `${ready.length} travel documents are ready to download.`, `documents:${ready.map((document) => `${document.id}:${document.version}`).sort().join('|')}`);
  }

  const nextPayment = next.payments?.items
    .filter((payment) => payment.status === 'outstanding' || payment.status === 'overdue')
    .filter((payment) => payment.dueDate)
    .sort((left, right) => (left.dueDate ?? '').localeCompare(right.dueDate ?? ''))[0];
  if (nextPayment?.dueDate) {
    const days = daysFrom(today, nextPayment.dueDate);
    if (days <= 7 && !(next.awaitingAcceptance && days < 0)) {
      const timing = days < 0 ? 'is overdue' : days === 0 ? 'is due today' : `is due in ${days} day${days === 1 ? '' : 's'}`;
      add('balance_reminder', reminderTitle(nextPayment.label), `${nextPayment.label} ${timing}.`, `balance:${nextPayment.id}:${nextPayment.dueDate}:${days < 0 ? 'overdue' : days}`);
    }
  }

  if (next.departureDate) {
    const days = daysFrom(today, next.departureDate);
    const threshold = [1, 7, 30].find((value) => days >= 0 && days <= value);
    if (threshold) {
      const timing = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
      add('departure_reminder', 'Your trip is nearly here', `${next.tripName} departs ${timing}. Check your documents and final travel details.`, `departure:${next.departureDate}:${threshold}`);
    }
  }
  return drafts;
}

/** A reminder is a "Balance reminder" only for the balance; a deposit or instalment is a "Payment reminder". */
export function reminderTitle(label: string): string {
  return /balance/i.test(label) ? 'Balance reminder' : 'Payment reminder';
}

/** The numeric id the operating system needs for a notification (a 32-bit hash of its string id, never 0). */
export function notificationNumber(id: string): number {
  let hash = 0;
  for (const character of id) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}

function daysFrom(today: Date, date: string): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((new Date(`${date}T00:00:00`).getTime() - start) / 86_400_000);
}

const SYMBOLS: Record<string, string> = { GBP: '£', EUR: '€', USD: '$' };

/** `Intl` may be missing in the background runner's JavaScript engine, so there is a plain fallback. */
function money(amount: number, currency: string): string {
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount); }
  catch { return `${SYMBOLS[currency] ?? `${currency} `}${amount.toFixed(2)}`; }
}
