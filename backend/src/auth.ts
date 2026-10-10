import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './errors.js';
import { chaosService } from './chaos.js';
import type { Role, User } from './types.js';

const secret = process.env['AUTH_SECRET'] ?? 'fleet-pulse-dev-secret';
const refreshTokens = new Map<string, { userId: string; expiresAt: number }>();

const users = [
  { id: 'usr-operator', email: 'operator@fleetpulse.dev', password: 'operator123', role: 'operator' as const },
  { id: 'usr-viewer', email: 'viewer@fleetpulse.dev', password: 'viewer123', role: 'viewer' as const },
];

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthenticatedRequest extends Request {
  user?: User;
}

interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
  exp: number;
}

export function login(email: string, password: string): AuthResponse {
  const record = users.find((user) => user.email === email && user.password === password);
  if (!record) {
    throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  return issueTokens(toUser(record));
}

export function refresh(refreshToken: string): AuthResponse {
  const stored = refreshTokens.get(refreshToken);
  if (!stored || stored.expiresAt < Date.now()) {
    throw new ApiError(401, 'invalid_refresh_token', 'Refresh token is invalid or expired');
  }
  refreshTokens.delete(refreshToken);
  const record = users.find((user) => user.id === stored.userId);
  if (!record) {
    throw new ApiError(401, 'invalid_refresh_token', 'Refresh token user no longer exists');
  }
  return issueTokens(toUser(record));
}

export function authenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  try {
    const header = req.header('authorization');
    const queryToken = typeof req.query['token'] === 'string' ? req.query['token'] : undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
    if (!token) {
      throw new ApiError(401, 'missing_token', 'Authentication token is required');
    }
    req.user = verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(role: Role) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, 'missing_token', 'Authentication token is required'));
      return;
    }
    if (req.user.role !== role) {
      next(new ApiError(403, 'forbidden', `${role} permissions are required`));
      return;
    }
    next();
  };
}

export function verifyAccessToken(token: string): User {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || signature !== sign(encoded)) {
    throw new ApiError(401, 'invalid_token', 'Authentication token is invalid');
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
  if (payload.exp < Date.now()) {
    throw new ApiError(401, 'token_expired', 'Authentication token has expired');
  }
  return { id: payload.sub, email: payload.email, role: payload.role };
}

function issueTokens(user: User): AuthResponse {
  const expiresAt = Date.now() + chaosService.get().token_ttl * 1000;
  const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role, exp: expiresAt };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const accessToken = `${encoded}.${sign(encoded)}`;
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  refreshTokens.set(refreshToken, { userId: user.id, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  return { user, accessToken, refreshToken, expiresAt };
}

function sign(value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function toUser(record: (typeof users)[number]): User {
  return { id: record.id, email: record.email, role: record.role };
}
