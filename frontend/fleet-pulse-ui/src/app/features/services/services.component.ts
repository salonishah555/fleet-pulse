import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { FleetStore } from '../../core/state/fleet-store.service';
import { PaginationComponent } from '../../shared/components/pagination.component';
import { StateComponent } from '../../shared/components/state.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';

@Component({
  selector: 'app-services',
  imports: [CommonModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule, PaginationComponent, StateComponent, StatusBadgeComponent],
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
          <input matInput type="search" [value]="store.query()" (input)="store.setQuery($any($event.target).value)" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Status</mat-label>
          <mat-select [value]="store.statusFilter()" (selectionChange)="store.setStatus($event.value)">
            <mat-option value="all">All statuses</mat-option>
            <mat-option value="healthy">Healthy</mat-option>
            <mat-option value="degraded">Degraded</mat-option>
            <mat-option value="down">Down</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Team</mat-label>
          <mat-select [value]="store.teamFilter()" (selectionChange)="store.setTeam($event.value)">
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
        <div class="table-wrap">
          <table mat-table [dataSource]="store.visibleServices()" class="fleet-table">
            <ng-container matColumnDef="service">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="store.sortBy('name')">Service</button></th>
              <td mat-cell *matCellDef="let service"><strong>{{ service.name }}</strong><small>{{ service.region }}</small></td>
            </ng-container>
            <ng-container matColumnDef="team">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="store.sortBy('team')">Team</button></th>
              <td mat-cell *matCellDef="let service">{{ service.team }}</td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="store.sortBy('status')">Status</button></th>
              <td mat-cell *matCellDef="let service"><app-status-badge [status]="service.status" [label]="service.status" /></td>
            </ng-container>
            <ng-container matColumnDef="latency">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="store.sortBy('latency')">P95</button></th>
              <td mat-cell *matCellDef="let service">{{ service.latency }}ms</td>
            </ng-container>
            <ng-container matColumnDef="errors">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="store.sortBy('errorRate')">Errors</button></th>
              <td mat-cell *matCellDef="let service">{{ service.errorRate | number: '1.2-2' }}%</td>
            </ng-container>
            <ng-container matColumnDef="rps">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="store.sortBy('rps')">RPS</button></th>
              <td mat-cell *matCellDef="let service">{{ service.rps | number: '1.0-0' }}</td>
            </ng-container>
            <ng-container matColumnDef="updated">
              <th mat-header-cell *matHeaderCellDef><button mat-button type="button" (click)="store.sortBy('updatedAt')">Updated</button></th>
              <td mat-cell *matCellDef="let service">{{ service.updatedAt | date: 'shortTime' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let service; columns: displayedColumns" [class.alert-row]="service.status !== 'healthy'" [routerLink]="['/services', service.id]"></tr>
          </table>
        </div>
        @if (store.visibleServices().length === 0) {
          <app-state title="No matching services" message="Try a different filter." />
        }
        <app-pagination [page]="store.page()" [pageCount]="store.pageCount()" (previous)="store.page.update(page => page - 1)" (next)="store.page.update(page => page + 1)" />
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServicesComponent {
  readonly store = inject(FleetStore);
  readonly displayedColumns = ['service', 'team', 'status', 'latency', 'errors', 'rps', 'updated'];
}
