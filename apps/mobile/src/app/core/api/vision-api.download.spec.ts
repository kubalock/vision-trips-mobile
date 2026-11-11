import { TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DocumentTooLargeError, MAX_DOCUMENT_BYTES, VisionApiService } from './vision-api.service';

describe('VisionApiService document downloads', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }));

  it('returns the document when it is within the limit', async () => {
    const download = TestBed.inject(VisionApiService).downloadDocument('confirmation', 'token');
    const request = TestBed.inject(HttpTestingController).expectOne((req) => req.url.endsWith('/documents/confirmation.pdf'));
    request.flush(new Blob(['%PDF'], { type: 'application/pdf' }), { headers: { 'content-length': '4' } });
    expect((await download).size).toBe(4);
  });

  it('aborts as soon as the declared size is over the limit', async () => {
    const download = TestBed.inject(VisionApiService).downloadDocument('supplier:x', 'token');
    const request = TestBed.inject(HttpTestingController).expectOne(() => true);
    request.event({ type: HttpEventType.ResponseHeader, headers: new (await import('@angular/common/http')).HttpHeaders({ 'content-length': String(MAX_DOCUMENT_BYTES + 1) }), status: 200, statusText: 'OK', url: '', ok: true } as never);

    await expect(download).rejects.toBeInstanceOf(DocumentTooLargeError);
    expect(request.cancelled).toBe(true);
  });

  it('aborts when the bytes received pass the limit without a declared size', async () => {
    const download = TestBed.inject(VisionApiService).downloadDocument('supplier:x', 'token');
    const request = TestBed.inject(HttpTestingController).expectOne(() => true);
    request.event({ type: HttpEventType.DownloadProgress, loaded: MAX_DOCUMENT_BYTES + 1 });

    await expect(download).rejects.toBeInstanceOf(DocumentTooLargeError);
    expect(request.cancelled).toBe(true);
  });
});
