#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const reportDir = process.env.DMM_QA_REPORT_DIR ?? join(root, 'qa-reports');
mkdirSync(reportDir, { recursive: true });

const steps = [
  ['typecheck', ['npm', ['run', 'typecheck']]],
  ['test', ['npm', ['test']]],
  ['build', ['npm', ['run', 'build']]],
];
if (process.env.DMM_QA_SMOKE === '1') steps.push(['smoke', ['npm', ['run', 'qa:smoke']]]);

const results = [];
for (const [name, [cmd, args]] of steps) {
  const started = Date.now();
  console.log(`\n## QA step: ${name}`);
  const res = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  const row = { name, exitCode: res.status ?? 1, durationMs: Date.now() - started };
  results.push(row);
  if (row.exitCode !== 0) break;
}
const summary = { ok: results.every((r) => r.exitCode === 0), generatedAt: new Date().toISOString(), results };
writeFileSync(join(reportDir, 'qa-summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nQA summary: ${summary.ok ? 'PASS' : 'FAIL'} (${join(reportDir, 'qa-summary.json')})`);
process.exit(summary.ok ? 0 : 1);
