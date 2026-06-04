import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CredentialStatus } from '@dmm/shared';
import type { Db } from '../db/sqlite.js';
import { insertAudit, nowIso } from '../db/sqlite.js';

function key(masterKey: string): Buffer { return createHash('sha256').update(masterKey).digest(); }
function encrypt(masterKey: string, plaintext: string): string { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(masterKey), iv); const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]); const tag = cipher.getAuthTag(); return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`; }
export function decrypt(masterKey: string, payload: string): string { const [v, iv64, tag64, text64] = payload.split('.'); if (v !== 'v1') throw new Error('unsupported_secret_version'); const decipher = createDecipheriv('aes-256-gcm', key(masterKey), Buffer.from(iv64, 'base64url')); decipher.setAuthTag(Buffer.from(tag64, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(text64, 'base64url')), decipher.final()]).toString('utf8'); }
function fingerprint(secret: string): string { const normalized = secret.trim(); const suffix = normalized.slice(-4); const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 10); return `${hash}…${suffix}`; }

export type StoredCredential = { providerId: string; status: CredentialStatus; fingerprint: string; secret: string; lastValidatedAt?: string };
export type SaveCredentialResult = { providerId: string; status: CredentialStatus; fingerprint: string };

export function saveCredential(db: Db, masterKey: string, actor: string, providerId: string, secret: string): SaveCredentialResult {
  if (!secret || secret.trim().length < 8) throw new Error('credential_too_short');
  const now = nowIso();
  const fp = fingerprint(secret);
  db.prepare('DELETE FROM credentials WHERE provider_id=? AND harness_id IS NULL').run(providerId);
  db.prepare('INSERT INTO credentials (id,provider_id,harness_id,scope,encrypted_payload,fingerprint,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(), providerId, null, 'global_provider', encrypt(masterKey, secret.trim()), fp, 'saved', now, now);
  db.prepare("UPDATE providers SET status='configured', updated_at=? WHERE id=?").run(now, providerId);
  insertAudit(db, { eventType: 'provider.credential.saved', actor, targetType: 'provider', targetId: providerId, payload: { fingerprint: fp } });
  return { providerId, status: 'saved', fingerprint: fp };
}

export function getCredential(db: Db, masterKey: string, providerId: string): StoredCredential | null {
  const row = db.prepare('SELECT * FROM credentials WHERE provider_id=? AND harness_id IS NULL ORDER BY updated_at DESC LIMIT 1').get(providerId) as any;
  if (!row) return null;
  return { providerId, status: row.status as CredentialStatus, fingerprint: row.fingerprint, secret: decrypt(masterKey, row.encrypted_payload), lastValidatedAt: row.last_validated_at ?? undefined };
}

export function deleteCredential(db: Db, actor: string, providerId: string): { providerId: string; deleted: boolean } {
  const result = db.prepare('DELETE FROM credentials WHERE provider_id=? AND harness_id IS NULL').run(providerId);
  const now = nowIso();
  db.prepare("UPDATE providers SET status='available', updated_at=? WHERE id=?").run(now, providerId);
  db.prepare("UPDATE harness_providers SET credential_status='missing', last_validated_at=? WHERE provider_id=?").run(now, providerId);
  insertAudit(db, { eventType: 'provider.credential.deleted', actor, targetType: 'provider', targetId: providerId, payload: { deleted: result.changes > 0 } });
  return { providerId, deleted: result.changes > 0 };
}

export function markCredentialValidated(db: Db, actor: string, providerId: string, status: 'healthy' | 'saved' | 'invalid' | 'unsupported' | 'error', message?: string): { providerId: string; status: string } {
  const now = nowIso();
  db.prepare('UPDATE credentials SET status=?, last_validated_at=?, updated_at=? WHERE provider_id=? AND harness_id IS NULL').run(status, now, now, providerId);
  const providerStatus = status === 'healthy' ? 'healthy' : status === 'invalid' || status === 'error' ? 'degraded' : 'configured';
  db.prepare('UPDATE providers SET status=?, updated_at=? WHERE id=?').run(providerStatus, now, providerId);
  insertAudit(db, { eventType: 'provider.credential.validated', actor, targetType: 'provider', targetId: providerId, payload: { status, message } });
  return { providerId, status };
}

export function markHarnessCredential(db: Db, actor: string, harnessId: string, providerId: string, status: CredentialStatus, message?: string): { harnessId: string; providerId: string; status: CredentialStatus } {
  const now = nowIso();
  db.prepare('UPDATE harness_providers SET credential_status=?, last_validated_at=? WHERE harness_id=? AND provider_id=?').run(status, now, harnessId, providerId);
  insertAudit(db, { eventType: 'provider.credential.harness_state', actor, targetType: 'provider', targetId: providerId, payload: { harnessId, status, message } });
  return { harnessId, providerId, status };
}
