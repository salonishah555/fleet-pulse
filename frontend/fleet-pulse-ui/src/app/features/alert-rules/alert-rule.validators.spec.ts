import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { durationRangeValidator, metricThresholdValidator, uniqueConditionValidator } from './alert-rule.validators';

describe('alert rule validators', () => {
  it('bounds error-rate thresholds based on the selected metric', () => {
    const condition = new FormGroup({
      metric: new FormControl('error rate'),
      threshold: new FormControl(101),
    });
    expect(metricThresholdValidator(condition.controls.threshold)).toEqual({ thresholdRange: { max: 100 } });
    condition.controls.threshold.setValue(50);
    expect(metricThresholdValidator(condition.controls.threshold)).toBeNull();
  });

  it('rejects invalid durations and allows values between 1 and 3600 seconds', () => {
    expect(durationRangeValidator(new FormControl(0))).toEqual({ durationRange: true });
    expect(durationRangeValidator(new FormControl(60))).toBeNull();
  });

  it('rejects duplicate metric/operator pairs across the conditions array', () => {
    const row = () => new FormGroup({ metric: new FormControl('p95 latency'), comparator: new FormControl('>') });
    const conditions = new FormArray([row(), row()]);
    expect(uniqueConditionValidator(conditions)).toEqual({ duplicateConditions: true });
    conditions.at(1).controls['metric'].setValue('error rate');
    expect(uniqueConditionValidator(conditions)).toBeNull();
  });
});
