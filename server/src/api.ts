import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/sqlite.js';
import { dmmSectionManifest, type ApiResponse, type AuthUser, type StatusPayload, type ModelStatus, type ProviderStatus } from '@dmm/shared';
import { createSession, destroySession, getSession, requestSessionId, setSessionCookie, clearSessionCookie, sign, csrfHeader } from './auth/sessions.js';
import { verifyPassword } from './auth/password.js';
import { insertAudit, listAudit } from './db/sqlite.js';
import type { AdapterRegistry } from './adapters/registry.js';
import { listModels, listNormalizedDmmState, listProviders, listProviderCredentialRequirements, setModelStatus, setProviderStatus } from './catalog/catalog.js';
import { listCatalogDiffs, listCatalogSnapshots } from './catalog/snapshots.js';
import { listCatalogLifecycle } from './catalog/lifecycle.js';
import { deleteCredential, getCredential, listCredentials, markCredentialValidated, saveCredential } from './vault/credential-store.js';
import { clientIp, sanitizeIdentifier, sanitizeSecret } from './security.js';
export type AppContext = { db: Db; config: AppConfig; version: string; adapters: AdapterRegistry };
type LoginBody = { username?: string; password?: string };
type CredentialBody = { secret?: string };
function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> { return { ok: true, data, ...(meta ? { meta } : {}) }; }
function fail(code: string, message: string, status = 400): ApiResponse<never> & { statusCode?: number } { return { ok: false, error: { code, message }, statusCode: status }; }
export async function registerApi(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/health', async () => ok({ status: 'ok', service: 'dmm' }));
  app.get('/api/section-manifest', async () => ok(dmmSectionManifest));
  app.get('/api/status', async (request) => ok<StatusPayload>({ service: 'dmm', version: ctx.version, section: dmmSectionManifest, authenticated: !!currentUser(ctx, request) }));
  app.get('/api/auth/me', async (request, reply) => { const user = currentUser(ctx, request); if (!user) return reply.code(401).send(fail('unauthorized', 'Login required', 401)); const session = currentSession(ctx, request); return ok({ user, csrfToken: session?.csrfToken }); });
  app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => { const body = request.body as LoginBody; const username = String(body?.username ?? '').slice(0, 128); const password = String(body?.password ?? '').slice(0, 8192); const ip = clientIp(request); const row: any = ctx.db.prepare('SELECT username,password_hash,role FROM users WHERE username = ?').get(username); if (!row || !verifyPassword(password, row.password_hash)) { insertAudit(ctx.db, { eventType: 'auth.login_failed', actor: username || 'unknown', targetType: 'user', targetId: username || 'unknown', payload: { ip } }); return reply.code(401).send(fail('invalid_credentials', 'Invalid username or password', 401)); } const session = createSession(ctx.db, row.username); setSessionCookie(reply, sign(session.id, ctx.config.sessionSecret), ctx.config.cookieSecure); insertAudit(ctx.db, { eventType: 'auth.login_succeeded', actor: row.username, targetType: 'user', targetId: row.username, payload: { ip } }); return ok({ user: { username: row.username, role: row.role } as AuthUser, csrfToken: session.csrfToken }); });
  app.post('/api/auth/logout', { preHandler: requireAuth(ctx) }, async (request, reply) => { const id = requestSessionId(request, ctx.config.sessionSecret); if (id) destroySession(ctx.db, id); clearSessionCookie(reply, ctx.config.cookieSecure); return ok({ loggedOut: true }); });
  app.get('/api/audit', { preHandler: requireAuth(ctx) }, async () => ok({ events: listAudit(ctx.db) }));
  app.get('/api/harnesses', { preHandler: requireAuth(ctx) }, async () => ok({ harnesses: ctx.adapters.configuredHarnesses() }));
  app.post('/api/harnesses/refresh', { preHandler: requireAuth(ctx) }, async (request) => { const actor = currentUser(ctx, request)?.username ?? 'admin'; await ctx.adapters.refreshAll(actor); return ok({ harnesses: await ctx.adapters.refreshLifecycle(actor) }); });
  app.post('/api/harnesses/lifecycle/refresh', { preHandler: requireAuth(ctx) }, async (request) => ok({ harnesses: await ctx.adapters.refreshLifecycle(currentUser(ctx, request)?.username ?? 'admin') }));
  app.get('/api/catalog/snapshots', { preHandler: requireAuth(ctx) }, async () => ok({ snapshots: listCatalogSnapshots(ctx.db) }));
  app.get('/api/catalog/diffs', { preHandler: requireAuth(ctx) }, async () => ok({ diffs: listCatalogDiffs(ctx.db) }));
  app.get('/api/catalog/lifecycle', { preHandler: requireAuth(ctx) }, async () => ok({ lifecycle: listCatalogLifecycle(ctx.db) }));
  app.post('/api/catalog/lifecycle/refresh', { preHandler: requireAuth(ctx) }, async (request) => ok(await ctx.adapters.refreshUpdateDrivenCatalog(currentUser(ctx, request)?.username ?? 'admin')));
  app.post('/api/catalog/refresh', { preHandler: requireAuth(ctx) }, async (request) => ok({ results: await ctx.adapters.refreshCatalog(currentUser(ctx, request)?.username ?? 'admin') }));
  app.post('/api/harnesses/:id/catalog/refresh', { preHandler: requireAuth(ctx) }, async (request) => ok({ results: await ctx.adapters.refreshCatalog(currentUser(ctx, request)?.username ?? 'admin', sanitizeIdentifier((request.params as any).id, 'harness_id')) }));
  app.post('/api/harnesses/:id/operations/:operationId', { preHandler: requireAuth(ctx) }, async (request) => ok({ result: await ctx.adapters.runHarnessOperation(currentUser(ctx, request)?.username ?? 'admin', sanitizeIdentifier((request.params as any).id, 'harness_id'), sanitizeIdentifier((request.params as any).operationId, 'operation_id'), (request.body ?? {}) as Record<string, unknown>) }));
  app.get('/api/providers', { preHandler: requireAuth(ctx) }, async () => ok({ providers: listProviders(ctx.db) }));
  app.get('/api/providers/requirements', { preHandler: requireAuth(ctx) }, async () => ok({ requirements: listProviderCredentialRequirements(ctx.db) }));
  app.get('/api/credentials', { preHandler: requireAuth(ctx) }, async () => ok({ credentials: listCredentials(ctx.db) }));
  app.get('/api/normalized-state', { preHandler: requireAuth(ctx) }, async () => ok(listNormalizedDmmState(ctx.db)));
  app.post('/api/providers/:id/enable', { preHandler: requireAuth(ctx) }, async (request) => ok({ provider: setProviderStatus(ctx.db, currentUser(ctx, request)?.username ?? 'admin', sanitizeIdentifier((request.params as any).id, 'provider_id'), 'available') }));
  app.post('/api/providers/:id/disable', { preHandler: requireAuth(ctx) }, async (request) => ok({ provider: setProviderStatus(ctx.db, currentUser(ctx, request)?.username ?? 'admin', sanitizeIdentifier((request.params as any).id, 'provider_id'), 'disabled' as ProviderStatus) }));
  app.post('/api/providers/:id/credential', { preHandler: requireAuth(ctx) }, async (request) => { const actor = currentUser(ctx, request)?.username ?? 'admin'; const providerId = sanitizeIdentifier((request.params as any).id, 'provider_id'); const secret = sanitizeSecret((request.body as CredentialBody).secret); const credential = saveCredential(ctx.db, ctx.config.masterKey, actor, providerId, secret); const install = await ctx.adapters.installProviderCredential(actor, providerId, secret); markCredentialValidated(ctx.db, actor, providerId, install.aggregateStatus, `BYOK install aggregate status: ${install.aggregateStatus}`); return ok({ credential, install: redactAdapterResult(install) }); });
  app.delete('/api/providers/:id/credential', { preHandler: requireAuth(ctx) }, async (request) => ok({ credential: deleteCredential(ctx.db, currentUser(ctx, request)?.username ?? 'admin', sanitizeIdentifier((request.params as any).id, 'provider_id')) }));
  app.post('/api/providers/:id/validate', { preHandler: requireAuth(ctx) }, async (request, reply) => { const actor = currentUser(ctx, request)?.username ?? 'admin'; const providerId = sanitizeIdentifier((request.params as any).id, 'provider_id'); const stored = getCredential(ctx.db, ctx.config.masterKey, providerId); if (!stored) return reply.code(404).send(fail('credential_missing', 'No saved credential for provider', 404)); const validation = await ctx.adapters.validateProviderCredential(actor, providerId, stored.secret); const credential = markCredentialValidated(ctx.db, actor, providerId, validation.aggregateStatus, `BYOK validation aggregate status: ${validation.aggregateStatus}`); return ok({ credential, validation: redactAdapterResult(validation) }); });
  app.get('/api/models', { preHandler: requireAuth(ctx) }, async () => ok({ models: listModels(ctx.db) }));
  app.post('/api/models/:id/enable', { preHandler: requireAuth(ctx) }, async (request) => ok({ model: setModelStatus(ctx.db, currentUser(ctx, request)?.username ?? 'admin', sanitizeIdentifier((request.params as any).id, 'model_id'), 'enabled') }));
  app.post('/api/models/:id/disable', { preHandler: requireAuth(ctx) }, async (request) => ok({ model: setModelStatus(ctx.db, currentUser(ctx, request)?.username ?? 'admin', sanitizeIdentifier((request.params as any).id, 'model_id'), 'disabled' as ModelStatus) }));
}
function currentSession(ctx: AppContext, request: FastifyRequest) { const id = requestSessionId(request, ctx.config.sessionSecret); return id ? getSession(ctx.db, id) : null; }
function currentUser(ctx: AppContext, request: FastifyRequest): AuthUser | null { const session = currentSession(ctx, request); if (!session) return null; const row: any = ctx.db.prepare('SELECT username,role FROM users WHERE username = ?').get(session.username); return row ? { username: row.username, role: row.role } : null; }
function requireAuth(ctx: AppContext) { return async (request: FastifyRequest, reply: FastifyReply) => { const session = currentSession(ctx, request); if (!session) return reply.code(401).send(fail('unauthorized', 'Login required', 401)); if (['POST','PUT','PATCH','DELETE'].includes(request.method) && !request.url.startsWith('/api/auth/login')) { if (request.headers[csrfHeader] !== session.csrfToken) return reply.code(403).send(fail('csrf_invalid', 'CSRF token missing or invalid', 403)); } }; }

export function redactAdapterResult<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, val) => /secret|token|password|api[_-]?key|credential/i.test(key) && typeof val === 'string' ? '[redacted]' : val));
}
