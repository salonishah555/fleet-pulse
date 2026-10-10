import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { FleetStore } from '../../core/state/fleet-store.service';
import { AppShellComponent } from './app-shell.component';
import type { User } from '../../core/models/api.models';

describe('AppShellComponent profile menu', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let auth: MockAuthService;
  let store: MockFleetStore;
  let router: Router;

  beforeEach(async () => {
    auth = new MockAuthService();
    store = new MockFleetStore();

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: FleetStore, useValue: store },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an authenticated profile button instead of a Login action', () => {
    expect(query('a.login-action')).toBeNull();
    expect(query('button[aria-label="Open profile menu"]')).not.toBeNull();
    expect(query('.profile-menu')).toBeNull();
  });

  it('opens and closes the profile menu from the avatar control', () => {
    click('button[aria-label="Open profile menu"]');
    expect(query('.profile-menu')).not.toBeNull();
    expect(text()).toContain('operator@fleetpulse.dev');
    expect(text()).toContain('Logout');

    click('button[aria-label="Open profile menu"]');
    expect(query('.profile-menu')).toBeNull();
  });

  it('closes the profile menu on outside click and Escape', () => {
    click('button[aria-label="Open profile menu"]');
    document.body.click();
    fixture.detectChanges();
    expect(query('.profile-menu')).toBeNull();

    click('button[aria-label="Open profile menu"]');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(query('.profile-menu')).toBeNull();
  });

  it('logs out, closes realtime streams and redirects to login', () => {
    click('button[aria-label="Open profile menu"]');
    click('button[role="menuitem"]');

    expect(auth.logout).toHaveBeenCalledOnce();
    expect(store.realtime.disconnect).toHaveBeenCalledOnce();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('shows Login when no authenticated user is available', () => {
    auth.currentUser.set(null);
    fixture.detectChanges();

    expect(query('a.login-action')?.textContent?.trim()).toBe('Login');
    expect(query('button[aria-label="Open profile menu"]')).toBeNull();
  });

  function click(selector: string): void {
    (query(selector) as HTMLElement).click();
    fixture.detectChanges();
  }

  function query(selector: string): Element | null {
    return fixture.nativeElement.querySelector(selector) as Element | null;
  }

  function text(): string {
    return fixture.nativeElement.textContent as string;
  }
});

class MockAuthService {
  readonly currentUser = signal<User | null>({ id: 'usr-operator', email: 'operator@fleetpulse.dev', role: 'operator' });
  readonly user = this.currentUser.asReadonly();
  readonly isOperator = () => this.currentUser()?.role === 'operator';
  readonly logout = vi.fn(() => this.currentUser.set(null));
}

class MockFleetStore {
  readonly realtime = { disconnect: vi.fn() };
  readonly load = vi.fn();
  readonly transport = () => 'WebSocket';
  readonly eventOffset = () => 42;
  readonly lastEvent = () => new Date(0);
  readonly stale = () => false;
  readonly connectionStatus = () => 'live';
}
