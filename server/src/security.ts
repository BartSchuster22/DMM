import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';

export const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'"
  ].join('; ')
} as const;

const apiCacheHeaders = {
  'cache-control': 'no-store, max-age=0',
  pragma: 'no-cache'
} as const;

export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    for (const [key, value] of Object.entries(securityHeaders)) reply.header(key, value);
    if (request.url.startsWith('/api') || request.url === '/health') {
      for (const [key, value] of Object.entries(apiCacheHeaders)) reply.header(key, value);
    }
    return payload;
  });

  app.setErrorHandler((error: any, request, reply) => {
    request.log.error({ err: error, method: request.method, url: request.url }, 'request failed');
    const status = typeof error?.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    const code = status === 500 ? 'internal_error' : 'bad_request';
    const message = status === 500 ? 'Internal server error' : safePublicMessage(error?.message);
    reply.code(status).send({ ok: false, error: { code, message } });
  });
}

export function safePublicMessage(message: string | undefined): string {
  if (!message) return 'Request failed';
  if (/secret|token|password|key|credential|encrypted|payload/i.test(message)) return 'Request failed';
  return message.slice(0, 160);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function sanitizeIdentifier(input: unknown, field: string): string {
  const value = String(input ?? '');
  if (value.length < 1 || value.length > 180) throw Object.assign(new Error(`${field}_invalid`), { statusCode: 400 });
  if (!/^[A-Za-z0-9._:@/+\-]+$/.test(value)) throw Object.assign(new Error(`${field}_invalid`), { statusCode: 400 });
  if (value.includes('..')) throw Object.assign(new Error(`${field}_invalid`), { statusCode: 400 });
  return value;
}

export function sanitizeSecret(input: unknown): string {
  if (typeof input !== 'string') throw Object.assign(new Error('secret_invalid'), { statusCode: 400 });
  const trimmed = input.trim();
  if (trimmed.length < 8 || trimmed.length > 8192) throw Object.assign(new Error('secret_invalid'), { statusCode: 400 });
  if (/\p{C}/u.test(trimmed)) throw Object.assign(new Error('secret_invalid'), { statusCode: 400 });
  return trimmed;
}

export function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim().slice(0, 64);
  return request.ip.slice(0, 64);
}
