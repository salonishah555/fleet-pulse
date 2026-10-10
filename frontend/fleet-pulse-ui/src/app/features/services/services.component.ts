import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { FleetStore } from '../../core/state/fleet-store.service';
import { StateComponent } from '../../shared/components/state.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';

@Component({
  selector: 'app-services',
  imports: [CommonModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule, StateComponent, StatusBadgeComponent],
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
        <div #tableViewport class="table-wrap fleet-virtual-scroll" role="region" aria-label="Services table" tabindex="0" (scroll)="onScroll($event)">
          <div class="virtual-spacer" [style.height.px]="store.virtualTopSpace()" aria-hidden="true"></div>
          <table mat-table [dataSource]="store.visibleServices()" class="fleet-table">
            <ng-container matColumnDef="service">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="sortBy('name')">Service</button></th>
              <td mat-cell *matCellDef="let service"><a [routerLink]="['/services', service.id]" (click)="$event.stopPropagation()"><strong>{{ service.name }}</strong></a><small>{{ service.region }}</small></td>
            </ng-container>
            <ng-container matColumnDef="team">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="sortBy('team')">Team</button></th>
              <td mat-cell *matCellDef="let service">{{ service.team }}</td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="sortBy('status')">Status</button></th>
              <td mat-cell *matCellDef="let service"><span [class.status-flash]="service.statusChanged"><app-status-badge [status]="service.status" [label]="service.status" /></span></td>
            </ng-container>
            <ng-container matColumnDef="latency">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="sortBy('latency')">P95</button></th>
              <td mat-cell *matCellDef="let service">{{ service.latency }}ms</td>
            </ng-container>
            <ng-container matColumnDef="errors">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="sortBy('errorRate')">Errors</button></th>
              <td mat-cell *matCellDef="let service">{{ service.errorRate | number: '1.2-2' }}%</td>
            </ng-container>
            <ng-container matColumnDef="rps">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="sortBy('rps')">RPS</button></th>
              <td mat-cell *matCellDef="let service">{{ service.rps | number: '1.0-0' }}</td>
            </ng-container>
            <ng-container matColumnDef="updated">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="sortBy('updatedAt')">Updated</button></th>
              <td mat-cell *matCellDef="let service">{{ service.updatedAt | date: 'shortTime' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let service; columns: displayedColumns" [class.alert-row]="service.status !== 'healthy'" [routerLink]="['/services', service.id]"></tr>
          </table>
          <div class="virtual-spacer" [style.height.px]="store.virtualBottomSpace()" aria-hidden="true"></div>
        </div>
        @if (store.visibleServices().length === 0) {
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
  readonly displayedColumns = ['service', 'team', 'status', 'latency', 'errors', 'rps', 'updated'];
  @ViewChild('tableViewport') private tableViewport?: ElementRef<HTMLElement>;

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
      this.store.setPage(parsePage(params.get('page')));
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

  onScroll(event: Event): void {
    const element = event.target as HTMLElement;
    const header = element.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    this.store.setWindowStart(Math.floor(Math.max(0, element.scrollTop - header) / this.store.rowHeight));
  }

  private resetTableScroll(): void {
    if (this.tableViewport) this.tableViewport.nativeElement.scrollTop = 0;
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

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function isSortKey(value: string | null): value is Parameters<FleetStore['setSort']>[0] {
  return value !== null && ['name', 'team', 'status', 'latency', 'errorRate', 'rps', 'updatedAt'].includes(value);
}
