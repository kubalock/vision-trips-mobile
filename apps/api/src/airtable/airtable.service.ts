import { BadGatewayException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: Record<string, unknown>;
}

@Injectable()
export class AirtableService {
  records(baseId: string, table: string, recordIds: string[]): Promise<AirtableRecord[]> {
    return Promise.all([...new Set(recordIds)].filter(isRecordId).map((id) => this.record(baseId, table, id)));
  }

  async record(baseId: string, table: string, recordId: string): Promise<AirtableRecord> {
    const token = process.env.AIRTABLE_TOKEN;
    if (!token) throw new ServiceUnavailableException('Airtable is not configured.');

    const timeoutMs = Number(process.env.AIRTABLE_REQUEST_TIMEOUT_MS ?? 10_000);
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BadGatewayException('Airtable could not be reached.');
    }
    if (response.status === 404) throw new NotFoundException('Trip not found.');
    if (!response.ok) throw new BadGatewayException('Airtable returned an unexpected response.');
    return (await response.json()) as AirtableRecord;
  }
}

function isRecordId(value: string): boolean {
  return /^rec[A-Za-z0-9]{14}$/.test(value);
}
