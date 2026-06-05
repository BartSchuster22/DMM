import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../src/db/sqlite.ts';
import { seedCatalog } from '../src/catalog/catalog.ts';
import { deleteCredential, getCredential, listCredentials, markCredentialValidated, saveCredential } from '../src/vault/credential-store.ts';

const masterKey = 'phase-b-test-master-key-credential-management';

test('DMM credential vault stores encrypted BYOK, exposes only fingerprint inventory, and supports validation/delete lifecycle', () => {
  const db = openDb(':memory:');
  migrate(db);
  seedCatalog(db);

  const secret = 'sk-test-phase-b-credential-value';
  const saved = saveCredential(db, masterKey, 'tester', 'openrouter', secret);
  assert.equal(saved.providerId, 'openrouter');
  assert.equal(saved.status, 'saved');
  assert.equal(saved.fingerprint.endsWith('alue'), true);

  const raw = db.prepare('SELECT encrypted_payload FROM credentials WHERE provider_id=?').get('openrouter') as { encrypted_payload: string };
  assert.equal(raw.encrypted_payload.includes(secret), false);

  const stored = getCredential(db, masterKey, 'openrouter');
  assert.equal(stored?.secret, secret);
  assert.equal(stored?.fingerprint, saved.fingerprint);

  const inventory = listCredentials(db);
  assert.equal(inventory.length, 1);
  assert.deepEqual(Object.keys(inventory[0]!).sort(), ['authMethod', 'createdAt', 'fingerprint', 'harnessId', 'lastValidatedAt', 'providerId', 'providerLabel', 'scope', 'status', 'updatedAt'].sort());
  assert.equal(JSON.stringify(inventory).includes(secret), false);

  const validated = markCredentialValidated(db, 'tester', 'openrouter', 'healthy', 'validated in test');
  assert.equal(validated.status, 'healthy');
  assert.equal((getCredential(db, masterKey, 'openrouter')?.status), 'healthy');

  const deleted = deleteCredential(db, 'tester', 'openrouter');
  assert.equal(deleted.deleted, true);
  assert.equal(getCredential(db, masterKey, 'openrouter'), null);
  assert.equal(listCredentials(db).length, 0);
});
