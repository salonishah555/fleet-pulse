import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Response } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { chaosService } from './chaos.js';
import { getReplay, getSnapshot, nextMetricEvent } from './data.js';
import { ApiError } from './errors.js';
import { verifyAccessToken } from './auth.js';
import type { ChaosState, MetricEvent, PingEvent } from './types.js';

interface StreamConnection {
  transport: 'ws' | 'sse';
  overrides: Record<string, unknown>;
  state: ChaosState;
  shuffleQueue: (MetricEvent | PingEvent)[];
  shuffleFlush?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
  garbageToggle: boolean;
}

type StreamFrame = MetricEvent | PingEvent | { type: 'metric'; offset: number } | string;

const sockets = new Map<WebSocket, StreamConnection>();
const sseClients = new Map<Response, StreamConnection>();
let pump: NodeJS.Timeout | undefined;
let heartbeat: NodeJS.Timeout | undefined;
let lastPumpAt = Date.now();
let accumulatedEvents = 0;

export function attachWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/stream') return;

    const overrides = streamOverrides(url.searchParams);
    const connection = createConnection('ws', overrides);
    if (currentState(connection).ws === 'down') {
      writeUpgradeError(socket, new ApiError(503, 'stream_unavailable', 'WebSocket stream is unavailable'));
      return;
    }

    try {
      const authorization = req.headers.authorization;
      const headerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      const queryToken = url.searchParams.get('access_token') ?? url.searchParams.get('token');
      verifyAccessToken(headerToken ?? queryToken ?? '');
    } catch {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.close(4401, 'Authentication token is invalid');
      });
      return;
    }

    const sinceValue = url.searchParams.get('since');
    const since = sinceValue === null ? getSnapshot().offset : Number(sinceValue);
    let replay: MetricEvent[];
    try {
      replay = getReplay(Number.isFinite(since) ? Math.max(0, Math.trunc(since)) : getSnapshot().offset).items;
    } catch (error) {
      if (error instanceof ApiError) {
        writeUpgradeError(socket, error);
        return;
      }
      throw error;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.set(ws, connection);
      configureKill(connection, () => ws.close(1000, 'Chaos switch'));
      ws.on('close', () => removeConnection(sockets, ws, connection));
      if (currentState(connection).ws !== 'silent') {
        for (const event of replay) enqueueEvent(connection, event, (item) => sendWebSocket(ws, item));
      }
    });
  });

  startPump();
  return wss;
}

export function addSseClient(res: Response, since: number, overrides: Record<string, unknown> = {}): void {
  const connection = createConnection('sse', overrides);
  if (currentState(connection).sse === 'down') {
    throw new ApiError(503, 'stream_unavailable', 'SSE stream is unavailable');
  }
  const replay = getReplay(since).items;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  sseClients.set(res, connection);
  configureKill(connection, () => res.end());
  for (const event of replay) {
    enqueueEvent(connection, event, (item) => writeSse(res, item));
  }
  res.on('close', () => removeConnection(sseClients, res, connection));
}

export function stopStreams(): void {
  if (pump) clearInterval(pump);
  if (heartbeat) clearInterval(heartbeat);
  pump = undefined;
  heartbeat = undefined;
  for (const [socket, connection] of sockets) {
    clearConnection(connection);
    socket.close(1000, 'Server shutdown');
  }
  for (const [client, connection] of sseClients) {
    clearConnection(connection);
    client.end();
  }
  sockets.clear();
  sseClients.clear();
}

function startPump(): void {
  if (pump) return;
  lastPumpAt = Date.now();
  accumulatedEvents = 0;
  pump = setInterval(() => {
    const now = Date.now();
    const elapsed = now - lastPumpAt;
    lastPumpAt = now;
    accumulatedEvents += elapsed * chaosService.get().rate / 1000;
    const count = Math.floor(accumulatedEvents);
    accumulatedEvents -= count;
    for (let index = 0; index < count; index += 1) {
      const event = nextMetricEvent(now);
      publish(event);
    }
  }, 10);

  heartbeat = setInterval(() => {
    publish({ type: 'ping', ts: Date.now() });
  }, 5_000);
}

function publish(event: MetricEvent | PingEvent): void {
  const dropSample = Math.random() * 100;
  for (const [socket, connection] of sockets) {
    enqueueEvent(connection, event, (item) => sendWebSocket(socket, item), dropSample);
  }
  for (const [client, connection] of sseClients) {
    enqueueEvent(connection, event, (item) => writeSse(client, item), dropSample);
  }
}

function enqueueEvent(
  connection: StreamConnection,
  event: MetricEvent | PingEvent,
  send: (item: StreamFrame) => void,
  dropSample = Math.random() * 100,
): void {
  const state = currentState(connection);
  if (event.type === 'metric' && chaosService.shouldDrop(state, dropSample)) return;
  if (connection.transport === 'ws' && state.ws === 'silent') return;
  if (chaosService.hasFlag(state, 'shuffle')) {
    connection.shuffleQueue.push(event);
    if (!connection.shuffleFlush) {
      connection.shuffleFlush = setTimeout(() => {
        connection.shuffleFlush = undefined;
        const queued = connection.shuffleQueue.splice(0);
        for (let index = queued.length - 1; index > 0; index -= 1) {
          const swapIndex = Math.floor(Math.random() * (index + 1));
          [queued[index], queued[swapIndex]] = [queued[swapIndex], queued[index]];
        }
        for (const item of queued) deliverEvent(connection, item, send);
      }, 100);
    }
    return;
  }
  deliverEvent(connection, event, send);
}

function deliverEvent(
  connection: StreamConnection,
  event: MetricEvent | PingEvent,
  send: (item: StreamFrame) => void,
): void {
  const state = currentState(connection);
  if (connection.transport === 'ws' && state.ws === 'silent') return;

  let output: StreamFrame = event;
  if (event.type === 'metric' && chaosService.shouldGarbage(state)) {
    connection.garbageToggle = !connection.garbageToggle;
    output = connection.garbageToggle
      ? '{bad-json'
      : { type: 'metric', offset: event.offset };
  }
  send(output);
  if (event.type === 'metric' && chaosService.hasFlag(state, 'dupe') && Math.random() < 0.1) {
    send(output);
  }
}

function sendWebSocket(socket: WebSocket, event: StreamFrame): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(typeof event === 'string' ? event : JSON.stringify(event));
}

function writeSse(res: Response, event: StreamFrame): void {
  if (typeof event === 'string') {
    res.write(`event: metric\ndata: ${event}\n\n`);
    return;
  }
  const type = event.type;
  const id = type === 'metric' ? event.offset : event.ts;
  res.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function currentState(connection: StreamConnection): ChaosState {
  return connection.state;
}

function createConnection(transport: StreamConnection['transport'], overrides: Record<string, unknown>): StreamConnection {
  return {
    transport,
    overrides,
    state: chaosService.fromQuery(overrides),
    shuffleQueue: [],
    garbageToggle: false,
  };
}

function streamOverrides(params: URLSearchParams): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const key of ['rate', 'ws', 'sse', 'chaos', 'token_ttl', 'http', 'kill']) {
    if (params.has(key)) overrides[key] = params.get(key);
  }
  return overrides;
}

function configureKill(connection: StreamConnection, close: () => void): void {
  if (connection.killTimer) clearInterval(connection.killTimer);
  const kill = currentState(connection).kill;
  if (kill && kill > 0) connection.killTimer = setInterval(close, kill * 1000);
}

function refreshConnections(): void {
  for (const [socket, connection] of sockets) {
    connection.state = chaosService.fromQuery(connection.overrides);
    const state = currentState(connection);
    if (state.ws === 'down') socket.close(1000, 'Chaos switch');
    configureKill(connection, () => socket.close(1000, 'Chaos switch'));
  }
  for (const [client, connection] of sseClients) {
    connection.state = chaosService.fromQuery(connection.overrides);
    const state = currentState(connection);
    if (state.sse === 'down') client.end();
    configureKill(connection, () => client.end());
  }
}

function clearConnection(connection: StreamConnection): void {
  if (connection.shuffleFlush) clearTimeout(connection.shuffleFlush);
  if (connection.killTimer) clearInterval(connection.killTimer);
  connection.shuffleFlush = undefined;
  connection.killTimer = undefined;
  connection.shuffleQueue.length = 0;
}

function removeConnection<T extends WebSocket | Response>(
  connections: Map<T, StreamConnection>,
  client: T,
  connection: StreamConnection,
): void {
  connections.delete(client);
  clearConnection(connection);
}

function writeUpgradeError(socket: Duplex, error: ApiError): void {
  const body = JSON.stringify({
    error: { code: error.code, message: error.message, details: [] },
  });
  socket.end(
    `HTTP/1.1 ${error.status} ${error.status === 503 ? 'Service Unavailable' : 'Gone'}\r\n` +
    'Content-Type: application/json\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n\r\n' +
    body,
  );
}

chaosService.on('change', refreshConnections);
