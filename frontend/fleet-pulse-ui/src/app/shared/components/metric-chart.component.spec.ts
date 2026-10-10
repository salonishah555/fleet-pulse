import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { MetricChartComponent } from './metric-chart.component';

const chartHarness = vi.hoisted(() => ({
  instances: [] as {
    data: { labels: string[]; datasets: { data: number[] }[] };
    update: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[],
  register: vi.fn(),
}));

vi.mock('chart.js', () => ({
  Chart: class {
    static register = chartHarness.register;
    readonly data: { labels: string[]; datasets: { data: number[] }[] };
    readonly update = vi.fn();
    readonly destroy = vi.fn();

    constructor(_context: unknown, config: { data: { labels: string[]; datasets: { data: number[] }[] } }) {
      this.data = config.data;
      chartHarness.instances.push(this);
    }
  },
  registerables: [],
}));

describe('MetricChartComponent', () => {
  beforeEach(() => {
    chartHarness.instances.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders finite metric values with Chart.js and updates the existing chart', () => {
    const fixture = TestBed.createComponent(MetricChartComponent);
    fixture.componentRef.setInput('values', [1, Number.NaN, 3]);
    fixture.componentRef.setInput('label', 'Latency history');
    fixture.detectChanges();

    const chart = chartHarness.instances[0];
    expect(chart.data.datasets[0].data).toEqual([1, 3]);
    expect((fixture.nativeElement as HTMLElement).querySelector('canvas')?.getAttribute('aria-label')).toBe('Latency history');

    fixture.componentRef.setInput('values', [4, 5]);
    fixture.detectChanges();
    expect(chart.data.datasets[0].data).toEqual([4, 5]);
    expect(chart.update).toHaveBeenCalledWith('none');

    fixture.destroy();
    expect(chart.destroy).toHaveBeenCalledOnce();
  });
});
