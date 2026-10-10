import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authGuard, operatorGuard } from './auth.guard';
import type { AuthResponse } from '../models/api.models';

describe('auth guards', () => {
  let http: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('redirects unauthenticated users to login', async () => {
    const result = await firstValueFrom(TestBed.runInInjectionContext(() => authGuard({} as never, { url: '/services?q=api' } as never) as never));

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Fservices%3Fq%3Dapi');
  });

  it('refreshes an expired stored session before allowing protected routes', async () => {
    localStorage.setItem('fleet-pulse-session', JSON.stringify(authResponse('expired-token', 'refresh-token', Date.now() - 1_000)));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);

    const result = firstValueFrom(TestBed.runInInjectionContext(() => authGuard({} as never, {} as never) as never));
    http.expectOne('http://localhost:4000/auth/refresh').flush(authResponse('new-token', 'new-refresh-token'));

    await expect(result).resolves.toBe(true);
  });

  it('redirects viewers away from operator-only routes', async () => {
    localStorage.setItem('fleet-pulse-session', JSON.stringify(authResponse('viewer-token', 'viewer-refresh-token', Date.now() + 60_000, 'viewer')));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);

    const result = firstValueFrom(TestBed.runInInjectionContext(() => operatorGuard({} as never, {} as never) as never));
    http.expectOne('http://localhost:4000/auth/refresh').flush(authResponse('new-viewer-token', 'new-viewer-refresh-token', Date.now() + 60_000, 'viewer'));

    const resolved = await result;
    expect(resolved instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(resolved as UrlTree)).toBe('/dashboard');
  });
});

function authResponse(accessToken: string, refreshToken: string, expiresAt = Date.now() + 60_000, role: 'operator' | 'viewer' = 'operator'): AuthResponse {
  return {
    accessToken,
    refreshToken,
    expiresAt,
    user: { id: `usr-${role}`, email: `${role}@fleetpulse.dev`, role },
  };
}
