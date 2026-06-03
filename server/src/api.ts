import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/sqlite.js';
import { dmmSectionManifest, type ApiResponse, type AuthUser, type StatusPayload } from '@dmm/shared';
import { createSession, destroySession, getSession, requestSessionId, setSessionCookie, clearSessionCookie, sign, csrfHeader } from './auth/sessions.js';
import { verifyPassword } from './auth/password.js';
import { insertAudit, listAudit } from './db/sqlite.js';

export type AppContext = { db: Db; config: AppConfig; version: string };

type LoginBody = { username?: string; password?: string };

function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> { return { ok: true, data, ...(meta ? { meta } : {}) }; }
function fail(code: string, message: string, status = 400): ApiResponse<never> & { statusCode?: number } { return { ok: false, error: { code, message }, statusCode: status }; }

export async function registerApi(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/health', async () => ok({ status: 'ok', service: 'dmm' }));
  app.get('/api/section-manifest', async () => ok(dmmSectionManifest));
  app.get('/api/status', async (request) => ok<StatusPayload>({ service: 'dmm', version: ctx.version, section: dmmSectionManifest, authenticated: !!currentUser(ctx, request) }));
  app.get('/api/auth/me', async (request, reply) => {
    const user = currentUser(ctx, request);
    if (!user) return reply.code(401).send(fail('unauthorized', 'Login required', 401));
    const session = currentSession(ctx, request);
    return ok({ user, csrfToken: session?.csrfToken });
  });
  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as LoginBody;
    const username = String(body?.username ?? '');
    const password = String(body?.password ?? '');
    const row: any = ctx.db.prepare('SELECT username,password_hash,role FROM users WHERE username = ?').get(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      insertAudit(ctx.db, { eventType: 'auth.login_failed', actor: username || 'unknown', targetType: 'user', targetId: username || 'unknown', payload: { ip: request.ip } });
      return reply.code(401).send(fail('invalid_credentials', 'Invalid username or password', 401));
    }
    const session = createSession(ctx.db, row.username);
    setSessionCookie(reply, sign(session.id, ctx.config.sessionSecret), ctx.config.cookieSecure);
    insertAudit(ctx.db, { eventType: 'auth.login_succeeded', actor: row.username, targetType: 'user', targetId: row.username, payload: { ip: request.ip } });
    return ok({ user: { username: row.username, role: row.role } as AuthUser, csrfToken: session.csrfToken });
  });
  app.post('/api/auth/logout', { preHandler: requireAuth(ctx) }, async (request, reply) => {
    const id = requestSessionId(request, ctx.config.sessionSecret);
    if (id) destroySession(ctx.db, id);
    clearSessionCookie(reply, ctx.config.cookieSecure);
    return ok({ loggedOut: true });
  });
  app.get('/api/audit', { preHandler: requireAuth(ctx) }, async () => ok({ events: listAudit(ctx.db) }));
  app.get('/api/harnesses', { preHandler: requireAuth(ctx) }, async () => ok({ harnesses: [] }));
  app.get('/api/providers', { preHandler: requireAuth(ctx) }, async () => ok({ providers: [] }));
  app.get('/api/models', { preHandler: requireAuth(ctx) }, async () => ok({ models: [] }));
}

function currentSession(ctx: AppContext, request: FastifyRequest) {
  const id = requestSessionId(request, ctx.config.sessionSecret);
  return id ? getSession(ctx.db, id) : null;
}

function currentUser(ctx: AppContext, request: FastifyRequest): AuthUser | null {
  const session = currentSession(ctx, request);
  if (!session) return null;
  const row: any = ctx.db.prepare('SELECT username,role FROM users WHERE username = ?').get(session.username);
  return row ? { username: row.username, role: row.role } : null;
}

function requireAuth(ctx: AppContext) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const session = currentSession(ctx, request);
    if (!session) return reply.code(401).send(fail('unauthorized', 'Login required', 401));
    if (['POST','PUT','PATCH','DELETE'].includes(request.method) && !request.url.startsWith('/api/auth/login')) {
      if (request.headers[csrfHeader] !== session.csrfToken) return reply.code(403).send(fail('csrf_invalid', 'CSRF token missing or invalid', 403));
    }
  };
}
