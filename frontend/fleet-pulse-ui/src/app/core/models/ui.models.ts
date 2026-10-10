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
  trend: number[];
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
  metric: 'p95 latency' | 'error rate' | 'throughput';
  comparator: '>' | '<';
  threshold: number;
  scope: string;
  enabled: boolean;
}
