import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { vi } from 'vitest';
import type { FleetService } from '../../core/models/ui.models';
import { FleetApiService } from '../../core/http/fleet-api.service';
import { FleetStore } from '../../core/state/fleet-store.service';
import { ServiceDetailComponent } from './service-detail.component';

describe('ServiceDetailComponent', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('loads the selected service 15-minute history and renders three metric charts', async () => {
    const service: FleetService = {
      id: 'svc-1',
      name: 'checkout-api',
      team: 'commerce',
      region: 'us-east',
      status: 'healthy',
      latency: 120,
      errorRate: 0.4,
      rps: 82,
      updatedAt: new Date('2026-10-10T10:00:00Z'),
      statusChanged: false,
      trend: { latency: [120], errorRate: [0.4], throughput: [82] },
    };
    const history = [{ ts: 1, p95: 120, errRate: 0.4, rps: 82, status: 'healthy' as const }];
    const routeParams = new BehaviorSubject(convertToParamMap({ id: 'svc-1' }));
    const store = {
      services: signal([service]),
      serviceHistory: signal({}),
      setServiceHistory: vi.fn(),
    };
    const api = { history: vi.fn(() => of({ serviceId: 'svc-1', minutes: 15, points: history })) };

    await TestBed.configureTestingModule({
      imports: [ServiceDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: routeParams.asObservable(), snapshot: { paramMap: convertToParamMap({ id: 'svc-1' }) } } },
        { provide: FleetStore, useValue: store },
        { provide: FleetApiService, useValue: api },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ServiceDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(api.history).toHaveBeenCalledWith('svc-1', 15);
    expect(store.setServiceHistory).toHaveBeenCalledWith('svc-1', history);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('app-metric-chart')).toHaveLength(3);

    routeParams.next(convertToParamMap({ id: 'svc-2' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.selectedServiceId()).toBe('svc-2');
  });
});
