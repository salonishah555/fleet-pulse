import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { FleetStore } from '../../core/state/fleet-store.service';

@Component({
  selector: 'app-shell',
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
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
          <a class="nav-item" routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
          <a class="nav-item" routerLink="/services" routerLinkActive="active">Services</a>
          <a class="nav-item" routerLink="/alert-rules" routerLinkActive="active">Alert rules</a>
          <a class="nav-item" routerLink="/incidents" routerLinkActive="active">Incidents</a>
          @if (auth.isOperator()) {
            <a class="nav-item" routerLink="/chaos" routerLinkActive="active">Chaos</a>
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
            <button type="button" class="icon-button" aria-label="Log out" (click)="logout()">
              {{ initials }}
            </button>
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

  get title(): string {
    return 'Operations Dashboard';
  }

  get initials(): string {
    return (this.auth.user()?.email ?? 'FP').slice(0, 2).toUpperCase();
  }

  ngOnInit(): void {
    this.store.load();
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
