#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync, writeFileSync, mkdirSync, chownSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const base = (process.env.DMM_OPS_BASE_URL ?? process.env.DMM_QA_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
const reportDir = process.env.DMM_OPS_REPORT_DIR ?? join(root, 'qa-reports');
mkdirSync(reportDir, { recursive: true });
const checks = [];
function add(name, ok, detail = {}) { checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail.message ? ` — ${detail.message}` : ''}`); }
function cmd(command, args, opts={}) { return spawnSync(command, args, { encoding: 'utf8', ...opts }); }

let docker;
for (let attempt = 0; attempt < 30; attempt += 1) {
  docker = cmd('docker', ['inspect', '--format', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}', 'dmm']);
  if (docker.status === 0 && /running/.test(docker.stdout) && /healthy/.test(docker.stdout)) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
add('container state', docker?.status === 0 && /running/.test(docker.stdout) && /healthy/.test(docker.stdout), { output: docker?.stdout.trim() ?? '', message: docker?.stderr.trim() ?? '' });

try {
  const r = await fetch(`${base}/health`);
  const body = await r.json();
  add('health endpoint', r.ok && body?.ok === true && body?.data?.service === 'dmm', { status: r.status });
  add('security headers', r.headers.get('x-frame-options') === 'DENY' && /no-store/.test(r.headers.get('cache-control') ?? ''), { xFrameOptions: r.headers.get('x-frame-options'), cacheControl: r.headers.get('cache-control') });
} catch (e) { add('health endpoint', false, { message: e.message }); }

const configuredDb = process.env.DMM_DB_PATH;
const db = configuredDb?.startsWith('/app/data/')
  ? join(root, 'data', basename(configuredDb))
  : configuredDb ?? join(root, 'data', 'dmm.sqlite');
if (existsSync(db)) {
  const integrity = cmd('sqlite3', [db, 'PRAGMA integrity_check;']);
  add('database integrity', integrity.status === 0 && integrity.stdout.trim() === 'ok', { output: integrity.stdout.trim(), message: integrity.stderr.trim() });
  add('database size', statSync(db).size > 0, { bytes: statSync(db).size });
} else add('database exists', false, { path: db });

const df = cmd('df', ['-P', root]);
if (df.status === 0) {
  const line = df.stdout.trim().split('\n').at(-1) ?? '';
  const used = Number((line.match(/ (\d+)% /) ?? [])[1] ?? 100);
  add('disk usage below critical 95%', used < 95, { usedPercent: used, warning: used >= 90 ? 'above 90% warning threshold' : undefined });
}

const backupDir = process.env.DMM_BACKUP_DIR ?? join(root, 'backups');
if (existsSync(backupDir)) {
  const backups = readdirSync(backupDir)
    .filter(f => /^dmm-.*\.sqlite$/.test(f))
    .sort((a, b) => statSync(join(backupDir, b)).mtimeMs - statSync(join(backupDir, a)).mtimeMs);
  const newest = backups[0];
  const ageHours = newest ? (Date.now() - statSync(join(backupDir, newest)).mtimeMs) / 36e5 : Infinity;
  add('recent backup exists', backups.length > 0 && ageHours < 48, { count: backups.length, newest, ageHours: Number(ageHours.toFixed(2)) });
} else add('recent backup exists', false, { message: 'backup dir missing' });

const summary = { ok: checks.every(c => c.ok), generatedAt: new Date().toISOString(), base, checks };
const reportPath = join(reportDir, 'ops-health.json');
writeFileSync(reportPath, JSON.stringify(summary, null, 2));
try { if (process.getuid?.() === 0) { const uid = Number(spawnSync('id', ['-u', 'dmm'], { encoding: 'utf8' }).stdout.trim()); const gid = Number(spawnSync('id', ['-g', 'dmm'], { encoding: 'utf8' }).stdout.trim()); if (Number.isFinite(uid) && Number.isFinite(gid)) chownSync(reportPath, uid, gid); } } catch {}
console.log(`\nOps health: ${summary.ok ? 'PASS' : 'FAIL'} (${reportPath})`);
process.exit(summary.ok ? 0 : 1);
