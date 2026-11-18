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

  it('sends no overdue reminder for a quotation that has not been accepted', async () => {
    const store = new CustomerNotificationsStore();
    const payments = { currency: 'GBP', balance: 120, items: [{ id: 'deposit', label: 'Deposit Payment', status: 'outstanding', dueDate: '2020-01-01' }] } as TripSnapshot['payments'];
    await store.sync(null, snapshot({ stage: 'quote', quotation: { accepted: false }, payments } as Partial<TripSnapshot>));
    expect(store.list('trip-1')).toEqual([]);
    await store.sync(null, snapshot({ stage: 'confirmed', payments } as Partial<TripSnapshot>));
    expect(store.list('trip-1').map((item) => item.kind)).toEqual(['balance_reminder']);
  });

  it('hides overdue reminders saved earlier while the trip is a quotation awaiting acceptance', async () => {
    const store = new CustomerNotificationsStore();
    const payments = { currency: 'GBP', balance: 120, items: [{ id: 'deposit', label: 'Deposit Payment', status: 'overdue', dueDate: '2020-01-01' }] } as TripSnapshot['payments'];
    await store.sync(null, snapshot({ stage: 'confirmed', payments } as Partial<TripSnapshot>));
    await store.quoteAccepted(snapshot());
    const quote = { stage: 'quote', quotation: { accepted: false } } as Pick<TripSnapshot, 'stage' | 'quotation'>;
    expect(store.list('trip-1', quote).map((item) => item.kind)).toEqual(['quote_accepted']);
    expect(store.list('trip-1', { ...quote, quotation: { accepted: true } } as typeof quote)).toHaveLength(2);
    expect(store.list('trip-1')).toHaveLength(2);
  });

  it('marks the trip inbox as read', async () => {
    const store = new CustomerNotificationsStore();
    await store.quoteAccepted(snapshot());
    store.markAllRead('trip-1');
    expect(store.list('trip-1')[0].readAt).not.toBeNull();
  });

  it('retitles a deposit reminder saved as "Balance reminder" by an older version', () => {
    const stored = (id: string, body: string) => ({ id, tripId: 'trip-1', kind: 'balance_reminder', title: 'Balance reminder', body, createdAt: `2026-11-1${id}T09:00:00Z`, readAt: null });
    localStorage.setItem('vision-trips:notifications:trip-1', JSON.stringify([stored('1', 'Deposit is overdue.'), stored('2', 'Balance is due in 3 days.')]));
    const titles = new CustomerNotificationsStore().list('trip-1').map((item) => [item.body, item.title]);
    expect(titles).toEqual([['Balance is due in 3 days.', 'Balance reminder'], ['Deposit is overdue.', 'Payment reminder']]);
  });
});
