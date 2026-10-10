import { HttpClient, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resilienceInterceptor } from './resilience.interceptor';

describe('resilienceInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([resilienceInterceptor])), provideHttpClientTesting()],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('retries API GET requests for transient failures up to three times', async () => {
    const response = firstValueFrom(client.get('http://localhost:3000/metrics/snapshot'));

    http.expectOne('http://localhost:3000/metrics/snapshot').flush({}, { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(250);
    http.expectOne('http://localhost:3000/metrics/snapshot').flush({}, { status: 502, statusText: 'Bad Gateway' });
    await vi.advanceTimersByTimeAsync(500);
    http.expectOne('http://localhost:3000/metrics/snapshot').flush({}, { status: 504, statusText: 'Gateway Timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    http.expectOne('http://localhost:3000/metrics/snapshot').flush({ ok: true });

    await expect(response).resolves.toEqual({ ok: true });
  });

  it('honors Retry-After for HTTP 429 responses', async () => {
    const response = firstValueFrom(client.get('http://localhost:3000/services'));

    http.expectOne('http://localhost:3000/services').flush(
      {},
      { status: 429, statusText: 'Too Many Requests', headers: new HttpHeaders({ 'Retry-After': '2' }) },
    );
    await vi.advanceTimersByTimeAsync(1_999);
    http.expectNone('http://localhost:3000/services');
    await vi.advanceTimersByTimeAsync(1);
    http.expectOne('http://localhost:3000/services').flush({ items: [] });

    await expect(response).resolves.toEqual({ items: [] });
  });

  it('does not retry non-transient client errors', async () => {
    const response = firstValueFrom(client.get('http://localhost:3000/alert-rules')).catch((error: unknown) => error);

    http.expectOne('http://localhost:3000/alert-rules').flush({}, { status: 401, statusText: 'Unauthorized' });

    await expect(response).resolves.toBeTruthy();
    http.expectNone('http://localhost:3000/alert-rules');
  });

  it('does not blindly retry mutations', async () => {
    const response = firstValueFrom(client.post('http://localhost:3000/alert-rules', { name: 'Latency' })).catch((error: unknown) => error);

    http.expectOne('http://localhost:3000/alert-rules').flush({}, { status: 503, statusText: 'Unavailable' });

    await expect(response).resolves.toBeTruthy();
    http.expectNone('http://localhost:3000/alert-rules');
  });

  it('times out requests after 10 seconds', async () => {
    const response = firstValueFrom(client.get('http://localhost:3000/metrics/snapshot')).catch((error: unknown) => error);

    http.expectOne('http://localhost:3000/metrics/snapshot');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(response).resolves.toMatchObject({ name: 'TimeoutError' });
  });
});
