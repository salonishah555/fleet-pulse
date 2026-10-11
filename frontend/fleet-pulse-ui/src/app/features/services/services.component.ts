import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FleetStore } from '../../core/state/fleet-store.service';
import type { FleetService } from '../../core/models/ui.models';
import { StateComponent } from '../../shared/components/state.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';

@Component({
  selector: 'app-services',
  imports: [CommonModule, RouterLink, ScrollingModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, StateComponent, StatusBadgeComponent],
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
        <mat-form-field appearance="outline">
          <mat-label>Search services</mat-label>
          <input matInput type="search" [value]="store.query()" (input)="updateQuery($any($event.target).value)" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Status</mat-label>
          <mat-select [value]="store.statusFilter()" (selectionChange)="updateStatus($event.value)">
            <mat-option value="all">All statuses</mat-option>
            <mat-option value="healthy">Healthy</mat-option>
            <mat-option value="degraded">Degraded</mat-option>
            <mat-option value="down">Down</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Team</mat-label>
          <mat-select [value]="store.teamFilter()" (selectionChange)="updateTeam($event.value)">
            <mat-option value="all">All teams</mat-option>
            @for (team of store.teams(); track team) {
              <mat-option [value]="team">{{ team }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </section>

      @if (store.loading()) {
        <app-state title="Loading services" />
      } @else if (store.error()) {
        <app-state title="Unable to load services" [message]="store.error() ?? ''" />
      } @else {
        <cdk-virtual-scroll-viewport
          #tableViewport
          class="fleet-virtual-scroll"
          role="region"
          aria-label="Services table"
          tabindex="0"
          [itemSize]="rowHeight"
          [minBufferPx]="432"
          [maxBufferPx]="864"
        >
          <table class="mat-mdc-table fleet-table" role="table">
            <thead>
              <tr class="mat-mdc-header-row">
                <th class="mat-mdc-header-cell" scope="col"><button mat-button type="button" (click)="sortBy('name')">Service</button></th>
                <th class="mat-mdc-header-cell" scope="col"><button mat-button type="button" (click)="sortBy('team')">Team</button></th>
                <th class="mat-mdc-header-cell" scope="col"><button mat-button type="button" (click)="sortBy('status')">Status</button></th>
                <th class="mat-mdc-header-cell" scope="col"><button mat-button type="button" (click)="sortBy('latency')">P95</button></th>
                <th class="mat-mdc-header-cell" scope="col"><button mat-button type="button" (click)="sortBy('errorRate')">Errors</button></th>
                <th class="mat-mdc-header-cell" scope="col"><button mat-button type="button" (click)="sortBy('rps')">RPS</button></th>
                <th class="mat-mdc-header-cell" scope="col"><button mat-button type="button" (click)="sortBy('updatedAt')">Updated</button></th>
              </tr>
            </thead>
            <tbody>
              <tr
                class="mat-mdc-row"
                *cdkVirtualFor="let service of store.sortedServices(); trackBy: trackService"
                [class.alert-row]="service.status !== 'healthy'"
                [routerLink]="['/services', service.id]"
              >
                <td class="mat-mdc-cell"><a [routerLink]="['/services', service.id]" (click)="$event.stopPropagation()"><strong>{{ service.name }}</strong></a><small>{{ service.region }}</small></td>
                <td class="mat-mdc-cell">{{ service.team }}</td>
                <td class="mat-mdc-cell"><span [class.status-flash]="service.statusChanged"><app-status-badge [status]="service.status" [label]="service.status" /></span></td>
                <td class="mat-mdc-cell">{{ service.latency }}ms</td>
                <td class="mat-mdc-cell">{{ service.errorRate | number: '1.2-2' }}%</td>
                <td class="mat-mdc-cell">{{ service.rps | number: '1.0-0' }}</td>
                <td class="mat-mdc-cell">{{ service.updatedAt | date: 'shortTime' }}</td>
              </tr>
            </tbody>
          </table>
        </cdk-virtual-scroll-viewport>
        @if (store.sortedServices().length === 0) {
          <app-state title="No matching services" message="Try a different filter." />
        }
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicesComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly store = inject(FleetStore);
  readonly rowHeight = 54;
  @ViewChild(CdkVirtualScrollViewport) private tableViewport?: CdkVirtualScrollViewport;

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      this.store.setQuery(params.get('q') ?? '');
      this.store.setStatus(params.get('status') ?? 'all');
      this.store.setTeam(params.get('team') ?? 'all');
      const sort = params.get('sort');
      const direction = params.get('direction');
      this.restoreSort(
        isSortKey(sort) ? sort : 'status',
        direction === 'asc' || direction === 'desc' ? direction : 'desc',
      );
      this.resetTableScroll();
    });
  }

  updateQuery(value: string): void {
    this.store.setQuery(value);
    this.resetTableScroll();
    this.syncUrl();
  }

  updateStatus(value: string): void {
    this.store.setStatus(value);
    this.resetTableScroll();
    this.syncUrl();
  }

  updateTeam(value: string): void {
    this.store.setTeam(value);
    this.resetTableScroll();
    this.syncUrl();
  }

  sortBy(key: Parameters<FleetStore['sortBy']>[0]): void {
    this.store.sortBy(key);
    this.resetTableScroll();
    this.syncUrl();
  }

  restoreSort(key: Parameters<FleetStore['setSort']>[0], direction: 'asc' | 'desc'): void {
    this.store.setSort(key, direction);
  }

  trackService(_index: number, service: FleetService): string {
    return service.id;
  }

  private resetTableScroll(): void {
    this.tableViewport?.scrollToIndex(0);
  }

  private syncUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: this.store.query() || null,
        status: this.store.statusFilter() === 'all' ? null : this.store.statusFilter(),
        team: this.store.teamFilter() === 'all' ? null : this.store.teamFilter(),
        sort: this.store.sortKey(),
        direction: this.store.sortDirection(),
      },
      replaceUrl: true,
    });
  }
}

function isSortKey(value: string | null): value is Parameters<FleetStore['setSort']>[0] {
  return value !== null && ['name', 'team', 'status', 'latency', 'errorRate', 'rps', 'updatedAt'].includes(value);
}
