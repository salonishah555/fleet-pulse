import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

const apiBaseUrl = 'http://localhost:3000';
const authPaths = ['/auth/login', '/auth/refresh'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!req.url.startsWith(apiBaseUrl) || authPaths.some((path) => req.url.startsWith(`${apiBaseUrl}${path}`))) {
    return next(req);
  }

  return auth.ensureValidSession().pipe(
    switchMap((session) => next(session ? withBearer(req, session.accessToken) : req)),
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      return auth.refreshSession().pipe(
        switchMap((session) => next(withBearer(req, session.accessToken))),
        catchError((refreshError: unknown) => {
          auth.logout();
          void router.navigateByUrl('/login');
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};

function withBearer(req: Parameters<HttpInterceptorFn>[0], token: string) {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
