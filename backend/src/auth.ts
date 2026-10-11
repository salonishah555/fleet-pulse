import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './errors.js';
import { chaosService } from './chaos.js';
import type { Role, User } from './types.js';

const secret = process.env['AUTH_SECRET'] ?? 'fleet-pulse-dev-secret';
const refreshTokens = new Map<string, { userId: string; expiresAt: number }>();

const users = [
  {
    id: 'usr-operator',
    email: 'operator@pulse.dev',
    credentials: [
      { email: 'operator@pulse.dev', password: 'pulse123' },
      { email: 'operator@fleetpulse.dev', password: 'operator123' },
    ],
    role: 'operator' as const,
  },
  {
    id: 'usr-viewer',
    email: 'viewer@pulse.dev',
    credentials: [
      { email: 'viewer@pulse.dev', password: 'pulse123' },
      { email: 'viewer@fleetpulse.dev', password: 'viewer123' },
    ],
    role: 'viewer' as const,
  },
];

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  expiresIn: number;
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
  const record = users.find((user) => user.credentials.some((credential) => credential.email === email && credential.password === password));
  if (!record) {
    throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect');
  }
  return issueTokens(toUser(record));
}

export function refresh(refreshToken: string): AuthResponse {
  const stored = refreshTokens.get(refreshToken);
  if (!stored || stored.expiresAt < Date.now()) {
    throw new ApiError(401, 'refresh_invalid', 'Refresh token is invalid or expired');
  }
  refreshTokens.delete(refreshToken);
  const record = users.find((user) => user.id === stored.userId);
  if (!record) {
    throw new ApiError(401, 'refresh_invalid', 'Refresh token user no longer exists');
  }
  return issueTokens(toUser(record));
}

export function authenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  try {
    const header = req.header('authorization');
    const isStream = req.path === '/stream/sse' || req.path === '/assistant/stream';
    const accessToken = req.query['access_token'];
    const legacyToken = req.query['token'];
    const queryToken = isStream
      ? (typeof accessToken === 'string' ? accessToken : typeof legacyToken === 'string' ? legacyToken : undefined)
      : undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
    if (!token) {
      throw new ApiError(401, 'token_invalid', 'Authentication token is required');
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
      next(new ApiError(401, 'token_invalid', 'Authentication token is required'));
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
  if (!encoded || !signature || token.split('.').length !== 2 || signature !== sign(encoded)) {
    throw new ApiError(401, 'token_invalid', 'Authentication token is invalid');
  }
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    throw new ApiError(401, 'token_invalid', 'Authentication token is invalid');
  }
  if (
    typeof payload !== 'object' || payload === null ||
    typeof payload.sub !== 'string' || typeof payload.email !== 'string' ||
    (payload.role !== 'operator' && payload.role !== 'viewer') ||
    typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
  ) {
    throw new ApiError(401, 'token_invalid', 'Authentication token is invalid');
  }
  if (payload.exp <= Date.now()) {
    throw new ApiError(401, 'token_expired', 'Authentication token has expired');
  }
  return { id: payload.sub, email: payload.email, role: payload.role };
}

function issueTokens(user: User): AuthResponse {
  const expiresIn = chaosService.get().token_ttl;
  const expiresAt = Date.now() + expiresIn * 1000;
  const payload: TokenPayload = { sub: user.id, email: user.email, role: user.role, exp: expiresAt };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const accessToken = `${encoded}.${sign(encoded)}`;
  const refreshToken = crypto.randomBytes(32).toString('base64url');
  refreshTokens.set(refreshToken, { userId: user.id, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  return { user, accessToken, refreshToken, expiresAt, expiresIn };
}

function sign(value: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function toUser(record: (typeof users)[number]): User {
  return { id: record.id, email: record.email, role: record.role };
}
