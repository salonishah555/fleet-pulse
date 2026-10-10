import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { TimeoutError, retry, throwError, timeout, timer } from 'rxjs';

const apiBaseUrl = 'http://localhost:4000';
const requestTimeoutMs = 10_000;
const maxRetryAttempts = 3;
const baseRetryDelayMs = 250;

export const resilienceInterceptor: HttpInterceptorFn = (req, next) => {
  const isApiRequest = req.url.startsWith(apiBaseUrl);
  const hasIdempotencyKey = Boolean(req.headers.get('Idempotency-Key'));
  const isRetryableMethod = req.method === 'GET' || (req.method === 'POST' && hasIdempotencyKey);

  return next(req).pipe(
    timeout({ each: requestTimeoutMs }),
    retry({
      count: isApiRequest && isRetryableMethod ? maxRetryAttempts : 0,
      delay: (error: unknown, retryAttempt) => {
        if (!(error instanceof TimeoutError) && !isTransientHttpError(error)) {
          return throwError(() => error);
        }
        return timer(retryDelay(error, retryAttempt));
      },
    }),
  );
};

function isTransientHttpError(error: unknown): error is HttpErrorResponse {
  if (!(error instanceof HttpErrorResponse)) {
    return false;
  }
  return error.status === 0 || error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504;
}

function retryDelay(error: HttpErrorResponse | TimeoutError, retryAttempt: number): number {
  if (error instanceof HttpErrorResponse && error.status === 429) {
    const retryAfter = parseRetryAfter(error.headers.get('Retry-After'));
    if (retryAfter !== undefined) {
      return retryAfter;
    }
  }
  return baseRetryDelayMs * 2 ** (retryAttempt - 1);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}
