import { BadGatewayException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

export interface AirtableListOptions {
  filterByFormula?: string;
  fields?: string[];
  maxRecords?: number;
}

@Injectable()
export class AirtableService {
  private readonly logger = new Logger(AirtableService.name);
  /** Airtable allows 5 requests per second per base, so requests are spaced out per base, not globally. */
  private readonly baseQueues = new Map<string, { queue: Promise<void>; nextRequestAt: number }>();

  /**
   * Linked records by ID, in the order given, fetched in bulk (30 IDs per request, like the PHP client) instead of
   * one request per record. Linked records are optional context: a deleted record or a failed chunk is logged and
   * left out rather than failing the whole trip. Load the primary record with `record()`, which does throw.
   */
  async records(baseId: string, table: string, recordIds: string[]): Promise<AirtableRecord[]> {
    const ids = [...new Set(recordIds)].filter(isRecordId);
    if (!ids.length) return [];
    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += RECORDS_PER_REQUEST) chunks.push(ids.slice(index, index + RECORDS_PER_REQUEST));
    const results = await Promise.all(chunks.map(async (chunk) => {
      try {
        return await this.list(baseId, table, { maxRecords: chunk.length, filterByFormula: `OR(${chunk.map((id) => `RECORD_ID()='${id}'`).join(',')})` });
      } catch (error) {
        this.logger.warn(`Omitting ${chunk.length} linked ${table} record(s): ${error instanceof Error ? error.message : 'request failed'}`);
        return [];
      }
    }));
    const byId = new Map(results.flat().map((record) => [record.id, record]));
    const found = ids.flatMap((id) => { const record = byId.get(id); return record ? [record] : []; });
    if (found.length < ids.length) this.logger.warn(`${ids.length - found.length} linked ${table} record(s) were not found and were omitted.`);
    return found;
  }

  async list(baseId: string, table: string, options: AirtableListOptions = {}): Promise<AirtableRecord[]> {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Airtable is not configured.');
    const limit = Math.min(Math.max(options.maxRecords ?? 100, 1), 100);
    const params = new URLSearchParams({ pageSize: String(limit), maxRecords: String(limit) });
    if (options.filterByFormula) params.set('filterByFormula', options.filterByFormula);
    for (const field of options.fields ?? []) params.append('fields[]', field);
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${params}`;
    const response = await this.fetchWithRetry(baseId, url, token, `listing ${table}`);
    if (!response.ok) {
      const detail = await responseText(response);
      this.logger.warn(`Airtable ${response.status} listing ${table}: ${detail}`);
      if (response.status === 401 || response.status === 403) throw new ServiceUnavailableException('The Airtable token cannot search this base or table.');
      if (response.status === 422) throw new BadGatewayException(`Airtable rejected the ${table} search. Check that this base uses the Vision schema.`);
      if (response.status === 429 || response.status >= 500) throw new ServiceUnavailableException('Airtable is temporarily unavailable. Try again shortly.');
      throw new BadGatewayException(`Airtable rejected the ${table} search (status ${response.status}).`);
    }
    try {
      const value = await response.json() as { records?: unknown };
      if (!Array.isArray(value.records)) throw new Error('invalid list');
      return value.records.filter((record): record is AirtableRecord => Boolean(record && typeof record === 'object' && typeof (record as AirtableRecord).id === 'string' && (record as AirtableRecord).fields));
    } catch { throw new BadGatewayException('Airtable returned a malformed record list.'); }
  }

  async record(baseId: string, table: string, recordId: string): Promise<AirtableRecord> {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Airtable is not configured.');

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
    const response = await this.fetchWithRetry(baseId, url, token, `for ${table}/${recordId}`);
    if (response.ok) return this.parseRecord(response);

    const detail = await responseText(response);
    this.logger.warn(`Airtable ${response.status} for ${table}/${recordId}: ${detail}`);
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

  /**
   * One Airtable GET, spaced per base and retried on network errors, 429 and 5xx (honouring Retry-After).
   * Returns the final response, successful or not; callers map failures to their own messages.
   */
  private async fetchWithRetry(baseId: string, url: string, token: string, label: string): Promise<Response> {
    const timeoutMs = Number(process.env.AIRTABLE_REQUEST_TIMEOUT_MS ?? 10_000);
    const maxAttempts = positiveInteger(process.env.AIRTABLE_MAX_ATTEMPTS, 3);
    for (let attempt = 1; ; attempt += 1) {
      await this.throttle(baseId);
      let response: Response;
      try {
        response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        if (attempt < maxAttempts) { await sleep(backoffMs(attempt)); continue; }
        this.logger.warn(`Airtable request ${label} failed after ${attempt} attempts: ${errorName(error)}`);
        throw new BadGatewayException('Airtable could not be reached.');
      }
      if (response.ok) return response;
      if (isRetryable(response.status) && attempt < maxAttempts) {
        this.logger.warn(`Airtable ${response.status} ${label}; retrying.`);
        await responseText(response);
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      // Leave the body unread so the caller can include it in its own log line.
      return response;
    }
  }

  async updateRecord(baseId: string, table: string, recordId: string, fields: Record<string, unknown>): Promise<AirtableRecord> {
    return this.write(baseId, table, recordId, 'PATCH', { fields, typecast: true });
  }

  async createRecord(baseId: string, table: string, fields: Record<string, unknown>): Promise<AirtableRecord> {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Airtable is not configured.');
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    await this.throttle(baseId);
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true }),
      signal: AbortSignal.timeout(Number(process.env.AIRTABLE_REQUEST_TIMEOUT_MS ?? 10_000)),
    });
    if (!response.ok) {
      const detail = await responseText(response);
      this.logger.warn(`Airtable ${response.status} creating ${table}: ${detail}`);
      throw new ServiceUnavailableException('Airtable could not record the engagement event.');
    }
    return this.parseRecord(response);
  }

  async addComment(baseId: string, table: string, recordId: string, text: string): Promise<void> {
    await this.write(baseId, table, recordId, 'POST', { text: text.slice(0, 1_000) }, 'comments');
  }

  private async write(
    baseId: string,
    table: string,
    recordId: string,
    method: 'PATCH' | 'POST',
    body: Record<string, unknown>,
    suffix = '',
  ): Promise<AirtableRecord> {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Airtable is not configured.');
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}${suffix ? `/${suffix}` : ''}`;
    await this.throttle(baseId);
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.AIRTABLE_REQUEST_TIMEOUT_MS ?? 10_000)),
    });
    if (!response.ok) {
      const detail = await responseText(response);
      this.logger.warn(`Airtable ${response.status} writing ${table}/${recordId}: ${detail}`);
      if (response.status === 401 || response.status === 403) throw new ServiceUnavailableException('The Airtable token does not have write access to this base or table.');
      if (response.status === 404) throw new NotFoundException(`Airtable could not find the ${table} record.`);
      if (response.status === 422) throw new BadGatewayException(`Airtable rejected the ${table} update. Check the quotation acceptance fields.`);
      if (response.status === 429 || response.status >= 500) throw new ServiceUnavailableException('Airtable is temporarily unavailable. Try again shortly.');
      throw new BadGatewayException(`Airtable rejected the ${table} update (status ${response.status}).`);
    }
    if (suffix === 'comments') return { id: recordId, fields: {} };
    return this.parseRecord(response);
  }

  private async throttle(baseId: string): Promise<void> {
    const state = this.baseQueues.get(baseId) ?? { queue: Promise.resolve(), nextRequestAt: 0 };
    this.baseQueues.set(baseId, state);
    const previous = state.queue;
    let release: () => void = () => {};
    state.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const intervalMs = nonNegativeInteger(process.env.AIRTABLE_MIN_REQUEST_INTERVAL_MS, 220);
      await sleep(Math.max(0, state.nextRequestAt - Date.now()));
      state.nextRequestAt = Date.now() + intervalMs;
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

/** Same chunk size as the PHP client; keeps the OR(RECORD_ID()=...) formula URL well under Airtable's length limit. */
const RECORDS_PER_REQUEST = 30;

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
