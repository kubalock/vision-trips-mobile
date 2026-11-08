import type { AirtableService } from '../airtable/airtable.service.js';
import { EngagementService } from './engagement.service.js';

describe('EngagementService', () => {
  it('writes a redacted, linked engagement row when configured', async () => {
    const previous = process.env.AIRTABLE_ENGAGEMENT_TABLE;
    process.env.AIRTABLE_ENGAGEMENT_TABLE = 'Engagement';
    const createRecord = vi.fn().mockResolvedValue({ id: 'recEvent', fields: {} });
    const service = new EngagementService({ createRecord } as unknown as AirtableService);

    service.record(
      { baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false },
      { event: 'section_opened', detail: 'documents', stage: 'Booked', occurredAt: '2026-11-08T12:00:00Z', device: 'web' },
    );
    await Promise.resolve();

    expect(createRecord).toHaveBeenCalledWith('appABCDEFGHIJKLMN', 'Engagement', {
      Booking: ['recABCDEFGHIJKLMN'], Event: 'section_opened', Detail: 'documents', Stage: 'Booked', When: '2026-11-08T12:00:00.000Z', Device: 'web',
    });
    if (previous === undefined) delete process.env.AIRTABLE_ENGAGEMENT_TABLE; else process.env.AIRTABLE_ENGAGEMENT_TABLE = previous;
  });

  it('does nothing when Airtable engagement logging is not configured', () => {
    const previous = process.env.AIRTABLE_ENGAGEMENT_TABLE;
    delete process.env.AIRTABLE_ENGAGEMENT_TABLE;
    const createRecord = vi.fn();
    new EngagementService({ createRecord } as unknown as AirtableService).record(
      { baseId: 'appABCDEFGHIJKLMN', recordId: 'recABCDEFGHIJKLMN', fellowTraveller: false },
      { event: 'action_clicked', detail: 'Download' },
    );
    expect(createRecord).not.toHaveBeenCalled();
    if (previous !== undefined) process.env.AIRTABLE_ENGAGEMENT_TABLE = previous;
  });
});
