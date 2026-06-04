#!/usr/bin/env node
import { existsSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const backup = process.argv[2];
if (!backup || !existsSync(backup)) { console.error('Usage: npm run ops:restore -- /absolute/path/to/dmm-backup.sqlite'); process.exit(2); }
const root = resolve(new URL('..', import.meta.url).pathname);
const dbPath = process.env.DMM_DB_PATH ?? join(root, 'data', 'dmm.sqlite');
const integrity = spawnSync('sqlite3', [backup, 'PRAGMA integrity_check;'], { encoding: 'utf8' });
if (integrity.status !== 0 || integrity.stdout.trim() !== 'ok') { console.error(`Backup integrity failed: ${integrity.stderr || integrity.stdout}`); process.exit(1); }
spawnSync('docker', ['compose', 'stop', 'dmm'], { stdio: 'inherit' });
copyFileSync(backup, dbPath);
spawnSync('docker', ['compose', 'up', '-d'], { stdio: 'inherit' });
spawnSync('npm', ['run', 'ops:health'], { stdio: 'inherit' });
