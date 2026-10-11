import { ApiError, notFound } from './errors.js';
import type { AlertRule, FleetService, MetricEvent, MetricName, RuleOperator, ServiceStatus } from './types.js';

export interface ServiceQuery {
  q?: string;
  status?: ServiceStatus | 'all';
  team?: string;
  region?: string;
  sort?: keyof FleetService;
  direction?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface MetricPoint {
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
  status: ServiceStatus;
}

const teams = ['Platform', 'Dispatch', 'Routing', 'Payments', 'Telemetry', 'Mobile', 'Data'];
const regions = ['us-east', 'us-west', 'eu-central', 'ap-south'];
const prefixes = ['routing-core', 'dispatch-api', 'driver-mobile', 'payments-ledger', 'fleet-ingest', 'telemetry-edge'];
const replayRetentionMs = 5 * 60_000;
const historyLimit = 720;

let offset = 184_239;
let oldestAvailableOffset = offset + 1;
const services = createServices();
const serviceSeq = new Map(services.map((service) => [service.id, 0]));
const replay: MetricEvent[] = [];
let replayStart = 0;
const history = new Map<string, MetricPoint[]>();
const rules = new Map<string, AlertRule>();

seedRules();
for (const service of services) {
  history.set(service.id, [{ ts: service.updatedAt, p95: service.p95, errRate: service.errRate, rps: service.rps, status: service.status }]);
}

export function listServices(query: ServiceQuery) {
  const needle = query.q?.trim().toLowerCase() ?? '';
  let items = services.filter((service) => {
    const queryMatch = !needle || `${service.name} ${service.team} ${service.region}`.toLowerCase().includes(needle);
    const statusMatch = !query.status || query.status === 'all' || service.status === query.status;
    const teamMatch = !query.team || query.team === 'all' || service.team === query.team;
    const regionMatch = !query.region || query.region === 'all' || service.region === query.region;
    return queryMatch && statusMatch && teamMatch && regionMatch;
  });

  const sort = query.sort ?? 'status';
  const direction = query.direction === 'asc' ? 1 : -1;
  items = [...items].sort((left, right) => compare(sortValue(left, sort), sortValue(right, sort)) * direction);
  const total = items.length;
  const start = (query.page - 1) * query.pageSize;
  return { items: items.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total, teams, regions };
}

export function getSnapshot() {
  const total = services.length;
  const healthy = services.filter((service) => service.status === 'healthy').length;
  const degraded = services.filter((service) => service.status === 'degraded').length;
  const down = services.filter((service) => service.status === 'down').length;
  const avgP95 = Math.round(services.reduce((sum, service) => sum + service.p95, 0) / total);
  const totalRps = Math.round(services.reduce((sum, service) => sum + service.rps, 0));
  const avgErrRate = Number((services.reduce((sum, service) => sum + service.errRate, 0) / total).toFixed(2));
  return {
    offset,
    generatedAt: Date.now(),
    summary: { total, healthy, degraded, down, avgP95, totalRps, avgErrRate },
    services: services.map((service) => ({ ...service, seq: serviceSeq.get(service.id) ?? 0 })),
  };
}

export function getHistory(serviceId: string, minutes: number) {
  if (!serviceSeq.has(serviceId)) {
    throw notFound('Service not found');
  }
  const cutoff = Date.now() - minutes * 60_000;
  const points = (history.get(serviceId) ?? []).filter((point) => point.ts >= cutoff);
  return { serviceId, minutes, points, items: points };
}

export function getReplay(since: number) {
  pruneReplay(Date.now());
  if (since < oldestAvailableOffset - 1) {
    throw new ApiError(410, 'replay_too_old', 'Requested metric history is no longer available');
  }
  return { since, latestOffset: offset, items: replay.slice(replayStart).filter((event) => event.offset > since) };
}

export function nextMetricEvent(now = Date.now()): MetricEvent {
  const index = offset % services.length;
  const service = services[index];
  const seq = (serviceSeq.get(service.id) ?? 0) + 1;
  serviceSeq.set(service.id, seq);
  const p95 = clamp(Math.round(service.p95 + wave(index, 38, now)), 35, 950);
  const errRate = clamp(Number((service.errRate + wave(index + 4, 0.28, now)).toFixed(2)), 0, 8);
  const rps = clamp(Math.round(service.rps + wave(index + 9, 10, now)), 4, 780);
  const status = deriveStatus(p95, errRate, service.status);

  Object.assign(service, { p95, errRate, rps, status, updatedAt: now });
  const event: MetricEvent = { type: 'metric', offset: ++offset, serviceId: service.id, seq, ts: now, p95, errRate, rps, status };
  if (replayStart === replay.length) oldestAvailableOffset = event.offset;
  replay.push(event);
  pruneReplay(now);
  const points = history.get(service.id) ?? [];
  points.push({ ts: now, p95, errRate, rps, status });
  if (points.length > historyLimit) {
    points.splice(0, points.length - historyLimit);
  }
  history.set(service.id, points);
  return event;
}

function pruneReplay(now: number): void {
  const cutoff = now - replayRetentionMs;
  while (replayStart < replay.length && replay[replayStart].ts < cutoff) {
    oldestAvailableOffset = replay[replayStart].offset + 1;
    replayStart += 1;
  }
  if (replayStart >= 100_000 && replayStart * 2 >= replay.length) {
    replay.splice(0, replayStart);
    replayStart = 0;
  }
}

export function listRules(): AlertRule[] {
  return [...rules.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getRule(id: string): AlertRule {
  const rule = rules.get(id);
  if (!rule) {
    throw notFound('Alert rule not found');
  }
  return rule;
}

export function validateRuleName(name: string, excludeId?: string) {
  const normalized = name.trim().toLowerCase();
  const available = normalized.length >= 3 && ![...rules.values()].some((rule) => rule.id !== excludeId && rule.name.toLowerCase() === normalized);
  return { name, available };
}

export function createRule(input: RuleInput, id?: string): AlertRule {
  ensureUniqueRuleName(input.name);
  const ruleId = id?.trim() || `rule-${cryptoRandom()}`;
  if (rules.has(ruleId)) {
    throw new ApiError(409, 'duplicate_rule_id', 'Rule id is already in use');
  }
  const now = Date.now();
  const rule: AlertRule = {
    id: ruleId,
    name: input.name.trim(),
    conditions: input.conditions,
    scope: input.scope.trim(),
    enabled: input.enabled ?? true,
    createdAt: now,
    updatedAt: now,
  };
  rules.set(rule.id, rule);
  return rule;
}

export function updateRule(id: string, input: Partial<RuleInput>): AlertRule {
  const current = rules.get(id);
  if (!current) {
    throw notFound('Alert rule not found');
  }
  if (input.name && input.name.trim().toLowerCase() !== current.name.toLowerCase()) {
    ensureUniqueRuleName(input.name, id);
  }
  const updated: AlertRule = {
    ...current,
    name: input.name?.trim() ?? current.name,
    conditions: input.conditions ?? current.conditions,
    scope: input.scope?.trim() ?? current.scope,
    enabled: input.enabled ?? current.enabled,
    updatedAt: Date.now(),
  };
  rules.set(id, updated);
  return updated;
}

export function deleteRule(id: string): void {
  if (!rules.delete(id)) {
    throw notFound('Alert rule not found');
  }
}

export interface RuleInput {
  name: string;
  conditions: { metric: MetricName; operator: RuleOperator; threshold: number; durationSec: number }[];
  scope: string;
  enabled?: boolean;
}

function ensureUniqueRuleName(name: string, excludeId?: string): void {
  if (!validateRuleName(name, excludeId).available) {
    throw new ApiError(409, 'duplicate_rule_name', 'Rule name is already in use');
  }
}

function createServices(): FleetService[] {
  return Array.from({ length: 2000 }, (_, index) => {
    const team = teams[index % teams.length];
    const region = regions[index % regions.length];
    const base = 60 + (index % 17) * 18;
    const status: ServiceStatus = index % 41 === 0 ? 'down' : index % 11 === 0 || base > 300 ? 'degraded' : 'healthy';
    const errRate = Number(((index % 23) / 14 + (status === 'down' ? 3.1 : 0)).toFixed(2));
    return {
      id: `svc-${String(index + 1).padStart(4, '0')}`,
      name: `${prefixes[index % prefixes.length]}-${String(index + 1).padStart(3, '0')}`,
      team,
      region,
      status,
      p95: status === 'down' ? base + 360 : base,
      errRate,
      rps: 24 + (index % 67) * 6,
      updatedAt: Date.now() - (index % 90) * 1000,
    };
  });
}

function seedRules(): void {
  createRule({ name: 'Latency breach', scope: 'all teams', enabled: true, conditions: [{ metric: 'p95', operator: '>', threshold: 420, durationSec: 60 }] });
  createRule({ name: 'Payment errors', scope: 'Payments', enabled: true, conditions: [{ metric: 'errRate', operator: '>', threshold: 2.4, durationSec: 60 }] });
  createRule({ name: 'Traffic drought', scope: 'Dispatch', enabled: false, conditions: [{ metric: 'rps', operator: '<', threshold: 20, durationSec: 120 }] });
}

function sortValue(service: FleetService, sort: keyof FleetService): string | number {
  const statusRank: Record<ServiceStatus, number> = { healthy: 1, degraded: 2, down: 3 };
  return sort === 'status' ? statusRank[service.status] : service[sort];
}

function compare(left: string | number, right: string | number): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deriveStatus(p95: number, errRate: number, fallback: ServiceStatus): ServiceStatus {
  if (errRate > 5.5 || p95 > 760) return 'down';
  if (errRate > 2.1 || p95 > 420) return 'degraded';
  if (fallback === 'down' && p95 > 620) return 'down';
  return 'healthy';
}

function wave(seed: number, scale: number, now: number): number {
  return Math.sin((now / 1000 + seed) * 0.9) * scale;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10);
}
