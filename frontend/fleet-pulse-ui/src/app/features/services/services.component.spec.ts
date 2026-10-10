import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { FleetStore } from '../../core/state/fleet-store.service';
import type { FleetService } from '../../core/models/ui.models';
import { ServicesComponent } from './services.component';

describe('ServicesComponent', () => {
  it('renders Material table rows and forwards search and sorting actions', async () => {
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
      trend: [400, 420],
    };
    const store = {
      filteredServices: signal([service]),
      visibleServices: signal([service]),
      loading: signal(false),
      error: signal<string | null>(null),
      query: signal(''),
      statusFilter: signal('all'),
      teamFilter: signal('all'),
      teams: signal(['commerce']),
      page: signal(1),
      pageCount: signal(1),
      setQuery: vi.fn(),
      setStatus: vi.fn(),
      setTeam: vi.fn(),
      sortBy: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ServicesComponent],
      providers: [provideRouter([]), { provide: FleetStore, useValue: store }],
    }).compileComponents();

    const fixture = TestBed.createComponent(ServicesComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('table[mat-table]')).not.toBeNull();
    expect(element.querySelector('tr.mat-mdc-row')?.textContent).toContain('checkout-api');

    const search = element.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'checkout';
    search.dispatchEvent(new Event('input'));
    expect(store.setQuery).toHaveBeenCalledWith('checkout');

    (element.querySelector('th button') as HTMLButtonElement).click();
    expect(store.sortBy).toHaveBeenCalledWith('name');
  });
});
