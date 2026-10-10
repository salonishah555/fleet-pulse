import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, forkJoin, of, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { FleetApiService } from '../http/fleet-api.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AlertRuleDto, FleetServiceDto, MetricEvent, MetricName } from '../models/api.models';
import type { AlertRule, FleetService, FleetSummary, Incident, SortDirection, SortKey } from '../models/ui.models';

@Injectable({ providedIn: 'root' })
export class FleetStore {
  private readonly auth = inject(AuthService);
  private readonly api = inject(FleetApiService);
  readonly realtime = inject(RealtimeService);

  readonly services = signal<FleetService[]>([]);
  readonly rules = signal<AlertRule[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly statusFilter = signal<'all' | FleetService['status']>('all');
  readonly teamFilter = signal('all');
  readonly sortKey = signal<SortKey>('status');
  readonly sortDirection = signal<SortDirection>('desc');
  readonly page = signal(1);
  readonly pageSize = signal(14);

  readonly eventOffset = computed(() => this.realtime.offset());
  readonly lastEvent = computed(() => this.realtime.lastEventAt() ?? new Date());
  readonly transport = computed(() => this.realtime.transport());
  readonly connectionStatus = computed(() => this.realtime.status());
  readonly stale = computed(() => this.realtime.status() === 'stale' || this.realtime.status() === 'disconnected');

  readonly teams = computed(() => Array.from(new Set(this.services().map((service) => service.team))).sort());
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
  readonly visibleServices = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.sortedServices().slice(start, start + this.pageSize());
  });
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filteredServices().length / this.pageSize())));
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
  readonly incidents = computed<Incident[]>(() =>
    this.services()
      .filter((service) => service.status !== 'healthy')
      .slice(0, 20)
      .map((service) => ({
        id: `inc-${service.id}`,
        service: service.name,
        message: service.status === 'down' ? 'Service is currently down' : `P95 ${service.latency}ms, errors ${service.errorRate.toFixed(2)}%`,
        severity: service.status === 'down' ? 'critical' : service.errorRate > 2 ? 'warning' : 'info',
        time: timeAgo(service.updatedAt),
      })),
  );

  load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    forkJoin({ snapshot: this.api.snapshot(), rules: this.api.rules() })
      .pipe(
        tap(({ snapshot, rules }) => {
          this.services.set(snapshot.services.map(mapService));
          this.rules.set(rules.items.map(mapRule));
          this.realtime.offset.set(snapshot.offset);
          const token = this.auth.accessToken();
          if (token) this.realtime.connect(token, (event) => this.applyMetricEvent(event), snapshot.offset);
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
    this.page.set(1);
  }

  setStatus(value: string): void {
    this.statusFilter.set(value as 'all' | FleetService['status']);
    this.page.set(1);
  }

  setTeam(value: string): void {
    this.teamFilter.set(value);
    this.page.set(1);
  }

  sortBy(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDirection.update((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('asc');
    }
  }

  createRule(rule: Omit<AlertRule, 'id' | 'enabled'>): void {
    this.api
      .createRule({
        name: rule.name,
        scope: rule.scope,
        enabled: true,
        conditions: [{ metric: toApiMetric(rule.metric), operator: rule.comparator, threshold: rule.threshold, durationSec: 60 }],
      })
      .subscribe((created) => this.rules.update((rules) => [mapRule(created), ...rules]));
  }

  updateRule(rule: AlertRule): void {
    this.api
      .updateRule(rule.id, {
        name: rule.name,
        scope: rule.scope,
        enabled: rule.enabled,
        conditions: [{ metric: toApiMetric(rule.metric), operator: rule.comparator, threshold: rule.threshold, durationSec: 60 }],
      })
      .subscribe((updated) => this.rules.update((rules) => rules.map((item) => (item.id === rule.id ? mapRule(updated) : item))));
  }

  toggleRule(rule: AlertRule): void {
    this.api.updateRule(rule.id, { enabled: !rule.enabled }).subscribe((updated) => {
      this.rules.update((rules) => rules.map((item) => (item.id === rule.id ? mapRule(updated) : item)));
    });
  }

  deleteRule(ruleId: string): void {
    this.api.deleteRule(ruleId).subscribe(() => this.rules.update((rules) => rules.filter((rule) => rule.id !== ruleId)));
  }

  private applyMetricEvent(event: MetricEvent): void {
    this.services.update((services) =>
      services.map((service) =>
        service.id === event.serviceId
          ? {
              ...service,
              latency: event.p95,
              errorRate: event.errRate,
              rps: event.rps,
              status: event.status,
              updatedAt: new Date(event.ts),
              trend: [...service.trend.slice(1), event.p95],
            }
          : service,
      ),
    );
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
    trend: Array.from({ length: 28 }, (_value, point) => service.p95 + Math.round(Math.sin(point / 3) * 16)),
  };
}

export function mapRule(rule: AlertRuleDto): AlertRule {
  const condition = rule.conditions[0];
  return {
    id: rule.id,
    name: rule.name,
    metric: condition?.metric === 'errRate' ? 'error rate' : condition?.metric === 'rps' ? 'throughput' : 'p95 latency',
    comparator: condition?.operator === '<' || condition?.operator === '<=' ? '<' : '>',
    threshold: condition?.threshold ?? 0,
    scope: rule.scope,
    enabled: rule.enabled,
  };
}

function toApiMetric(metric: AlertRule['metric']): MetricName {
  if (metric === 'error rate') return 'errRate';
  if (metric === 'throughput') return 'rps';
  return 'p95';
}

function sortValue(service: FleetService, key: SortKey): string | number {
  const statusRank: Record<FleetService['status'], number> = { healthy: 1, degraded: 2, down: 3 };
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
