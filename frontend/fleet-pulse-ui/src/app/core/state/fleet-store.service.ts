import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, forkJoin, of, tap, throwError, type Observable } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { FleetApiService } from '../http/fleet-api.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AlertRuleDto, FleetServiceDto, MetricEvent, MetricName, SnapshotResponse } from '../models/api.models';
import type { AlertRule, FleetService, FleetSummary, Incident, MetricPoint, SortDirection, SortKey } from '../models/ui.models';

const metricFlushIntervalMs = 250;

@Injectable({ providedIn: 'root' })
export class FleetStore {
  private readonly auth = inject(AuthService);
  private readonly api = inject(FleetApiService);
  readonly realtime = inject(RealtimeService);

  readonly services = signal<FleetService[]>([]);
  readonly rules = signal<AlertRule[]>([]);
  readonly ruleActionError = signal<string | null>(null);
  readonly serviceHistory = signal<Record<string, MetricPoint[]>>({});
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly statusFilter = signal<'all' | FleetService['status']>('all');
  readonly teamFilter = signal('all');
  readonly sortKey = signal<SortKey>('status');
  readonly sortDirection = signal<SortDirection>('desc');

  readonly eventOffset = computed(() => this.realtime.displayOffset());
  readonly lastEvent = computed(() => this.realtime.lastEventAt());
  readonly transport = computed(() => this.realtime.transport());
  readonly connectionStatus = computed(() => this.realtime.status());
  readonly stale = computed(() => this.realtime.status() === 'stale' || this.realtime.status() === 'disconnected');

  readonly teams = signal<string[]>([]);
  readonly filteredServices = computed(() => {
    const query = this.query().trim().toLowerCase();
    const status = this.statusFilter();
    const team = this.teamFilter();
    return this.services().filter((service) => {
      const matchesQuery = !query || `${service.name} ${service.team} ${service.region}`.toLowerCase().includes(query);
      const matchesStatus = status === 'all' || service.status === status;
      const matchesTeam = team === 'all' || service.team === team;
      return matchesQuery && matchesStatus && matchesTeam;
    });
  });
  readonly sortedServices = computed(() => {
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const key = this.sortKey();
    return [...this.filteredServices()].sort((first, second) => compare(sortValue(first, key), sortValue(second, key)) * direction);
  });
  readonly summary = computed<FleetSummary>(() => {
    const services = this.services();
    const total = services.length || 1;
    const healthy = services.filter((service) => service.status === 'healthy').length;
    const degraded = services.filter((service) => service.status === 'degraded').length;
    const down = services.filter((service) => service.status === 'down').length;
    const avgLatency = Math.round(services.reduce((sum, service) => sum + service.latency, 0) / total);
    const totalRps = Math.round(services.reduce((sum, service) => sum + service.rps, 0));
    const errorRate = services.reduce((sum, service) => sum + service.errorRate, 0) / total;
    return { total: services.length, healthy, degraded, down, avgLatency, totalRps, errorRate };
  });
  readonly incidents = computed<Incident[]>(() => [
    ...this.ruleIncidents(),
    ...this.services()
      .filter((service) => service.status !== 'healthy')
      .slice(0, 20)
      .map((service) => ({
        id: `inc-${service.id}`,
        service: service.name,
        message: service.status === 'down' ? 'Service is currently down' : `P95 ${service.latency}ms, errors ${service.errorRate.toFixed(2)}%`,
        severity: (service.status === 'down' ? 'critical' : service.errorRate > 2 ? 'warning' : 'info') as Incident['severity'],
        time: timeAgo(service.updatedAt),
      })),
  ]);
  readonly ruleIncidents = signal<Incident[]>([]);
  readonly latestRuleNotification = signal<string | null>(null);
  private readonly ruleStartTimes = new Map<string, number>();
  private readonly firingRuleKeys = new Set<string>();
  private readonly statusFlashDeadlines = new Map<string, number>();
  private readonly pendingMetricEvents: MetricEvent[] = [];
  private readonly serviceById = new Map<string, FleetService>();
  private readonly serviceIndexById = new Map<string, number>();
  private metricFlushTimer?: ReturnType<typeof setTimeout>;
  private statusFlashTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.auth.logout$.subscribe(() => this.realtime.disconnect());
  }

  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    forkJoin({ snapshot: this.api.snapshot(), rules: this.api.rules() })
      .pipe(
        tap(({ snapshot, rules }) => {
          const mappedServices = snapshot.services.map(mapService);
          this.services.set(mappedServices);
          this.replaceServiceIndex(mappedServices);
          this.teams.set(getTeams(mappedServices));
          this.rules.set(rules.items.map(mapRule));
          this.realtime.setOffset(snapshot.offset);
          const token = this.auth.accessToken();
          if (token) {
            this.realtime.connect(token, {
              onMetric: (event) => this.queueMetricEvent(event),
              onSnapshot: (freshSnapshot) => this.applySnapshot(freshSnapshot),
            }, snapshot.offset);
            this.realtime.seedSequences(snapshot.services);
          }
          this.error.set(null);
          this.loading.set(false);
        }),
        catchError((error: unknown) => {
          this.error.set(error instanceof Error ? error.message : 'Unable to load Fleet Pulse data.');
          this.loading.set(false);
          return of(null);
        }),
      )
      .subscribe();
  }

  setQuery(value: string): void {
    this.query.set(value);
  }

  setStatus(value: string): void {
    this.statusFilter.set(value as 'all' | FleetService['status']);
  }

  setTeam(value: string): void {
    this.teamFilter.set(value);
  }

  setSort(key: SortKey, direction: SortDirection): void {
    this.sortKey.set(key);
    this.sortDirection.set(direction);
  }

  setServiceHistory(serviceId: string, points: MetricPoint[]): void {
    const service = this.services().find((item) => item.id === serviceId);
    const latestPoint = service
      ? {
          ts: service.updatedAt.getTime(),
          p95: service.latency,
          errRate: service.errorRate,
          rps: service.rps,
          status: service.status,
        }
      : undefined;
    const merged = latestPoint && latestPoint.ts > (points[points.length - 1]?.ts ?? 0) ? [...points, latestPoint] : points;
    this.serviceHistory.update((history) => ({ ...history, [serviceId]: downsamplePoints(merged, 300) }));
  }

  sortBy(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('asc');
    }
  }

  createRule(rule: Omit<AlertRule, 'id' | 'enabled'>): Observable<AlertRuleDto> {
    this.ruleActionError.set(null);
    const optimisticId = `pending-${crypto.randomUUID()}`;
    const optimisticRule: AlertRule = { ...rule, id: optimisticId, enabled: true };
    this.rules.update((rules) => [optimisticRule, ...rules]);
    return this.api
      .createRule({
        name: rule.name,
        scope: rule.scope,
        enabled: true,
        idempotencyKey: crypto.randomUUID(),
        conditions: rule.conditions.map((condition) => ({
          metric: toApiMetric(condition.metric),
          operator: condition.comparator,
          threshold: condition.threshold,
          durationSec: condition.durationSec,
        })),
      })
      .pipe(
        tap((created) => this.rules.update((rules) => rules.map((item) => item.id === optimisticId ? mapRule(created) : item))),
        catchError((error: unknown) => {
          this.rules.update((rules) => rules.filter((item) => item.id !== optimisticId));
          return throwError(() => error);
        }),
      );
  }

  updateRule(rule: AlertRule): Observable<AlertRuleDto> {
    this.ruleActionError.set(null);
    const previous = this.rules().find((item) => item.id === rule.id);
    this.rules.update((rules) => rules.map((item) => item.id === rule.id ? rule : item));
    return this.api
      .updateRule(rule.id, {
        name: rule.name,
        scope: rule.scope,
        enabled: rule.enabled,
        conditions: rule.conditions.map((condition) => ({
          metric: toApiMetric(condition.metric),
          operator: condition.comparator,
          threshold: condition.threshold,
          durationSec: condition.durationSec,
        })),
      })
      .pipe(
        tap((updated) => this.rules.update((rules) => rules.map((item) => (item.id === rule.id ? mapRule(updated) : item)))),
        catchError((error: unknown) => {
          if (previous) this.rules.update((rules) => rules.map((item) => item.id === rule.id ? previous : item));
          return throwError(() => error);
        }),
      );
  }

  toggleRule(rule: AlertRule): void {
    this.ruleActionError.set(null);
    this.rules.update((rules) => rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item));
    this.api.updateRule(rule.id, { enabled: !rule.enabled }).subscribe((updated) => {
      this.rules.update((rules) => rules.map((item) => (item.id === rule.id ? mapRule(updated) : item)));
    }, () => {
      this.rules.update((rules) => rules.map((item) => item.id === rule.id ? rule : item));
      this.ruleActionError.set(`Unable to update alert rule "${rule.name}".`);
    });
  }

  deleteRule(ruleId: string): void {
    this.ruleActionError.set(null);
    const previous = this.rules();
    this.rules.update((rules) => rules.filter((rule) => rule.id !== ruleId));
    this.api.deleteRule(ruleId).subscribe(() => undefined, () => {
      this.rules.set(previous);
      this.ruleActionError.set('Unable to delete the alert rule. The previous rule list was restored.');
    });
  }

  private queueMetricEvent(event: MetricEvent): void {
    this.pendingMetricEvents.push(event);
    if (this.metricFlushTimer) return;
    this.metricFlushTimer = setTimeout(() => {
      this.metricFlushTimer = undefined;
      this.applyMetricEvents(this.pendingMetricEvents.splice(0));
    }, metricFlushIntervalMs);
  }

  private applySnapshot(snapshot: SnapshotResponse): void {
    const mappedServices = snapshot.services.map(mapService);
    this.services.set(mappedServices);
    this.replaceServiceIndex(mappedServices);
    this.teams.set(getTeams(mappedServices));
    this.realtime.setOffset(snapshot.offset);
    this.realtime.seedSequences(snapshot.services);
  }

  private replaceServiceIndex(services: FleetService[]): void {
    this.serviceById.clear();
    this.serviceIndexById.clear();
    for (const [index, service] of services.entries()) {
      this.serviceById.set(service.id, service);
      this.serviceIndexById.set(service.id, index);
    }
  }

  private applyMetricEvents(events: MetricEvent[]): void {
    const byService = new Map<string, MetricEvent[]>();
    for (const event of events) {
      const serviceEvents = byService.get(event.serviceId) ?? [];
      serviceEvents.push(event);
      byService.set(event.serviceId, serviceEvents);
    }
    const services = this.services();
    const nextServices = services.slice();
    const currentHistory = this.serviceHistory();
    let nextHistory: Record<string, MetricPoint[]> | undefined;
    const now = Date.now();
    for (const [serviceId, serviceEvents] of byService) {
      const service = this.serviceById.get(serviceId);
      const serviceIndex = this.serviceIndexById.get(serviceId);
      if (!service || serviceIndex === undefined) continue;

      const updated = applyServiceEvents(service, serviceEvents);
      this.serviceById.set(serviceId, updated);
      nextServices[serviceIndex] = updated;

      let observedStatus = service.status;
      const statusChanged = serviceEvents.some((event) => {
        const changed = observedStatus !== undefined && observedStatus !== event.status;
        observedStatus = event.status;
        return changed;
      });
      if (statusChanged) {
        this.statusFlashDeadlines.set(serviceId, now + 1000);
        this.scheduleStatusFlashCleanup();
      }
      if (currentHistory[serviceId]) {
        nextHistory ??= { ...currentHistory };
        nextHistory[serviceId] = appendMetricEvents(currentHistory[serviceId], serviceEvents);
      }
    }
    this.services.set(nextServices);
    if (nextHistory) this.serviceHistory.set(nextHistory);
    for (const event of events) this.evaluateRules(event);
  }

  private scheduleStatusFlashCleanup(): void {
    if (this.statusFlashTimer) return;
    const nextDeadline = Math.min(...this.statusFlashDeadlines.values());
    this.statusFlashTimer = setTimeout(() => {
      this.statusFlashTimer = undefined;
      const now = Date.now();
      const expiredIds = new Set<string>();
      for (const [serviceId, deadline] of this.statusFlashDeadlines) {
        if (deadline > now) continue;
        this.statusFlashDeadlines.delete(serviceId);
        expiredIds.add(serviceId);
      }
      if (expiredIds.size) {
        const services = this.services().slice();
        for (const serviceId of expiredIds) {
          const index = this.serviceIndexById.get(serviceId);
          const service = index === undefined ? undefined : services[index];
          if (index !== undefined && service?.statusChanged) services[index] = { ...service, statusChanged: false };
        }
        this.services.set(services);
      }
      if (this.statusFlashDeadlines.size) this.scheduleStatusFlashCleanup();
    }, Math.max(0, nextDeadline - Date.now()));
  }

  private evaluateRules(event: MetricEvent): void {
    const service = this.serviceById.get(event.serviceId);
    if (!service) return;
    for (const rule of this.rules()) {
      const incidentKey = `${rule.id}:${event.serviceId}`;
      const scope = rule.scope.trim().toLowerCase();
      const inScope = !scope || scope === 'global' || scope === 'all' || scope === '*' || scope === service.team.toLowerCase();
      const matches = rule.enabled && inScope && ruleMatchesEvent(rule, event);
      if (!matches) {
        this.ruleStartTimes.delete(incidentKey);
        continue;
      }
      const startedAt = this.ruleStartTimes.get(incidentKey) ?? event.ts;
      this.ruleStartTimes.set(incidentKey, startedAt);
      const durationSec = Math.max(...rule.conditions.map((condition) => condition.durationSec));
      if (!shouldFireRule(startedAt, event.ts, durationSec, this.firingRuleKeys.has(incidentKey))) continue;
      this.firingRuleKeys.add(incidentKey);
      this.ruleIncidents.update((incidents) => [
        {
          id: `rule-${incidentKey}`,
          service: service.name,
          message: `Alert rule "${rule.name}" fired`,
          severity: 'critical' as const,
          time: 'just now',
        },
        ...incidents.filter((incident) => incident.id !== `rule-${incidentKey}`),
      ].slice(0, 100));
      this.latestRuleNotification.set(`Alert rule "${rule.name}" fired for ${service.name}`);
    }
  }
}

export function mapService(service: FleetServiceDto): FleetService {
  return {
    id: service.id,
    name: service.name,
    team: service.team,
    region: service.region,
    status: service.status,
    latency: service.p95,
    errorRate: service.errRate,
    rps: service.rps,
    updatedAt: new Date(service.updatedAt),
    statusChanged: false,
    trend: {
      latency: [service.p95],
      errorRate: [service.errRate],
      throughput: [service.rps],
    },
  };
}

export function mapRule(rule: AlertRuleDto): AlertRule {
  return {
    id: rule.id,
    name: rule.name,
    conditions: rule.conditions.map((condition) => ({
      metric: condition.metric === 'errRate' ? 'error rate' : condition.metric === 'rps' ? 'throughput' : 'p95 latency',
      comparator: condition.operator,
      threshold: condition.threshold,
      durationSec: condition.durationSec,
    })),
    scope: rule.scope,
    enabled: rule.enabled,
  };
}

function toApiMetric(metric: AlertRule['conditions'][number]['metric']): MetricName {
  if (metric === 'error rate') return 'errRate';
  if (metric === 'throughput') return 'rps';
  return 'p95';
}

export function downsamplePoints(points: MetricPoint[], maxPoints = 300): MetricPoint[] {
  maxPoints = Math.max(2, Math.trunc(maxPoints));
  if (points.length === 0) return [];
  if (points.length <= maxPoints) return [...points];
  const bucketSize = (points.length - 2) / (maxPoints - 2);
  const reduced = [points[0]];
  for (let bucket = 0; bucket < maxPoints - 2; bucket++) {
    const start = 1 + Math.floor(bucket * bucketSize);
    const end = Math.min(points.length - 1, 1 + Math.floor((bucket + 1) * bucketSize));
    const selected = points.slice(start, Math.max(start + 1, end));
    const average = selected.reduce(
      (sum, point) => ({ p95: sum.p95 + point.p95, errRate: sum.errRate + point.errRate, rps: sum.rps + point.rps }),
      { p95: 0, errRate: 0, rps: 0 },
    );
    reduced.push({
      ...selected[selected.length - 1],
      p95: average.p95 / selected.length,
      errRate: average.errRate / selected.length,
      rps: average.rps / selected.length,
    });
  }

  reduced.push(points[points.length - 1]);
  return reduced;
}

export function ruleMatchesEvent(rule: AlertRule, event: MetricEvent): boolean {
  return rule.conditions.length > 0 && rule.conditions.every((condition) => {
    const value = condition.metric === 'p95 latency' ? event.p95 : condition.metric === 'error rate' ? event.errRate : event.rps;
    if (condition.comparator === '>') return value > condition.threshold;
    if (condition.comparator === '>=') return value >= condition.threshold;
    if (condition.comparator === '<') return value < condition.threshold;
    return value <= condition.threshold;
  });
}

export function shouldFireRule(startedAt: number, eventAt: number, durationSec: number, alreadyFired: boolean): boolean {
  return !alreadyFired && eventAt - startedAt >= durationSec * 1000;
}

function appendLimited(values: number[], value: number): number[] {
  return [...values.slice(-298), value];
}

function appendMetricEvents(values: MetricPoint[], events: MetricEvent[]): MetricPoint[] {
  return downsamplePoints(
    [...values, ...events.map((event) => ({
      ts: event.ts,
      p95: event.p95,
      errRate: event.errRate,
      rps: event.rps,
      status: event.status,
    }))],
    300,
  );
}

function applyServiceEvents(service: FleetService, events: MetricEvent[]): FleetService {
  let currentStatus: FleetService['status'] | undefined = service.status;
  let statusChanged = false;
  for (const event of events) {
    if (currentStatus !== undefined && currentStatus !== event.status) statusChanged = true;
    currentStatus = event.status;
  }
  const latest = events[events.length - 1];
  return {
    ...service,
    latency: latest.p95,
    errorRate: latest.errRate,
    rps: latest.rps,
    status: latest.status,
    statusChanged: statusChanged || service.statusChanged,
    updatedAt: new Date(latest.ts),
    trend: {
      latency: appendLimited(service.trend.latency, latest.p95),
      errorRate: appendLimited(service.trend.errorRate, latest.errRate),
      throughput: appendLimited(service.trend.throughput, latest.rps),
    },
  };
}

function getTeams(services: FleetService[]): string[] {
  return Array.from(new Set(services.map((service) => service.team))).sort();
}

const statusRank: Record<FleetService['status'], number> = { healthy: 1, degraded: 2, down: 3 };

function sortValue(service: FleetService, key: SortKey): string | number {
  if (key === 'latency') return service.latency;
  if (key === 'errorRate') return service.errorRate;
  if (key === 'updatedAt') return service.updatedAt.getTime();
  if (key === 'status') return statusRank[service.status];
  return service[key];
}

function compare(left: string | number, right: string | number): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function timeAgo(date: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
