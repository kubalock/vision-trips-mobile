import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { TripSnapshot } from '@vision-trips/contracts';

export type CustomerNotificationKind = 'quote_accepted' | 'payment_received' | 'documents_ready' | 'balance_reminder' | 'departure_reminder';

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
  list(tripId: string): CustomerNotification[] {
    return this.read(tripId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

  async sync(previous: TripSnapshot | null, snapshot: TripSnapshot): Promise<void> {
    if (previous?.payments && snapshot.payments) {
      const previousItems = new Map(previous.payments.items.map((item) => [item.id, item]));
      for (const payment of snapshot.payments.items) {
        if (payment.status === 'paid' && previousItems.get(payment.id)?.status !== 'paid') {
          await this.add(snapshot.tripId, 'payment_received', 'Payment received', `${payment.label} has been received. Your balance is now ${money(snapshot.payments.balance, snapshot.payments.currency)}.`, `payment:${payment.id}:${payment.completedDate ?? snapshot.version}`);
        }
      }
    }

    if (previous) {
      const previousDocuments = new Map(previous.documents.map((document) => [document.id, document]));
      const ready = snapshot.documents.filter((document) => document.status === 'ready' && (previousDocuments.get(document.id)?.status !== 'ready' || previousDocuments.get(document.id)?.version !== document.version));
      if (ready.length) await this.add(snapshot.tripId, 'documents_ready', ready.length === 1 ? 'Document ready' : 'Documents ready', ready.length === 1 ? `${ready[0].title} is ready to download.` : `${ready.length} travel documents are ready to download.`, `documents:${ready.map((document) => `${document.id}:${document.version}`).sort().join('|')}`);
    }

    const nextPayment = snapshot.payments?.items
      .filter((payment) => payment.status === 'outstanding' || payment.status === 'overdue')
      .filter((payment) => payment.dueDate)
      .sort((left, right) => (left.dueDate ?? '').localeCompare(right.dueDate ?? ''))[0];
    if (nextPayment?.dueDate) {
      const days = daysFromToday(nextPayment.dueDate);
      if (days <= 7) {
        const timing = days < 0 ? 'is overdue' : days === 0 ? 'is due today' : `is due in ${days} day${days === 1 ? '' : 's'}`;
        await this.add(snapshot.tripId, 'balance_reminder', 'Balance reminder', `${nextPayment.label} ${timing}.`, `balance:${nextPayment.id}:${nextPayment.dueDate}:${days < 0 ? 'overdue' : days}`);
      }
    }

    if (snapshot.summary.departureDate) {
      const days = daysFromToday(snapshot.summary.departureDate);
      const threshold = [1, 7, 30].find((value) => days >= 0 && days <= value);
      if (threshold) {
        const timing = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
        await this.add(snapshot.tripId, 'departure_reminder', 'Your trip is nearly here', `${snapshot.summary.name} departs ${timing}. Check your documents and final travel details.`, `departure:${snapshot.summary.departureDate}:${threshold}`);
      }
    }
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
      await LocalNotifications.schedule({ notifications: [{ id: notificationId(notification.id), title: notification.title, body: notification.body, schedule: { at: new Date(Date.now() + 500) }, extra: { tripId: notification.tripId } }] });
    } else if ('Notification' in window && Notification.permission === 'granted') new Notification(notification.title, { body: notification.body, tag: notification.id });
  }

  private read(tripId: string): CustomerNotification[] {
    try {
      const value = JSON.parse(localStorage.getItem(this.key(tripId)) || '[]') as unknown;
      return Array.isArray(value) ? value.filter(isCustomerNotification) : [];
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

function daysFromToday(date: string): number {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.floor((new Date(`${date}T00:00:00`).getTime() - start) / 86_400_000);
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount);
}

function notificationId(value: string): number {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}
