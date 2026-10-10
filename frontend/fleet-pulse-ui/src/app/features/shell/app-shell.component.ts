import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../core/auth/auth.service';
import { FleetStore } from '../../core/state/fleet-store.service';

@Component({
  selector: 'app-shell',
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, MatButtonModule],
  template: `
    <main class="ops-shell">
      <aside class="sidebar" aria-label="Primary navigation">
        <a class="brand" routerLink="/dashboard" aria-label="Fleet Pulse home">
          <span class="brand-mark">FP</span>
          <span>
            <strong>Fleet Pulse</strong>
            <small>Realtime ops</small>
          </span>
        </a>

        <nav class="nav-list">
          <a mat-button class="nav-item" routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
          <a mat-button class="nav-item" routerLink="/services" routerLinkActive="active">Services</a>
          <a mat-button class="nav-item" routerLink="/alert-rules" routerLinkActive="active">Alert rules</a>
          <a mat-button class="nav-item" routerLink="/incidents" routerLinkActive="active">Incidents</a>
          @if (auth.isOperator()) {
            <a mat-button class="nav-item" routerLink="/chaos" routerLinkActive="active">Chaos</a>
          }
        </nav>

        <section class="connection-card" aria-label="Connection health">
          <div>
            <span class="eyebrow">Transport</span>
            <strong>{{ store.transport() }}</strong>
          </div>
          <span class="pulse-dot" aria-hidden="true"></span>
          <dl>
            <div>
              <dt>Offset</dt>
              <dd>{{ store.eventOffset() }}</dd>
            </div>
            <div>
              <dt>Last event</dt>
              <dd>{{ store.lastEvent() | date: 'mediumTime' }}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{{ store.stale() ? 'Stale' : 'Live' }}</dd>
            </div>
          </dl>
        </section>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <span class="eyebrow">Production / us-east primary</span>
            <h1>{{ title }}</h1>
          </div>
          <div class="topbar-actions">
            <span class="status-pill" [class.healthy]="!store.stale()" [class.degraded]="store.stale()">
              {{ store.connectionStatus() }}
            </span>
            @if (auth.user(); as user) {
              <div class="profile-menu-wrap">
                <button
                  type="button"
                  matButton="outlined"
                  class="icon-button"
                  aria-label="Open profile menu"
                  aria-haspopup="menu"
                  [attr.aria-expanded]="profileMenuOpen()"
                  (click)="toggleProfileMenu($event)"
                >
                  {{ initials }}
                </button>
                @if (profileMenuOpen()) {
                  <div class="profile-menu" role="menu" aria-label="Profile menu">
                    <div class="profile-menu-header">
                      <strong>{{ displayName() }}</strong>
                      <span>{{ user.role }}</span>
                    </div>
                    <button type="button" matButton="outlined" role="menuitem" class="profile-menu-item danger" (click)="logout()">Logout</button>
                  </div>
                }
              </div>
            } @else {
              <a mat-button class="nav-item login-action" routerLink="/login">Login</a>
            }
          </div>
        </header>
        <router-outlet />
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent implements OnInit {
  readonly store = inject(FleetStore);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly profileMenuOpen = signal(false);
  readonly displayName = computed(() => this.auth.user()?.email ?? this.auth.user()?.role ?? 'Signed in');

  get title(): string {
    return 'Operations Dashboard';
  }

  get initials(): string {
    return (this.auth.user()?.email ?? 'FP').slice(0, 2).toUpperCase();
  }

  ngOnInit(): void {
    this.store.load();
  }

  toggleProfileMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.profileMenuOpen.update((open) => !open);
  }

  logout(): void {
    this.profileMenuOpen.set(false);
    this.store.realtime.disconnect();
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  @HostListener('document:click', ['$event.target'])
  closeProfileMenuOnOutsideClick(target: EventTarget | null): void {
    if (!this.profileMenuOpen()) return;
    if (target instanceof Element && target.closest('.profile-menu-wrap')) return;
    this.profileMenuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  closeProfileMenuOnEscape(): void {
    this.profileMenuOpen.set(false);
  }
}
