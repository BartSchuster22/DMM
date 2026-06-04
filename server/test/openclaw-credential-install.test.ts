import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenClawAdapter } from '../src/adapters/openclaw/adapter.ts';

const harness = { id: 'openclaw', type: 'openclaw', label: 'OpenClaw', baseUrl: 'http://127.0.0.1:18789', enabled: true, adapterName: 'openclaw', config: {} };

test('OpenClaw adapter exposes credential validation/install as Layer 3 capabilities', () => {
  const caps = new OpenClawAdapter().capabilities();
  assert.equal(caps.credentialValidation, true);
  assert.equal(caps.credentialInstall, true);
});

test('OpenClaw adapter validates and installs credentials through host helper without returning secrets', async () => {
  const adapter = new OpenClawAdapter();
  const secret = 'fake-key-credential-value';
  const calls: Array<{ operation: string; body: any }> = [];
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.DMM_HOST_HELPER_URL;
  const oldToken = process.env.DMM_HOST_HELPER_TOKEN;
  process.env.DMM_HOST_HELPER_URL = 'http://helper.local';
  process.env.DMM_HOST_HELPER_TOKEN = 'helper-token';
  globalThis.fetch = (async (url: any, init: any) => {
    const operation = String(url).split('/').pop() ?? '';
    const body = JSON.parse(String(init.body));
    calls.push({ operation, body });
    assert.equal(init.headers['x-dmm-helper-token'], 'helper-token');
    assert.equal(body.providerId, 'deepseek');
    assert.equal(body.secret, secret);
    if (operation === 'openclaw.validateCredential') {
      return new Response(JSON.stringify({ ok: true, operation, data: { status: 'healthy', message: 'Credential passed OpenClaw local BYOK format validation' } }), { status: 200 });
    }
    if (operation === 'openclaw.installCredential') {
      return new Response(JSON.stringify({ ok: true, operation, data: { status: 'installed', message: 'Credential installed into OpenClaw auth profile', profileId: 'deepseek:default', backupsCreated: 2 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, operation, error: { code: 'bad_op', message: 'bad operation' } }), { status: 400 });
  }) as typeof fetch;
  try {
    const validation = await adapter.validateCredential({ harness, timeoutMs: 1000 }, { providerId: 'deepseek', secret });
    const install = await adapter.installCredential({ harness, timeoutMs: 1000 }, { providerId: 'deepseek', secret, label: 'DMM BYOK deepseek' });
    assert.equal(validation.status, 'healthy');
    assert.equal(install.status, 'installed');
    assert.equal(calls.length, 2);
    assert.equal(JSON.stringify(validation).includes(secret), false);
    assert.equal(JSON.stringify(install).includes(secret), false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.DMM_HOST_HELPER_URL; else process.env.DMM_HOST_HELPER_URL = oldUrl;
    if (oldToken === undefined) delete process.env.DMM_HOST_HELPER_TOKEN; else process.env.DMM_HOST_HELPER_TOKEN = oldToken;
  }
});
