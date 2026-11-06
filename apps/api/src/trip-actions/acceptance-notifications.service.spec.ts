import { AcceptanceNotificationsService } from './acceptance-notifications.service.js';

describe('AcceptanceNotificationsService', () => {
  afterEach(() => { delete process.env.RESEND_API_KEY; });

  it('creates local previews for customer and agent when no provider key is configured', async () => {
    const service = new AcceptanceNotificationsService();
    const result = await service.send({
      summary: { name: 'Lisbon Escape', reference: 'VT-2' },
      support: { email: 'agent@example.com' },
    } as never, { name: 'Alex Traveller', email: 'alex@example.com' }, '2026-11-06T12:00:00Z');

    expect(result).toEqual({ customer: 'local_preview', agent: 'local_preview' });
  });
});
