import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-metric-chart',
  template: `
    <svg class="chart" viewBox="0 0 190 54" role="img" [attr.aria-label]="label()">
      <polyline [attr.points]="points()" />
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricChartComponent {
  readonly values = input.required<number[]>();
  readonly label = input('Metric trend chart');
  readonly points = computed(() => {
    const values = this.values();
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    return values
      .map((value, index) => {
        const x = (index / Math.max(1, values.length - 1)) * 190;
        const y = 54 - ((value - min) / range) * 54;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });
}
