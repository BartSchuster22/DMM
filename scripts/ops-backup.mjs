#!/usr/bin/env node
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const dbPath = process.env.DMM_DB_PATH ?? join(root, 'data', 'dmm.sqlite');
const backupDir = process.env.DMM_BACKUP_DIR ?? join(root, 'backups');
const retention = Number(process.env.DMM_BACKUP_RETENTION ?? 14);
mkdirSync(backupDir, { recursive: true });
if (!existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDir, `dmm-${stamp}.sqlite`);
const sqlite = spawnSync('sqlite3', [dbPath, `.backup '${target.replaceAll("'", "''")}'`], { encoding: 'utf8' });
if (sqlite.status !== 0) {
  console.warn(`sqlite3 backup unavailable/failed (${sqlite.stderr.trim() || sqlite.status}); falling back to file copy`);
  await copyFile(dbPath, target);
}
const integrity = spawnSync('sqlite3', [target, 'PRAGMA integrity_check;'], { encoding: 'utf8' });
if (integrity.status !== 0 || integrity.stdout.trim() !== 'ok') throw new Error(`backup integrity failed: ${integrity.stderr || integrity.stdout}`);
const meta = { ok: true, source: dbPath, backup: target, bytes: statSync(target).size, integrity: 'ok', generatedAt: new Date().toISOString() };
await writeFile(`${target}.json`, JSON.stringify(meta, null, 2));
const files = spawnSync('bash', ['-lc', `ls -1t ${JSON.stringify(backupDir).slice(1,-1)}/dmm-*.sqlite 2>/dev/null || true`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
for (const old of files.slice(retention)) spawnSync('rm', ['-f', old, `${old}.json`]);
console.log(JSON.stringify(meta, null, 2));
