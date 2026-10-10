import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, catchError, finalize, of, shareReplay, tap, throwError } from 'rxjs';
import type { AuthResponse, User } from '../models/api.models';

const apiBaseUrl = 'http://localhost:3000';
const expirySkewMs = 5_000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly session = signal<AuthSession | null>(readSession());
  private readonly logoutSubject = new Subject<void>();
  private refreshInFlight$?: Observable<AuthResponse>;

  readonly user = computed(() => this.session()?.user ?? null);
  readonly accessToken = computed(() => {
    const session = this.session();
    return session && 'accessToken' in session ? session.accessToken : null;
  });
  readonly isAuthenticated = computed(() => this.hasValidAccessToken());
  readonly isOperator = computed(() => this.user()?.role === 'operator');
  readonly logout$ = this.logoutSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${apiBaseUrl}/auth/login`, { email, password }).pipe(tap((session) => this.setSession(session)));
  }

  refresh(): Observable<AuthResponse> {
    const refreshToken = this.session()?.refreshToken;
    if (!refreshToken) {
      return throwError(() => new Error('No refresh token is available.'));
    }
    return this.http.post<AuthResponse>(`${apiBaseUrl}/auth/refresh`, { refreshToken }).pipe(tap((session) => this.setSession(session)));
  }

  ensureValidSession(): Observable<AuthResponse | null> {
    const session = this.session();
    if (!session) {
      return of(null);
    }
    if (this.hasValidAccessToken()) {
      return of(session as AuthResponse);
    }
    return this.refreshSession().pipe(
      catchError(() => {
        this.logout();
        return of(null);
      }),
    );
  }

  refreshSession(): Observable<AuthResponse> {
    if (!this.refreshInFlight$) {
      this.refreshInFlight$ = this.refresh().pipe(
        finalize(() => {
          this.refreshInFlight$ = undefined;
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
    }
    return this.refreshInFlight$;
  }

  demoLogin(role: User['role'] = 'operator'): Observable<AuthResponse> {
    return this.login(role === 'operator' ? 'operator@fleetpulse.dev' : 'viewer@fleetpulse.dev', role === 'operator' ? 'operator123' : 'viewer123');
  }

  logout(): void {
    this.refreshInFlight$ = undefined;
    this.session.set(null);
    localStorage.removeItem('fleet-pulse-session');
    this.logoutSubject.next();
  }

  private hasValidAccessToken(): boolean {
    const session = this.session();
    return Boolean(session && 'accessToken' in session && session.accessToken && session.expiresAt - expirySkewMs > Date.now());
  }

  private setSession(session: AuthResponse): void {
    this.session.set(session);
    localStorage.setItem('fleet-pulse-session', JSON.stringify(toPersistedSession(session)));
  }
}

type PersistedSession = Pick<AuthResponse, 'user' | 'refreshToken' | 'expiresAt'>;
type AuthSession = AuthResponse | PersistedSession;

function readSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem('fleet-pulse-session');
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AuthResponse>;
    if (!parsed.user || !parsed.refreshToken) {
      return null;
    }
    return toPersistedSession(parsed as AuthResponse);
  } catch {
    return null;
  }
}

function toPersistedSession(session: AuthResponse): PersistedSession {
  return {
    user: session.user,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
}
