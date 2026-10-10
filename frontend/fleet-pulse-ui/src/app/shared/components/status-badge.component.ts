import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ServiceStatus } from '../../core/models/api.models';

@Component({
  selector: 'app-status-badge',
  template: `<span class="status-pill" [class]="status()">{{ label() }}</span>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadgeComponent {
  readonly status = input.required<ServiceStatus | 'healthy' | 'degraded' | 'down'>();
  readonly label = input.required<string>();
}
