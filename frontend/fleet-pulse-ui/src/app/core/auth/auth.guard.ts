import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ensureValidSession().pipe(map((session) => (session ? true : router.createUrlTree(['/login']))));
};

export const operatorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ensureValidSession().pipe(map((session) => {
    if (!session) return router.createUrlTree(['/login']);
    return session.user.role === 'operator' ? true : router.createUrlTree(['/dashboard']);
  }));
};
