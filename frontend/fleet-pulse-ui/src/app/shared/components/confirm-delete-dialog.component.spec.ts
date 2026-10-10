import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { vi } from 'vitest';
import { ConfirmDeleteDialogComponent } from './confirm-delete-dialog.component';

describe('ConfirmDeleteDialogComponent', () => {
  it('displays the selected rule and returns the user decision', async () => {
    const close = vi.fn();
    await TestBed.configureTestingModule({
      imports: [ConfirmDeleteDialogComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { ruleName: 'Latency breach' } },
        { provide: MatDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ConfirmDeleteDialogComponent);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Latency breach');
    const buttons = Array.from(element.querySelectorAll('button'));
    expect(buttons).toHaveLength(2);

    buttons[0].click();
    expect(close).toHaveBeenCalledWith(false);
    buttons[1].click();
    expect(close).toHaveBeenCalledWith(true);
  });
});
