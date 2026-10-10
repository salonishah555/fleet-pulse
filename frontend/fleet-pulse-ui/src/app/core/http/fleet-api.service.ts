import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AlertRuleDto, AlertRulesResponse, MetricEvent, ServicesResponse, ServiceStatus, SnapshotResponse } from '../models/api.models';

const apiBaseUrl = 'http://localhost:4000';

export interface ServiceListParams {
  q?: string;
  status?: ServiceStatus | 'all';
  team?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface RuleInput {
  name: string;
  scope: string;
  enabled?: boolean;
  conditions: AlertRuleDto['conditions'];
}

export interface MetricHistoryPoint {
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
  status: ServiceStatus;
}

export interface MetricHistoryResponse {
  serviceId: string;
  minutes: number;
  points?: MetricHistoryPoint[];
  items?: MetricHistoryPoint[];
}

@Injectable({ providedIn: 'root' })
export class FleetApiService {
  private readonly http = inject(HttpClient);

  services(params: ServiceListParams) {
    return this.http.get<ServicesResponse>(`${apiBaseUrl}/services`, { params: toParams(params) });
  }

  snapshot() {
    return this.http.get<SnapshotResponse>(`${apiBaseUrl}/metrics/snapshot`);
  }

  rules() {
    return this.http.get<AlertRulesResponse>(`${apiBaseUrl}/rules`);
  }

  rule(id: string) {
    return this.http.get<AlertRuleDto>(`${apiBaseUrl}/rules/${encodeURIComponent(id)}`);
  }

  history(serviceId: string, minutes = 15) {
    return this.http.get<MetricHistoryResponse>(
      `${apiBaseUrl}/metrics/history`,
      { params: new HttpParams().set('serviceId', serviceId).set('minutes', minutes) },
    );
  }

  replay(since: number) {
    return this.http.get<{ since: number; latestOffset: number; items: MetricEvent[] }>(`${apiBaseUrl}/metrics/replay`, {
      params: new HttpParams().set('since', since),
    });
  }

  validateRuleName(name: string, excludeId?: string) {
    let params = new HttpParams().set('name', name);
    if (excludeId) params = params.set('excludeId', excludeId);
    return this.http.get<{ name: string; available: boolean }>(`${apiBaseUrl}/rules/check-name`, { params });
  }

  createRule(rule: RuleInput & { idempotencyKey?: string }) {
    const headers = rule.idempotencyKey ? { 'Idempotency-Key': rule.idempotencyKey } : undefined;
    const body = { ...rule };
    delete body.idempotencyKey;
    return this.http.post<AlertRuleDto>(`${apiBaseUrl}/rules`, body, { headers });
  }

  updateRule(id: string, rule: Partial<RuleInput>) {
    return this.http.put<AlertRuleDto>(`${apiBaseUrl}/rules/${encodeURIComponent(id)}`, rule);
  }

  deleteRule(id: string) {
    return this.http.delete<void>(`${apiBaseUrl}/rules/${encodeURIComponent(id)}`);
  }

  chaos() {
    return this.http.get<ChaosState>(`${apiBaseUrl}/chaos`);
  }

  updateChaos(input: Partial<ChaosState>) {
    return this.http.post<ChaosState>(`${apiBaseUrl}/chaos`, input);
  }

  resetChaos() {
    return this.http.delete<ChaosState>(`${apiBaseUrl}/chaos`);
  }
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

function toParams(values: ServiceListParams): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}
