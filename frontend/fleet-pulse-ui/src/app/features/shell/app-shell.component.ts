import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { filter } from 'rxjs';
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
          @if (auth.isOperator()) {
            <a mat-button class="nav-item" routerLink="/rules" routerLinkActive="active">Alert rules</a>
          }
          <a mat-button class="nav-item" routerLink="/incidents" routerLinkActive="active">Incidents</a>
          <a mat-button class="nav-item" routerLink="/settings" routerLinkActive="active">Settings</a>
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
              <dd class="connection-offset">{{ store.eventOffset() }}</dd>
            </div>
            <div>
              <dt>Last event</dt>
              <dd class="connection-last-event">
                @if (store.lastEvent(); as lastEvent) {
                  <span>{{ lastEvent | date: 'mediumTime' }}</span>
                  <span class="connection-age">({{ ((store.realtime.lastEventAgeMs() ?? 0) / 1000) | number: '1.0-0' }}s ago)</span>
                } @else {
                  <span>Not received</span>
                  <span class="connection-age" aria-hidden="true">&nbsp;</span>
                }
              </dd>
            </div>
            <div>
              <dt>State</dt>
              <dd role="status" aria-live="polite">{{ store.connectionStatus() }}</dd>
            </div>
          </dl>
        </section>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <nav class="eyebrow breadcrumbs" aria-label="Breadcrumb">
              <a routerLink="/dashboard">Production / us-east primary</a>
              @for (breadcrumb of breadcrumbs(); let last = $last; track breadcrumb.label) {
                <span aria-hidden="true">/</span>
                @if (breadcrumb.url && !last) {
                  <a [routerLink]="breadcrumb.url">{{ breadcrumb.label }}</a>
                } @else {
                  <span [attr.aria-current]="last ? 'page' : null">{{ breadcrumb.label }}</span>
                }
              }
            </nav>
            <h1>{{ title() }}</h1>
          </div>
          <div class="topbar-actions">
            @if (store.latestRuleNotification(); as notification) {
              <span class="rule-notification" role="status" aria-live="polite">{{ notification }}</span>
            }
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
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly profileMenuOpen = signal(false);
  readonly displayName = computed(() => this.auth.user()?.email ?? this.auth.user()?.role ?? 'Signed in');

  readonly title = signal('Operations Dashboard');
  readonly breadcrumbs = signal<BreadcrumbItem[]>([{ label: 'Dashboard' }]);

  get initials(): string {
    return (this.auth.user()?.email ?? 'FP').slice(0, 2).toUpperCase();
  }

  ngOnInit(): void {
    this.store.load();
    this.updatePageTitle();
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.updatePageTitle());
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

  private updatePageTitle(): void {
    let activeRoute = this.route.snapshot;
    while (activeRoute.firstChild) activeRoute = activeRoute.firstChild;
    const pageTitle = String(activeRoute.data['pageTitle'] ?? 'Operations Dashboard');
    this.title.set(pageTitle);
    this.breadcrumbs.set(parseBreadcrumbs(activeRoute.data['breadcrumbs'], pageTitle));
  }
}

interface BreadcrumbItem {
  label: string;
  url?: string;
}

function parseBreadcrumbs(value: unknown, fallback: string): BreadcrumbItem[] {
  if (!Array.isArray(value)) return [{ label: fallback }];
  const breadcrumbs = value.filter(
    (item): item is BreadcrumbItem =>
      typeof item === 'object' &&
      item !== null &&
      'label' in item &&
      typeof item.label === 'string' &&
      (!('url' in item) || typeof item.url === 'string'),
  );
  return breadcrumbs.length ? breadcrumbs : [{ label: fallback }];
}
