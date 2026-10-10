import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-stat-card',
  template: `
    <article class="kpi-card" [class]="tone()">
      <span>{{ label() }}</span>
      <strong>{{ value() }}</strong>
      <small>{{ detail() }}</small>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly detail = input.required<string>();
  readonly tone = input<'good' | 'warn' | 'bad' | ''>('');
}
