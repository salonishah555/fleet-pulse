import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-state',
  template: `
    <div class="empty-state" role="status">
      <strong>{{ title() }}</strong>
      @if (message()) {
        <p>{{ message() }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StateComponent {
  readonly title = input.required<string>();
  readonly message = input('');
}
