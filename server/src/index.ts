import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config/env.js';
import { migrate, openDb } from './db/sqlite.js';
import { ensureAdmin } from './auth/bootstrap.js';
import { registerApi } from './api.js';
import { AdapterRegistry } from './adapters/registry.js';

import { registerSecurity } from './security.js';
const version = '0.3.0';
const config = loadConfig();
const db = openDb(config.dbPath);
migrate(db);
const admin = ensureAdmin(db, config.adminUser, config.adminPassword);
if (admin.generatedPassword) console.log(`[DMM] Generated initial admin credentials username=${admin.username} password=${admin.generatedPassword}`);
const adapters = new AdapterRegistry(db, config.harnesses);
const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 16 * 1024,
  trustProxy: '127.0.0.1'
});
registerSecurity(app);
await app.register(cookie); await app.register(rateLimit, { max: config.rateLimitMax, timeWindow: '1 minute' }); await registerApi(app, { db, config, version, adapters });
const here = dirname(fileURLToPath(import.meta.url)); const webDist = resolve(here, '../../web/dist');
if (existsSync(webDist)) { await app.register(fastifyStatic, { root: webDist, prefix: '/' }); app.setNotFoundHandler((request, reply) => { if (request.url.startsWith('/api') || request.url === '/health') return reply.code(404).send({ ok: false, error: { code: 'not_found', message: 'Not found' } }); return reply.sendFile('index.html'); }); }
const shutdown = async () => { await app.close(); db.close(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
await app.listen({ host: '127.0.0.1', port: config.port });
