import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FleetStore } from '../../core/state/fleet-store.service';
import { MetricChartComponent } from '../../shared/components/metric-chart.component';
import { StateComponent } from '../../shared/components/state.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, StatCardComponent, StatusBadgeComponent, MetricChartComponent, StateComponent],
  template: `
    @if (store.loading()) {
      <app-state title="Loading fleet telemetry" message="Fetching the latest metrics snapshot." />
    } @else if (store.error()) {
      <app-state title="Unable to load dashboard" [message]="store.error() ?? ''" />
    } @else {
      <section class="kpi-grid" aria-label="Fleet summary">
        <app-stat-card label="Services" [value]="summary().total" detail="2,000 generated services" />
        <app-stat-card label="Healthy" [value]="summary().healthy" detail="No active SLO pressure" tone="good" />
        <app-stat-card label="Degraded" [value]="summary().degraded" detail="Needs investigation" tone="warn" />
        <app-stat-card label="Down" [value]="summary().down" detail="Critical response required" tone="bad" />
        <app-stat-card label="Avg P95" [value]="summary().avgLatency + 'ms'" [detail]="summary().totalRps + ' total RPS'" />
      </section>

      <section class="dashboard-grid">
        <article class="panel service-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">Highest priority</span>
              <h2>Services needing attention</h2>
            </div>
            <a class="text-link" routerLink="/services">View all</a>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th>P95</th>
                  <th>Errors</th>
                  <th>RPS</th>
                </tr>
              </thead>
              <tbody>
                @for (service of priorityServices(); track service.id) {
                  <tr [class.alert-row]="service.status !== 'healthy'" [routerLink]="['/services', service.id]">
                    <td><strong>{{ service.name }}</strong><small>{{ service.region }}</small></td>
                    <td>{{ service.team }}</td>
                    <td><app-status-badge [status]="service.status" [label]="service.status" /></td>
                    <td>{{ service.latency }}ms</td>
                    <td>{{ service.errorRate | number: '1.2-2' }}%</td>
                    <td>{{ service.rps | number: '1.0-0' }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="6"><app-state title="No services loaded" /></td></tr>
                }
              </tbody>
            </table>
          </div>
        </article>

        <aside class="right-rail">
          <article class="panel">
            <span class="eyebrow">Latency trend</span>
            <h2>{{ featuredService().name }}</h2>
            @if (featuredService(); as service) {
              <div class="metric-row">
                <div><span>P95 latency</span><strong>{{ service.latency }}ms</strong></div>
                <div><span>Error rate</span><strong>{{ service.errorRate | number: '1.2-2' }}%</strong></div>
              </div>
              <app-metric-chart [values]="service.trend" [label]="service.name + ' latency trend'" />
            }
          </article>

          <article class="panel">
            <div class="panel-heading">
              <div>
                <span class="eyebrow">Recent incidents</span>
                <h2>Live impact</h2>
              </div>
              <a class="text-link" routerLink="/incidents">Open</a>
            </div>
            @for (incident of store.incidents().slice(0, 5); track incident.id) {
              <div class="incident">
                <app-status-badge [status]="incident.severity === 'critical' ? 'down' : incident.severity === 'warning' ? 'degraded' : 'healthy'" [label]="incident.severity" />
                <p>{{ incident.service }}</p>
                <span>{{ incident.message }} · {{ incident.time }}</span>
              </div>
            } @empty {
              <app-state title="No active incidents" message="The fleet is currently healthy." />
            }
          </article>
        </aside>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  readonly store = inject(FleetStore);
  readonly summary = this.store.summary;
  readonly priorityServices = computed(() => this.store.sortedServices().filter((service) => service.status !== 'healthy').slice(0, 10));
  readonly featuredService = computed(() => this.priorityServices()[0] ?? this.store.services()[0]);
}
