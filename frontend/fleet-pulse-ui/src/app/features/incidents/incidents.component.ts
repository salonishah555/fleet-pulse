import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FleetStore } from '../../core/state/fleet-store.service';
import { StateComponent } from '../../shared/components/state.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge.component';

@Component({
  selector: 'app-incidents',
  imports: [CommonModule, StateComponent, StatusBadgeComponent],
  template: `
    <article class="panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Incidents</span>
          <h2>Current impact</h2>
        </div>
        <span class="muted">{{ store.incidents().length }} active</span>
      </div>
      @for (incident of store.incidents(); track incident.id) {
        <div class="incident">
          <app-status-badge [status]="incident.severity === 'critical' ? 'down' : incident.severity === 'warning' ? 'degraded' : 'healthy'" [label]="incident.severity" />
          <p>{{ incident.service }}</p>
          <span>{{ incident.message }} · {{ incident.time }}</span>
        </div>
      } @empty {
        <app-state title="No active incidents" message="The realtime stream has not reported degraded or down services." />
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncidentsComponent {
  readonly store = inject(FleetStore);
}
