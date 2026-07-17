import { randomUUID } from 'node:crypto';
import type { ProviderView, ModelView, ProviderStatus, ModelStatus, CredentialStatus, ProviderCredentialRequirementView, ProviderHarnessCredentialState, NormalizedDmmStateView, NormalizedProviderState } from '@dmm/shared';
import type { Db } from '../db/sqlite.js';
import type { DiscoveredModel, DiscoveredProvider } from '../adapters/types.js';
import { nowIso } from '../db/sqlite.js';
import { providerManifest } from './provider-manifest.js';
export function listProviders(db: Db): ProviderView[] {
  const reqs = new Map(listProviderCredentialRequirements(db).map((r) => [r.providerId, r]));
  const rows = db.prepare(`SELECT p.*, c.status credential_status, c.fingerprint,
    (SELECT COUNT(*) FROM models m WHERE m.provider_id=p.id AND EXISTS (SELECT 1 FROM harness_models hm JOIN harnesses h ON h.id=hm.harness_id WHERE hm.model_id=m.id AND hm.status != 'removed_from_harness' AND h.enabled=1)) model_count
    FROM providers p LEFT JOIN credentials c ON c.provider_id=p.id AND c.harness_id IS NULL
    WHERE EXISTS (SELECT 1 FROM harness_providers hp JOIN harnesses h ON h.id=hp.harness_id WHERE hp.provider_id=p.id AND hp.status != 'removed_from_harness' AND h.enabled=1)
    ORDER BY p.label ASC`).all() as any[];
  return rows.map((r) => {
    const req = reqs.get(r.id);
    const metadata = parseJsonObject(r.metadata_json);
    return { id: r.id, label: r.label, authMethod: r.auth_method, docsUrl: r.docs_url ?? undefined, status: r.status as ProviderStatus, credentialStatus: ((r.credential_status ?? req?.credentialStatus) ?? 'missing') as CredentialStatus, credentialFingerprint: r.fingerprint ?? undefined, modelCount: Number(r.model_count ?? 0), harnesses: harnessesForProvider(db, r.id), credentialRequirements: req, providerKind: stringValue(metadata.providerKind), upstreamProviderId: stringValue(metadata.upstreamProviderId), role: stringValue(metadata.role), updatedAt: r.updated_at };
  });
}
export function listModels(db: Db): ModelView[] { const rows = db.prepare(`SELECT * FROM models m WHERE EXISTS (SELECT 1 FROM harness_models hm JOIN harnesses h ON h.id=hm.harness_id WHERE hm.model_id=m.id AND hm.status != 'removed_from_harness' AND h.enabled=1) ORDER BY provider_id ASC, display_name ASC`).all() as any[]; return rows.map((r) => ({ id: r.id, providerId: r.provider_id, displayName: r.display_name, modality: r.modality, contextWindow: r.context_window ?? undefined, status: r.status as ModelStatus, harnesses: harnessesForModel(db, r.id), updatedAt: r.updated_at })); }
export function upsertDiscoveredProvider(db: Db, harnessId: string, provider: DiscoveredProvider): void {
  const now = nowIso();
  const manifest = providerManifest(provider.id);
  const metadata = { source: 'framework-catalog', ...(manifest?.metadata ?? {}), ...(provider.metadata ?? {}) };
  const credentialStatus = credentialStatusFromDiscoveredProvider(provider);
  db.prepare(`INSERT INTO providers (id,label,auth_method,docs_url,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,auth_method=excluded.auth_method,docs_url=excluded.docs_url,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).run(provider.id, provider.label || manifest?.label || provider.id, provider.authMethod ?? manifest?.authMethod ?? 'unknown', manifest?.docsUrl ?? null, provider.status ?? 'available', JSON.stringify(metadata), now, now);
  db.prepare(`INSERT INTO harness_providers (id,harness_id,provider_id,harness_provider_id,status,credential_status,discovery_supported,credential_install_supported,model_count,last_discovered_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(harness_id,provider_id) DO UPDATE SET harness_provider_id=excluded.harness_provider_id,status=excluded.status,credential_status=excluded.credential_status,last_discovered_at=excluded.last_discovered_at`).run(randomUUID(), harnessId, provider.id, provider.harnessProviderId, provider.status ?? 'harness_supported', credentialStatus, 1, 0, 0, now);
}
export function upsertDiscoveredModel(db: Db, harnessId: string, providerId: string, id: string, displayName: string, harnessModelId: string, model?: Partial<DiscoveredModel>): void { const now = nowIso(); db.prepare(`INSERT INTO providers (id,label,auth_method,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(providerId, providerId, 'unknown', 'available', '{}', now, now); db.prepare(`INSERT INTO models (id,provider_id,display_name,modality,context_window,capabilities_json,pricing_json,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,context_window=excluded.context_window,status=excluded.status,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).run(id, providerId, displayName, model?.modality ?? 'text', model?.contextWindow ?? null, JSON.stringify(['text']), '{}', model?.status ?? 'available', JSON.stringify({ source: 'framework-catalog', ...(model?.metadata ?? {}) }), now, now); db.prepare(`INSERT INTO harness_models (id,harness_id,provider_id,model_id,harness_model_id,status,discovered_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(harness_id,model_id) DO UPDATE SET harness_model_id=excluded.harness_model_id,status=excluded.status,last_seen_at=excluded.last_seen_at`).run(randomUUID(), harnessId, providerId, id, harnessModelId, model?.status ?? 'available', now, now); db.prepare('UPDATE harness_providers SET model_count=(SELECT COUNT(*) FROM harness_models WHERE harness_id=? AND provider_id=? AND status != ?) WHERE harness_id=? AND provider_id=?').run(harnessId, providerId, 'removed_from_harness', harnessId, providerId); }
function harnessesForProvider(db: Db, providerId: string): string[] { return (db.prepare("SELECT hp.harness_id FROM harness_providers hp JOIN harnesses h ON h.id=hp.harness_id WHERE hp.provider_id=? AND hp.status != 'removed_from_harness' AND h.enabled=1 ORDER BY hp.harness_id").all(providerId) as any[]).map((r) => r.harness_id); }
function harnessesForModel(db: Db, modelId: string): string[] { return (db.prepare("SELECT hm.harness_id FROM harness_models hm JOIN harnesses h ON h.id=hm.harness_id WHERE hm.model_id=? AND hm.status != 'removed_from_harness' AND h.enabled=1 ORDER BY hm.harness_id").all(modelId) as any[]).map((r) => r.harness_id); }



export function listNormalizedDmmState(db: Db): NormalizedDmmStateView {
  return {
    layers: [
      { id: 'external_provider_model_source', label: 'Layer 1: external provider/model sources', description: 'External provider/model truth ingested or discovered by DMM.' },
      { id: 'harness_instance', label: 'Layer 2: harness instances', description: 'Configured runtime/framework instances available on this DMM instance.' },
      { id: 'harness_dmm_adapter', label: 'Layer 3: harness <> DMM adapters', description: 'Adapter normalization boundary for provider/model/credential state.' },
      { id: 'dmm_ui', label: 'Layer 4: DMM core + UI', description: 'Unified DMM view rendered from normalized state.' }
    ],
    providers: listNormalizedProviderStates(db)
  };
}

export function listNormalizedProviderStates(db: Db): NormalizedProviderState[] {
  const providers = db.prepare(`SELECT p.*, c.status credential_status, c.fingerprint, (SELECT COUNT(*) FROM models m WHERE m.provider_id=p.id AND EXISTS (SELECT 1 FROM harness_models hm JOIN harnesses h ON h.id=hm.harness_id WHERE hm.model_id=m.id AND hm.status != 'removed_from_harness' AND h.enabled=1)) model_count FROM providers p LEFT JOIN credentials c ON c.provider_id=p.id AND c.harness_id IS NULL WHERE EXISTS (SELECT 1 FROM harness_providers hp JOIN harnesses h ON h.id=hp.harness_id WHERE hp.provider_id=p.id AND hp.status != 'removed_from_harness' AND h.enabled=1) ORDER BY p.label ASC`).all() as any[];
  return providers.map((p) => {
    const metadata = parseJsonObject(p.metadata_json);
    const harnessRows = db.prepare(`SELECT hp.*, h.type harness_type, h.label harness_label, h.adapter_name FROM harness_providers hp JOIN harnesses h ON h.id = hp.harness_id WHERE hp.provider_id = ? AND hp.status != 'removed_from_harness' AND h.enabled=1 ORDER BY hp.harness_id ASC`).all(p.id) as any[];
    const harnessStates = harnessRows.map((h) => ({
      harnessId: h.harness_id,
      harnessType: h.harness_type,
      harnessLabel: h.harness_label,
      adapterName: h.adapter_name,
      harnessProviderId: h.harness_provider_id,
      supportStatus: h.status,
      credentialStatus: (h.credential_status ?? 'missing') as CredentialStatus,
      discoverySupported: Boolean(h.discovery_supported),
      credentialInstallSupported: Boolean(h.credential_install_supported),
      modelCount: Number(h.model_count ?? 0),
      lastDiscoveredAt: h.last_discovered_at ?? undefined,
      lastValidatedAt: h.last_validated_at ?? undefined
    }));
    return {
      layer: 'dmm_ui',
      providerId: p.id,
      label: p.label,
      authMethod: p.auth_method,
      dmmProviderStatus: p.status as ProviderStatus,
      dmmCredentialStatus: ((p.credential_status ?? aggregateCredentialStatusValue(harnessStates.map((h) => ({ ...h, status: h.credentialStatus })), metadata)) ?? 'missing') as CredentialStatus,
      dmmCredentialFingerprint: p.fingerprint ?? undefined,
      externalSource: typeof metadata.source === 'string' ? metadata.source : 'unknown',
      providerKind: stringValue(metadata.providerKind),
      upstreamProviderId: stringValue(metadata.upstreamProviderId),
      role: stringValue(metadata.role),
      modelCount: Number(p.model_count ?? 0),
      harnessStates,
      updatedAt: p.updated_at
    };
  });
}

export function listProviderCredentialRequirements(db: Db): ProviderCredentialRequirementView[] {
  const rows = db.prepare("SELECT * FROM providers p WHERE EXISTS (SELECT 1 FROM harness_providers hp JOIN harnesses h ON h.id=hp.harness_id WHERE hp.provider_id=p.id AND hp.status != 'removed_from_harness' AND h.enabled=1) ORDER BY label ASC").all() as any[];
  return rows.map((r) => {
    const metadata = parseJsonObject(r.metadata_json);
    const harnesses = harnessCredentialStatesForProvider(db, r.id);
    const aggregateStatus = aggregateCredentialStatusValue(harnesses, metadata);
    return {
      providerId: r.id,
      label: r.label,
      authMethod: r.auth_method,
      status: r.status as ProviderStatus,
      credentialStatus: aggregateStatus,
      requiredEnvVars: stringArray(metadata.requiredEnvVars),
      configuredEnvVars: stringArray(metadata.configuredEnvVars),
      credentialPoolCount: numberValue(metadata.credentialPoolCount),
      harnesses,
      docsUrl: r.docs_url ?? undefined,
      updatedAt: r.updated_at
    };
  });
}

function harnessCredentialStatesForProvider(db: Db, providerId: string): ProviderHarnessCredentialState[] {
  return (db.prepare("SELECT hp.harness_id,hp.status,hp.credential_status,hp.discovery_supported,hp.credential_install_supported,hp.model_count,hp.last_discovered_at,hp.last_validated_at FROM harness_providers hp JOIN harnesses h ON h.id=hp.harness_id WHERE hp.provider_id=? AND hp.status != 'removed_from_harness' AND h.enabled=1 ORDER BY hp.harness_id").all(providerId) as any[]).map((r) => ({
    harnessId: r.harness_id,
    status: (r.credential_status ?? 'missing') as CredentialStatus,
    discoverySupported: Boolean(r.discovery_supported),
    credentialInstallSupported: Boolean(r.credential_install_supported),
    modelCount: Number(r.model_count ?? 0),
    lastDiscoveredAt: r.last_discovered_at ?? undefined,
    lastValidatedAt: r.last_validated_at ?? undefined
  }));
}

export function credentialStatusFromDiscoveredProvider(provider: DiscoveredProvider): CredentialStatus {
  const metadata = provider.metadata ?? {};
  if ((provider.status ?? '') === 'configured') return 'saved';
  if (numberValue((metadata as any).credentialPoolCount) > 0) return 'saved';
  if (stringArray((metadata as any).configuredEnvVars).length > 0) return 'saved';
  const profileCounts = (metadata as any).profileCounts;
  if (profileCounts && typeof profileCounts === 'object' && numberValue(profileCounts.count) > 0) return 'saved';
  return 'missing';
}

function aggregateCredentialStatusValue(harnesses: ProviderHarnessCredentialState[], metadata: Record<string, unknown>): CredentialStatus {
  if (harnesses.some((h) => h.status === 'healthy')) return 'healthy';
  if (harnesses.some((h) => h.status === 'saved')) return 'saved';
  if (numberValue(metadata.credentialPoolCount) > 0 || stringArray(metadata.configuredEnvVars).length > 0) return 'saved';
  if (harnesses.some((h) => h.status === 'invalid')) return 'invalid';
  if (harnesses.some((h) => h.status === 'error')) return 'error';
  if (harnesses.some((h) => h.status === 'unsupported')) return 'unsupported';
  return 'missing';
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : []; }
function numberValue(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }

function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
