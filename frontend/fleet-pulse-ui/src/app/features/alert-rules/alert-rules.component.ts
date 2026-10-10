import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators, type AsyncValidatorFn } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { catchError, finalize, map, of, switchMap, timer } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { FleetApiService } from '../../core/http/fleet-api.service';
import { FleetStore } from '../../core/state/fleet-store.service';
import type { AlertRule } from '../../core/models/ui.models';
import { StateComponent } from '../../shared/components/state.component';
import { ConfirmDeleteDialogComponent } from '../../shared/components/confirm-delete-dialog.component';
import { durationRangeValidator, metricThresholdValidator, uniqueConditionValidator } from './alert-rule.validators';

type RuleMetric = AlertRule['conditions'][number]['metric'];
type RuleOperator = AlertRule['conditions'][number]['comparator'];
type ConditionForm = FormGroup<{
  metric: FormControl<RuleMetric>;
  comparator: FormControl<RuleOperator>;
  threshold: FormControl<number>;
  durationSec: FormControl<number>;
}>;

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
        <app-state title="Operator access required" message="Only operators can view or change alert rules." />
      } @else {
        @if (store.ruleActionError()) {
          <p class="form-error" role="alert">{{ store.ruleActionError() }}</p>
        }
        <form class="rule-form" [formGroup]="form" (ngSubmit)="saveRule()">
          <mat-form-field appearance="outline">
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" autocomplete="off" />
            @if (form.controls.name.pending) { <mat-hint>Checking name…</mat-hint> }
            @if (form.controls.name.hasError('duplicateName')) { <mat-error>This rule name is already in use.</mat-error> }
            @if (form.controls.name.hasError('nameCheckUnavailable')) { <mat-error>Name availability could not be checked.</mat-error> }
          </mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Scope (global or team)</mat-label><input matInput formControlName="scope" /></mat-form-field>

          <section class="condition-editor" formArrayName="conditions" aria-label="Rule conditions">
            <div class="panel-heading">
              <h3>Conditions</h3>
              <button matButton="outlined" type="button" [disabled]="conditions.length >= 5" (click)="addCondition()">Add condition</button>
            </div>
            @if (conditions.hasError('duplicateConditions')) {
              <p class="form-error" role="alert">Each metric/operator pair can appear only once.</p>
            }
            @for (condition of conditions.controls; track condition; let index = $index) {
              <div class="condition-row" [formGroupName]="index">
                <mat-form-field appearance="outline">
                  <mat-label>Metric</mat-label>
                  <mat-select formControlName="metric" (selectionChange)="condition.controls.threshold.updateValueAndValidity()">
                    <mat-option value="p95 latency">P95 latency (ms)</mat-option>
                    <mat-option value="error rate">Error rate (%)</mat-option>
                    <mat-option value="throughput">Requests per second</mat-option>
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Operator</mat-label>
                  <mat-select formControlName="comparator">
                    <mat-option value=">">&gt;</mat-option>
                    <mat-option value=">=">&gt;=</mat-option>
                    <mat-option value="<">&lt;</mat-option>
                    <mat-option value="<=">&lt;=</mat-option>
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>{{ thresholdLabel(condition) }}</mat-label>
                  <input matInput type="number" formControlName="threshold" />
                  @if (condition.controls.threshold.hasError('thresholdRange')) {
                    <mat-error>Enter a value within the valid range for this metric.</mat-error>
                  }
                </mat-form-field>
                <mat-form-field appearance="outline">
                  <mat-label>Duration (seconds)</mat-label>
                  <input matInput type="number" formControlName="durationSec" />
                  @if (condition.controls.durationSec.hasError('durationRange')) {
                    <mat-error>Duration must be from 1 to 3600 seconds.</mat-error>
                  }
                </mat-form-field>
                <button matButton="outlined" class="danger" type="button" [disabled]="conditions.length <= 1" (click)="removeCondition(index)">Remove</button>
              </div>
            }
          </section>

          @if (formError()) { <p class="form-error" role="alert">{{ formError() }}</p> }
          <div class="form-actions">
            <button matButton="filled" type="submit" [disabled]="form.invalid || form.pending || saving()">
              {{ saving() ? 'Saving…' : editingRuleId() ? 'Save changes' : 'Create rule' }}
            </button>
            @if (editingRuleId()) {
              <button matButton="outlined" type="button" (click)="resetForm()">Cancel edit</button>
            }
          </div>
        </form>

        <section class="rules-list">
          @for (rule of store.rules(); track rule.id) {
            <article class="rule-item">
              <div>
                <strong>{{ rule.name }}</strong>
                @for (condition of rule.conditions; track $index) {
                  <span>{{ condition.metric }} {{ condition.comparator }} {{ condition.threshold }} for {{ condition.durationSec }}s</span>
                }
                <span>Scope: {{ rule.scope }} · {{ rule.enabled ? 'Enabled' : 'Disabled' }}</span>
              </div>
              <div class="rule-actions">
                <button matButton="outlined" type="button" (click)="editRule(rule)">Edit</button>
                <button matButton="outlined" type="button" (click)="store.toggleRule(rule)">{{ rule.enabled ? 'Disable' : 'Enable' }}</button>
                <button matButton="outlined" type="button" class="danger" (click)="confirmDelete(rule.id, rule.name)">Delete</button>
              </div>
            </article>
          } @empty {
            <app-state title="No alert rules" message="Create the first rule above." />
          }
        </section>
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertRulesComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly dialog = inject(MatDialog);
  private readonly api = inject(FleetApiService);
  readonly auth = inject(AuthService);
  readonly store = inject(FleetStore);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);
  readonly editingRuleId = signal<string | null>(null);
  readonly conditions = this.fb.array<ConditionForm>([this.createCondition()], { validators: uniqueConditionValidator });
  readonly form = this.fb.group({
    name: this.fb.control('', {
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(80)],
      asyncValidators: [this.uniqueNameValidator()],
      updateOn: 'change',
    }),
    scope: this.fb.control('global', [Validators.required, Validators.maxLength(80)]),
    conditions: this.conditions,
  });

  addCondition(): void {
    if (this.conditions.length >= 5) return;
    const usedPairs = new Set(this.conditions.controls.map((condition) =>
      `${condition.controls.metric.value}:${condition.controls.comparator.value}`,
    ));
    const metrics: RuleMetric[] = ['p95 latency', 'error rate', 'throughput'];
    const comparators: RuleOperator[] = ['>', '>=', '<', '<='];
    for (const metric of metrics) {
      const comparator = comparators.find((operator) => !usedPairs.has(`${metric}:${operator}`));
      if (!comparator) continue;
      const threshold = metric === 'error rate' ? 2 : metric === 'throughput' ? 100 : 300;
      this.conditions.push(this.createCondition({ metric, comparator, threshold }));
      break;
    }
    this.conditions.updateValueAndValidity();
  }

  removeCondition(index: number): void {
    if (this.conditions.length > 1) this.conditions.removeAt(index);
    this.conditions.updateValueAndValidity();
  }

  thresholdLabel(condition: ConditionForm): string {
    const metric = condition.controls.metric.value;
    if (metric === 'error rate') return 'Threshold (%)';
    if (metric === 'throughput') return 'Threshold (req/s)';
    return 'Threshold (ms)';
  }

  saveRule(): void {
    this.formError.set(null);
    if (!this.auth.isOperator()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid || this.form.pending || this.saving()) return;

    const value = this.form.getRawValue();
    const rule = {
      name: value.name.trim(),
      scope: value.scope.trim(),
      conditions: value.conditions,
    };
    this.saving.set(true);
    const operation = this.editingRuleId()
      ? this.store.updateRule({ ...rule, id: this.editingRuleId()!, enabled: this.store.rules().find((item) => item.id === this.editingRuleId())?.enabled ?? true })
      : this.store.createRule(rule);
    operation.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => this.resetForm(),
      error: () => this.formError.set('The rule could not be saved. Your previous rule list has been restored.'),
    });
  }

  editRule(rule: AlertRule): void {
    if (!this.auth.isOperator()) return;
    this.editingRuleId.set(rule.id);
    this.form.controls.name.setValue(rule.name);
    this.form.controls.scope.setValue(rule.scope);
    while (this.conditions.length) this.conditions.removeAt(0);
    for (const condition of rule.conditions) this.conditions.push(this.createCondition(condition));
    this.conditions.updateValueAndValidity();
    this.form.markAsPristine();
  }

  resetForm(): void {
    this.editingRuleId.set(null);
    this.formError.set(null);
    this.form.reset({ name: '', scope: 'global' });
    while (this.conditions.length) this.conditions.removeAt(0);
    this.conditions.push(this.createCondition());
  }

  confirmDiscardChanges(): boolean {
    if (!this.form.dirty || this.saving()) return true;
    return window.confirm('Discard unsaved alert rule changes?');
  }

  @HostListener('window:beforeunload', ['$event'])
  confirmBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.form.dirty || this.saving()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  confirmDelete(ruleId: string, ruleName: string): void {
    if (!this.auth.isOperator()) return;
    this.dialog
      .open(ConfirmDeleteDialogComponent, { data: { ruleName }, ariaLabel: 'Confirm alert rule deletion' })
      .afterClosed()
      .subscribe((confirmed: boolean | undefined) => {
        if (confirmed && this.auth.isOperator()) this.store.deleteRule(ruleId);
      });
  }

  private createCondition(value?: Partial<ConditionForm['value']>): ConditionForm {
    const metric = value?.metric ?? 'p95 latency';
    const comparator = value?.comparator ?? '>';
    const threshold = value?.threshold ?? 300;
    const durationSec = value?.durationSec ?? 60;
    return this.fb.group({
      metric: this.fb.control<RuleMetric>(metric, Validators.required),
      comparator: this.fb.control<RuleOperator>(comparator, Validators.required),
      threshold: this.fb.control(threshold, { validators: [Validators.required, metricThresholdValidator] }),
      durationSec: this.fb.control(durationSec, { validators: [Validators.required, durationRangeValidator] }),
    });
  }

  private uniqueNameValidator(): AsyncValidatorFn {
    return (control) => {
      const name = String(control.value ?? '').trim();
      if (name.length < 3) return of(null);
      return timer(300).pipe(
        switchMap(() => this.api.validateRuleName(name, this.editingRuleId() ?? undefined)),
        map((result) => result.available ? null : { duplicateName: true }),
        catchError(() => of({ nameCheckUnavailable: true })),
      );
    };
  }
}
