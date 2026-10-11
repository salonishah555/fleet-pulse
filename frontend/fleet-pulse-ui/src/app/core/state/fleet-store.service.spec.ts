import { downsamplePoints, mapService, ruleMatchesEvent, shouldFireRule } from './fleet-store.service';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import type { MetricEvent } from '../models/api.models';
import type { AlertRule, MetricPoint } from '../models/ui.models';
import { AuthService } from '../auth/auth.service';
import { FleetApiService } from '../http/fleet-api.service';
import { RealtimeService } from '../realtime/realtime.service';
import { FleetStore } from './fleet-store.service';

describe('fleet stream processing helpers', () => {
  it('reduces history to at most 300 points while preserving endpoints', () => {
    const points: MetricPoint[] = Array.from({ length: 1000 }, (_value, index) => ({
      ts: index,
      p95: index,
      errRate: index / 10,
      rps: index * 2,
      status: 'healthy',
    }));

    const result = downsamplePoints(points);

    expect(result).toHaveLength(300);
    expect(result[0]).toEqual(points[0]);
    expect(result[result.length - 1]).toEqual(points[points.length - 1]);
  });

  it('evaluates all conditions and respects the rule duration and deduplication state', () => {
    const rule: AlertRule = {
      id: 'rule-1',
      name: 'Elevated checkout latency',
      scope: 'global',
      enabled: true,
      conditions: [
        { metric: 'p95 latency', comparator: '>=', threshold: 300, durationSec: 30 },
        { metric: 'error rate', comparator: '>', threshold: 2, durationSec: 30 },
      ],
    };
    const event: MetricEvent = {
      type: 'metric',
      offset: 2,
      serviceId: 'svc-1',
      seq: 2,
      ts: 40_000,
      p95: 400,
      errRate: 3,
      rps: 100,
      status: 'degraded',
    };

    expect(ruleMatchesEvent(rule, event)).toBe(true);
    expect(shouldFireRule(0, event.ts, 30, false)).toBe(true);
    expect(shouldFireRule(0, event.ts, 30, true)).toBe(false);
    expect(ruleMatchesEvent({ ...rule, conditions: [{ ...rule.conditions[0], threshold: 500 }] }, event)).toBe(false);
  });

  it('clears multiple service status flashes in one store update', () => {
    vi.useFakeTimers();
    let onMetric: ((event: MetricEvent) => void) | undefined;
    const services = Array.from({ length: 2000 }, (_value, index) => ({
      id: `svc-${index + 1}`,
      name: `service-${index + 1}`,
      team: 'Operations',
      region: 'us-east',
      status: 'healthy' as const,
      p95: 100,
      errRate: 0.1,
      rps: 10,
      updatedAt: Date.now(),
      seq: 1,
    }));
    const snapshot = {
      offset: 1,
      generatedAt: Date.now(),
      summary: { total: 2000, healthy: 2000, degraded: 0, down: 0, avgP95: 100, totalRps: 20_000, avgErrRate: 0.1 },
      services,
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { logout$: new Subject<void>(), accessToken: () => 'token' } },
        { provide: FleetApiService, useValue: { snapshot: () => of(snapshot), rules: () => of({ items: [] }) } },
        {
          provide: RealtimeService,
          useValue: {
            setOffset: vi.fn(),
            connect: (_token: string, callbacks: { onMetric?: (event: MetricEvent) => void }) => {
              onMetric = callbacks.onMetric;
            },
            seedSequences: vi.fn(),
            disconnect: vi.fn(),
          },
        },
      ],
    });

    const store = TestBed.inject(FleetStore);
    const set = vi.spyOn(store.services, 'set');
    store.load();
    const untouchedService = store.services()[1999];
    const updates: MetricEvent[] = [
      {
        type: 'metric',
        offset: 2,
        serviceId: 'svc-1',
        seq: 2,
        ts: Date.now(),
        p95: 120,
        errRate: 0.2,
        rps: 12,
        status: 'degraded',
      },
      {
        type: 'metric',
        offset: 3,
        serviceId: 'svc-1',
        seq: 3,
        ts: Date.now() + 1,
        p95: 130,
        errRate: 0.3,
        rps: 13,
        status: 'degraded',
      },
      {
        type: 'metric',
        offset: 4,
        serviceId: 'svc-2',
        seq: 2,
        ts: Date.now() + 2,
        p95: 120,
        errRate: 0.2,
        rps: 12,
        status: 'degraded',
      },
    ];
    for (const event of updates) {
      onMetric?.(event);
    }

    vi.advanceTimersByTime(250);
    expect(store.services()[0].statusChanged).toBe(true);
    expect(store.services()[0].latency).toBe(130);
    expect(store.services()[0].trend.latency).toEqual([100, 130]);
    expect(store.services()[1].statusChanged).toBe(true);
    expect(store.services()).toHaveLength(2000);
    expect(store.services()[1999]).toBe(untouchedService);
    expect(store.services()[1999].statusChanged).toBe(false);
    expect(set).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);

    expect(store.services().every((service) => !service.statusChanged)).toBe(true);
    expect(set).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('keeps the filtered and sorted service collection unpaginated for viewport virtualization', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { logout$: new Subject<void>(), accessToken: () => null } },
        { provide: FleetApiService, useValue: {} },
        { provide: RealtimeService, useValue: { disconnect: vi.fn() } },
      ],
    });
    const store = TestBed.inject(FleetStore);
    store.services.set(Array.from({ length: 205 }, (_value, index) => mapService({
      id: `svc-${index + 1}`,
      name: `service-${index + 1}`,
      team: 'operations',
      region: 'us-east',
      status: 'healthy',
      p95: 100,
      errRate: 0.1,
      rps: 10,
      updatedAt: 1_800_000_000_000,
    })));

    expect(store.sortedServices()).toHaveLength(205);
    expect(store.sortedServices()[0].id).toBe('svc-1');

    store.setQuery('does-not-exist');
    expect(store.sortedServices()).toHaveLength(0);
  });
});
