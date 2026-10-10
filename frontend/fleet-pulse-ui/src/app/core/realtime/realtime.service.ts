import { Injectable, computed, effect, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { FleetApiService } from '../http/fleet-api.service';
import { FleetSettingsService } from '../settings/fleet-settings.service';
import type { MetricEvent, SnapshotResponse, StreamEvent } from '../models/api.models';

type ConnectionStatus = 'disconnected' | 'connecting' | 'live' | 'stale';
type RealtimeTransport = 'WebSocket' | 'SSE' | 'Polling';
type MetricCallback = (event: MetricEvent) => void;

export interface RealtimeCallbacks {
  onMetric?: MetricCallback;
  onSnapshot?: (snapshot: SnapshotResponse) => void;
}

export interface RealtimeDiagnostics {
  malformed: number;
  duplicate: number;
  gap: number;
  sequenceGap: number;
}

const apiBaseUrl = 'http://localhost:4000';
const connectTimeoutMs = 5_000;
const reorderWindowMs = 1_000;
const recoveryIntervalMs = 15_000;
const offsetDisplayIntervalMs = 250;
const activityDisplayIntervalMs = 1_000;

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly api = inject(FleetApiService);
  private readonly settings = inject(FleetSettingsService);

  readonly status = signal<ConnectionStatus>('disconnected');
  readonly transport = signal<RealtimeTransport>('WebSocket');
  readonly lastEventAt = signal<Date | null>(null);
  readonly lastEventAgeMs = signal<number | null>(null);
  readonly eventStale = signal(true);
  readonly offset = signal(0);
  readonly displayOffset = signal(0);
  readonly diagnostics = signal<RealtimeDiagnostics>({ malformed: 0, duplicate: 0, gap: 0, sequenceGap: 0 });
  readonly malformedCount = computed(() => this.diagnostics().malformed);
  readonly duplicateCount = computed(() => this.diagnostics().duplicate);
  readonly gapCount = computed(() => this.diagnostics().gap);
  readonly sequenceGapCount = computed(() => this.diagnostics().sequenceGap);

  private socket?: WebSocket;
  private source?: EventSource;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private reorderTimer?: ReturnType<typeof setTimeout>;
  private pollingTimer?: ReturnType<typeof setInterval>;
  private recoveryTimer?: ReturnType<typeof setInterval>;
  private repairSubscription?: Subscription;
  private snapshotSubscription?: Subscription;
  private bufferedEvents = new Map<number, MetricEvent>();
  private readonly lastSequenceByService = new Map<string, number>();
  private reconnectAttempts = 0;
  private webSocketFailures = 0;
  private sseFailures = 0;
  private generation = 0;
  private gapReportedFor?: number;
  private online = typeof navigator === 'undefined' || navigator.onLine;
  private callbacks: RealtimeCallbacks = {};
  private token = '';
  private connected = false;
  private ageTimer?: ReturnType<typeof setInterval>;
  private offsetDisplayTimer?: ReturnType<typeof setTimeout>;
  private readonly handleOffline = () => {
    this.online = false;
    this.generation += 1;
    this.clearTransportTimers();
    this.closeTransports();
    this.status.set('stale');
    this.emitStatus('stale');
  };
  private readonly handleOnline = () => {
    this.online = true;
    if (this.connected) this.openWebSocket();
  };

  constructor() {
    effect(() => {
      const { refreshIntervalSec, staleAfterSec } = this.settings.settings();
      if (this.connected && this.transport() === 'Polling') this.schedulePolling(refreshIntervalSec * 1000);
      this.refreshEventAge(staleAfterSec * 1000);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('offline', this.handleOffline);
      window.addEventListener('online', this.handleOnline);
    }
    this.ageTimer = setInterval(() => this.refreshEventAge(this.settings.settings().staleAfterSec * 1000), 1000);
  }

  connect(token: string, onMetric: MetricCallback, since?: number, onSnapshot?: (snapshot: SnapshotResponse) => void): void;
  connect(token: string, callbacks: RealtimeCallbacks, since?: number): void;
  connect(
    token: string,
    callback: MetricCallback | RealtimeCallbacks,
    since = this.offset(),
    onSnapshot?: (snapshot: SnapshotResponse) => void,
  ): void {
    this.disconnect();
    this.token = token;
    this.callbacks = typeof callback === 'function' ? { onMetric: callback, onSnapshot } : callback;
    this.setOffset(since);
    this.connected = true;
    this.webSocketFailures = 0;
    this.sseFailures = 0;
    this.reconnectAttempts = 0;
    this.bufferedEvents.clear();
    this.lastSequenceByService.clear();
    this.gapReportedFor = undefined;
    this.status.set('connecting');
    this.emitStatus('connecting');
    if (this.online) this.openWebSocket();
    else {
      this.status.set('stale');
      this.emitStatus('stale');
    }
  }

  disconnect(): void {
    this.connected = false;
    this.generation += 1;
    this.clearTransportTimers();
    this.closeTransports();
    this.repairSubscription?.unsubscribe();
    this.snapshotSubscription?.unsubscribe();
    this.repairSubscription = undefined;
    this.snapshotSubscription = undefined;
    this.bufferedEvents.clear();
    this.lastSequenceByService.clear();
    this.status.set('disconnected');
    this.emitStatus('disconnected');
    this.lastEventAt.set(null);
  }

  setOffset(offset: number): void {
    this.offset.set(offset);
    if (this.offsetDisplayTimer) return;
    this.displayOffset.set(offset);
    this.offsetDisplayTimer = setTimeout(() => {
      this.offsetDisplayTimer = undefined;
      this.displayOffset.set(this.offset());
    }, offsetDisplayIntervalMs);
  }

  private openWebSocket(recovery = false): void {
    if (!this.connected || !this.online) return;
    const attempt = recovery ? this.generation : ++this.generation;
    if (!recovery) {
      this.clearTransportTimers();
      this.closeTransports();
      this.status.set('connecting');
      this.emitStatus('connecting');
    } else {
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = undefined;
    }
    if (!recovery) this.transport.set('WebSocket');
    const url = `${apiBaseUrl.replace(/^http/, 'ws')}/stream?token=${encodeURIComponent(this.token)}&since=${this.offset()}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.handleWebSocketFailure(attempt, recovery);
      return;
    }
    this.socket = socket;
    let settled = false;
    let failed = false;
    const fail = () => {
      if (failed || attempt !== this.generation) return;
      failed = true;
      settled = true;
      this.handleWebSocketFailure(attempt, recovery);
    };
    this.connectTimer = setTimeout(() => {
      if (settled || attempt !== this.generation) return;
      failed = true;
      settled = true;
      if (!recovery) this.openSse();
      else {
        this.connectTimer = undefined;
        if (this.socket === socket) {
          this.socket = undefined;
          socket.close();
        }
        this.startRecoveryTimer();
      }
    }, connectTimeoutMs);
    socket.onopen = () => {
      if (attempt !== this.generation || failed) return;
      settled = true;
      this.clearConnectAndReconnectTimers();
      this.transport.set('WebSocket');
      this.webSocketFailures = 0;
      this.sseFailures = 0;
      this.reconnectAttempts = 0;
      this.source?.close();
      this.source = undefined;
      this.stopPolling();
      if (this.recoveryTimer) clearInterval(this.recoveryTimer);
      this.recoveryTimer = undefined;
      this.status.set('live');
      this.emitStatus('live');
      this.markActivity();
      this.startRecoveryTimer();
    };
    socket.onmessage = (message) => {
      if (attempt === this.generation) this.handleMessage(String(message.data));
    };
    socket.onerror = fail;
    socket.onclose = fail;
  }

  private handleWebSocketFailure(attempt: number, recovery: boolean): void {
    if (attempt !== this.generation) return;
    this.clearConnectAndReconnectTimers();
    if (!recovery) this.generation += 1;
    this.socket?.close();
    this.socket = undefined;
    if (recovery) {
      this.startRecoveryTimer();
      return;
    }
    this.webSocketFailures += 1;
    if (this.webSocketFailures >= 3) {
      this.reconnectAttempts = 0;
      this.openSse();
      return;
    }
    this.status.set('stale');
    this.emitStatus('stale');
    this.scheduleReconnect(() => this.openWebSocket());
  }

  private openSse(): void {
    if (!this.connected || !this.online) return;
    const attempt = ++this.generation;
    this.clearTransportTimers();
    this.closeTransports();
    this.transport.set('SSE');
    this.status.set('connecting');
    this.emitStatus('connecting');
    const url = `${apiBaseUrl}/stream/sse?token=${encodeURIComponent(this.token)}&since=${this.offset()}`;
    let source: EventSource;
    try {
      source = new EventSource(url);
    } catch {
      this.handleSseFailure(attempt);
      return;
    }
    this.source = source;
    let settled = false;
    source.onopen = () => {
      if (attempt !== this.generation) return;
      settled = true;
      this.status.set('live');
      this.emitStatus('live');
      this.markActivity();
      this.startRecoveryTimer();
    };
    source.addEventListener('metric', (message) => {
      if (attempt === this.generation && this.source === source) this.handleMessage((message as MessageEvent<string>).data);
    });
    source.addEventListener('ping', (message) => {
      if (attempt === this.generation && this.source === source) this.handleMessage((message as MessageEvent<string>).data);
    });
    source.addEventListener('malformed', () => {
      if (attempt !== this.generation || this.source !== source) return;
      this.incrementDiagnostic('malformed');
      this.markActivity();
    });
    source.onerror = () => {
      if (this.source !== source) return;
      if (!settled) {
        this.handleSseFailure(attempt);
        return;
      }
      this.handleSseFailure(attempt);
    };
  }

  private handleSseFailure(attempt: number): void {
    if (attempt !== this.generation) return;
    this.generation += 1;
    this.clearTransportTimers();
    this.socket?.close();
    this.socket = undefined;
    this.source?.close();
    this.source = undefined;
    this.sseFailures += 1;
    this.status.set('stale');
    this.emitStatus('stale');
    if (this.sseFailures >= 3) {
      this.startPolling();
    } else {
      this.scheduleReconnect(() => this.openSse());
    }
  }

  private startPolling(): void {
    if (!this.connected || !this.online) return;
    this.clearTransportTimers();
    this.closeTransports();
    this.transport.set('Polling');
    this.status.set('live');
    this.emitStatus('live');
    this.pollSnapshot();
    this.schedulePolling(this.settings.settings().refreshIntervalSec * 1000);
    this.startRecoveryTimer();
  }

  private schedulePolling(intervalMs: number): void {
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    if (this.connected && this.online && this.transport() === 'Polling') {
      this.pollingTimer = setInterval(() => this.pollSnapshot(), intervalMs);
    }
  }

  private pollSnapshot(): void {
    if (!this.connected || !this.online) return;
    this.snapshotSubscription?.unsubscribe();
    this.snapshotSubscription = this.api.snapshot().subscribe({
      next: (snapshot) => {
        if (!this.connected || this.transport() !== 'Polling') return;
        this.markActivity();
        this.setOffset(Math.max(this.offset(), snapshot.offset));
        this.seedSequences(snapshot.services);
        this.deliverSnapshot(snapshot);
      },
      error: () => {
        this.status.set('stale');
        this.emitStatus('stale');
      },
    });
  }

  private startRecoveryTimer(): void {
    if (!this.connected || this.transport() === 'WebSocket') return;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.recoveryTimer = setInterval(() => {
      if (this.connected && this.online && this.transport() !== 'WebSocket') this.openWebSocket(true);
    }, recoveryIntervalMs);
  }

  private handleMessage(raw: string): void {
    let event: StreamEvent;
    try {
      event = JSON.parse(raw) as StreamEvent;
      if (!isStreamEvent(event)) throw new Error('Invalid stream event');
    } catch {
      this.incrementDiagnostic('malformed');
      return;
    }
    this.markActivity();
    if (event.type === 'ping') return;
    if (event.offset <= this.offset() || this.bufferedEvents.has(event.offset)) {
      this.incrementDiagnostic('duplicate');
      return;
    }
    if (event.offset === this.offset() + 1) {
      this.applyMetric(event);
      this.drainBufferedEvents();
      return;
    }
    this.bufferedEvents.set(event.offset, event);
    this.reportGap();
    this.repairGap();
    if (!this.reorderTimer) {
      this.reorderTimer = setTimeout(() => {
        this.reorderTimer = undefined;
        this.drainBufferedEvents(true);
      }, reorderWindowMs);
    }
  }

  private applyMetric(event: MetricEvent): void {
    const previousSequence = this.lastSequenceByService.get(event.serviceId);
    if (previousSequence !== undefined && event.seq > previousSequence + 1) {
      this.incrementDiagnostic('sequenceGap');
      this.refreshSnapshot();
    }
    this.lastSequenceByService.set(event.serviceId, Math.max(previousSequence ?? 0, event.seq));
    this.setOffset(event.offset);
    this.status.set('live');
    this.callbacks.onMetric?.(event);
  }

  private drainBufferedEvents(afterWindow = false): void {
    while (this.bufferedEvents.size > 0) {
      const nextOffset = this.offset() + 1;
      const next = this.bufferedEvents.get(nextOffset);
      if (next) {
        this.bufferedEvents.delete(nextOffset);
        this.applyMetric(next);
        this.gapReportedFor = undefined;
        continue;
      }
      if (!afterWindow) break;
      const [offset, event] = [...this.bufferedEvents.entries()].sort(([left], [right]) => left - right)[0];
      this.bufferedEvents.delete(offset);
        this.setOffset(offset - 1);
      this.applyMetric(event);
    }
    if (!this.bufferedEvents.size) {
      if (this.reorderTimer) clearTimeout(this.reorderTimer);
      this.reorderTimer = undefined;
      this.gapReportedFor = undefined;
    }
  }

  private reportGap(): void {
    const expected = this.offset() + 1;
    if (this.gapReportedFor === expected) return;
    this.gapReportedFor = expected;
    this.incrementDiagnostic('gap');
  }

  private repairGap(): void {
    if (this.repairSubscription && !this.repairSubscription.closed) return;
    this.repairSubscription = this.api.replay(this.offset()).subscribe({
      next: (response) => {
        const items = [...response.items].sort((left, right) => left.offset - right.offset);
        for (const item of items) {
          this.bufferedEvents.delete(item.offset);
          this.handleReplayedMetric(item);
        }
        if (this.bufferedEvents.size) this.drainBufferedEvents();
      },
      error: (error: unknown) => {
        if (getStatus(error) === 410) this.refreshSnapshot();
      },
    });
  }

  private handleReplayedMetric(event: MetricEvent): void {
    if (!isMetricEvent(event) || event.offset <= this.offset()) return;
    if (event.offset === this.offset() + 1) {
      this.applyMetric(event);
      return;
    }
    this.bufferedEvents.set(event.offset, event);
  }

  private refreshSnapshot(): void {
    if (this.reorderTimer) clearTimeout(this.reorderTimer);
    this.reorderTimer = undefined;
    this.snapshotSubscription?.unsubscribe();
    this.snapshotSubscription = this.api.snapshot().subscribe({
      next: (snapshot) => {
        if (!this.connected) return;
        this.setOffset(snapshot.offset);
        this.seedSequences(snapshot.services);
        this.bufferedEvents.clear();
        this.deliverSnapshot(snapshot);
        this.markActivity();
        this.status.set('live');
        this.emitStatus('live');
      },
      error: () => {
        this.status.set('stale');
        this.emitStatus('stale');
      },
    });
  }

  private markActivity(): void {
    const now = Date.now();
    const lastDisplayedAt = this.lastEventAt()?.getTime() ?? 0;
    if (now - lastDisplayedAt >= activityDisplayIntervalMs) {
      this.lastEventAt.set(new Date(now));
      this.lastEventAgeMs.set(0);
      this.eventStale.set(false);
    }
    if (this.status() !== 'live') {
      this.status.set('live');
      this.emitStatus('live');
    }
  }

  private refreshEventAge(staleAfterMs: number): void {
    const timestamp = this.lastEventAt()?.getTime();
    if (timestamp === undefined) {
      this.lastEventAgeMs.set(null);
      this.eventStale.set(true);
      return;
    }
    const age = Math.max(0, Date.now() - timestamp);
    this.lastEventAgeMs.set(age);
    const isStale = age >= staleAfterMs;
    this.eventStale.set(isStale);
    if (!isStale || !this.connected || !this.online || this.status() === 'stale') return;
    this.status.set('stale');
    this.emitStatus('stale');
    if (this.transport() === 'WebSocket') {
      this.handleWebSocketFailure(this.generation, false);
    } else if (this.transport() === 'SSE') {
      this.handleSseFailure(this.generation);
    }
  }

  seedSequences(services: { id: string; seq?: number }[]): void {
    for (const service of services) {
      if (service.seq !== undefined && Number.isFinite(service.seq)) {
        this.lastSequenceByService.set(service.id, service.seq);
      }
    }
  }

  private deliverSnapshot(snapshot: SnapshotResponse): void {
    this.callbacks.onSnapshot?.(snapshot);
  }

  private emitStatus(status: ConnectionStatus): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fleet-pulse-connection-status', { detail: status }));
    }
  }

  private scheduleReconnect(callback: () => void): void {
    if (!this.connected || !this.online) return;
    const delay = Math.min(15_000, 1_000 * 2 ** this.reconnectAttempts++);
    this.reconnectTimer = setTimeout(callback, delay);
  }

  private incrementDiagnostic(key: keyof RealtimeDiagnostics): void {
    this.diagnostics.update((current) => ({ ...current, [key]: current[key] + 1 }));
  }

  private clearConnectAndReconnectTimers(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.connectTimer = undefined;
    this.reconnectTimer = undefined;
  }

  private clearTransportTimers(): void {
    this.clearConnectAndReconnectTimers();
    if (this.reorderTimer) clearTimeout(this.reorderTimer);
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    this.reorderTimer = undefined;
    this.pollingTimer = undefined;
    this.recoveryTimer = undefined;
  }

  private closeTransports(): void {
    this.socket?.close();
    this.source?.close();
    this.socket = undefined;
    this.source = undefined;
  }

  private stopPolling(): void {
    if (this.pollingTimer) clearInterval(this.pollingTimer);
    this.pollingTimer = undefined;
  }
}

function isStreamEvent(event: unknown): event is StreamEvent {
  if (!event || typeof event !== 'object') return false;
  const candidate = event as Partial<StreamEvent>;
  if (candidate.type === 'ping') return typeof candidate.ts === 'number' && Number.isFinite(candidate.ts);
  return isMetricEvent(event);
}

function isMetricEvent(event: unknown): event is MetricEvent {
  if (!event || typeof event !== 'object') return false;
  const candidate = event as Partial<MetricEvent>;
  return (
    candidate.type === 'metric' &&
    Number.isSafeInteger(candidate.offset) &&
    (candidate.offset ?? 0) > 0 &&
    typeof candidate.serviceId === 'string' &&
    Number.isFinite(candidate.seq) &&
    Number.isFinite(candidate.ts) &&
    Number.isFinite(candidate.p95) &&
    Number.isFinite(candidate.errRate) &&
    Number.isFinite(candidate.rps) &&
    ['healthy', 'degraded', 'down'].includes(candidate.status ?? '')
  );
}

function getStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}
