import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <main class="login-page">
      <section class="login-panel panel">
        <span class="eyebrow">Fleet Pulse</span>
        <h1>Operations Dashboard</h1>
        <p class="muted">Sign in with the demo operator or viewer account.</p>

        <form [formGroup]="form" (ngSubmit)="login()">
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="username" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input matInput type="password" formControlName="password" autocomplete="current-password" />
          </mat-form-field>
          @if (error()) {
            <p class="form-error">{{ error() }}</p>
          }
          <button matButton="filled" type="submit" [disabled]="form.invalid || loading()">{{ loading() ? 'Signing in...' : 'Sign in' }}</button>
        </form>

        <div class="demo-actions" aria-label="Demo login shortcuts">
          <button matButton="outlined" type="button" (click)="useDemo('operator')">Operator demo</button>
          <button matButton="outlined" type="button" (click)="useDemo('viewer')">Viewer demo</button>
        </div>
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly form = this.fb.nonNullable.group({
    email: ['operator@fleetpulse.dev', [Validators.required, Validators.email]],
    password: ['operator123', Validators.required],
  });

  login(): void {
    if (this.form.invalid || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    this.auth
      .login(email, password)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: () => void this.router.navigateByUrl('/dashboard'),
        error: () => this.error.set('Unable to sign in with those credentials.'),
      });
  }

  useDemo(role: 'operator' | 'viewer'): void {
    this.form.setValue({
      email: role === 'operator' ? 'operator@fleetpulse.dev' : 'viewer@fleetpulse.dev',
      password: role === 'operator' ? 'operator123' : 'viewer123',
    });
  }
}
