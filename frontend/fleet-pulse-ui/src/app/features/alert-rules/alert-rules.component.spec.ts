import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { FleetApiService } from '../../core/http/fleet-api.service';
import { FleetStore } from '../../core/state/fleet-store.service';
import { AlertRulesComponent } from './alert-rules.component';

describe('AlertRulesComponent', () => {
  it('adds unique valid conditions and stops at five', async () => {
    await TestBed.configureTestingModule({
      imports: [AlertRulesComponent],
      providers: [
        { provide: AuthService, useValue: { isOperator: () => true } },
        { provide: FleetApiService, useValue: { validateRuleName: () => of({ available: true }) } },
        { provide: FleetStore, useValue: { rules: signal([]), ruleActionError: signal(null) } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlertRulesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    const addButton = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    for (let index = 0; index < 4; index++) {
      addButton().click();
      fixture.detectChanges();
    }

    const pairs = component.conditions.controls.map((condition) =>
      `${condition.controls.metric.value}:${condition.controls.comparator.value}`,
    );
    expect(component.conditions.length).toBe(5);
    expect(new Set(pairs).size).toBe(5);
    expect(component.conditions.hasError('duplicateConditions')).toBe(false);
    expect(component.conditions.controls.every((condition) => condition.controls.threshold.valid)).toBe(true);
    expect(addButton().disabled).toBe(true);

    addButton().click();
    expect(component.conditions.length).toBe(5);
  });
});
