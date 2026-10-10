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
    const services = ['svc-1', 'svc-2'].map((id) => ({
      id,
      name: id,
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
      summary: { total: 2, healthy: 2, degraded: 0, down: 0, avgP95: 100, totalRps: 20, avgErrRate: 0.1 },
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
    const update = vi.spyOn(store.services, 'update');
    store.load();
    for (const [index, service] of services.entries()) {
      onMetric?.({
        type: 'metric',
        offset: index + 2,
        serviceId: service.id,
        seq: 2,
        ts: Date.now(),
        p95: 120,
        errRate: 0.2,
        rps: 12,
        status: 'degraded',
      });
    }

    vi.advanceTimersByTime(250);
    expect(store.services().every((service) => service.statusChanged)).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);

    expect(store.services().every((service) => !service.statusChanged)).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('keeps a virtualized service window aligned to the filtered list and clamps invalid page requests', () => {
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

    store.setPage(3);

    expect(store.pageCount()).toBe(3);
    expect(store.currentPage()).toBe(3);
    expect(store.pageRangeStart()).toBe(201);
    expect(store.pageRangeEnd()).toBe(205);
    expect(store.visibleServices()).toHaveLength(40);
    expect(store.visibleServices()[0].id).toBe('svc-1');

    store.setWindowStart(80);
    expect(store.visibleServices()[0].id).toBe('svc-81');
    expect(store.visibleServices()).toHaveLength(40);

    store.setPage(99);
    expect(store.currentPage()).toBe(3);

    store.setQuery('does-not-exist');
    expect(store.page()).toBe(1);
    expect(store.pageCount()).toBe(1);
    expect(store.pageRangeStart()).toBe(0);
    expect(store.pageRangeEnd()).toBe(0);
    expect(store.visibleServices()).toHaveLength(0);
  });
});
