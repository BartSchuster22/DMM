#!/usr/bin/env node
import { chmodSync, chownSync, copyFileSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const backup = process.argv[2] ? resolve(process.argv[2]) : '';
if (!backup || !existsSync(backup)) {
  console.error('Usage: npm run ops:restore -- /absolute/path/to/dmm-backup.sqlite');
  process.exit(2);
}
const root = resolve(new URL('..', import.meta.url).pathname);
const dbPath = process.env.DMM_DB_PATH ?? join(root, 'data', 'dmm.sqlite');
const currentOwner = existsSync(dbPath) ? statSync(dbPath) : null;
const verify = spawnSync('sqlite3', [backup, 'PRAGMA integrity_check; PRAGMA foreign_key_check;'], { encoding: 'utf8' });
if (verify.status !== 0 || verify.stdout.trim() !== 'ok') {
  console.error(`Backup verification failed: ${verify.stderr || verify.stdout}`);
  process.exit(1);
}
const safety = spawnSync(process.execPath, [join(root, 'scripts', 'ops-backup.mjs')], { cwd: root, encoding: 'utf8', env: process.env });
if (safety.status !== 0) {
  console.error(`Pre-restore safety backup failed: ${safety.stderr || safety.stdout}`);
  process.exit(1);
}
const stop = spawnSync('docker', ['compose', 'stop', 'dmm'], { cwd: root, stdio: 'inherit' });
if (stop.status !== 0) process.exit(stop.status ?? 1);
for (const suffix of ['-wal', '-shm']) {
  const sidecar = `${dbPath}${suffix}`;
  if (existsSync(sidecar)) unlinkSync(sidecar);
}
copyFileSync(backup, dbPath);
if (currentOwner) chownSync(dbPath, currentOwner.uid, currentOwner.gid);
chmodSync(dbPath, 0o600);
const start = spawnSync('docker', ['compose', 'up', '-d', 'dmm'], { cwd: root, stdio: 'inherit' });
if (start.status !== 0) process.exit(start.status ?? 1);
let containerHealth = '';
for (let attempt = 0; attempt < 60; attempt += 1) {
  const inspect = spawnSync('docker', ['inspect', 'dmm', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'], { encoding: 'utf8' });
  containerHealth = inspect.stdout.trim();
  if (containerHealth === 'healthy' || containerHealth === 'running') break;
  if (containerHealth === 'unhealthy' || inspect.status !== 0) {
    console.error(`Restored container failed to start: ${containerHealth || inspect.stderr.trim()}`);
    process.exit(1);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}
if (containerHealth !== 'healthy' && containerHealth !== 'running') {
  console.error(`Timed out waiting for restored container health: ${containerHealth || 'unknown'}`);
  process.exit(1);
}
const health = spawnSync('npm', ['run', 'ops:health'], { cwd: root, stdio: 'inherit', env: process.env });
process.exit(health.status ?? 1);
