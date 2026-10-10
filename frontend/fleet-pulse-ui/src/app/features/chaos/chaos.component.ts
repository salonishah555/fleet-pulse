import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChaosState, FleetApiService } from '../../core/http/fleet-api.service';
import { StateComponent } from '../../shared/components/state.component';

const modes = ['drop', 'duplicate', 'shuffle', 'malformed'];

@Component({
  selector: 'app-chaos',
  imports: [CommonModule, FormsModule, StateComponent],
  template: `
    <article class="panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Operator controls</span>
          <h2>Chaos testing</h2>
        </div>
        <button type="button" class="danger" (click)="reset()">Reset</button>
      </div>

      @if (error()) {
        <app-state title="Unable to load chaos controls" [message]="error() ?? ''" />
      } @else if (state(); as state) {
        <section class="chaos-grid">
          <label><span>Rate ms</span><input type="number" [(ngModel)]="state.rate" /></label>
          <label>
            <span>WebSocket</span>
            <select [(ngModel)]="state.ws">
              <option [ngValue]="undefined">Normal</option>
              <option value="down">Down</option>
              <option value="silent">Silent</option>
            </select>
          </label>
          <label>
            <span>SSE</span>
            <select [(ngModel)]="state.sse">
              <option [ngValue]="undefined">Normal</option>
              <option value="down">Down</option>
            </select>
          </label>
          <label><span>Token TTL</span><input type="number" [(ngModel)]="state.token_ttl" /></label>
        </section>
        <section class="mode-list" aria-label="Stream chaos modes">
          @for (mode of modes; track mode) {
            <label class="check-row">
              <input type="checkbox" [checked]="state.chaos.includes(mode)" (change)="toggleMode(mode, $any($event.target).checked)" />
              <span>{{ mode }}</span>
            </label>
          }
        </section>
        <button type="button" (click)="save()">Apply chaos</button>
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
