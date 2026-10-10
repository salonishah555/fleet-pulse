import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import type { AuthResponse, User } from '../models/api.models';

const apiBaseUrl = 'http://localhost:3000';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly session = signal<AuthResponse | null>(readSession());
  readonly user = computed(() => this.session()?.user ?? null);
  readonly accessToken = computed(() => this.session()?.accessToken ?? null);
  readonly isAuthenticated = computed(() => Boolean(this.session()?.accessToken));
  readonly isOperator = computed(() => this.user()?.role === 'operator');

  constructor(private readonly http: HttpClient) {}

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${apiBaseUrl}/auth/login`, { email, password }).pipe(tap((session) => this.setSession(session)));
  }

  refresh(): Observable<AuthResponse> {
    const refreshToken = this.session()?.refreshToken;
    return this.http.post<AuthResponse>(`${apiBaseUrl}/auth/refresh`, { refreshToken }).pipe(tap((session) => this.setSession(session)));
  }

  demoLogin(role: User['role'] = 'operator'): Observable<AuthResponse> {
    return this.login(role === 'operator' ? 'operator@fleetpulse.dev' : 'viewer@fleetpulse.dev', role === 'operator' ? 'operator123' : 'viewer123');
  }

  logout(): void {
    this.session.set(null);
    localStorage.removeItem('fleet-pulse-session');
  }

  private setSession(session: AuthResponse): void {
    this.session.set(session);
    localStorage.setItem('fleet-pulse-session', JSON.stringify(session));
  }
}

function readSession(): AuthResponse | null {
  try {
    const raw = localStorage.getItem('fleet-pulse-session');
    return raw ? (JSON.parse(raw) as AuthResponse) : null;
  } catch {
    return null;
  }
}
