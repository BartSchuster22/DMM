import type { Db } from '../db/sqlite.js';
import { insertAudit, nowIso } from '../db/sqlite.js';
import type { HarnessConfig } from '../config/env.js';
import { HermesAdapter } from './hermes/adapter.js';
import { OpenClawAdapter } from './openclaw/adapter.js';
import { FreeModelRouterAdapter } from './free-model-router/adapter.js';
import type { AdapterCapabilities, HarnessAdapter, HarnessOperationResult, HarnessView, CredentialValidationResult, InstallCredentialResult } from './types.js';
import { unsupportedCapabilities } from './types.js';
import { upsertDiscoveredModel } from '../catalog/catalog.js';
import { storeCatalogSnapshot } from '../catalog/snapshots.js';
import { catalogRefreshReason, listCatalogLifecycle } from '../catalog/lifecycle.js';
import { markHarnessCredential } from '../vault/credential-store.js';

export type ProviderCredentialOperationResult = {
  providerId: string;
  harnessResults: Array<{ harnessId: string; validation?: CredentialValidationResult; install?: InstallCredentialResult; status: string; message?: string }>;
  aggregateStatus: 'healthy' | 'saved' | 'invalid' | 'unsupported' | 'error';
};

export class AdapterRegistry {
  private adapters = new Map<string, HarnessAdapter>();

  constructor(private db: Db, private harnesses: HarnessConfig[], private timeoutMs = 2500) {
    this.register(new HermesAdapter());
    this.register(new OpenClawAdapter());
    this.register(new FreeModelRouterAdapter());
    this.seedHarnesses();
  }

  register(adapter: HarnessAdapter): void { this.adapters.set(adapter.adapterId, adapter); }

  configuredHarnesses(): HarnessView[] {
    const rows = this.db.prepare('SELECT * FROM harnesses ORDER BY id ASC').all() as any[];
    return rows.map((r) => this.rowToView(r));
  }

  async refreshAll(actor = 'system'): Promise<HarnessView[]> {
    const views: HarnessView[] = [];
    for (const harness of this.harnesses) {
      const adapter = this.adapters.get(harness.adapterName);
      const capabilities = adapter?.capabilities() ?? unsupportedCapabilities;
      if (!harness.enabled || !adapter) {
        views.push(this.upsertHarness(harness, 'unknown', capabilities, undefined, adapter ? 'disabled' : 'adapter missing'));
        continue;
      }
      const health = await adapter.health({ harness, timeoutMs: this.timeoutMs });
      const view = this.upsertHarness(harness, health.status, capabilities, health.checkedAt, health.message);
      insertAudit(this.db, { eventType: 'harness.health_checked', actor, targetType: 'harness', targetId: harness.id, payload: { status: health.status, message: health.message, latencyMs: health.latencyMs, capabilities } });
      if (capabilities.modelDiscovery) await this.discoverModelsForHarness(adapter, harness, actor);
      views.push(view);
    }
    return views;
  }

  async refreshLifecycle(actor = 'system'): Promise<HarnessView[]> {
    const views: HarnessView[] = [];
    for (const harness of this.harnesses) {
      const adapter = this.adapters.get(harness.adapterName);
      if (!harness.enabled || !adapter) {
        views.push(this.rowToView(this.db.prepare('SELECT * FROM harnesses WHERE id = ?').get(harness.id) as any));
        continue;
      }
      const ctx = { harness, timeoutMs: this.timeoutMs };
      let currentVersion: string | undefined;
      let latestVersion: string | undefined;
      let updateAvailable = false;
      let updateChannel: string | undefined;
      let versionCheckedAt: string | undefined;
      let updateCheckedAt: string | undefined;
      const messages: string[] = [];
      if (adapter.version) {
        const version = await adapter.version(ctx);
        currentVersion = version.currentVersion;
        versionCheckedAt = version.checkedAt;
        if (version.message) messages.push(version.message);
        insertAudit(this.db, { eventType: 'harness.version_checked', actor, targetType: 'harness', targetId: harness.id, payload: version });
      }
      if (adapter.updateStatus) {
        const update = await adapter.updateStatus(ctx);
        updateAvailable = update.available;
        latestVersion = update.latestVersion;
        updateChannel = update.channel;
        updateCheckedAt = update.checkedAt;
        if (!currentVersion && update.currentVersion) currentVersion = update.currentVersion;
        if (update.message) messages.push(update.message);
        insertAudit(this.db, { eventType: 'harness.update_checked', actor, targetType: 'harness', targetId: harness.id, payload: update });
      }
      const now = nowIso();
      this.db.prepare(`UPDATE harnesses SET current_version = COALESCE(?, current_version), latest_version = COALESCE(?, latest_version), update_available = ?, update_channel = COALESCE(?, update_channel), last_version_checked_at = COALESCE(?, last_version_checked_at), last_update_checked_at = COALESCE(?, last_update_checked_at), lifecycle_message = ?, updated_at = ? WHERE id = ?`).run(currentVersion ?? null, latestVersion ?? null, updateAvailable ? 1 : 0, updateChannel ?? null, versionCheckedAt ?? null, updateCheckedAt ?? null, messages.filter(Boolean).join(' | ') || null, now, harness.id);
      views.push(this.rowToView(this.db.prepare('SELECT * FROM harnesses WHERE id = ?').get(harness.id) as any));
    }
    return views;
  }

  async refreshCatalog(actor = 'system', harnessId?: string): Promise<Array<{ harnessId: string; snapshot?: unknown; diff?: unknown; error?: string }>> {
    const results: Array<{ harnessId: string; snapshot?: unknown; diff?: unknown; error?: string }> = [];
    for (const harness of this.harnesses.filter((h) => !harnessId || h.id === harnessId)) {
      const adapter = this.adapters.get(harness.adapterName);
      const capabilities = adapter?.capabilities() ?? unsupportedCapabilities;
      if (!harness.enabled || !adapter?.catalogRefresh) {
        results.push({ harnessId: harness.id, error: adapter ? 'catalog refresh unsupported or harness disabled' : 'adapter missing' });
        continue;
      }
      try {
        const input = await adapter.catalogRefresh({ harness, timeoutMs: this.timeoutMs });
        const stored = storeCatalogSnapshot(this.db, actor, input);
        this.db.prepare('UPDATE harness_providers SET discovery_supported=?, credential_install_supported=? WHERE harness_id=?').run(capabilities.providerDiscovery ? 1 : 0, capabilities.credentialInstall ? 1 : 0, harness.id);
        results.push({ harnessId: harness.id, snapshot: stored.snapshot, diff: stored.diff });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'catalog refresh failed';
        insertAudit(this.db, { eventType: 'catalog.refresh_failed', actor, targetType: 'harness', targetId: harness.id, payload: { message } });
        results.push({ harnessId: harness.id, error: message });
      }
    }
    return results;
  }


  async refreshUpdateDrivenCatalog(actor = 'system'): Promise<{ lifecycle: ReturnType<typeof listCatalogLifecycle>; refreshed: Array<{ harnessId: string; reason: string; result: unknown }>; skipped: Array<{ harnessId: string; reason: string }> }> {
    await this.refreshLifecycle(actor);
    const before = listCatalogLifecycle(this.db);
    const refreshed: Array<{ harnessId: string; reason: string; result: unknown }> = [];
    const skipped: Array<{ harnessId: string; reason: string }> = [];
    for (const item of before) {
      const reason = catalogRefreshReason(item);
      if (!reason) {
        skipped.push({ harnessId: item.harnessId, reason: 'catalog_current' });
        continue;
      }
      const [result] = await this.refreshCatalog(actor, item.harnessId);
      refreshed.push({ harnessId: item.harnessId, reason, result });
      insertAudit(this.db, { eventType: 'catalog.lifecycle_refresh', actor, targetType: 'harness', targetId: item.harnessId, payload: { reason, result } });
    }
    return { lifecycle: listCatalogLifecycle(this.db), refreshed, skipped };
  }


  async runHarnessOperation(actor: string, harnessId: string, operationId: string, input?: Record<string, unknown>): Promise<HarnessOperationResult> {
    const harness = this.harnesses.find((h) => h.id === harnessId);
    const adapter = harness ? this.adapters.get(harness.adapterName) : undefined;
    if (!harness || !adapter || !harness.enabled || !adapter.runOperation) {
      const result: HarnessOperationResult = { operationId, status: 'unsupported', message: 'Harness operation is unsupported, disabled, or adapter is missing' };
      insertAudit(this.db, { eventType: 'harness.operation_unsupported', actor, targetType: 'harness', targetId: harnessId, payload: result });
      return result;
    }
    const result = await adapter.runOperation({ harness, timeoutMs: this.timeoutMs }, operationId, input);
    insertAudit(this.db, { eventType: 'harness.operation_run', actor, targetType: 'harness', targetId: harnessId, payload: { operationId, status: result.status, message: result.message } });
    return result;
  }

  async validateProviderCredential(actor: string, providerId: string, secret: string): Promise<ProviderCredentialOperationResult> {
    return this.providerCredentialOperation(actor, providerId, secret, false);
  }

  async installProviderCredential(actor: string, providerId: string, secret: string): Promise<ProviderCredentialOperationResult> {
    return this.providerCredentialOperation(actor, providerId, secret, true);
  }

  private async providerCredentialOperation(actor: string, providerId: string, secret: string, install: boolean): Promise<ProviderCredentialOperationResult> {
    const harnessRows = this.db.prepare('SELECT harness_id FROM harness_providers WHERE provider_id=? ORDER BY harness_id').all(providerId) as any[];
    const results: ProviderCredentialOperationResult['harnessResults'] = [];
    for (const row of harnessRows) {
      const harness = this.harnesses.find((h) => h.id === row.harness_id);
      const adapter = harness ? this.adapters.get(harness.adapterName) : undefined;
      if (!harness || !adapter || !harness.enabled) {
        results.push({ harnessId: row.harness_id, status: 'unsupported', message: 'Harness is disabled or adapter is missing' });
        continue;
      }
      const capabilities = adapter.capabilities();
      const ctx = { harness, timeoutMs: this.timeoutMs };
      let validation: CredentialValidationResult | undefined;
      if (capabilities.credentialValidation) validation = await adapter.validateCredential(ctx, { providerId, secret });
      else validation = { status: 'unsupported', message: 'Credential validation is not supported by this harness adapter' };
      let installResult: InstallCredentialResult | undefined;
      if (install && validation.status === 'healthy' && capabilities.credentialInstall) installResult = await adapter.installCredential(ctx, { providerId, secret, label: `DMM BYOK ${providerId}` });
      const status = install ? statusFromInstall(validation, installResult) : validation.status;
      markHarnessCredential(this.db, actor, harness.id, providerId, status === 'installed' ? 'saved' : status as any, installResult?.message ?? validation.message);
      results.push({ harnessId: harness.id, validation, install: installResult, status, message: installResult?.message ?? validation.message });
    }
    const aggregateStatus = aggregateCredentialOperationStatus(results, install);
    insertAudit(this.db, { eventType: install ? 'provider.credential.install_completed' : 'provider.credential.validation_completed', actor, targetType: 'provider', targetId: providerId, payload: { aggregateStatus, harnessResults: results.map((r) => ({ ...r, validation: r.validation ? { status: r.validation.status, message: r.validation.message } : undefined, install: r.install ? { status: r.install.status, message: r.install.message } : undefined })) } });
    return { providerId, harnessResults: results, aggregateStatus };
  }

  private async discoverModelsForHarness(adapter: HarnessAdapter, harness: HarnessConfig, actor: string): Promise<void> {
    try {
      const models = await adapter.discoverModels({ harness, timeoutMs: this.timeoutMs });
      for (const model of models) upsertDiscoveredModel(this.db, harness.id, model.providerId, model.id, model.displayName, model.harnessModelId);
      if (models.length) insertAudit(this.db, { eventType: 'harness.models_discovered', actor, targetType: 'harness', targetId: harness.id, payload: { count: models.length } });
    } catch (error) {
      insertAudit(this.db, { eventType: 'harness.model_discovery_failed', actor, targetType: 'harness', targetId: harness.id, payload: { message: error instanceof Error ? error.message : 'unknown error' } });
    }
  }

  private seedHarnesses(): void {
    const now = nowIso();
    for (const harness of this.harnesses) {
      const adapter = this.adapters.get(harness.adapterName);
      const capabilities = adapter?.capabilities() ?? unsupportedCapabilities;
      this.db.prepare(`INSERT INTO harnesses (id,type,label,base_url,enabled,adapter_name,status,capabilities_json,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,label=excluded.label,base_url=excluded.base_url,enabled=excluded.enabled,adapter_name=excluded.adapter_name,capabilities_json=excluded.capabilities_json,config_json=excluded.config_json,updated_at=excluded.updated_at`).run(harness.id, harness.type, harness.label, harness.baseUrl, harness.enabled ? 1 : 0, harness.adapterName, 'unknown', JSON.stringify(capabilities), JSON.stringify(harness.config ?? {}), now, now);
    }
  }

  private upsertHarness(harness: HarnessConfig, status: string, capabilities: AdapterCapabilities, lastSeenAt?: string, message?: string): HarnessView {
    const now = nowIso();
    this.db.prepare(`INSERT INTO harnesses (id,type,label,base_url,enabled,adapter_name,status,capabilities_json,config_json,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,label=excluded.label,base_url=excluded.base_url,enabled=excluded.enabled,adapter_name=excluded.adapter_name,status=excluded.status,capabilities_json=excluded.capabilities_json,config_json=excluded.config_json,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`).run(harness.id, harness.type, harness.label, harness.baseUrl, harness.enabled ? 1 : 0, harness.adapterName, status, JSON.stringify(capabilities), JSON.stringify(harness.config ?? {}), lastSeenAt ?? null, now, now);
    return this.rowToView(this.db.prepare('SELECT * FROM harnesses WHERE id = ?').get(harness.id) as any);
  }

  private rowToView(r: any): HarnessView {
    const config = r.config_json ? JSON.parse(r.config_json) as Record<string, unknown> : undefined;
    const adapter = this.adapters.get(r.adapter_name);
    const harness: HarnessConfig = { id: r.id, type: r.type, label: r.label, baseUrl: r.base_url, enabled: !!r.enabled, adapterName: r.adapter_name, config };
    return { id: r.id, type: r.type, label: r.label, baseUrl: r.base_url, enabled: !!r.enabled, adapterName: r.adapter_name, status: r.status, capabilities: JSON.parse(r.capabilities_json) as AdapterCapabilities, config, operations: adapter?.listOperations ? adapter.listOperations({ harness, timeoutMs: this.timeoutMs }) : undefined, lastSeenAt: r.last_seen_at ?? undefined, updatedAt: r.updated_at, currentVersion: r.current_version ?? undefined, latestVersion: r.latest_version ?? undefined, updateAvailable: !!r.update_available, updateChannel: r.update_channel ?? undefined, lastVersionCheckedAt: r.last_version_checked_at ?? undefined, lastUpdateCheckedAt: r.last_update_checked_at ?? undefined, lastCatalogRefreshAt: r.last_catalog_refresh_at ?? undefined, lifecycleMessage: r.lifecycle_message ?? undefined };
  }
}

function statusFromInstall(validation: CredentialValidationResult, install?: InstallCredentialResult): string {
  if (validation.status !== 'healthy') return validation.status;
  if (!install) return 'unsupported';
  if (install.status === 'installed') return 'installed';
  return install.status;
}

function aggregateCredentialOperationStatus(results: ProviderCredentialOperationResult['harnessResults'], install: boolean): ProviderCredentialOperationResult['aggregateStatus'] {
  if (results.some((r) => r.status === 'installed' || r.status === 'healthy')) return install ? 'saved' : 'healthy';
  if (results.some((r) => r.status === 'invalid')) return 'invalid';
  if (results.some((r) => r.status === 'error')) return 'error';
  return 'unsupported';
}
