import { AbstractControl, type FormArray, type ValidationErrors, type ValidatorFn } from '@angular/forms';

export const metricThresholdValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const value = Number(control.value);
  const metric = control.parent?.get('metric')?.value;
  if (!Number.isFinite(value) || value < 0) return { thresholdRange: true };
  if (metric === 'error rate' && value > 100) return { thresholdRange: { max: 100 } };
  if (metric === 'p95 latency' && value > 60_000) return { thresholdRange: { max: 60_000 } };
  if (metric === 'throughput' && value > 1_000_000_000) return { thresholdRange: { max: 1_000_000_000 } };
  return null;
};

export const durationRangeValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const duration = Number(control.value);
  return Number.isInteger(duration) && duration >= 1 && duration <= 3600 ? null : { durationRange: true };
};

export const uniqueConditionValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const conditions = control as FormArray;
  const signatures = conditions.controls.map((condition) =>
    `${condition.get('metric')?.value}:${condition.get('comparator')?.value}`,
  );
  return new Set(signatures).size === signatures.length ? null : { duplicateConditions: true };
};
