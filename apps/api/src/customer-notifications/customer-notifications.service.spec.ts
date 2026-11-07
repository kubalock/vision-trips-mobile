import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { CustomerNotificationsService, customerEmailTemplates } from './customer-notifications.service.js';

describe('CustomerNotificationsService', () => {
  let store: DurableAuthStore;
  beforeEach(() => {
    process.env.VISION_AUTOMATION_KEY = 'automation-secret'; process.env.VISION_LINK_SECRET = 'link-secret'; process.env.RESEND_API_KEY = 'resend-secret';
    store = new DurableAuthStore(':memory:');
  });
  afterEach(() => { store.onModuleDestroy(); vi.restoreAllMocks(); delete process.env.VISION_AUTOMATION_KEY; delete process.env.VISION_LINK_SECRET; delete process.env.RESEND_API_KEY; });

  it.each(customerEmailTemplates)('delivers and audits the %s template', async (template) => {
    const airtable = { addComment: vi.fn().mockResolvedValue(undefined) };
    const service = makeService(store, airtable);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: `email-${template}` }), { status: 200 }));
    const result = await service.send('automation-secret', { baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', template, ...(template === 'custom' ? { subject: 'A personal update', heading: 'Hello Alex', body: 'Your travel expert has an update.' } : {}) });
    expect(result).toMatchObject({ delivered: true, duplicate: false, to: 'alex@example.com', template });
    const requestBody = (fetchMock.mock.calls[0][1] as RequestInit).body;
    expect(typeof requestBody).toBe('string');
    const payload = JSON.parse(requestBody as string) as { to: string[]; html: string; subject: string };
    expect(payload.to).toEqual(['alex@example.com']);
    expect(payload.html).toContain('Example Travel');
    expect(payload.html).not.toContain('<script>');
    expect(airtable.addComment).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN', expect.stringContaining(`Email delivered via Vision Trips · ${template}`));
  });

  it('retries a missing Airtable audit comment without resending the email', async () => {
    const airtable = { addComment: vi.fn().mockRejectedValueOnce(new Error('Airtable unavailable')).mockResolvedValueOnce(undefined) };
    const service = makeService(store, airtable);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }));
    const request = { baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', template: 'welcome_home', idempotencyKey: 'welcome-2027' };
    await expect(service.send('automation-secret', request)).rejects.toThrow('audit comment is still pending');
    await expect(service.send('automation-secret', request)).resolves.toMatchObject({ delivered: true, duplicate: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(airtable.addComment).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid automation key before reading a booking', async () => {
    const trips = { verificationProfile: vi.fn(), snapshot: vi.fn() };
    const service = new CustomerNotificationsService(trips as never, {} as never, {} as never, store);
    await expect(service.send('wrong-key', { baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', template: 'balance_reminder' })).rejects.toThrow('Invalid automation key');
    expect(trips.verificationProfile).not.toHaveBeenCalled();
  });
});

function makeService(store: DurableAuthStore, airtable: { addComment: ReturnType<typeof vi.fn> }): CustomerNotificationsService {
  const snapshot = {
    version: 'v1', summary: { name: 'Lisbon Escape', departureDate: '2027-03-01', returnDate: '2027-03-10' },
    travellers: [{ isLead: true, firstName: 'Alex' }], quotation: { expiresAt: '2026-12-01' },
    payments: { currency: 'GBP', total: 2500, balance: 1000, balanceDueDate: '2027-01-15', items: [{ id: 'pay1', status: 'paid', completedDate: '2026-11-07' }] },
    documents: [{ id: 'doc1', version: 'one' }], brand: { name: 'Example Travel', logoUrl: null, theme: { primaryColor: '#155B75' }, profile: { reviewLinks: [{ provider: 'google', url: 'https://reviews.example' }] } },
    support: { email: 'agent@example.com', phone: '020 7000 0000' },
  };
  const trips = { verificationProfile: vi.fn().mockResolvedValue({ email: 'alex@example.com' }), snapshot: vi.fn().mockResolvedValue(snapshot) };
  const links = { mintCustomerLink: vi.fn().mockReturnValue('https://trips.example/trip/signed') };
  return new CustomerNotificationsService(trips as never, airtable as never, links as never, store);
}
