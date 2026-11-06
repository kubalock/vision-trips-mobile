import { BadGatewayException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

@Injectable()
export class AirtableService {
  private readonly logger = new Logger(AirtableService.name);
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  records(baseId: string, table: string, recordIds: string[]): Promise<AirtableRecord[]> {
    return Promise.all([...new Set(recordIds)].filter(isRecordId).map((id) => this.record(baseId, table, id)));
  }

  async record(baseId: string, table: string, recordId: string): Promise<AirtableRecord> {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Airtable is not configured.');

    const timeoutMs = Number(process.env.AIRTABLE_REQUEST_TIMEOUT_MS ?? 10_000);
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
    const maxAttempts = positiveInteger(process.env.AIRTABLE_MAX_ATTEMPTS, 3);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await this.throttle();
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          await sleep(backoffMs(attempt));
          continue;
        }
        this.logger.warn(`Airtable request failed after ${attempt} attempts: ${errorName(error)}`);
        throw new BadGatewayException('Airtable could not be reached.');
      }

      if (response.ok) return this.parseRecord(response);

      const detail = await responseText(response);
      this.logger.warn(`Airtable ${response.status} for ${table}/${recordId}: ${detail}`);
      if (isRetryable(response.status) && attempt < maxAttempts) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }

      if (response.status === 401) throw new ServiceUnavailableException('The Airtable token is invalid or expired.');
      if (response.status === 403) throw new ServiceUnavailableException('The Airtable token does not have access to this base or table.');
      if (response.status === 404) throw new NotFoundException(`Airtable could not find the ${table} record.`);
      if (response.status === 422) {
        throw new BadGatewayException(`Airtable rejected the ${table} request. Check that this base uses the Vision schema.`);
      }
      if (response.status === 429) {
        throw new ServiceUnavailableException('Airtable is rate limiting requests. Wait a moment and try again.');
      }
      if (response.status >= 500) {
        throw new ServiceUnavailableException('Airtable is temporarily unavailable. Try again shortly.');
      }
      throw new BadGatewayException(`Airtable rejected the ${table} request (status ${response.status}).`);
    }

    throw new ServiceUnavailableException('Airtable is temporarily unavailable. Try again shortly.');
  }

  private async throttle(): Promise<void> {
    const previous = this.requestQueue;
    let release: () => void = () => {};
    this.requestQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const intervalMs = nonNegativeInteger(process.env.AIRTABLE_MIN_REQUEST_INTERVAL_MS, 220);
      await sleep(Math.max(0, this.nextRequestAt - Date.now()));
      this.nextRequestAt = Date.now() + intervalMs;
    } finally {
      release();
    }
  }

  private async parseRecord(response: Response): Promise<AirtableRecord> {
    try {
      const value = await response.json() as Partial<AirtableRecord>;
      if (typeof value.id !== 'string' || !value.fields || typeof value.fields !== 'object') throw new Error('invalid record');
      return value as AirtableRecord;
    } catch {
      throw new BadGatewayException('Airtable returned a malformed record.');
    }
  }
}

function isRecordId(value: string): boolean {
  return /^rec[A-Za-z0-9]{14}$/.test(value);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return backoffMs(attempt);
}

function backoffMs(attempt: number): number {
  const baseMs = nonNegativeInteger(process.env.AIRTABLE_RETRY_BASE_MS, 500);
  return baseMs * 2 ** (attempt - 1);
}

async function responseText(response: Response): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, ' ').trim();
    return text.slice(0, 300) || '(empty response)';
  } catch {
    return '(unreadable response)';
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
