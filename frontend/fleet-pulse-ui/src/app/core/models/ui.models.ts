import type { ServiceStatus } from './api.models';

export type SortKey = 'name' | 'team' | 'status' | 'latency' | 'errorRate' | 'rps' | 'updatedAt';
export type SortDirection = 'asc' | 'desc';

export interface FleetService {
  id: string;
  name: string;
  team: string;
  region: string;
  status: ServiceStatus;
  latency: number;
  errorRate: number;
  rps: number;
  updatedAt: Date;
  statusChanged: boolean;
  trend: {
    latency: number[];
    errorRate: number[];
    throughput: number[];
  };
}

export interface MetricPoint {
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
  status: ServiceStatus;
}

export interface FleetSummary {
  total: number;
  healthy: number;
  degraded: number;
  down: number;
  avgLatency: number;
  totalRps: number;
  errorRate: number;
}

export interface Incident {
  id: string;
  service: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  time: string;
}

export interface AlertRule {
  id: string;
  name: string;
  conditions: {
    metric: 'p95 latency' | 'error rate' | 'throughput';
    comparator: '>' | '>=' | '<' | '<=';
    threshold: number;
    durationSec: number;
  }[];
  scope: string;
  enabled: boolean;
}
