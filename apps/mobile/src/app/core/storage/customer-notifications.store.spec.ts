import type { TripSnapshot } from '@vision-trips/contracts';
import { CustomerNotificationsStore } from './customer-notifications.store';

function snapshot(overrides: Partial<TripSnapshot> = {}): TripSnapshot {
  return {
    tripId: 'trip-1', version: 'v1', summary: { name: 'Lisbon', departureDate: null } as TripSnapshot['summary'],
    documents: [], ...overrides,
  } as TripSnapshot;
}

describe('CustomerNotificationsStore', () => {
  beforeEach(() => localStorage.clear());

  it('stores and deduplicates quotation acceptance notifications', async () => {
    const store = new CustomerNotificationsStore();
    await store.quoteAccepted(snapshot());
    await store.quoteAccepted(snapshot());
    expect(store.list('trip-1')).toHaveLength(1);
    expect(store.list('trip-1')[0]).toMatchObject({ kind: 'quote_accepted', readAt: null });
  });

  it('detects newly paid items and newly ready documents', async () => {
    const store = new CustomerNotificationsStore();
    const previous = snapshot({
      payments: { currency: 'GBP', balance: 800, items: [{ id: 'deposit', label: 'Deposit', status: 'outstanding' }] } as TripSnapshot['payments'],
      documents: [{ id: 'tickets', title: 'Travel tickets', status: 'pending', version: 'v1' }] as TripSnapshot['documents'],
    });
    const current = snapshot({
      version: 'v2',
      payments: { currency: 'GBP', balance: 500, items: [{ id: 'deposit', label: 'Deposit', status: 'paid', completedDate: '2026-11-07' }] } as TripSnapshot['payments'],
      documents: [{ id: 'tickets', title: 'Travel tickets', status: 'ready', version: 'v2' }] as TripSnapshot['documents'],
    });

    await store.sync(previous, current);

    expect(store.list('trip-1').map((item) => item.kind).sort()).toEqual(['documents_ready', 'payment_received']);
  });

  it('marks the trip inbox as read', async () => {
    const store = new CustomerNotificationsStore();
    await store.quoteAccepted(snapshot());
    store.markAllRead('trip-1');
    expect(store.list('trip-1')[0].readAt).not.toBeNull();
  });
});
