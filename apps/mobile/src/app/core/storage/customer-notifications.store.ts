import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { notificationBasis, notificationNumber, reminderTitle, tripNotifications, type CustomerNotificationKind, type NotificationDraft, type TripSnapshot } from '@vision-trips/contracts';

export type { CustomerNotificationKind };

export interface CustomerNotification {
  id: string;
  tripId: string;
  kind: CustomerNotificationKind;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

const ENABLED_KEY = 'vision-trips:notifications:device-enabled';

@Injectable({ providedIn: 'root' })
export class CustomerNotificationsStore {
  /**
   * The trip's notifications, newest first. Pass the open trip so that, while it is a quotation awaiting acceptance,
   * "overdue" payment reminders saved earlier are hidden: nothing is owed yet. They stay stored, so they show again
   * if the booking goes ahead with the payment still late.
   */
  list(tripId: string, trip?: Pick<TripSnapshot, 'stage' | 'quotation'> | null): CustomerNotification[] {
    const hideOverdue = trip?.stage === 'quote' && !trip.quotation?.accepted;
    return this.read(tripId)
      .filter((notification) => !(hideOverdue && notification.kind === 'balance_reminder' && notification.id.endsWith(':overdue')))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  deviceEnabled(): boolean {
    return localStorage.getItem(ENABLED_KEY) === 'true';
  }

  async setDeviceEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      localStorage.setItem(ENABLED_KEY, 'false');
      return false;
    }
    const granted = await this.requestPermission();
    localStorage.setItem(ENABLED_KEY, String(granted));
    return granted;
  }

  async quoteAccepted(snapshot: TripSnapshot): Promise<void> {
    await this.add(snapshot.tripId, 'quote_accepted', `Quotation accepted`, `${snapshot.summary.name} has been accepted. Your agent will confirm the booking with the suppliers.`, `quote:${snapshot.version}`);
  }

  /** Records (and shows) what changed between two versions of a trip, using the rules shared with the background check. */
  async sync(previous: TripSnapshot | null, snapshot: TripSnapshot): Promise<void> {
    for (const draft of tripNotifications(previous ? notificationBasis(previous) : null, notificationBasis(snapshot))) {
      await this.add(snapshot.tripId, draft.kind, draft.title, draft.body, draft.id.slice(draft.kind.length + 1));
    }
  }

  /** Records notifications the background check already showed on the device, without showing them a second time. */
  recordShown(tripId: string, drafts: Array<NotificationDraft & { createdAt?: string }>): void {
    const notifications = this.read(tripId);
    const known = new Set(notifications.map((notification) => notification.id));
    const added = drafts.filter((draft) => !known.has(draft.id)).map((draft): CustomerNotification => ({ id: draft.id, tripId, kind: draft.kind, title: draft.title, body: draft.body, createdAt: draft.createdAt ?? new Date().toISOString(), readAt: null }));
    if (added.length) this.write(tripId, [...added, ...notifications].slice(0, 100));
  }

  /** Ids of every notification recorded for a trip, so the background check never shows one of them again. */
  ids(tripId: string): string[] {
    return this.read(tripId).map((notification) => notification.id);
  }

  markAllRead(tripId: string): void {
    const now = new Date().toISOString();
    this.write(tripId, this.read(tripId).map((notification) => notification.readAt ? notification : { ...notification, readAt: now }));
  }

  clear(tripId: string): void {
    localStorage.removeItem(this.key(tripId));
  }

  private async add(tripId: string, kind: CustomerNotificationKind, title: string, body: string, dedupeKey: string): Promise<void> {
    const id = `${kind}:${dedupeKey}`;
    const notifications = this.read(tripId);
    if (notifications.some((notification) => notification.id === id)) return;
    const notification: CustomerNotification = { id, tripId, kind, title, body, createdAt: new Date().toISOString(), readAt: null };
    this.write(tripId, [notification, ...notifications].slice(0, 100));
    if (this.deviceEnabled()) await this.present(notification);
  }

  private async requestPermission(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) return (await LocalNotifications.requestPermissions()).display === 'granted';
    if (!('Notification' in window)) return false;
    return (Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()) === 'granted';
  }

  private async present(notification: CustomerNotification): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.schedule({ notifications: [{ id: notificationNumber(notification.id), title: notification.title, body: notification.body, schedule: { at: new Date(Date.now() + 500) }, extra: { tripId: notification.tripId } }] });
    } else if ('Notification' in window && Notification.permission === 'granted') new Notification(notification.title, { body: notification.body, tag: notification.id });
  }

  private read(tripId: string): CustomerNotification[] {
    try {
      const value = JSON.parse(localStorage.getItem(this.key(tripId)) || '[]') as unknown;
      return Array.isArray(value) ? value.filter(isCustomerNotification).map(withCurrentTitle) : [];
    } catch { return []; }
  }

  private write(tripId: string, notifications: CustomerNotification[]): void {
    localStorage.setItem(this.key(tripId), JSON.stringify(notifications));
  }

  private key(tripId: string): string { return `vision-trips:notifications:${tripId}`; }
}

function isCustomerNotification(value: unknown): value is CustomerNotification {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CustomerNotification>;
  return typeof item.id === 'string' && typeof item.tripId === 'string' && typeof item.title === 'string' && typeof item.createdAt === 'string';
}

/**
 * Reminders saved by older versions were all titled "Balance reminder", even for a deposit. The body starts with the
 * payment's label ("Deposit is overdue."), so the title is worked out again when shown instead of trusting the stored one.
 */
function withCurrentTitle(notification: CustomerNotification): CustomerNotification {
  if (notification.kind !== 'balance_reminder' || typeof notification.body !== 'string') return notification;
  const label = notification.body.replace(/ is (overdue|due today|due in \d+ days?)\.$/, '');
  const title = reminderTitle(label);
  return title === notification.title ? notification : { ...notification, title };
}
