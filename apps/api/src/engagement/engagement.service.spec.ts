import type { AirtableService } from '../airtable/airtable.service.js';
import type { DurableAuthStore } from '../sessions/durable-auth.store.js';
import { EngagementService } from './engagement.service.js';

describe('EngagementService', () => {
  it('writes a redacted, linked engagement row when configured', async () => {
    const previous = process.env.AIRTABLE_ENGAGEMENT_TABLE;
    process.env.AIRTABLE_ENGAGEMENT_TABLE = 'Engagement';
    const createRecord = vi.fn().mockResolvedValue({ id: 'recEvent', fields: {} });
    const enqueueJob = vi.fn();
    const service = new EngagementService({ createRecord } as unknown as AirtableService, { enqueueJob } as unknown as DurableAuthStore);

    service.record(
      { baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false },
      { event: 'section_opened', detail: 'documents', stage: 'Booked', occurredAt: '2026-11-08T12:00:00Z', device: 'web' },
    );
    expect(enqueueJob).toHaveBeenCalledWith(expect.any(String), 'airtable-engagement', { baseId: 'appABCDEFGHIJKLMN', table: 'Engagement', fields: {
      Booking: ['recABCDEFGHIJKLMN'], Event: 'section_opened', Detail: 'documents', Stage: 'Booked', When: '2026-11-08T12:00:00.000Z', Device: 'web',
    } });
    if (previous === undefined) delete process.env.AIRTABLE_ENGAGEMENT_TABLE; else process.env.AIRTABLE_ENGAGEMENT_TABLE = previous;
  });

  it('does nothing when Airtable engagement logging is not configured', () => {
    const previous = process.env.AIRTABLE_ENGAGEMENT_TABLE;
    delete process.env.AIRTABLE_ENGAGEMENT_TABLE;
    const createRecord = vi.fn();
    const enqueueJob = vi.fn();
    new EngagementService({ createRecord } as unknown as AirtableService, { enqueueJob } as unknown as DurableAuthStore).record(
      { baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false },
      { event: 'action_clicked', detail: 'Download' },
    );
    expect(createRecord).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
    if (previous !== undefined) process.env.AIRTABLE_ENGAGEMENT_TABLE = previous;
  });
});
