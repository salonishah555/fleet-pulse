import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { FleetStore } from '../../core/state/fleet-store.service';
import type { FleetService } from '../../core/models/ui.models';
import { ServicesComponent } from './services.component';

@Component({ standalone: true, template: 'Service details' })
class ServiceDetailsStubComponent {}

describe('ServicesComponent', () => {
  it('renders a virtualized Material table and forwards search and sorting actions', async () => {
    const service: FleetService = {
      id: 'svc-1',
      name: 'checkout-api',
      team: 'commerce',
      region: 'us-east',
      status: 'degraded',
      latency: 420,
      errorRate: 1.25,
      rps: 92,
      updatedAt: new Date('2026-10-10T10:00:00Z'),
      statusChanged: false,
      trend: { latency: [400, 420], errorRate: [1, 1.25], throughput: [90, 92] },
    };
    const services = Array.from({ length: 2000 }, (_value, index) => ({
      ...service,
      id: `svc-${index + 1}`,
      name: index === 0 ? 'checkout-api' : `service-${index + 1}`,
    }));
    const store = {
      filteredServices: signal(services),
      sortedServices: signal(services),
      loading: signal(false),
      error: signal<string | null>(null),
      query: signal(''),
      statusFilter: signal('all'),
      teamFilter: signal('all'),
      sortKey: signal('name'),
      sortDirection: signal('asc'),
      teams: signal(['commerce']),
      setQuery: vi.fn(),
      setStatus: vi.fn(),
      setTeam: vi.fn(),
      sortBy: vi.fn(),
      setSort: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ServicesComponent],
      providers: [
        provideRouter([
          { path: 'services', component: ServicesComponent },
          { path: 'services/:id', component: ServiceDetailsStubComponent },
        ]),
        { provide: FleetStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ServicesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const viewportElement = fixture.nativeElement.querySelector('cdk-virtual-scroll-viewport') as HTMLElement;
    Object.defineProperty(viewportElement, 'clientHeight', { configurable: true, value: 432 });
    Object.defineProperty(viewportElement, 'scrollTo', { configurable: true, value: vi.fn() });
    fixture.debugElement.query(By.directive(CdkVirtualScrollViewport)).injector
      .get(CdkVirtualScrollViewport).checkViewportSize();
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('cdk-virtual-scroll-viewport')).not.toBeNull();
    expect(element.querySelector('table[role="table"]')).not.toBeNull();
    expect(element.querySelector('tr.mat-mdc-row')?.textContent).toContain('checkout-api');
    expect(store.sortedServices().length).toBe(2000);
    expect(element.querySelectorAll('tr.mat-mdc-row').length).toBeLessThan(60);
    expect(element.querySelector('[aria-label="Services pagination"]')).toBeNull();

    const search = element.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'checkout';
    search.dispatchEvent(new Event('input'));
    expect(store.setQuery).toHaveBeenCalledWith('checkout');

    (element.querySelector('th button') as HTMLButtonElement).click();
    expect(store.sortBy).toHaveBeenCalledWith('name');

    (element.querySelector('tr.mat-mdc-row') as HTMLTableRowElement).click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/services/svc-1');
  });
});
