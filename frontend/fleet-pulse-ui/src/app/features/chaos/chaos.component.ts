import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ChaosState, FleetApiService } from '../../core/http/fleet-api.service';
import { StateComponent } from '../../shared/components/state.component';

const modes = ['drop', 'duplicate', 'shuffle', 'malformed'];

@Component({
  selector: 'app-chaos',
  imports: [CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule, StateComponent],
  template: `
    <article class="panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Operator controls</span>
          <h2>Chaos testing</h2>
        </div>
        <button matButton="outlined" type="button" class="danger" (click)="reset()">Reset</button>
      </div>

      @if (error()) {
        <app-state title="Unable to load chaos controls" [message]="error() ?? ''" />
      } @else if (state(); as state) {
        <section class="chaos-grid">
          <mat-form-field appearance="outline"><mat-label>Rate ms</mat-label><input matInput type="number" [(ngModel)]="state.rate" /></mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>WebSocket</mat-label>
            <mat-select [(ngModel)]="state.ws">
              <mat-option [value]="undefined">Normal</mat-option>
              <mat-option value="down">Down</mat-option>
              <mat-option value="silent">Silent</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>SSE</mat-label>
            <mat-select [(ngModel)]="state.sse">
              <mat-option [value]="undefined">Normal</mat-option>
              <mat-option value="down">Down</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Token TTL</mat-label><input matInput type="number" [(ngModel)]="state.token_ttl" /></mat-form-field>
        </section>
        <section class="mode-list" aria-label="Stream chaos modes">
          @for (mode of modes; track mode) {
            <mat-checkbox [checked]="state.chaos.includes(mode)" (change)="toggleMode(mode, $event.checked)">{{ mode }}</mat-checkbox>
          }
        </section>
        <button matButton="filled" type="button" (click)="save()">Apply chaos</button>
      }
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChaosComponent implements OnInit {
  private readonly api = inject(FleetApiService);
  readonly modes = modes;
  readonly state = signal<ChaosState | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.api.chaos().subscribe({
      next: (state) => this.state.set({ ...state, chaos: [...state.chaos] }),
      error: () => this.error.set('Chaos controls require an operator session and reachable backend.'),
    });
  }

  toggleMode(mode: string, enabled: boolean): void {
    const state = this.state();
    if (!state) return;
    state.chaos = enabled ? Array.from(new Set([...state.chaos, mode])) : state.chaos.filter((item) => item !== mode);
    this.state.set({ ...state });
  }

  save(): void {
    const state = this.state();
    if (!state) return;
    this.api.updateChaos(state).subscribe((updated) => this.state.set({ ...updated, chaos: [...updated.chaos] }));
  }

  reset(): void {
    this.api.resetChaos().subscribe((updated) => this.state.set({ ...updated, chaos: [...updated.chaos] }));
  }
}
