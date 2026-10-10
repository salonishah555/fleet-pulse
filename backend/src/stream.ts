import type { Server } from 'node:http';
import type { Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { chaosService } from './chaos.js';
import { getReplay, nextMetricEvent } from './data.js';
import { ApiError } from './errors.js';
import { verifyAccessToken } from './auth.js';
import type { ChaosState, MetricEvent, PingEvent } from './types.js';

const sockets = new Set<WebSocket>();
const sseClients = new Set<Response>();
let pump: NodeJS.Timeout | undefined;
let heartbeat: NodeJS.Timeout | undefined;

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/stream') {
      return;
    }
    try {
      if (chaosService.get().ws === 'down') {
        throw new ApiError(503, 'stream_unavailable', 'WebSocket stream is unavailable');
      }
      verifyAccessToken(url.searchParams.get('token') ?? '');
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (socket, req) => {
    sockets.add(socket);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const since = Number(url.searchParams.get('since') ?? '0');
    for (const event of getReplay(Number.isFinite(since) ? since : 0).items) {
      socket.send(JSON.stringify(event));
    }
    socket.on('close', () => sockets.delete(socket));
  });

  startPump();
  return wss;
}

export function addSseClient(res: Response, since: number): void {
  if (chaosService.get().sse === 'down') {
    throw new ApiError(503, 'stream_unavailable', 'SSE stream is unavailable');
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sseClients.add(res);
  for (const event of getReplay(since).items) {
    writeSse(res, event);
  }
  res.on('close', () => sseClients.delete(res));
}

export function stopStreams(): void {
  if (pump) clearInterval(pump);
  if (heartbeat) clearInterval(heartbeat);
  for (const socket of sockets) socket.close();
  for (const client of sseClients) client.end();
}

function startPump(): void {
  if (pump) return;
  pump = setInterval(() => {
    const local = chaosService.get();
    const batch = Math.max(1, Math.floor(local.rate / 10));
    for (let i = 0; i < batch; i += 1) {
      publish(applyChaos(nextMetricEvent(), local), local);
    }
  }, 100);

  heartbeat = setInterval(() => {
    const ping: PingEvent = { type: 'ping', ts: Date.now() };
    publish(ping, chaosService.get());
  }, 10_000);
}

function applyChaos(event: MetricEvent, local: ChaosState): MetricEvent | string | undefined {
  if (chaosService.shouldDrop(local)) return undefined;
  if (chaosService.shouldGarbage(local) || chaosService.hasFlag(local, 'malformed')) return '{bad-json';
  if (chaosService.hasFlag(local, 'duplicate')) {
    queueMicrotask(() => publish(event, local));
  }
  if (chaosService.hasFlag(local, 'shuffle')) {
    setTimeout(() => publish(event, local), 150);
    return undefined;
  }
  return event;
}

function publish(event: MetricEvent | PingEvent | string | undefined, local: ChaosState): void {
  if (event === undefined) return;
  const payload = typeof event === 'string' ? event : JSON.stringify(event);
  if (local.ws !== 'silent') {
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
  for (const client of sseClients) {
    writeSse(client, event);
  }
}

function writeSse(res: Response, event: MetricEvent | PingEvent | string): void {
  if (typeof event === 'string') {
    res.write(`event: malformed\ndata: ${event}\n\n`);
    return;
  }
  res.write(`id: ${event.type === 'metric' ? event.offset : event.ts}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
