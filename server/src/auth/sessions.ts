import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/sqlite.js';
import { nowIso } from '../db/sqlite.js';

export const sessionCookie = 'dmm_session';
export const csrfHeader = 'x-csrf-token';

export function sign(value: string, secret: string): string {
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

export function unsign(signed: string | undefined, secret: string): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  return sign(value, secret) === signed ? value : null;
}

export function createSession(db: Db, username: string): { id: string; csrfToken: string; expiresAt: string } {
  const id = randomUUID();
  const csrfToken = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  db.prepare('INSERT INTO sessions (id,username,csrf_token,expires_at,created_at) VALUES (?,?,?,?,?)').run(id, username, csrfToken, expiresAt, nowIso());
  return { id, csrfToken, expiresAt };
}

export function destroySession(db: Db, id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function getSession(db: Db, id: string): { id: string; username: string; csrfToken: string; expiresAt: string } | null {
  const r: any = db.prepare('SELECT id, username, csrf_token, expires_at FROM sessions WHERE id = ?').get(id);
  if (!r) return null;
  if (new Date(r.expires_at).getTime() <= Date.now()) { destroySession(db, id); return null; }
  return { id: r.id, username: r.username, csrfToken: r.csrf_token, expiresAt: r.expires_at };
}

export function setSessionCookie(reply: FastifyReply, signedId: string, secure: boolean): void {
  reply.setCookie(sessionCookie, signedId, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 60 * 60 * 12 });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(sessionCookie, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

export function requestSessionId(request: FastifyRequest, secret: string): string | null {
  return unsign((request.cookies as Record<string, string | undefined>)[sessionCookie], secret);
}
