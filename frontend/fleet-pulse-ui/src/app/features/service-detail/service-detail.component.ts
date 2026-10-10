import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FleetStore } from '../../core/state/fleet-store.service';
import { MetricChartComponent } from '../../shared/components/metric-chart.component';
import { StateComponent } from '../../shared/components/state.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';

@Component({
  selector: 'app-service-detail',
  imports: [CommonModule, RouterLink, MetricChartComponent, StateComponent, StatCardComponent, StatusBadgeComponent],
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
          <app-metric-chart [values]="service.trend" [label]="service.name + ' latency history'" />
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
export class ServiceDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(FleetStore);
  readonly service = computed(() => {
    const id = this.route.snapshot.paramMap.get('id');
    return this.store.services().find((service) => service.id === id);
  });
}
