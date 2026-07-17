#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const dbPath = process.env.DMM_DB_PATH ?? join(root, 'data', 'dmm.sqlite');
const backupDir = process.env.DMM_BACKUP_DIR ?? join(root, 'backups');
const retention = Number(process.env.DMM_BACKUP_RETENTION ?? 56);
if (!Number.isInteger(retention) || retention < 2) throw new Error('DMM_BACKUP_RETENTION must be at least 2');
mkdirSync(backupDir, { recursive: true, mode: 0o700 });
chmodSync(backupDir, 0o700);
if (!existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDir, `dmm-${stamp}.sqlite`);
const sqlite = spawnSync('sqlite3', [dbPath, `.backup '${target.replaceAll("'", "''")}'`], { encoding: 'utf8' });
if (sqlite.status !== 0) throw new Error(`sqlite backup failed: ${sqlite.stderr.trim() || sqlite.status}`);
chmodSync(target, 0o600);
const integrity = spawnSync('sqlite3', [target, 'PRAGMA integrity_check; PRAGMA foreign_key_check;'], { encoding: 'utf8' });
if (integrity.status !== 0 || integrity.stdout.trim() !== 'ok') throw new Error(`backup integrity failed: ${integrity.stderr || integrity.stdout}`);
const meta = { ok: true, source: dbPath, backup: target, bytes: statSync(target).size, integrity: 'ok', generatedAt: new Date().toISOString() };
const metaPath = `${target}.json`;
await writeFile(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
chmodSync(metaPath, 0o600);
const files = readdirSync(backupDir)
  .filter((name) => /^dmm-.*\.sqlite$/.test(name))
  .map((name) => join(backupDir, name))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
for (const old of files.slice(retention)) {
  unlinkSync(old);
  const oldMeta = `${old}.json`;
  if (existsSync(oldMeta)) unlinkSync(oldMeta);
}
console.log(JSON.stringify(meta, null, 2));
