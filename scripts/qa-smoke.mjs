#!/usr/bin/env node
import assert from 'node:assert/strict';

const base = (process.env.DMM_QA_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/, '');
const username = process.env.DMM_ADMIN_USER ?? process.env.DMM_QA_USER ?? 'admin';
const password = process.env.DMM_ADMIN_PASSWORD ?? process.env.DMM_QA_PASSWORD;
const failFast = process.env.DMM_QA_FAIL_FAST !== '0';

const results = [];
let cookie = '';
let csrfToken = '';

function record(name, ok, detail = {}) {
  const row = { name, ok, detail };
  results.push(row);
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} ${name}${detail.message ? ` — ${detail.message}` : ''}`);
}

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    record(name, true, { durationMs: Date.now() - started, ...(detail ?? {}) });
  } catch (error) {
    record(name, false, { durationMs: Date.now() - started, message: error instanceof Error ? error.message : String(error) });
    if (failFast) throw error;
  }
}

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${base}${path}`, { ...options, headers });
  const text = await res.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { res, body, text };
}

function assertSecurityHeaders(res, api = false) {
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  if (api) assert.match(res.headers.get('cache-control') ?? '', /no-store/);
}

function assertNoSecretLeak(value, context) {
  const text = JSON.stringify(value);
  const leakPatterns = [/sk-[A-Za-z0-9_-]{12,}/, /glpat-[A-Za-z0-9_-]{12,}/, /ghp_[A-Za-z0-9_]{12,}/, /api[_-]?key["']?\s*[:=]\s*["'][^"']{8,}/i, /secret["']?\s*[:=]\s*["'][^"']{8,}/i];
  for (const pattern of leakPatterns) assert.doesNotMatch(text, pattern, `${context} leaked secret-like value`);
}

await check('health endpoint', async () => {
  const { res, body } = await request('/health');
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.service, 'dmm');
  assertSecurityHeaders(res, true);
});

await check('frontend shell serves hardened assets', async () => {
  const { res, text } = await request('/');
  assert.equal(res.status, 200);
  assert.match(text, /<div id="root"><\/div>/);
  assert.match(text, /\/assets\/index-.*\.js/);
  assert.match(text, /\/assets\/index-.*\.css/);
  assertSecurityHeaders(res, false);
});

await check('public status endpoint', async () => {
  const { res, body } = await request('/api/status');
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.service, 'dmm');
  assert.equal(body.data.authenticated, false);
  assertSecurityHeaders(res, true);
});

await check('protected endpoint rejects anonymous access', async () => {
  const { res, body } = await request('/api/providers');
  assert.equal(res.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'unauthorized');
});

if (!password) {
  record('authenticated QA skipped', true, { message: 'DMM_ADMIN_PASSWORD/DMM_QA_PASSWORD not set' });
} else {
  await check('admin login sets hardened cookie', async () => {
    const { res, body } = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    csrfToken = body.data.csrfToken;
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    if (base.startsWith('https://')) assert.match(setCookie, /Secure/i);
    cookie = setCookie.split(';')[0];
  });

  await check('csrf blocks mutating requests', async () => {
    const { res, body } = await request('/api/catalog/refresh', { method: 'POST' });
    assert.equal(res.status, 403);
    assert.equal(body.error.code, 'csrf_invalid');
  });

  const endpoints = [
    ['/api/harnesses', 'harnesses'],
    ['/api/providers', 'providers'],
    ['/api/providers/requirements', 'requirements'],
    ['/api/models', 'models'],
    ['/api/catalog/lifecycle', 'lifecycle'],
    ['/api/catalog/snapshots', 'snapshots'],
    ['/api/catalog/diffs', 'diffs'],
    ['/api/audit', 'events']
  ];
  for (const [path, key] of endpoints) {
    await check(`authenticated ${path}`, async () => {
      const { res, body } = await request(path);
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data[key]), `${key} must be an array`);
      assertNoSecretLeak(body, path);
      return { count: body.data[key].length };
    });
  }

  await check('catalog refresh action succeeds', async () => {
    const { res, body } = await request('/api/catalog/refresh', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.data.results));
    assertNoSecretLeak(body, 'catalog refresh');
    return { results: body.data.results.length };
  });
}

const failed = results.filter((r) => !r.ok);
const summary = { ok: failed.length === 0, passed: results.length - failed.length, failed: failed.length, base, generatedAt: new Date().toISOString(), results };
console.log(`\nDMM QA smoke summary: ${summary.passed} passed, ${summary.failed} failed`);
if (process.env.DMM_QA_JSON) await import('node:fs/promises').then(fs => fs.writeFile(process.env.DMM_QA_JSON, JSON.stringify(summary, null, 2)));
if (failed.length) process.exit(1);
