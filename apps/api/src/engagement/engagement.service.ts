import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CustomerEngagementRequest } from '@vision-trips/contracts';
import { AirtableService } from '../airtable/airtable.service.js';
import { DurableAuthStore } from '../sessions/durable-auth.store.js';
import type { SessionPrincipal } from '../sessions/sessions.service.js';

@Injectable()
export class EngagementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngagementService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(private readonly airtable: AirtableService, private readonly store: DurableAuthStore) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.processJobs(), 1_000);
    this.timer.unref?.();
    void this.processJobs();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

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
    this.store.enqueueJob(randomUUID(), 'airtable-engagement', { baseId: principal.baseId, table, fields });
  }

  private async processJobs(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of this.store.claimJobs('airtable-engagement')) {
        const payload = job.payload as { baseId?: unknown; table?: unknown; fields?: unknown };
        try {
          if (typeof payload.baseId !== 'string' || typeof payload.table !== 'string' || !payload.fields || typeof payload.fields !== 'object') throw new Error('invalid engagement job');
          await this.airtable.createRecord(payload.baseId, payload.table, payload.fields as Record<string, unknown>);
          this.store.completeJob(job.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error';
          if (job.attempts >= 5) { this.store.failJob(job.id, message); this.logger.error(`Engagement job ${job.id} failed permanently: ${message}`); }
          else { this.store.retryJob(job.id, message, Date.now() + Math.min(60_000, 1_000 * 2 ** job.attempts)); this.logger.warn(`Engagement job ${job.id} will retry: ${message}`); }
        }
      }
    } finally { this.running = false; }
  }
}

function validDate(value: string | undefined): string {
  const time = value ? Date.parse(value) : Number.NaN;
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString();
}
