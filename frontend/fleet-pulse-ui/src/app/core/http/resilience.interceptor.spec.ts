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
    const response = firstValueFrom(client.get('http://localhost:4000/metrics/snapshot'));

    http.expectOne('http://localhost:4000/metrics/snapshot').flush({}, { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(250);
    http.expectOne('http://localhost:4000/metrics/snapshot').flush({}, { status: 502, statusText: 'Bad Gateway' });
    await vi.advanceTimersByTimeAsync(500);
    http.expectOne('http://localhost:4000/metrics/snapshot').flush({}, { status: 504, statusText: 'Gateway Timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    http.expectOne('http://localhost:4000/metrics/snapshot').flush({ ok: true });

    await expect(response).resolves.toEqual({ ok: true });
  });

  it('honors Retry-After for HTTP 429 responses', async () => {
    const response = firstValueFrom(client.get('http://localhost:4000/services'));

    http.expectOne('http://localhost:4000/services').flush(
      {},
      { status: 429, statusText: 'Too Many Requests', headers: new HttpHeaders({ 'Retry-After': '2' }) },
    );
    await vi.advanceTimersByTimeAsync(1_999);
    http.expectNone('http://localhost:4000/services');
    await vi.advanceTimersByTimeAsync(1);
    http.expectOne('http://localhost:4000/services').flush({ items: [] });

    await expect(response).resolves.toEqual({ items: [] });
  });

  it('does not retry non-transient client errors', async () => {
    const response = firstValueFrom(client.get('http://localhost:4000/alert-rules')).catch((error: unknown) => error);

    http.expectOne('http://localhost:4000/alert-rules').flush({}, { status: 401, statusText: 'Unauthorized' });

    await expect(response).resolves.toBeTruthy();
    http.expectNone('http://localhost:4000/alert-rules');
  });

  it('does not blindly retry mutations', async () => {
    const response = firstValueFrom(client.post('http://localhost:4000/alert-rules', { name: 'Latency' })).catch((error: unknown) => error);

    http.expectOne('http://localhost:4000/alert-rules').flush({}, { status: 503, statusText: 'Unavailable' });

    await expect(response).resolves.toBeTruthy();
    http.expectNone('http://localhost:4000/alert-rules');
  });

  it('retries an idempotent rule POST after a transient failure', async () => {
    const response = firstValueFrom(
      client.post('http://localhost:4000/rules', { name: 'Latency' }, { headers: { 'Idempotency-Key': 'request-1' } }),
    );

    http.expectOne('http://localhost:4000/rules').flush({}, { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(250);
    const retry = http.expectOne('http://localhost:4000/rules');
    expect(retry.request.headers.get('Idempotency-Key')).toBe('request-1');
    retry.flush({ id: 'rule-1' });

    await expect(response).resolves.toEqual({ id: 'rule-1' });
  });

  it('retries timed-out GET requests with backoff and applies the 10-second timeout per attempt', async () => {
    const response = firstValueFrom(client.get('http://localhost:4000/metrics/snapshot'));

    http.expectOne('http://localhost:4000/metrics/snapshot');
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(250);
    http.expectOne('http://localhost:4000/metrics/snapshot');
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(500);
    http.expectOne('http://localhost:4000/metrics/snapshot');
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(1_000);
    http.expectOne('http://localhost:4000/metrics/snapshot').flush({ ok: true });

    await expect(response).resolves.toEqual({ ok: true });
  });
});
