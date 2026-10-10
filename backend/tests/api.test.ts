import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';
import { chaosService } from '../src/chaos.js';

const app = createApp();

async function loginAs(email = 'operator@fleetpulse.dev', password = 'operator123') {
  const response = await request(app).post('/auth/login').send({ email, password }).expect(200);
  return response.body as { accessToken: string; refreshToken: string; user: { role: string } };
}

describe('Fleet Pulse API', () => {
  beforeEach(() => {
    chaosService.reset();
  });

  afterEach(() => {
    chaosService.reset();
  });

  it('authenticates demo users and rotates refresh tokens', async () => {
    const auth = await loginAs();
    expect(auth.user.role).toBe('operator');

    const refreshed = await request(app).post('/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(200);
    expect(refreshed.body.refreshToken).not.toBe(auth.refreshToken);

    await request(app).post('/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(401);
  });

  it('handles login CORS preflight for the Angular development origin', async () => {
    const response = await request(app)
      .options('/auth/login')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type')
      .expect(204);

    expect(response.header['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(response.header['access-control-allow-methods']).toContain('POST');
    expect(response.header['access-control-allow-headers']).toContain('Content-Type');
    expect(response.header['access-control-allow-credentials']).toBeUndefined();
  });

  it('returns CORS headers for login and accepts the demo payload contract', async () => {
    const response = await request(app)
      .post('/auth/login')
      .set('Origin', 'http://localhost:4200')
      .send({ email: 'operator@fleetpulse.dev', password: 'operator123' })
      .expect(200);

    expect(response.header['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(response.body.user).toMatchObject({ email: 'operator@fleetpulse.dev', role: 'operator' });
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
  });

  it('sends protected responses for bearer access tokens', async () => {
    const auth = await loginAs();
    const response = await request(app)
      .get('/metrics/snapshot')
      .set('Origin', 'http://localhost:4200')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200);

    expect(response.header['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(response.body.summary.total).toBe(2000);
  });

  it('rejects operator-only rule changes for viewers', async () => {
    const viewer = await loginAs('viewer@fleetpulse.dev', 'viewer123');
    await request(app)
      .post('/alert-rules')
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ name: 'Viewer rule', scope: 'all teams', conditions: [{ metric: 'p95', operator: '>', threshold: 300, durationSec: 60 }] })
      .expect(403);
  });

  it('paginates and filters generated services', async () => {
    const auth = await loginAs();
    const response = await request(app)
      .get('/services?page=1&pageSize=10&team=Payments&status=degraded')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200);

    expect(response.body.items).toHaveLength(10);
    expect(response.body.total).toBeGreaterThan(10);
    expect(response.body.items.every((service: { team: string; status: string }) => service.team === 'Payments' && service.status === 'degraded')).toBe(true);
  });

  it('returns snapshots, history and replay contracts', async () => {
    const auth = await loginAs();
    const snapshot = await request(app).get('/metrics/snapshot').set('Authorization', `Bearer ${auth.accessToken}`).expect(200);
    expect(snapshot.body.summary.total).toBe(2000);
    expect(snapshot.body.offset).toBeGreaterThan(0);

    await request(app)
      .get(`/metrics/history?serviceId=${snapshot.body.services[0].id}&minutes=30`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200);

    const replay = await request(app)
      .get(`/metrics/replay?since=${snapshot.body.offset - 10}`)
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200);
    expect(replay.body.latestOffset).toBeGreaterThanOrEqual(snapshot.body.offset);
  });

  it('validates duplicate rule names and supports chaos reset', async () => {
    const auth = await loginAs();
    const validation = await request(app)
      .get('/alert-rules/validate-name?name=Latency%20breach')
      .set('Authorization', `Bearer ${auth.accessToken}`)
      .expect(200);
    expect(validation.body.available).toBe(false);

    await request(app).post('/chaos').set('Authorization', `Bearer ${auth.accessToken}`).send({ rate: 2000, http: '429' }).expect(200);
    await request(app).delete('/chaos').set('Authorization', `Bearer ${auth.accessToken}`).expect(200);
  });
});
