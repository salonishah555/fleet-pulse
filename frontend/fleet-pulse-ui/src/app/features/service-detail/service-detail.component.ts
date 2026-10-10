import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { FleetStore } from '../../core/state/fleet-store.service';
import { FleetApiService, type MetricHistoryResponse } from '../../core/http/fleet-api.service';
import { MetricChartComponent } from '../../shared/components/metric-chart.component';
import { StateComponent } from '../../shared/components/state.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';
import type { MetricPoint } from '../../core/models/ui.models';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-service-detail',
  imports: [CommonModule, RouterLink, MatButtonModule, MetricChartComponent, StateComponent, StatCardComponent, StatusBadgeComponent],
  template: `
    @if (service(); as service) {
      <section class="detail-grid">
        <article class="panel">
          <a class="text-link" routerLink="/services">Back to services</a>
          <div class="detail-heading">
            <div>
              <span class="eyebrow">{{ service.team }} / {{ service.region }}</span>
              <h2>{{ service.name }}</h2>
            </div>
            <app-status-badge [status]="service.status" [label]="service.status" />
          </div>
          @if (historyStatus() === 'loading') {
            <app-state title="Loading 15-minute service history" />
          } @else if (historyStatus() === 'error') {
            <app-state title="Unable to load service charts" message="The service details remain available. Retry loading chart history." />
            <button matButton="outlined" type="button" (click)="retryHistory()">Retry charts</button>
          } @else {
            <section class="service-charts" aria-label="Last 15 minutes of metrics">
              <article class="metric-chart-panel">
                <h3>P95 latency</h3>
                <app-metric-chart [values]="historyPoints().map(point => point.p95)" [label]="service.name + ' P95 latency over 15 minutes'" />
              </article>
              <article class="metric-chart-panel">
                <h3>Error rate (%)</h3>
                <app-metric-chart [values]="historyPoints().map(point => point.errRate)" [label]="service.name + ' error rate over 15 minutes'" />
              </article>
              <article class="metric-chart-panel">
                <h3>Requests per second</h3>
                <app-metric-chart [values]="historyPoints().map(point => point.rps)" [label]="service.name + ' throughput over 15 minutes'" />
              </article>
            </section>
          }
        </article>
        <section class="kpi-grid detail-kpis">
          <app-stat-card label="P95 latency" [value]="service.latency + 'ms'" detail="Updated from realtime stream" />
          <app-stat-card label="Error rate" [value]="(service.errorRate | number: '1.2-2') + '%'" detail="Rolling metric" [tone]="service.errorRate > 2 ? 'warn' : ''" />
          <app-stat-card label="Throughput" [value]="service.rps" detail="Requests per second" />
        </section>
      </section>
    } @else {
      <app-state title="Service not found" message="The service may still be loading, or the id is invalid." />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServiceDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(FleetStore);
  private readonly api = inject(FleetApiService);
  readonly selectedServiceId = signal('');
  readonly historyStatus = signal<'loading' | 'loaded' | 'error'>('loading');
  readonly historyPoints = computed(() => this.store.serviceHistory()[this.selectedServiceId()] ?? []);
  readonly service = computed(() => {
    return this.store.services().find((service) => service.id === this.selectedServiceId());
  });

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('id') ?? ''),
        distinctUntilChanged(),
        tap((serviceId) => {
          this.selectedServiceId.set(serviceId);
          this.historyStatus.set('loading');
        }),
        switchMap((serviceId) =>
          this.api.history(serviceId, 15).pipe(
            map((response) => ({ serviceId, points: normalizeHistory(response), failed: false })),
            catchError(() => of({ serviceId, points: [], failed: true })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ serviceId, points, failed }) => {
        if (serviceId !== this.selectedServiceId()) return;
        if (failed) {
          this.historyStatus.set('error');
          return;
        }
        this.store.setServiceHistory(serviceId, points);
        this.historyStatus.set('loaded');
      });
  }

  retryHistory(): void {
    this.historyStatus.set('loading');
    const serviceId = this.selectedServiceId();
    this.api.history(serviceId, 15).pipe(
      map((response) => normalizeHistory(response)),
      catchError(() => {
        this.historyStatus.set('error');
        return of(null);
      }),
    ).subscribe((points) => {
      if (!points || serviceId !== this.selectedServiceId()) return;
      this.store.setServiceHistory(serviceId, points);
      this.historyStatus.set('loaded');
    });
  }
}

function normalizeHistory(response: MetricHistoryResponse): MetricPoint[] {
  const points = response.points ?? response.items ?? [];
  return points
    .filter((point) => Number.isFinite(point.ts) && Number.isFinite(point.p95) && Number.isFinite(point.errRate) && Number.isFinite(point.rps))
    .map((point) => ({ ...point }));
}
