import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import type { AuthResponse } from '../models/api.models';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('stores a successful login session', async () => {
    const response = authResponse('access-token', 'refresh-token');
    const result = firstValueFrom(service.login('operator@pulse.dev', 'pulse123'));

    const request = http.expectOne('http://localhost:4000/auth/login');
    expect(request.request.method).toBe('POST');
    request.flush(response);

    await expect(result).resolves.toEqual(response);
    expect(service.accessToken()).toBe('access-token');
    const stored = JSON.parse(localStorage.getItem('fleet-pulse-session') ?? '{}');
    expect(stored.refreshToken).toBe('refresh-token');
    expect(stored.accessToken).toBeUndefined();
  });

  it('does not store a session when login fails', async () => {
    const result = firstValueFrom(service.login('operator@pulse.dev', 'wrong-password'));

    http.expectOne('http://localhost:4000/auth/login').flush(
      { error: { code: 'invalid_credentials', message: 'Email or password is incorrect' } },
      { status: 401, statusText: 'Unauthorized' },
    );

    await expect(result).rejects.toBeTruthy();
    expect(service.accessToken()).toBeNull();
    expect(localStorage.getItem('fleet-pulse-session')).toBeNull();
  });

  it('refreshes a stored refresh-token session without persisting the access token', async () => {
    localStorage.setItem('fleet-pulse-session', JSON.stringify(authResponse('expired-token', 'refresh-token', Date.now() - 1_000)));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);

    const refreshed = authResponse('new-access-token', 'new-refresh-token');
    const result = firstValueFrom(service.ensureValidSession());

    const request = http.expectOne('http://localhost:4000/auth/refresh');
    expect(request.request.body).toEqual({ refreshToken: 'refresh-token' });
    request.flush(refreshed);

    await expect(result).resolves.toEqual(refreshed);
    expect(service.accessToken()).toBe('new-access-token');
    const stored = JSON.parse(localStorage.getItem('fleet-pulse-session') ?? '{}');
    expect(stored.refreshToken).toBe('new-refresh-token');
    expect(stored.accessToken).toBeUndefined();
  });

  it('clears session data on logout', () => {
    localStorage.setItem('fleet-pulse-session', JSON.stringify(authResponse('access-token', 'refresh-token')));
    service.logout();

    expect(service.accessToken()).toBeNull();
    expect(localStorage.getItem('fleet-pulse-session')).toBeNull();
  });
});

function authResponse(accessToken: string, refreshToken: string, expiresAt = Date.now() + 60_000): AuthResponse {
  return {
    accessToken,
    refreshToken,
    expiresAt,
    user: { id: 'usr-operator', email: 'operator@pulse.dev', role: 'operator' },
  };
}
