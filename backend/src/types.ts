export type Role = 'operator' | 'viewer';
export type ServiceStatus = 'healthy' | 'degraded' | 'down';
export type MetricName = 'p95' | 'errRate' | 'rps';
export type RuleOperator = '>' | '>=' | '<' | '<=';

export interface User {
  id: string;
  email: string;
  role: Role;
}

export interface FleetService {
  id: string;
  name: string;
  team: string;
  region: string;
  status: ServiceStatus;
  p95: number;
  errRate: number;
  rps: number;
  updatedAt: number;
}

export interface MetricEvent {
  type: 'metric';
  offset: number;
  serviceId: string;
  seq: number;
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
  status: ServiceStatus;
}

export interface PingEvent {
  type: 'ping';
  ts: number;
}

export interface RuleCondition {
  metric: MetricName;
  operator: RuleOperator;
  threshold: number;
  durationSec: number;
  [key: string]: unknown;
}

export interface AlertRule {
  id: string;
  name: string;
  conditions: RuleCondition[];
  scope: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface ChaosState {
  rate: number;
  ws?: 'down' | 'silent';
  sse?: 'down';
  chaos: string[];
  token_ttl: number;
  http?: string;
  kill?: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown[];
  };
}
