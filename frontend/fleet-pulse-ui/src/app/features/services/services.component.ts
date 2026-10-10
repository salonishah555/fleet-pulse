import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FleetStore } from '../../core/state/fleet-store.service';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { StateComponent } from '../../shared/components/state.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';

@Component({
  selector: 'app-services',
  imports: [CommonModule, RouterLink, PaginationComponent, StateComponent, StatusBadgeComponent],
  template: `
    <article class="panel service-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Inventory</span>
          <h2>Services</h2>
        </div>
        <span class="muted">{{ store.filteredServices().length }} matched</span>
      </div>

      <section class="filters" aria-label="Service filters">
        <label>
          <span>Search</span>
          <input type="search" [value]="store.query()" (input)="store.setQuery($any($event.target).value)" />
        </label>
        <label>
          <span>Status</span>
          <select [value]="store.statusFilter()" (change)="store.setStatus($any($event.target).value)">
            <option value="all">All statuses</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="down">Down</option>
          </select>
        </label>
        <label>
          <span>Team</span>
          <select [value]="store.teamFilter()" (change)="store.setTeam($any($event.target).value)">
            <option value="all">All teams</option>
            @for (team of store.teams(); track team) {
              <option [value]="team">{{ team }}</option>
            }
          </select>
        </label>
      </section>

      @if (store.loading()) {
        <app-state title="Loading services" />
      } @else if (store.error()) {
        <app-state title="Unable to load services" [message]="store.error() ?? ''" />
      } @else {
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th><button type="button" (click)="store.sortBy('name')">Service</button></th>
                <th><button type="button" (click)="store.sortBy('team')">Team</button></th>
                <th><button type="button" (click)="store.sortBy('status')">Status</button></th>
                <th><button type="button" (click)="store.sortBy('latency')">P95</button></th>
                <th><button type="button" (click)="store.sortBy('errorRate')">Errors</button></th>
                <th><button type="button" (click)="store.sortBy('rps')">RPS</button></th>
                <th><button type="button" (click)="store.sortBy('updatedAt')">Updated</button></th>
              </tr>
            </thead>
            <tbody>
              @for (service of store.visibleServices(); track service.id) {
                <tr [class.alert-row]="service.status !== 'healthy'" [routerLink]="['/services', service.id]">
                  <td><strong>{{ service.name }}</strong><small>{{ service.region }}</small></td>
                  <td>{{ service.team }}</td>
                  <td><app-status-badge [status]="service.status" [label]="service.status" /></td>
                  <td>{{ service.latency }}ms</td>
                  <td>{{ service.errorRate | number: '1.2-2' }}%</td>
                  <td>{{ service.rps | number: '1.0-0' }}</td>
                  <td>{{ service.updatedAt | date: 'shortTime' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="7"><app-state title="No matching services" message="Try a different filter." /></td></tr>
              }
            </tbody>
          </table>
        </div>
        <app-pagination [page]="store.page()" [pageCount]="store.pageCount()" (previous)="store.page.update(page => page - 1)" (next)="store.page.update(page => page + 1)" />
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicesComponent {
  readonly store = inject(FleetStore);
}
