import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogRefreshReason, listCatalogLifecycle } from '../src/catalog/lifecycle.ts';
import { migrate, openDb } from '../src/db/sqlite.ts';
import type { CatalogLifecycleView } from '@dmm/shared';

function view(input: Partial<CatalogLifecycleView>): CatalogLifecycleView {
  return { harnessId: 'hermes', label: 'Hermes', updateAvailable: false, refreshRecommended: false, ...input };
}

test('catalog lifecycle recommends refresh when no snapshot exists', () => {
  assert.equal(catalogRefreshReason(view({ currentVersion: '1.0.0' })), 'no_snapshot');
});

test('catalog lifecycle recommends refresh when harness version changed since snapshot', () => {
  assert.equal(catalogRefreshReason(view({ currentVersion: '1.1.0', latestSnapshotVersion: '1.0.0', latestSnapshotCapturedAt: '2026-06-04T09:00:00.000Z' })), 'harness_version_changed');
});

test('catalog lifecycle stays current when snapshot matches checked lifecycle', () => {
  assert.equal(catalogRefreshReason(view({ currentVersion: '1.0.0', latestSnapshotVersion: '1.0.0', latestSnapshotCapturedAt: '2026-06-04T09:00:00.000Z', lastCatalogRefreshAt: '2026-06-04T09:01:00.000Z', lastUpdateCheckedAt: '2026-06-04T09:00:00.000Z' })), undefined);
});

test('catalog lifecycle refreshes when update check is newer than catalog', () => {
  assert.equal(catalogRefreshReason(view({ currentVersion: '1.0.0', latestSnapshotVersion: '1.0.0', latestSnapshotCapturedAt: '2026-06-04T09:00:00.000Z', lastCatalogRefreshAt: '2026-06-04T09:00:00.000Z', lastUpdateCheckedAt: '2026-06-04T09:01:00.000Z' })), 'update_check_newer_than_catalog');
});

test('catalog lifecycle excludes disabled framework history from current scope', () => {
  const db = openDb(':memory:');
  migrate(db);
  const now = new Date().toISOString();
  const insert = db.prepare("INSERT INTO harnesses (id,type,label,base_url,enabled,adapter_name,status,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  insert.run('hermes', 'hermes', 'Hermes', 'http://127.0.0.1', 1, 'hermes', 'online', '{}', now, now);
  insert.run('retired', 'openclaw', 'Retired', 'http://127.0.0.1', 0, 'openclaw', 'offline', '{}', now, now);
  assert.deepEqual(listCatalogLifecycle(db).map((item) => item.harnessId), ['hermes']);
});
