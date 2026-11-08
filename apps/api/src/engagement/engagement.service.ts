import { Injectable, Logger } from '@nestjs/common';
import type { CustomerEngagementRequest } from '@vision-trips/contracts';
import { AirtableService } from '../airtable/airtable.service.js';
import type { SessionPrincipal } from '../sessions/sessions.service.js';

@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);
  constructor(private readonly airtable: AirtableService) {}

  record(principal: SessionPrincipal, input: CustomerEngagementRequest): void {
    const table = process.env.AIRTABLE_ENGAGEMENT_TABLE?.trim();
    if (!table) return;
    const fields = {
      Booking: [principal.recordId],
      Event: input.event,
      Detail: input.detail.slice(0, 200),
      Stage: (input.stage || '').slice(0, 100),
      When: validDate(input.occurredAt),
      Device: (input.device || 'unknown').slice(0, 100),
    };
    void this.airtable.createRecord(principal.baseId, table, fields).catch((error: unknown) => {
      this.logger.warn(`Engagement logging failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  }
}

function validDate(value: string | undefined): string {
  const time = value ? Date.parse(value) : Number.NaN;
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString();
}
