import { DOCUMENT } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnChanges, OnDestroy, ViewChild, computed, inject, input } from '@angular/core';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-metric-chart',
  template: `
    <canvas #canvas class="chart" role="img" [attr.aria-label]="label()"></canvas>
    @if (!hasData()) {
      <p class="muted">No metric data available.</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas') private canvas?: ElementRef<HTMLCanvasElement>;

  private readonly document = inject(DOCUMENT);
  readonly values = input.required<number[]>();
  readonly label = input('Metric trend chart');
  private readonly finiteValues = computed(() => this.values().filter(Number.isFinite));
  readonly hasData = computed(() => this.finiteValues().length > 0);
  private chart?: Chart<'line', number[], string>;
  private viewInitialized = false;
  private themeObserver?: MutationObserver;

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.themeObserver = new MutationObserver(() => {
      this.chart?.destroy();
      this.chart = undefined;
      this.renderChart();
    });
    this.themeObserver.observe(this.document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-scheme'],
    });
    this.renderChart();
  }

  ngOnChanges(): void {
    if (this.viewInitialized) this.renderChart();
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
    this.chart?.destroy();
  }

  private renderChart(): void {
    const canvas = this.canvas?.nativeElement;
    const values = this.finiteValues();
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const isLight = this.document.documentElement.dataset['colorScheme'] === 'light';

    if (!this.chart) {
      this.chart = new Chart(context, {
        type: 'line',
        data: {
          labels: values.map((_value, index) => String(index + 1)),
          datasets: [{
            data: values,
            borderColor: isLight ? '#0369a1' : '#38bdf8',
            backgroundColor: isLight ? 'rgba(3, 105, 161, 0.12)' : 'rgba(56, 189, 248, 0.12)',
            fill: true,
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.25,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            y: {
              ticks: { color: isLight ? '#475569' : '#94a3b8' },
              grid: { color: isLight ? 'rgba(71, 85, 105, 0.18)' : 'rgba(148, 163, 184, 0.14)' },
            },
          },
        },
      });
      return;
    }

    this.chart.data.labels = values.map((_value, index) => String(index + 1));
    this.chart.data.datasets[0].data = values;
    this.chart.update('none');
  }
}
