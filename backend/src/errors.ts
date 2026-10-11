import type { NextFunction, Request, Response } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown[] = [],
  ) {
    super(message);
  }
}

export function sendError(res: Response, error: ApiError): void {
  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      details: [],
    },
  });
}

export function notFound(message = 'Resource not found'): ApiError {
  return new ApiError(404, 'not_found', message);
}

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void> | void,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ApiError) {
    sendError(res, error);
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error';
  sendError(res, new ApiError(500, 'server_error', message));
}
