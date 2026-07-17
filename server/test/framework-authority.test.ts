import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../src/db/sqlite.ts';
import { listModels, listProviders, upsertDiscoveredModel, upsertDiscoveredProvider } from '../src/catalog/catalog.ts';
import { frameworkProviderForKeyActivation } from '../src/api.ts';

const at = '2026-01-01T00:00:00.000Z';

function harness(db: ReturnType<typeof openDb>, id: string, enabled: boolean): void {
  db.prepare(`INSERT INTO harnesses (id,type,label,base_url,enabled,adapter_name,status,capabilities_json,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, id, id, 'http://127.0.0.1', enabled ? 1 : 0, id, 'online', '{}', '{}', at, at);
}

test('current provider and model views contain only active framework bindings', () => {
  const db = openDb(':memory:');
  migrate(db);
  harness(db, 'hermes', true);
  harness(db, 'inactive-framework', false);

  upsertDiscoveredProvider(db, 'hermes', { id: 'openrouter', label: 'OpenRouter', harnessProviderId: 'openrouter', authMethod: 'api_key', status: 'available' });
  upsertDiscoveredModel(db, 'hermes', 'openrouter', 'openrouter:model-a', 'Model A', 'openrouter:model-a', { status: 'configured_default' });
  upsertDiscoveredProvider(db, 'inactive-framework', { id: 'inactive-provider', label: 'Inactive', harnessProviderId: 'inactive-provider', authMethod: 'api_key', status: 'available' });
  upsertDiscoveredModel(db, 'inactive-framework', 'inactive-provider', 'inactive-provider:model-b', 'Model B', 'inactive-provider:model-b');

  assert.deepEqual(listProviders(db).map((provider) => provider.id), ['openrouter']);
  assert.equal(listProviders(db)[0]?.docsUrl, 'https://openrouter.ai/keys');
  assert.deepEqual(listModels(db).map((model) => [model.id, model.status]), [['openrouter:model-a', 'configured_default']]);
  assert.deepEqual(frameworkProviderForKeyActivation(db, 'openrouter'), { authMethod: 'api_key', installSupported: false });
  db.prepare("UPDATE harness_providers SET credential_install_supported=1 WHERE harness_id='hermes' AND provider_id='openrouter'").run();
  assert.deepEqual(frameworkProviderForKeyActivation(db, 'openrouter'), { authMethod: 'api_key', installSupported: true });
  assert.equal(frameworkProviderForKeyActivation(db, 'inactive-provider'), null);
  assert.equal(frameworkProviderForKeyActivation(db, 'unknown-provider'), null);

  db.prepare("UPDATE harness_providers SET status='removed_from_harness' WHERE harness_id='hermes' AND provider_id='openrouter'").run();
  db.prepare("UPDATE harness_models SET status='removed_from_harness' WHERE harness_id='hermes' AND model_id='openrouter:model-a'").run();
  assert.deepEqual(listProviders(db), []);
  assert.deepEqual(listModels(db), []);
  db.close();
});

test('an empty database has no locally seeded provider or model truth', () => {
  const db = openDb(':memory:');
  migrate(db);
  assert.deepEqual(listProviders(db), []);
  assert.deepEqual(listModels(db), []);
  db.close();
});
