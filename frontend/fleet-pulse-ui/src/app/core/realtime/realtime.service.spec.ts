import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FleetApiService } from '../http/fleet-api.service';
import type { MetricEvent, SnapshotResponse } from '../models/api.models';
import { FleetSettingsService } from '../settings/fleet-settings.service';
import { RealtimeService } from './realtime.service';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  fail(): void {
    this.onerror?.();
  }

  send(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, (message: { data: string }) => void>();
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, callback: (message: { data: string }) => void): void {
    this.listeners.set(type, callback);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  send(type: string, data: string): void {
    this.listeners.get(type)?.({ data });
  }

  fail(): void {
    this.onerror?.();
  }
}

describe('RealtimeService', () => {
  let service: RealtimeService;
  let api: {
    snapshot: ReturnType<typeof vi.fn>;
    replay: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem('fleet-pulse-settings');
    FakeWebSocket.instances = [];
    FakeEventSource.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubGlobal('EventSource', FakeEventSource);
    api = {
      snapshot: vi.fn().mockReturnValue(of(snapshot(12))),
      replay: vi.fn().mockReturnValue(of({ since: 1, latestOffset: 3, items: [metric(2), metric(3)] })),
    };
    TestBed.configureTestingModule({
      providers: [RealtimeService, { provide: FleetApiService, useValue: api }],
    });
    service = TestBed.inject(RealtimeService);
  });

  afterEach(() => {
    service.disconnect();
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.removeItem('fleet-pulse-settings');
  });

  it('uses WebSocket first and falls back to SSE after the connect timeout', () => {
    service.connect('token', vi.fn(), 7);
    expect(service.transport()).toBe('WebSocket');
    expect(FakeWebSocket.instances[0].url).toContain('ws://localhost:4000/stream');
    expect(FakeWebSocket.instances[0].url).toContain('since=7');

    vi.advanceTimersByTime(5_000);

    expect(service.transport()).toBe('SSE');
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain('http://localhost:4000/stream/sse');
    expect(FakeEventSource.instances[0].url).toContain('/stream/sse');
  });

  it('switches to SSE after three WebSocket failures and polls after three SSE failures', () => {
    service.connect('token', vi.fn());
    FakeWebSocket.instances[0].fail();
    vi.advanceTimersByTime(1_000);
    FakeWebSocket.instances[1].fail();
    vi.advanceTimersByTime(2_000);
    FakeWebSocket.instances[2].fail();
    expect(service.transport()).toBe('SSE');

    FakeEventSource.instances[0].fail();
    vi.advanceTimersByTime(1_000);
    FakeEventSource.instances[1].fail();
    vi.advanceTimersByTime(2_000);
    FakeEventSource.instances[2].fail();

    expect(service.transport()).toBe('Polling');
    expect(api.snapshot).toHaveBeenCalledOnce();
    expect(service.offset()).toBe(12);
  });

  it('repairs out-of-order events, suppresses duplicates, and reports malformed input', () => {
    const onMetric = vi.fn();
    service.connect('token', onMetric, 1);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.send(metric(3));

    expect(api.replay).toHaveBeenCalledWith(1);
    expect(onMetric.mock.calls.map(([event]) => event.offset)).toEqual([2, 3]);
    socket.send(metric(3));
    socket.onmessage?.({ data: '{bad-json' });

    expect(service.offset()).toBe(3);
    expect(service.duplicateCount()).toBe(1);
    expect(service.malformedCount()).toBe(1);
    expect(service.gapCount()).toBe(1);
    expect(onMetric).toHaveBeenCalledTimes(2);
  });

  it('detects a per-service sequence gap and refreshes the authoritative snapshot', () => {
    const onSnapshot = vi.fn();
    service.connect('token', { onMetric: vi.fn(), onSnapshot }, 10);
    service.seedSequences([{ id: 'svc-1', seq: 4 }]);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.send({ ...metric(11), seq: 6 });

    expect(service.sequenceGapCount()).toBe(1);
    expect(api.snapshot).toHaveBeenCalledOnce();
    expect(onSnapshot).toHaveBeenCalledOnce();
  });

  it('applies saved stale and polling intervals to connection health and polling', () => {
    TestBed.inject(FleetSettingsService).save({
      refreshIntervalSec: 10,
      staleAfterSec: 5,
      colorScheme: 'dark',
    });
    TestBed.flushEffects();
    service.connect('token', vi.fn());
    service.seedSequences([]);
    vi.advanceTimersByTime(5_000);
    FakeEventSource.instances[0].fail();
    vi.advanceTimersByTime(1_000);
    FakeEventSource.instances[1].fail();
    vi.advanceTimersByTime(2_000);
    FakeEventSource.instances[2].fail();

    vi.advanceTimersByTime(4_999);
    expect(service.status()).toBe('live');
    vi.advanceTimersByTime(1);
    expect(service.status()).toBe('stale');
    vi.advanceTimersByTime(5_000);
    expect(api.snapshot).toHaveBeenCalledTimes(2);
  });

  it('counts malformed SSE events reported by the backend', () => {
    service.connect('token', vi.fn());
    vi.advanceTimersByTime(5_000);
    const source = FakeEventSource.instances[0];
    source.open?.();
    source.send('malformed', '{bad-json');

    expect(service.malformedCount()).toBe(1);
  });

  it('holds out-of-order events for at most one second and marks unresolved gaps', () => {
    api.replay.mockReturnValueOnce(of({ since: 1, latestOffset: 1, items: [] }));
    const onMetric = vi.fn();
    service.connect('token', onMetric, 1);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.send(metric(4));
    expect(onMetric).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);

    expect(onMetric).toHaveBeenCalledOnce();
    expect(service.offset()).toBe(4);
    expect(service.gapCount()).toBe(1);
  });

  it('refreshes the snapshot when replay reports an expired offset', () => {
    api.replay.mockReturnValueOnce(throwError(() => ({ status: 410 })));
    const onSnapshot = vi.fn();
    service.connect('token', { onMetric: vi.fn(), onSnapshot }, 1);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.send(metric(3));

    expect(api.snapshot).toHaveBeenCalledOnce();
    expect(onSnapshot).toHaveBeenCalledOnce();
    expect(service.offset()).toBe(12);
  });

  it('closes transports while offline and reconnects with WebSocket when online', () => {
    service.connect('token', vi.fn());
    const socket = FakeWebSocket.instances[0];
    window.dispatchEvent(new Event('offline'));

    expect(socket.closed).toBe(true);
    expect(service.status()).toBe('stale');
    expect(FakeWebSocket.instances).toHaveLength(1);

    window.dispatchEvent(new Event('online'));

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(service.transport()).toBe('WebSocket');
  });

  it('treats ping frames as heartbeat activity and marks a silent connection stale', () => {
    service.connect('token', vi.fn());
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.send({ type: 'ping', ts: Date.now() });
    vi.advanceTimersByTime(9_999);
    expect(service.status()).toBe('live');

    vi.advanceTimersByTime(1);

    expect(service.status()).toBe('stale');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('probes for WebSocket recovery while polling and stops polling when it succeeds', () => {
    service.connect('token', vi.fn());
    vi.advanceTimersByTime(5_000);
    FakeEventSource.instances[0].fail();
    vi.advanceTimersByTime(1_000);
    FakeEventSource.instances[1].fail();
    vi.advanceTimersByTime(2_000);
    FakeEventSource.instances[2].fail();
    expect(service.transport()).toBe('Polling');

    vi.advanceTimersByTime(15_000);

    const recoverySocket = FakeWebSocket.instances.at(-1)!;
    recoverySocket.open();
    expect(service.transport()).toBe('WebSocket');
    expect(FakeEventSource.instances[2].closed).toBe(true);
  });
});

function metric(offset: number): MetricEvent {
  return {
    type: 'metric',
    offset,
    serviceId: 'svc-1',
    seq: offset,
    ts: offset * 100,
    p95: 200,
    errRate: 1,
    rps: 20,
    status: 'healthy',
  };
}

function snapshot(offset: number): SnapshotResponse {
  return {
    offset,
    generatedAt: Date.now(),
    summary: { total: 0, healthy: 0, degraded: 0, down: 0, avgP95: 0, totalRps: 0, avgErrRate: 0 },
    services: [],
  };
}
