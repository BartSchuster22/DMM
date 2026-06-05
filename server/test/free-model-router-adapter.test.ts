import test from 'node:test';
import assert from 'node:assert/strict';
import { FreeModelRouterAdapter } from '../src/adapters/free-model-router/adapter.ts';

test('Free Model Router V2 adapter is read-only policy-provider harness', async () => {
  const adapter = new FreeModelRouterAdapter();
  const capabilities = adapter.capabilities();
  assert.equal(capabilities.health, true);
  assert.equal(capabilities.providerDiscovery, true);
  assert.equal(capabilities.modelDiscovery, true);
  assert.equal(capabilities.catalogRefresh, true);
  assert.equal(capabilities.credentialValidation, false);
  assert.equal(capabilities.credentialInstall, false);
  assert.equal(capabilities.updateApply, false);
  assert.equal(capabilities.restart, false);

  const providers = await adapter.discoverProviders({
    harness: { id: 'free-model-router-v2', type: 'free-model-router', label: 'Free Model Router V2', baseUrl: 'http://127.0.0.1:18082', enabled: true, adapterName: 'free-model-router' },
    timeoutMs: 10
  });
  assert.equal(providers.length, 1);
  assert.equal(providers[0]?.id, 'openrouter');
  assert.equal(providers[0]?.metadata?.runtimeMutation, false);

  const validation = await adapter.validateCredential({
    harness: { id: 'free-model-router-v2', type: 'free-model-router', label: 'Free Model Router V2', baseUrl: 'http://127.0.0.1:18082', enabled: true, adapterName: 'free-model-router' },
    timeoutMs: 10
  }, { providerId: 'openrouter', secret: 'sk-test-value' });
  assert.equal(validation.status, 'unsupported');
});

test('Free Model Router V2 adapter exposes allowlisted operation controls and gates tokened actions', async () => {
  const adapter = new FreeModelRouterAdapter();
  const harness = { id: 'free-model-router-v2', type: 'free-model-router', label: 'Free Model Router V2', baseUrl: 'http://127.0.0.1:18082', enabled: true, adapterName: 'free-model-router', config: {} };
  const operations = adapter.listOperations({ harness, timeoutMs: 10 });
  assert.deepEqual(operations.map((op) => op.id), ['status', 'hardening-report', 'openrouter-sync', 'capability-verify', 'rankings-generate', 'probe-free-models']);
  assert.equal(operations.every((op) => op.destructive === false), true);
  assert.equal(operations.find((op) => op.id === 'status')?.requiresToken, false);
  assert.equal(operations.find((op) => op.id === 'openrouter-sync')?.requiresToken, true);

  const gated = await adapter.runOperation({ harness, timeoutMs: 10 }, 'openrouter-sync');
  assert.equal(gated.status, 'unsupported');
  assert.match(gated.message ?? '', /machine token/i);

  const calls: Array<{ url: string; init: RequestInit }> = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ synced: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await adapter.runOperation({ harness: { ...harness, config: { machineToken: 'token-123' } }, timeoutMs: 10 }, 'openrouter-sync', { payload: { ok: true } });
    assert.equal(result.status, 'completed');
    assert.equal(calls[0]?.url, 'http://127.0.0.1:18082/v1/providers/openrouter/sync');
    assert.equal(calls[0]?.init.method, 'POST');
    assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, 'Bearer token-123');
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { payload: { ok: true } });
  } finally {
    globalThis.fetch = oldFetch;
  }
});
