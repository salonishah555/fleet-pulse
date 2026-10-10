import request from 'supertest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, createServer } from '../src/server.js';
import { chaosService } from '../src/chaos.js';
import { stopStreams } from '../src/stream.js';

const app = createApp();

async function loginAs(email = 'operator@pulse.dev', password = 'pulse123') {
  const response = await request(app).post('/auth/login').send({ email, password }).expect(200);
  return response.body as { accessToken: string; refreshToken: string; expiresAt: number; user: { role: string; email: string } };
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const rule = {
  name: 'Contract test rule',
  scope: 'all teams',
  enabled: true,
  conditions: [{ metric: 'p95', operator: '>', threshold: 300, durationSec: 60 }],
};

describe('Fleet Pulse API', () => {
  beforeEach(() => chaosService.reset());
  afterEach(() => chaosService.reset());

  it('authenticates assignment users and preserves legacy login aliases', async () => {
    const operator = await loginAs();
    expect(operator.user).toMatchObject({ email: 'operator@pulse.dev', role: 'operator' });
    const viewer = await loginAs('viewer@pulse.dev');
    expect(viewer.user).toMatchObject({ email: 'viewer@pulse.dev', role: 'viewer' });
    await loginAs('operator@fleetpulse.dev', 'operator123');
  });

  it('keeps the existing services and metrics API available with bearer auth', async () => {
    const auth = await loginAs();
    const services = await request(app).get('/services?page=1&pageSize=10').set(bearer(auth.accessToken)).expect(200);
    expect(services.body.items).toHaveLength(10);
    expect(services.body.total).toBe(2000);

    const snapshot = await request(app).get('/metrics/snapshot').set(bearer(auth.accessToken)).expect(200);
    expect(snapshot.body.services[0].seq).toEqual(expect.any(Number));
    const history = await request(app)
      .get(`/metrics/history?serviceId=${snapshot.body.services[0].id}&minutes=30`)
      .set(bearer(auth.accessToken))
      .expect(200);
    expect(history.body.points).toEqual(expect.any(Array));
    expect(history.body.items).toEqual(history.body.points);
    await request(app).get(`/metrics/replay?since=${snapshot.body.offset - 1}`).set(bearer(auth.accessToken)).expect(200);
  });

  it('supports rule collection, item CRUD, and check-name routes', async () => {
    const auth = await loginAs();
    const headers = bearer(auth.accessToken);

    const list = await request(app).get('/rules').set(headers).expect(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    await request(app).get('/rules/check-name?name=Latency%20breach').set(headers).expect(200).then((res) => {
      expect(res.body.available).toBe(false);
    });

    const created = await request(app).post('/rules/contract-rule').set(headers).send(rule).expect(201);
    expect(created.body).toMatchObject({ id: 'contract-rule' });
    const fetched = await request(app).get('/rules/contract-rule').set(headers).expect(200);
    expect(fetched.body.name).toBe(rule.name);

    await request(app).patch('/rules/contract-rule').set(headers).send({ enabled: false }).expect(200)
      .then((res) => expect(res.body.enabled).toBe(false));
    await request(app).put('/rules/contract-rule').set(headers).send({ ...rule, name: 'Updated rule' }).expect(200);
    await request(app).delete('/rules/contract-rule').set(headers).expect(204);
    await request(app).get('/rules/contract-rule').set(headers).expect(404);
  });

  it('allows browser idempotency headers and deduplicates keyed rule creation', async () => {
    const preflight = await request(app)
      .options('/rules')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,idempotency-key')
      .expect(204);
    expect(preflight.headers['access-control-allow-headers']).toContain('Idempotency-Key');

    const auth = await loginAs();
    const headers = { ...bearer(auth.accessToken), 'Idempotency-Key': 'dedupe-test-key' };
    const first = await request(app).post('/rules').set(headers).send(rule).expect(201);
    expect(first.body).toMatchObject({ id: expect.any(String) });
    const duplicate = await request(app).post('/rules').set(headers).send(rule).expect(201);
    expect(duplicate.body).toMatchObject({ id: first.body.id });
    expect(duplicate.body.id).toBe(first.body.id);

    await request(app)
      .post('/rules')
      .set(headers)
      .send({ ...rule, name: 'Different rule payload' })
      .expect(409);
  });

  it('protects rule mutations from viewers while retaining alert-rules aliases', async () => {
    const viewer = await loginAs('viewer@pulse.dev');
    await request(app).post('/rules/viewer-rule').set(bearer(viewer.accessToken)).send(rule).expect(403);

    const operator = await loginAs();
    const headers = bearer(operator.accessToken);
    const legacyRules = await request(app).get('/alert-rules').set(headers).expect(200);
    expect(legacyRules.body.items.length).toBeGreaterThan(0);
    await request(app).get('/alert-rules/validate-name?name=Latency%20breach').set(headers).expect(200)
      .then((res) => expect(res.body.available).toBe(false));
  });

  it('supports chaos rate, token TTL, HTTP failures, and reset', async () => {
    const auth = await loginAs();
    const headers = bearer(auth.accessToken);
    const configured = await request(app).post('/chaos').set(headers).send({ rate: 2000, token_ttl: 5, http: '503' }).expect(200);
    expect(configured.body).toMatchObject({ rate: 2000, token_ttl: 5, http: '503' });
    expect(configured.body.token_ttl).toBe(5);
    await request(app).get('/health').expect(503);

    await request(app).delete('/chaos').set(headers).expect(200);
    await request(app).post('/chaos').set(headers).send({ token_ttl: 5 }).expect(200);
    const shortLived = await loginAs();
    expect(shortLived.expiresAt - Date.now()).toBeLessThanOrEqual(5000);
    await request(app).delete('/chaos').set(headers).expect(200);
    await request(app).get('/health').expect(200);
  });

  it('accepts assignment stream chaos values and rejects SSE when configured down', async () => {
    const auth = await loginAs();
    const headers = bearer(auth.accessToken);
    const configured = await request(app)
      .post('/chaos')
      .set(headers)
      .send({ ws: 'silent', sse: 'down', chaos: 'drop:25,dupe,shuffle,garbage:10' })
      .expect(200);
    expect(configured.body).toMatchObject({
      ws: 'silent',
      sse: 'down',
      chaos: ['drop:25', 'dupe', 'shuffle', 'garbage:10'],
    });
    await request(app).get('/stream/sse').set(headers).expect(503);

    await request(app).post('/chaos').set(headers).send({ ws: 'drop:40', sse: null, chaos: [] }).expect(200)
      .then((res) => expect(res.body.ws).toBe('drop:40'));

    chaosService.merge({ ws: null, chaos: 'drop:100,dupe,shuffle,garbage:100' });
    const deterministicChaos = chaosService.get();
    expect(chaosService.shouldDrop(deterministicChaos)).toBe(true);
    expect(chaosService.shouldGarbage(deterministicChaos)).toBe(true);
    expect(chaosService.hasFlag(deterministicChaos, 'duplicate')).toBe(true);
  });

  it('applies WebSocket down and silent modes', async () => {
    const auth = await loginAs();
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${port}/stream?token=${encodeURIComponent(auth.accessToken)}`;

    try {
      chaosService.merge({ ws: 'down' });
      const unavailableStatus = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(url);
        const timer = setTimeout(() => reject(new Error('WebSocket down mode did not respond')), 1000);
        socket.on('unexpected-response', (_request, response) => {
          clearTimeout(timer);
          resolve(response.statusCode ?? 0);
        });
        socket.on('error', () => undefined);
      });
      expect(unavailableStatus).toBe(503);

      chaosService.merge({ ws: 'silent' });
      const socket = new WebSocket(url);
      await once(socket, 'open');
      const receivedMessage = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 250);
        socket.once('message', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
      expect(await receivedMessage).toBe(false);
      socket.close();

      chaosService.merge({ ws: null, chaos: 'shuffle' });
      const shuffledSocket = new WebSocket(url);
      await once(shuffledSocket, 'open');
      const offsets = await new Promise<number[]>((resolve, reject) => {
        const received: number[] = [];
        const timer = setTimeout(() => reject(new Error('Shuffled stream did not produce events')), 2000);
        shuffledSocket.on('message', (data) => {
          const event = JSON.parse(data.toString()) as { type: string; offset?: number };
          if (event.type === 'metric' && event.offset !== undefined) received.push(event.offset);
          if (received.length >= 20) {
            clearTimeout(timer);
            resolve(received);
          }
        });
      });
      expect(offsets).not.toEqual([...offsets].sort((left, right) => left - right));
      shuffledSocket.close();
    } finally {
      stopStreams();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
