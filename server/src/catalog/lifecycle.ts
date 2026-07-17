import type { CatalogLifecycleView } from '@dmm/shared';
import type { Db } from '../db/sqlite.js';

export function listCatalogLifecycle(db: Db): CatalogLifecycleView[] {
  const rows = db.prepare(`
    SELECT
      h.id,
      h.label,
      h.current_version,
      h.latest_version,
      h.update_available,
      h.last_version_checked_at,
      h.last_update_checked_at,
      h.last_catalog_refresh_at,
      h.lifecycle_message,
      s.harness_version AS snapshot_version,
      s.captured_at AS snapshot_captured_at,
      s.provider_count AS snapshot_provider_count,
      s.model_count AS snapshot_model_count
    FROM harnesses h
    LEFT JOIN catalog_snapshots s ON s.id = (
      SELECT id FROM catalog_snapshots WHERE harness_id = h.id ORDER BY captured_at DESC LIMIT 1
    )
    WHERE h.enabled = 1
    ORDER BY h.id ASC
  `).all() as any[];
  return rows.map(rowToCatalogLifecycleView);
}

export function catalogRefreshReason(view: CatalogLifecycleView): string | undefined {
  if (!view.latestSnapshotCapturedAt) return 'no_snapshot';
  if (view.currentVersion && view.latestSnapshotVersion && view.currentVersion !== view.latestSnapshotVersion) return 'harness_version_changed';
  if (view.currentVersion && !view.latestSnapshotVersion) return 'snapshot_version_missing';
  if (view.lastCatalogRefreshAt && view.lastUpdateCheckedAt && Date.parse(view.lastUpdateCheckedAt) > Date.parse(view.lastCatalogRefreshAt)) return 'update_check_newer_than_catalog';
  return undefined;
}

function rowToCatalogLifecycleView(r: any): CatalogLifecycleView {
  const base: CatalogLifecycleView = {
    harnessId: r.id,
    label: r.label,
    currentVersion: r.current_version ?? undefined,
    latestVersion: r.latest_version ?? undefined,
    updateAvailable: !!r.update_available,
    lastVersionCheckedAt: r.last_version_checked_at ?? undefined,
    lastUpdateCheckedAt: r.last_update_checked_at ?? undefined,
    lastCatalogRefreshAt: r.last_catalog_refresh_at ?? undefined,
    latestSnapshotVersion: r.snapshot_version ?? undefined,
    latestSnapshotCapturedAt: r.snapshot_captured_at ?? undefined,
    latestSnapshotProviderCount: r.snapshot_provider_count == null ? undefined : Number(r.snapshot_provider_count),
    latestSnapshotModelCount: r.snapshot_model_count == null ? undefined : Number(r.snapshot_model_count),
    refreshRecommended: false,
    reason: undefined
  };
  const reason = catalogRefreshReason(base);
  return { ...base, refreshRecommended: Boolean(reason), reason };
}
