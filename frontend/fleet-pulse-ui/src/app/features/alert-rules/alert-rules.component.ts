import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { AuthService } from '../../core/auth/auth.service';
import { FleetStore } from '../../core/state/fleet-store.service';
import { StateComponent } from '../../shared/components/state.component';
import { ConfirmDeleteDialogComponent } from '../../shared/components/confirm-delete-dialog.component';

@Component({
  selector: 'app-alert-rules',
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, StateComponent],
  template: `
    <article class="panel rules-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Alerting</span>
          <h2>Alert rules</h2>
        </div>
        <span class="muted">{{ store.rules().length }} configured</span>
      </div>

      @if (!auth.isOperator()) {
        <app-state title="Viewer access" message="Viewers can inspect alert rules, but only operators can change them." />
      }

      <form class="rule-form" [formGroup]="form" (ngSubmit)="createRule()">
        <mat-form-field appearance="outline"><mat-label>Name</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Metric</mat-label>
          <mat-select formControlName="metric">
            <mat-option value="p95 latency">P95 latency</mat-option>
            <mat-option value="error rate">Error rate</mat-option>
            <mat-option value="throughput">Throughput</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>When</mat-label>
          <mat-select formControlName="comparator">
            <mat-option value=">">&gt;</mat-option>
            <mat-option value="<">&lt;</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Threshold</mat-label><input matInput type="number" formControlName="threshold" /></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Scope</mat-label><input matInput formControlName="scope" /></mat-form-field>
        <button matButton="filled" type="submit" [disabled]="form.invalid || !auth.isOperator()">Create rule</button>
      </form>

      <section class="rules-list">
        @for (rule of store.rules(); track rule.id) {
          <article class="rule-item">
            <div>
              <strong>{{ rule.name }}</strong>
              <span>{{ rule.metric }} {{ rule.comparator }} {{ rule.threshold }} for {{ rule.scope }}</span>
            </div>
            <div class="rule-actions">
              <button matButton="outlined" type="button" [disabled]="!auth.isOperator()" (click)="store.toggleRule(rule)">{{ rule.enabled ? 'Disable' : 'Enable' }}</button>
              <button matButton="outlined" type="button" class="danger" [disabled]="!auth.isOperator()" (click)="confirmDelete(rule.id, rule.name)">Delete</button>
            </div>
          </article>
        } @empty {
          <app-state title="No alert rules" message="Create the first rule above." />
        }
      </section>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertRulesComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialog = inject(MatDialog);
  readonly auth = inject(AuthService);
  readonly store = inject(FleetStore);
  readonly form = this.fb.nonNullable.group({
    name: ['', Validators.required],
    metric: ['p95 latency' as const, Validators.required],
    comparator: ['>' as const, Validators.required],
    threshold: [300, [Validators.required, Validators.min(0)]],
    scope: ['global', Validators.required],
  });

  createRule(): void {
    if (this.form.invalid || !this.auth.isOperator()) return;
    this.store.createRule(this.form.getRawValue());
    this.form.patchValue({ name: '' });
  }

  confirmDelete(ruleId: string, ruleName: string): void {
    if (!this.auth.isOperator()) return;
    this.dialog
      .open(ConfirmDeleteDialogComponent, {
        data: { ruleName },
        ariaLabel: 'Confirm alert rule deletion',
      })
      .afterClosed()
      .subscribe((confirmed: boolean | undefined) => {
        if (confirmed && this.auth.isOperator()) this.store.deleteRule(ruleId);
      });
  }
}
