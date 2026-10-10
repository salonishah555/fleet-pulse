export type Role = 'operator' | 'viewer';
export type ServiceStatus = 'healthy' | 'degraded' | 'down';
export type MetricName = 'p95' | 'errRate' | 'rps';
export type RuleOperator = '>' | '>=' | '<' | '<=';

export interface User {
  id: string;
  email: string;
  role: Role;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface FleetServiceDto {
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

export interface ServicesResponse {
  items: FleetServiceDto[];
  page: number;
  pageSize: number;
  total: number;
  teams: string[];
  regions: string[];
}

export interface FleetSummaryDto {
  total: number;
  healthy: number;
  degraded: number;
  down: number;
  avgP95: number;
  totalRps: number;
  avgErrRate: number;
}

export interface SnapshotResponse {
  offset: number;
  generatedAt: number;
  summary: FleetSummaryDto;
  services: FleetServiceDto[];
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

export type StreamEvent = MetricEvent | PingEvent;

export interface RuleCondition {
  metric: MetricName;
  operator: RuleOperator;
  threshold: number;
  durationSec: number;
}

export interface AlertRuleDto {
  id: string;
  name: string;
  conditions: RuleCondition[];
  scope: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AlertRulesResponse {
  items: AlertRuleDto[];
}
