import { randomUUID } from 'node:crypto';
import type { CatalogDiffView, CatalogSnapshotView } from '@dmm/shared';
import type { Db } from '../db/sqlite.js';
import { insertAudit, nowIso } from '../db/sqlite.js';
import type { DiscoveredModel, DiscoveredProvider, HarnessCatalogSnapshotInput } from '../adapters/types.js';
import { upsertDiscoveredModel, upsertDiscoveredProvider } from './catalog.js';

export type CatalogDiff = {
  addedProviders: DiscoveredProvider[];
  removedProviders: DiscoveredProvider[];
  changedProviders: Array<{ before: DiscoveredProvider; after: DiscoveredProvider }>;
  addedModels: DiscoveredModel[];
  removedModels: DiscoveredModel[];
  changedModels: Array<{ before: DiscoveredModel; after: DiscoveredModel }>;
};

export function storeCatalogSnapshot(db: Db, actor: string, input: HarnessCatalogSnapshotInput): { snapshot: CatalogSnapshotView; diff?: CatalogDiffView } {
  const previous = latestSnapshotRaw(db, input.harnessId);
  const snapshotId = randomUUID();
  const capturedAt = input.capturedAt || nowIso();
  const snapshotJson = JSON.stringify(input);
  db.prepare(`INSERT INTO catalog_snapshots (id,harness_id,harness_version,provider_count,model_count,source_method,snapshot_json,captured_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(snapshotId, input.harnessId, input.harnessVersion ?? null, input.providers.length, input.models.length, input.source.method, snapshotJson, capturedAt);
  applyCatalogToCurrentTables(db, input);
  db.prepare('UPDATE harnesses SET last_catalog_refresh_at = ?, updated_at = ? WHERE id = ?').run(capturedAt, nowIso(), input.harnessId);
  const snapshot = rowToSnapshotView(db.prepare('SELECT * FROM catalog_snapshots WHERE id=?').get(snapshotId) as any);
  let diffView: CatalogDiffView | undefined;
  if (previous) {
    const diff = diffSnapshots(previous, input);
    const diffId = randomUUID();
    db.prepare(`INSERT INTO catalog_diffs (id,harness_id,from_snapshot_id,to_snapshot_id,added_providers_json,removed_providers_json,changed_providers_json,added_models_json,removed_models_json,changed_models_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(diffId, input.harnessId, previous.id, snapshotId, JSON.stringify(diff.addedProviders), JSON.stringify(diff.removedProviders), JSON.stringify(diff.changedProviders), JSON.stringify(diff.addedModels), JSON.stringify(diff.removedModels), JSON.stringify(diff.changedModels), capturedAt);
    diffView = rowToDiffView(db.prepare('SELECT * FROM catalog_diffs WHERE id=?').get(diffId) as any);
  }
  insertAudit(db, { eventType: 'catalog.snapshot_captured', actor, targetType: 'harness', targetId: input.harnessId, payload: { snapshotId, providerCount: input.providers.length, modelCount: input.models.length, source: input.source, diff: diffView?.summary } });
  return { snapshot, diff: diffView };
}

export function listCatalogSnapshots(db: Db, limit = 25): CatalogSnapshotView[] {
  return (db.prepare('SELECT * FROM catalog_snapshots ORDER BY captured_at DESC LIMIT ?').all(limit) as any[]).map(rowToSnapshotView);
}
export function listCatalogDiffs(db: Db, limit = 25): CatalogDiffView[] {
  return (db.prepare('SELECT * FROM catalog_diffs ORDER BY created_at DESC LIMIT ?').all(limit) as any[]).map(rowToDiffView);
}

function applyCatalogToCurrentTables(db: Db, input: HarnessCatalogSnapshotInput): void {
  const now = nowIso();
  for (const provider of input.providers) upsertDiscoveredProvider(db, input.harnessId, provider);
  for (const model of input.models) upsertDiscoveredModel(db, input.harnessId, model.providerId, model.id, model.displayName, model.harnessModelId, model);
  const seenProviderIds = new Set(input.providers.map((p) => p.id));
  const seenModelIds = new Set(input.models.map((m) => m.id));
  const existingProviders = db.prepare('SELECT provider_id FROM harness_providers WHERE harness_id=?').all(input.harnessId) as any[];
  for (const row of existingProviders) if (!seenProviderIds.has(row.provider_id)) db.prepare('UPDATE harness_providers SET status=?, last_discovered_at=? WHERE harness_id=? AND provider_id=?').run('removed_from_harness', now, input.harnessId, row.provider_id);
  const existingModels = db.prepare('SELECT model_id FROM harness_models WHERE harness_id=?').all(input.harnessId) as any[];
  for (const row of existingModels) if (!seenModelIds.has(row.model_id)) db.prepare('UPDATE harness_models SET status=?, last_seen_at=? WHERE harness_id=? AND model_id=?').run('removed_from_harness', now, input.harnessId, row.model_id);
}

function latestSnapshotRaw(db: Db, harnessId: string): (HarnessCatalogSnapshotInput & { id: string }) | null {
  const row = db.prepare('SELECT id,snapshot_json FROM catalog_snapshots WHERE harness_id=? ORDER BY captured_at DESC LIMIT 1').get(harnessId) as any;
  if (!row) return null;
  return { ...JSON.parse(row.snapshot_json), id: row.id };
}

function diffSnapshots(previous: HarnessCatalogSnapshotInput, current: HarnessCatalogSnapshotInput): CatalogDiff {
  const prevProviders = new Map(previous.providers.map((p) => [p.id, p]));
  const curProviders = new Map(current.providers.map((p) => [p.id, p]));
  const prevModels = new Map(previous.models.map((m) => [m.id, m]));
  const curModels = new Map(current.models.map((m) => [m.id, m]));
  return {
    addedProviders: [...curProviders.values()].filter((p) => !prevProviders.has(p.id)),
    removedProviders: [...prevProviders.values()].filter((p) => !curProviders.has(p.id)),
    changedProviders: [...curProviders.values()].filter((p) => prevProviders.has(p.id) && stableJson(prevProviders.get(p.id)) !== stableJson(p)).map((p) => ({ before: prevProviders.get(p.id)!, after: p })),
    addedModels: [...curModels.values()].filter((m) => !prevModels.has(m.id)),
    removedModels: [...prevModels.values()].filter((m) => !curModels.has(m.id)),
    changedModels: [...curModels.values()].filter((m) => prevModels.has(m.id) && stableJson(prevModels.get(m.id)) !== stableJson(m)).map((m) => ({ before: prevModels.get(m.id)!, after: m }))
  };
}
function stableJson(value: unknown): string { return JSON.stringify(value, Object.keys(value as any).sort()); }
function rowToSnapshotView(r: any): CatalogSnapshotView { return { id: r.id, harnessId: r.harness_id, harnessVersion: r.harness_version ?? undefined, providerCount: Number(r.provider_count), modelCount: Number(r.model_count), sourceMethod: r.source_method, capturedAt: r.captured_at }; }
function rowToDiffView(r: any): CatalogDiffView {
  const addedProviders = JSON.parse(r.added_providers_json); const removedProviders = JSON.parse(r.removed_providers_json); const changedProviders = JSON.parse(r.changed_providers_json); const addedModels = JSON.parse(r.added_models_json); const removedModels = JSON.parse(r.removed_models_json); const changedModels = JSON.parse(r.changed_models_json);
  return { id: r.id, harnessId: r.harness_id, fromSnapshotId: r.from_snapshot_id ?? undefined, toSnapshotId: r.to_snapshot_id, createdAt: r.created_at, summary: { addedProviders: addedProviders.length, removedProviders: removedProviders.length, changedProviders: changedProviders.length, addedModels: addedModels.length, removedModels: removedModels.length, changedModels: changedModels.length }, addedProviders, removedProviders, changedProviders, addedModels, removedModels, changedModels };
}
