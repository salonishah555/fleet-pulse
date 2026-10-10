import { Injectable, signal } from '@angular/core';
import type { MetricEvent, StreamEvent } from '../models/api.models';

@Injectable({ providedIn: 'root' })
export class RealtimeService {
  readonly status = signal<'disconnected' | 'connecting' | 'live' | 'stale'>('disconnected');
  readonly transport = signal<'WebSocket' | 'SSE'>('WebSocket');
  readonly lastEventAt = signal<Date | null>(null);
  readonly offset = signal(0);

  private socket?: WebSocket;
  private source?: EventSource;
  private seenOffsets = new Set<number>();
  private reconnectAttempts = 0;
  private reconnectTimer?: number;

  connect(token: string, onMetric: (event: MetricEvent) => void, since = this.offset()): void {
    this.disconnect();
    this.status.set('connecting');
    const wsUrl = `ws://localhost:3000/stream?token=${encodeURIComponent(token)}&since=${since}`;
    this.socket = new WebSocket(wsUrl);
    this.socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.transport.set('WebSocket');
      this.status.set('live');
    };
    this.socket.onmessage = (message) => this.handleMessage(String(message.data), onMetric);
    this.socket.onerror = () => this.connectSse(token, onMetric);
    this.socket.onclose = () => {
      if (this.status() !== 'live') return;
      this.status.set('stale');
      this.scheduleReconnect(() => this.connect(token, onMetric));
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.source?.close();
    this.socket = undefined;
    this.source = undefined;
  }

  private connectSse(token: string, onMetric: (event: MetricEvent) => void): void {
    this.socket?.close();
    this.transport.set('SSE');
    this.source = new EventSource(`http://localhost:3000/stream/sse?token=${encodeURIComponent(token)}&since=${this.offset()}`);
    this.source.onopen = () => {
      this.reconnectAttempts = 0;
      this.status.set('live');
    };
    this.source.addEventListener('metric', (message) => this.handleMessage(message.data, onMetric));
    this.source.onerror = () => {
      this.status.set('stale');
      this.source?.close();
      this.scheduleReconnect(() => this.connect(token, onMetric));
    };
  }

  private handleMessage(raw: string, onMetric: (event: MetricEvent) => void): void {
    try {
      const event = JSON.parse(raw) as StreamEvent;
      this.lastEventAt.set(new Date());
      if (event.type !== 'metric' || this.seenOffsets.has(event.offset) || event.offset <= this.offset()) {
        return;
      }
      this.seenOffsets.add(event.offset);
      if (this.seenOffsets.size > 5000) {
        this.seenOffsets = new Set([...this.seenOffsets].slice(-2500));
      }
      this.offset.set(event.offset);
      this.status.set('live');
      onMetric(event);
    } catch {
      this.status.set('stale');
    }
  }

  private scheduleReconnect(callback: () => void): void {
    const base = Math.min(15_000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts = Math.min(5, this.reconnectAttempts + 1);
    this.reconnectTimer = window.setTimeout(callback, base + Math.random() * 750);
  }
}
