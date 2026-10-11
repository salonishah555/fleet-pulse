import http from 'node:http';
import crypto from 'node:crypto';
import cors from 'cors';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, login, refresh, requireRole, type AuthenticatedRequest } from './auth.js';
import { chaosService } from './chaos.js';
import { ApiError, asyncRoute, errorMiddleware } from './errors.js';
import { addSseClient, attachWebSocket, stopStreams } from './stream.js';
import {
  createRule,
  deleteRule,
  getRule,
  getHistory,
  getReplay,
  getSnapshot,
  listRules,
  listServices,
  updateRule,
  validateRuleName,
  type RuleInput,
} from './data.js';
import type { MetricName, RuleOperator, ServiceStatus } from './types.js';

const port = Number(process.env['PORT'] ?? 4000);
const allowedOrigins = (process.env['CORS_ORIGIN'] ?? 'http://localhost:4200,http://127.0.0.1:4200,http://localhost:4201,http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new ApiError(403, 'cors_origin_denied', 'Origin is not allowed by CORS policy'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  optionsSuccessStatus: 204,
};

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const conditionSchema = z.object({
  metric: z.enum(['p95', 'errRate', 'rps'] satisfies MetricName[]),
  operator: z.enum(['>', '>=', '<', '<='] satisfies RuleOperator[]),
  threshold: z.number().finite().nonnegative(),
  durationSec: z.number().int().positive().max(3600),
});
const ruleSchema = z.object({
  name: z.string().trim().min(3).max(80),
  scope: z.string().trim().min(1).max(80),
  enabled: z.boolean().optional(),
  conditions: z.array(conditionSchema).min(1).max(5),
});
const idempotencyWindowMs = 24 * 60 * 60 * 1000;
const idempotentRuleCreates = new Map<string, {
  fingerprint: string;
  status: number;
  body: unknown;
  expiresAt: number;
}>();

export function createApp() {
  const app = express();
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
  app.use(express.json({ limit: '64kb' }));
  app.use(chaosHttpMiddleware);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/auth/login', asyncRoute((req, res) => {
    const body = loginSchema.parse(req.body);
    res.json(login(body.email, body.password));
  }));

  app.post('/auth/refresh', asyncRoute((req, res) => {
    const body = refreshSchema.parse(req.body);
    res.json(refresh(body.refreshToken));
  }));

  app.get('/services', authenticate, asyncRoute((req, res) => {
    const status = parseEnum<ServiceStatus | 'all'>(req.query['status'], ['healthy', 'degraded', 'down', 'all']);
    const direction = parseEnum<'asc' | 'desc'>(req.query['direction'], ['asc', 'desc']) ?? 'desc';
    res.json(listServices({
      q: stringQuery(req.query['q']),
      status,
      team: stringQuery(req.query['team']),
      region: stringQuery(req.query['region']),
      sort: parseSort(req.query['sort']),
      direction,
      page: intQuery(req.query['page'], 1, 1, 10_000),
      pageSize: intQuery(req.query['pageSize'], 25, 1, 100),
    }));
  }));

  app.get('/metrics/snapshot', authenticate, (_req, res) => {
    res.json(getSnapshot());
  });

  app.get('/metrics/history', authenticate, (req, res) => {
    const serviceId = requiredString(req.query['serviceId'], 'serviceId is required');
    const minutes = intQuery(req.query['minutes'], 30, 1, 24 * 60);
    res.json(getHistory(serviceId, minutes));
  });

  app.get('/metrics/replay', authenticate, (req, res) => {
    res.json(getReplay(intQuery(req.query['since'], 0, 0, Number.MAX_SAFE_INTEGER)));
  });

  app.get(['/stream/sse', '/assistant/stream'], authenticate, (req, res) => {
    addSseClient(
      res,
      intQuery(req.query['since'], getSnapshot().offset, 0, Number.MAX_SAFE_INTEGER),
      streamChaosOverrides(req),
    );
  });

  app.get('/alert-rules', authenticate, (_req, res) => {
    res.json({ items: listRules() });
  });

  app.get('/rules', authenticate, (_req, res) => {
    res.json({ items: listRules() });
  });

  app.get('/rules/check-name', authenticate, (req, res) => {
    res.json(validateRuleName(requiredString(req.query['name'], 'name is required'), stringQuery(req.query['excludeId'])));
  });

  app.get('/rules/:id', authenticate, (req, res) => {
    res.json(getRule(routeParam(req.params['id'], 'id is required')));
  });

  app.get('/alert-rules/validate-name', authenticate, (req, res) => {
    res.json(validateRuleName(requiredString(req.query['name'], 'name is required'), stringQuery(req.query['excludeId'])));
  });

  app.post('/rules', authenticate, requireRole('operator'), asyncRoute((req, res) => {
    const body = ruleSchema.parse(req.body) satisfies RuleInput;
    respondToIdempotentRuleCreate(req as AuthenticatedRequest, res, body);
  }));

  app.post('/rules/:id', authenticate, requireRole('operator'), asyncRoute((req, res) => {
    const body = ruleSchema.parse(req.body) satisfies RuleInput;
    respondToIdempotentRuleCreate(req as AuthenticatedRequest, res, body, routeParam(req.params['id'], 'id is required'));
  }));

  app.put('/rules/:id', authenticate, requireRole('operator'), asyncRoute((req, res) => {
    const body = ruleSchema.parse(req.body) satisfies RuleInput;
    res.json(updateRule(routeParam(req.params['id'], 'id is required'), body));
  }));

  app.patch('/rules/:id', authenticate, requireRole('operator'), asyncRoute((req, res) => {
    const body = ruleSchema.partial().parse(req.body);
    res.json(updateRule(routeParam(req.params['id'], 'id is required'), body));
  }));

  app.delete('/rules/:id', authenticate, requireRole('operator'), (req, res) => {
    deleteRule(routeParam(req.params['id'], 'id is required'));
    res.status(204).end();
  });

  app.post('/alert-rules', authenticate, requireRole('operator'), asyncRoute((req, res) => {
    const body = ruleSchema.parse(req.body) satisfies RuleInput;
    res.status(201).json(createRule(body));
  }));

  app.put('/alert-rules/:id', authenticate, requireRole('operator'), asyncRoute((req, res) => {
    const body = ruleSchema.parse(req.body) satisfies RuleInput;
    res.json(updateRule(routeParam(req.params['id'], 'id is required'), body));
  }));

  app.patch('/alert-rules/:id', authenticate, requireRole('operator'), asyncRoute((req, res) => {
    const body = ruleSchema.partial().parse(req.body);
    res.json(updateRule(routeParam(req.params['id'], 'id is required'), body));
  }));

  app.delete('/alert-rules/:id', authenticate, requireRole('operator'), (req, res) => {
    deleteRule(routeParam(req.params['id'], 'id is required'));
    res.status(204).end();
  });

  app.get('/chaos', (_req, res) => {
    res.json(chaosService.get());
  });

  app.post('/chaos', (req, res) => {
    const next = chaosService.merge(req.body as Record<string, unknown>);
    res.json(next);
  });

  app.delete('/chaos', (_req, res) => {
    res.json(chaosService.reset());
  });

  app.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'Route not found')));
  app.use(zodErrorMiddleware);
  app.use(errorMiddleware);
  return app;
}

export function createServer() {
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  return server;
}

if (process.env['NODE_ENV'] !== 'test') {
  const server = createServer();
  server.listen(port, () => {
    console.log(`Fleet Pulse API listening on http://localhost:${port}`);
  });
  const shutdown = () => {
    stopStreams();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function chaosHttpMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (
    req.path === '/health' ||
    req.path === '/chaos' ||
    req.path === '/auth' ||
    req.path.startsWith('/auth/') ||
    req.path === '/stream' ||
    req.path === '/stream/sse' ||
    req.path === '/assistant/stream'
  ) {
    next();
    return;
  }
  const httpMode = chaosService.get().http;
  if (httpMode === '429') {
    res.setHeader('Retry-After', '2');
    next(new ApiError(429, 'rate_limited', 'Chaos HTTP 429 mode is active'));
    return;
  }
  const status500 = httpMode?.match(/^500(?::([^:]+))?$/);
  if (status500) {
    const percentage = status500[1] === undefined ? 100 : Number(status500[1]);
    if (Number.isFinite(percentage) && Math.random() * 100 < Math.min(100, Math.max(0, percentage))) {
      next(new ApiError(500, 'server_error', 'Chaos HTTP 500 mode is active'));
      return;
    }
  }
  const failureStatus = httpMode === 'down' ? 503 : Number(httpMode);
  if (Number.isInteger(failureStatus) && failureStatus >= 400 && failureStatus <= 599) {
    next(new ApiError(failureStatus, `chaos_http_${failureStatus}`, `Chaos HTTP ${failureStatus} mode is active`));
    return;
  }
  if (httpMode?.startsWith('slow')) {
    const delay = Number(httpMode.split(':')[1] ?? 750);
    setTimeout(next, Number.isFinite(delay) ? Math.max(0, delay) : 750);
    return;
  }
  next();
}

function streamChaosOverrides(req: Request): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const key of ['rate', 'ws', 'sse', 'chaos', 'token_ttl', 'http', 'kill']) {
    if (req.query[key] !== undefined) overrides[key] = req.query[key];
  }
  return overrides;
}

function respondToIdempotentRuleCreate(req: AuthenticatedRequest, res: Response, body: RuleInput, id?: string): void {
  const idempotencyKey = req.header('Idempotency-Key')?.trim();
  if (!idempotencyKey) {
    res.status(201).json(createRule(body, id));
    return;
  }
  if (idempotencyKey.length > 200) {
    throw new ApiError(400, 'invalid_idempotency_key', 'Idempotency-Key must not exceed 200 characters');
  }

  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, 'token_invalid', 'Authentication token is required');
  }
  const cacheKey = `${userId}:${idempotencyKey}`;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ body, id })).digest('hex');
  const now = Date.now();
  for (const [key, entry] of idempotentRuleCreates) {
    if (entry.expiresAt <= now) idempotentRuleCreates.delete(key);
  }
  const cached = idempotentRuleCreates.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.fingerprint !== fingerprint) {
      throw new ApiError(409, 'idempotency_key_reused', 'Idempotency-Key was already used with a different request');
    }
    res.status(cached.status).json(cached.body);
    return;
  }
  if (cached) idempotentRuleCreates.delete(cacheKey);
  if (idempotentRuleCreates.size >= 10_000) {
    const oldestKey = idempotentRuleCreates.keys().next().value;
    if (oldestKey) idempotentRuleCreates.delete(oldestKey);
  }

  const result = createRule(body, id);
  idempotentRuleCreates.set(cacheKey, {
    fingerprint,
    status: 201,
    body: result,
    expiresAt: now + idempotencyWindowMs,
  });
  res.status(201).json(result);
}

function routeParam(value: string | string[] | undefined, message: string): string {
  if (typeof value !== 'string') throw new ApiError(400, 'validation_error', message);
  return value;
}

function zodErrorMiddleware(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: { code: 'validation_error', message: 'Request validation failed', details: [] } });
    return;
  }
  next(error);
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, message: string): string {
  const parsed = stringQuery(value);
  if (!parsed) throw new ApiError(400, 'validation_error', message);
  return parsed;
}

function intQuery(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'string' ? Number(value) : fallback;
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function parseSort(value: unknown) {
  const allowed = ['id', 'name', 'team', 'region', 'status', 'p95', 'errRate', 'rps', 'updatedAt'] as const;
  return parseEnum(value, allowed);
}
