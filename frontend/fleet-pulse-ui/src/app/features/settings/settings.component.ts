import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FleetSettingsService, defaultFleetSettings } from '../../core/settings/fleet-settings.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <article class="panel settings-panel">
      <span class="eyebrow">Preferences</span>
      <h2>Dashboard settings</h2>
      <p class="muted">Polling interval applies while WebSocket and SSE are unavailable. Stale threshold controls connection health; color scheme changes the dashboard palette.</p>
      <form #settingsForm="ngForm" (ngSubmit)="save(settingsForm.valid)">
        <mat-form-field appearance="outline">
          <mat-label>Polling interval (seconds)</mat-label>
          <input matInput type="number" name="refreshIntervalSec" [(ngModel)]="settings.refreshIntervalSec" min="1" max="30" required />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Stale after (seconds)</mat-label>
          <input matInput type="number" name="staleAfterSec" [(ngModel)]="settings.staleAfterSec" min="5" max="300" required />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Color scheme</mat-label>
          <mat-select name="colorScheme" [(ngModel)]="settings.colorScheme">
            <mat-option value="dark">Dark</mat-option>
            <mat-option value="light">Light</mat-option>
          </mat-select>
        </mat-form-field>
        <button matButton="filled" type="submit" [disabled]="settingsForm.invalid">Save preferences</button>
      </form>
      @if (saved()) {
        <p role="status" class="settings-saved">Preferences saved.</p>
      }
      @if (saveError()) {
        <p role="alert" class="form-error">{{ saveError() }}</p>
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly settingsService = inject(FleetSettingsService);
  readonly saved = signal(false);
  readonly settings = { ...defaultFleetSettings };
  readonly saveError = signal<string | null>(null);

  ngOnInit(): void {
    Object.assign(this.settings, this.settingsService.settings());
  }

  save(valid: boolean | null): void {
    if (!valid) return;
    try {
      this.settingsService.save(this.settings);
      this.saveError.set(null);
      this.saved.set(true);
    } catch (error) {
      this.saveError.set('Unable to save preferences in this browser.');
      console.error('Unable to save Fleet Pulse display preferences.', error);
    }
  }
}
