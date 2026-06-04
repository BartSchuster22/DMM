#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
function run(name, cmd, args, opts = {}) {
  console.log(`\n## ${name}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env, ...opts });
  if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1);
}
run('pre-deploy backup', 'npm', ['run', 'ops:backup']);
if (process.getuid?.() === 0) run('qa gate', 'sudo', ['-u', process.env.DMM_RUN_USER ?? 'dmm', '-H', 'npm', 'run', 'qa']);
else run('qa gate', 'npm', ['run', 'qa']);
run('docker compose build/up', 'docker', ['compose', 'up', '-d', '--build']);
run('post-deploy health', 'npm', ['run', 'ops:health']);
if (process.env.DMM_QA_SMOKE === '1') {
  if (process.getuid?.() === 0) run('live smoke', 'sudo', ['-u', process.env.DMM_RUN_USER ?? 'dmm', '-E', 'npm', 'run', 'qa:smoke']);
  else run('live smoke', 'npm', ['run', 'qa:smoke']);
}
console.log('\nProduction deploy completed.');
