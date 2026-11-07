import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { AirtableService } from './airtable.service.js';

describe('AirtableService', () => {
  beforeEach(() => {
    process.env.AIRTABLE_TOKEN = 'test-token';
    process.env.AIRTABLE_MAX_ATTEMPTS = '3';
    process.env.AIRTABLE_MIN_REQUEST_INTERVAL_MS = '0';
    process.env.AIRTABLE_RETRY_BASE_MS = '0';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AIRTABLE_TOKEN;
    delete process.env.AIRTABLE_MAX_ATTEMPTS;
    delete process.env.AIRTABLE_MIN_REQUEST_INTERVAL_MS;
    delete process.env.AIRTABLE_RETRY_BASE_MS;
  });

  it('retries a rate-limited request and returns the record', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"error":"RATE_LIMIT_REACHED"}', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'recABCDEFGHIJKLMN', fields: { Name: 'Trip' } }), { status: 200 }));

    const record = await new AirtableService().record('appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN');

    expect(record.fields.Name).toBe('Trip');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports persistent rate limiting clearly', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('{"error":"RATE_LIMIT_REACHED"}', { status: 429, headers: { 'retry-after': '0' } }),
    );

    await expect(new AirtableService().record('appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN'))
      .rejects.toThrow('Airtable is rate limiting requests');
  });

  it('reports a schema mismatch for Airtable 422 responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":"INVALID_REQUEST"}', { status: 422 }));

    await expect(new AirtableService().record('appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN'))
      .rejects.toBeInstanceOf(BadGatewayException);
  });

  it('retries transient server failures before reporting unavailability', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('upstream failure', { status: 503 }));

    await expect(new AirtableService().record('appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('writes record fields and native comments', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'recABCDEFGHIJKLMN', fields: { 'Quotation Accepted': true } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'com123' }), { status: 200 }));
    const service = new AirtableService();

    await service.updateRecord('appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN', { 'Quotation Accepted': true });
    await service.addComment('appABCDEFGHIJKLMN', 'Bookings', 'recABCDEFGHIJKLMN', 'Accepted online');

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/Bookings/recABCDEFGHIJKLMN'), expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ fields: { 'Quotation Accepted': true }, typecast: true }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining('/Bookings/recABCDEFGHIJKLMN/comments'), expect.objectContaining({
      method: 'POST', body: JSON.stringify({ text: 'Accepted online' }),
    }));
  });

  it('searches a table using encoded formulas and selected fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ records: [{ id: 'recABCDEFGHIJKLMN', fields: { Trips: ['recNOPQRSTUVWXYZ1'] } }] }), { status: 200 }));
    const records = await new AirtableService().list('appABCDEFGHIJKLMN', 'Customers', { filterByFormula: "LOWER({Primary Email})='alex@example.com'", fields: ['Trips'], maxRecords: 20 });
    expect(records).toHaveLength(1);
    const request = fetchMock.mock.calls[0][0];
    const url = typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    expect(url).toContain('filterByFormula=');
    expect(url).toContain('fields%5B%5D=Trips');
    expect(url).not.toContain('alex@example.com');
  });
});
