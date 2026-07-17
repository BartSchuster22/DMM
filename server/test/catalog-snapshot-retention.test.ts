import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate } from '../src/db/sqlite.ts';
import { CATALOG_SNAPSHOT_RETENTION_PER_HARNESS, listCatalogDiffs, listCatalogSnapshots, storeCatalogSnapshot } from '../src/catalog/snapshots.ts';
import type { Db } from '../src/db/sqlite.ts';
import type { HarnessCatalogSnapshotInput } from '../src/adapters/types.ts';

function insertHarness(db: Db, id: string): void {
  db.prepare(`INSERT INTO harnesses (id,type,label,base_url,enabled,adapter_name,status,capabilities_json,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'test', id, 'http://127.0.0.1', 1, 'test-adapter', 'online', '{}', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
}

function snapshot(harnessId: string, index: number): HarnessCatalogSnapshotInput {
  const suffix = String(index).padStart(2, '0');
  return {
    harnessId,
    harnessType: 'test',
    harnessVersion: `1.0.${index}`,
    capturedAt: `2026-01-01T00:${suffix}:00.000Z`,
    source: { method: 'api' },
    providers: [{ id: `provider-${harnessId}`, label: `Provider ${harnessId}`, harnessProviderId: `provider-${harnessId}`, authMethod: 'none', status: 'available' }],
    models: [{ id: `model-${harnessId}-${index}`, providerId: `provider-${harnessId}`, displayName: `Model ${index}`, harnessModelId: `model-${index}`, status: 'available' }]
  };
}

test('catalog snapshot retention keeps max 10 snapshots per harness and prunes orphaned diffs', () => {
  const db = openDb(':memory:');
  migrate(db);
  insertHarness(db, 'hermes');
  insertHarness(db, 'openclaw');

  for (let i = 0; i < 12; i += 1) storeCatalogSnapshot(db, 'test', snapshot('hermes', i));
  for (let i = 0; i < 3; i += 1) storeCatalogSnapshot(db, 'test', snapshot('openclaw', i));

  assert.equal((db.prepare('SELECT COUNT(*) count FROM catalog_snapshots WHERE harness_id = ?').get('hermes') as { count: number }).count, CATALOG_SNAPSHOT_RETENTION_PER_HARNESS);
  assert.equal((db.prepare('SELECT COUNT(*) count FROM catalog_snapshots WHERE harness_id = ?').get('openclaw') as { count: number }).count, 3);

  const hermesSnapshots = listCatalogSnapshots(db, 20).filter((s) => s.harnessId === 'hermes');
  assert.equal(hermesSnapshots.length, CATALOG_SNAPSHOT_RETENTION_PER_HARNESS);
  assert.equal(hermesSnapshots.at(0)?.capturedAt, '2026-01-01T00:11:00.000Z');
  assert.equal(hermesSnapshots.at(-1)?.capturedAt, '2026-01-01T00:02:00.000Z');

  const orphanDiffs = (db.prepare(`
    SELECT COUNT(*) count FROM catalog_diffs d
    WHERE d.to_snapshot_id NOT IN (SELECT id FROM catalog_snapshots)
       OR (d.from_snapshot_id IS NOT NULL AND d.from_snapshot_id NOT IN (SELECT id FROM catalog_snapshots))
  `).get() as { count: number }).count;
  assert.equal(orphanDiffs, 0);
  assert.equal(listCatalogDiffs(db, 50).filter((d) => d.harnessId === 'hermes').length, CATALOG_SNAPSHOT_RETENTION_PER_HARNESS - 1);

  db.prepare("UPDATE harnesses SET enabled=0 WHERE id='openclaw'").run();
  assert.equal(listCatalogSnapshots(db, 50).some((s) => s.harnessId === 'openclaw'), false);
  assert.equal(listCatalogDiffs(db, 50).some((d) => d.harnessId === 'openclaw'), false);
});

test('catalog diffs detect changes in nested model metadata', () => {
  const db = openDb(':memory:');
  migrate(db);
  insertHarness(db, 'hermes');
  const first = snapshot('hermes', 1);
  first.models[0].metadata = { nested: { mode: 'before' } };
  storeCatalogSnapshot(db, 'test', first);
  const second = structuredClone(first);
  second.capturedAt = '2026-01-01T00:02:00.000Z';
  second.models[0].metadata = { nested: { mode: 'after' } };
  storeCatalogSnapshot(db, 'test', second);
  assert.equal(listCatalogDiffs(db, 10)[0]?.summary.changedModels, 1);
});
