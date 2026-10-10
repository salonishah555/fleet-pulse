import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { FleetStore } from '../../core/state/fleet-store.service';
import { StateComponent } from '../../shared/components/state.component';

@Component({
  selector: 'app-alert-rules',
  imports: [CommonModule, ReactiveFormsModule, StateComponent],
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
        <label><span>Name</span><input formControlName="name" /></label>
        <label>
          <span>Metric</span>
          <select formControlName="metric">
            <option value="p95 latency">P95 latency</option>
            <option value="error rate">Error rate</option>
            <option value="throughput">Throughput</option>
          </select>
        </label>
        <label>
          <span>When</span>
          <select formControlName="comparator">
            <option value=">">&gt;</option>
            <option value="<">&lt;</option>
          </select>
        </label>
        <label><span>Threshold</span><input type="number" formControlName="threshold" /></label>
        <label><span>Scope</span><input formControlName="scope" /></label>
        <button type="submit" [disabled]="form.invalid || !auth.isOperator()">Create rule</button>
      </form>

      @if (confirmDelete()) {
        <section class="confirm-dialog" role="alertdialog" aria-label="Confirm delete">
          <span>Delete this rule?</span>
          <button type="button" class="danger" (click)="deleteConfirmed()">Delete</button>
          <button type="button" (click)="confirmDelete.set(null)">Cancel</button>
        </section>
      }

      <section class="rules-list">
        @for (rule of store.rules(); track rule.id) {
          <article class="rule-item">
            <div>
              <strong>{{ rule.name }}</strong>
              <span>{{ rule.metric }} {{ rule.comparator }} {{ rule.threshold }} for {{ rule.scope }}</span>
            </div>
            <div class="rule-actions">
              <button type="button" [disabled]="!auth.isOperator()" (click)="store.toggleRule(rule)">{{ rule.enabled ? 'Disable' : 'Enable' }}</button>
              <button type="button" class="danger" [disabled]="!auth.isOperator()" (click)="confirmDelete.set(rule.id)">Delete</button>
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
  readonly auth = inject(AuthService);
  readonly store = inject(FleetStore);
  readonly confirmDelete = signal<string | null>(null);
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

  deleteConfirmed(): void {
    const ruleId = this.confirmDelete();
    if (!ruleId || !this.auth.isOperator()) return;
    this.store.deleteRule(ruleId);
    this.confirmDelete.set(null);
  }
}
