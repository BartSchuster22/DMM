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
