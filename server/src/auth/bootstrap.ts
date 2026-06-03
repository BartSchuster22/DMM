import { randomBytes } from 'node:crypto';
import type { Db } from '../db/sqlite.js';
import { insertAudit, nowIso } from '../db/sqlite.js';
import { hashPassword } from './password.js';

export function ensureAdmin(db: Db, username: string, password?: string): { username: string; generatedPassword?: string } {
  const existing = db.prepare('SELECT username FROM users WHERE username = ?').get(username);
  if (existing) return { username };
  const generatedPassword = password ?? randomBytes(18).toString('base64url');
  const hash = hashPassword(generatedPassword);
  const now = nowIso();
  db.prepare('INSERT INTO users (username,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?)').run(username, hash, 'admin', now, now);
  insertAudit(db, { eventType: 'auth.admin_bootstrapped', actor: 'system', targetType: 'user', targetId: username, payload: { generated: !password } });
  return { username, generatedPassword: password ? undefined : generatedPassword };
}
