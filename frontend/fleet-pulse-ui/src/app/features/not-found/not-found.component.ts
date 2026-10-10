import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StateComponent } from '../../shared/components/state.component';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, StateComponent],
  template: `
    <main class="login-page">
      <section class="panel login-panel">
        <app-state title="Page not found" message="That route is not part of Fleet Pulse." />
        <a class="text-link" routerLink="/dashboard">Return to dashboard</a>
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {}
