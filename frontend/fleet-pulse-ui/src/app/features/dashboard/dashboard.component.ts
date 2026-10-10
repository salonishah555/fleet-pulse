import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { FleetStore } from '../../core/state/fleet-store.service';
import { MetricChartComponent } from '../../shared/components/metric-chart.component';
import { StateComponent } from '../../shared/components/state.component';
import { StatCardComponent } from '../../shared/components/stat-card.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink, MatButtonModule, MatTableModule, StatCardComponent, StatusBadgeComponent, MetricChartComponent, StateComponent],
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
            <a matButton class="text-link" routerLink="/services">View all</a>
          </div>
          <div class="table-wrap">
            <table mat-table [dataSource]="priorityServices()" class="fleet-table">
              <ng-container matColumnDef="service">
                <th mat-header-cell *matHeaderCellDef>Service</th>
                <td mat-cell *matCellDef="let service"><strong>{{ service.name }}</strong><small>{{ service.region }}</small></td>
              </ng-container>
              <ng-container matColumnDef="team">
                <th mat-header-cell *matHeaderCellDef>Team</th>
                <td mat-cell *matCellDef="let service">{{ service.team }}</td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let service"><app-status-badge [status]="service.status" [label]="service.status" /></td>
              </ng-container>
              <ng-container matColumnDef="latency">
                <th mat-header-cell *matHeaderCellDef>P95</th>
                <td mat-cell *matCellDef="let service">{{ service.latency }}ms</td>
              </ng-container>
              <ng-container matColumnDef="errors">
                <th mat-header-cell *matHeaderCellDef>Errors</th>
                <td mat-cell *matCellDef="let service">{{ service.errorRate | number: '1.2-2' }}%</td>
              </ng-container>
              <ng-container matColumnDef="rps">
                <th mat-header-cell *matHeaderCellDef>RPS</th>
                <td mat-cell *matCellDef="let service">{{ service.rps | number: '1.0-0' }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let service; columns: displayedColumns" [class.alert-row]="service.status !== 'healthy'" [routerLink]="['/services', service.id]"></tr>
            </table>
            @if (priorityServices().length === 0) {
              <app-state title="No services loaded" />
            }
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
              <app-metric-chart [values]="service.trend.latency" [label]="service.name + ' latency trend'" />
            }
          </article>

          <article class="panel">
            <div class="panel-heading">
              <div>
                <span class="eyebrow">Recent incidents</span>
                <h2>Live impact</h2>
              </div>
              <a matButton class="text-link" routerLink="/incidents">Open</a>
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
  readonly displayedColumns = ['service', 'team', 'status', 'latency', 'errors', 'rps'];
  readonly summary = this.store.summary;
  readonly priorityServices = computed(() => this.store.sortedServices().filter((service) => service.status !== 'healthy').slice(0, 10));
  readonly featuredService = computed(() => this.priorityServices()[0] ?? this.store.services()[0]);
}
