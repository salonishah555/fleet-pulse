import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';
import type { AuthResponse } from '../models/api.models';

@Component({ template: '' })
class BlankComponent {}

describe('authInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'login', component: BlankComponent }]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('attaches the bearer token to protected API requests', async () => {
    const auth = TestBed.inject(AuthService);
    const login = firstValueFrom(auth.login('operator@fleetpulse.dev', 'operator123'));
    http.expectOne('http://localhost:3000/auth/login').flush(authResponse('access-token', 'refresh-token'));
    await login;

    const response = firstValueFrom(client.get('http://localhost:3000/metrics/snapshot'));
    const request = http.expectOne('http://localhost:3000/metrics/snapshot');
    expect(request.request.headers.get('Authorization')).toBe('Bearer access-token');
    request.flush({ ok: true });

    await expect(response).resolves.toEqual({ ok: true });
  });

  it('refreshes and retries protected requests after a 401', async () => {
    const auth = TestBed.inject(AuthService);
    const login = firstValueFrom(auth.login('operator@fleetpulse.dev', 'operator123'));
    http.expectOne('http://localhost:3000/auth/login').flush(authResponse('old-access-token', 'refresh-token'));
    await login;

    const response = firstValueFrom(client.get('http://localhost:3000/alert-rules'));

    const firstAttempt = http.expectOne('http://localhost:3000/alert-rules');
    expect(firstAttempt.request.headers.get('Authorization')).toBe('Bearer old-access-token');
    firstAttempt.flush({ error: { code: 'token_expired', message: 'Authentication token has expired' } }, { status: 401, statusText: 'Unauthorized' });

    const refresh = http.expectOne('http://localhost:3000/auth/refresh');
    expect(refresh.request.headers.has('Authorization')).toBe(false);
    refresh.flush(authResponse('new-access-token', 'new-refresh-token'));

    const retry = http.expectOne('http://localhost:3000/alert-rules');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer new-access-token');
    retry.flush({ items: [] });

    await expect(response).resolves.toEqual({ items: [] });
  });

  it('clears the session when a 401 cannot be refreshed', async () => {
    const auth = TestBed.inject(AuthService);
    const login = firstValueFrom(auth.login('operator@fleetpulse.dev', 'operator123'));
    http.expectOne('http://localhost:3000/auth/login').flush(authResponse('old-access-token', 'refresh-token'));
    await login;

    const response = firstValueFrom(client.get('http://localhost:3000/metrics/snapshot'));

    http.expectOne('http://localhost:3000/metrics/snapshot').flush(
      { error: { code: 'token_expired', message: 'Authentication token has expired' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    http.expectOne('http://localhost:3000/auth/refresh').flush(
      { error: { code: 'invalid_refresh_token', message: 'Refresh token is invalid or expired' } },
      { status: 401, statusText: 'Unauthorized' },
    );

    await expect(response).rejects.toBeTruthy();
    expect(localStorage.getItem('fleet-pulse-session')).toBeNull();
  });
});

function authResponse(accessToken: string, refreshToken: string, expiresAt = Date.now() + 60_000): AuthResponse {
  return {
    accessToken,
    refreshToken,
    expiresAt,
    user: { id: 'usr-operator', email: 'operator@fleetpulse.dev', role: 'operator' },
  };
}
