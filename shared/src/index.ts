export type ApiSuccess<T> = { ok: true; data: T; meta?: Record<string, unknown> };
export type ApiError = { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;
export type SectionManifest = { id: string; label: string; title: string; routeBase: string; standaloneBase: string; icon: string; requiredCapabilities: string[]; navItems: Array<{ id: string; label: string; path: string }> };
export const dmmSectionManifest: SectionManifest = { id: 'dmm', label: 'Models', title: 'Direct Model Management', routeBase: '/models', standaloneBase: '/', icon: 'models', requiredCapabilities: ['models.manage'], navItems: [{ id: 'modelboard', label: 'ModelBoard', path: '/' }, { id: 'catalog', label: 'Catalog Truth', path: '/catalog' }, { id: 'providers', label: 'Providers', path: '/providers' }, { id: 'harnesses', label: 'Harnesses', path: '/harnesses' }, { id: 'audit', label: 'Audit', path: '/audit' }] };
export type AuthUser = { username: string; role: 'admin' };
export type StatusPayload = { service: 'dmm'; version: string; section: SectionManifest; authenticated: boolean };
export type HarnessStatus = 'unknown' | 'online' | 'degraded' | 'offline';
export type AuditEvent = { id: string; eventType: string; actor: string; targetType: string; targetId: string; payload: unknown; createdAt: string };
export type ProviderStatus = 'available' | 'configured' | 'healthy' | 'degraded' | 'disabled' | 'unavailable';
export type CredentialStatus = 'missing' | 'saved' | 'healthy' | 'invalid' | 'unsupported' | 'error';
export type ModelStatus = 'available' | 'enabled' | 'disabled' | 'deprecated' | 'unavailable';
export type ProviderHarnessCredentialState = { harnessId: string; status: CredentialStatus; discoverySupported: boolean; credentialInstallSupported: boolean; modelCount: number; lastDiscoveredAt?: string; lastValidatedAt?: string };
export type ProviderCredentialRequirementView = { providerId: string; label: string; authMethod: string; status: ProviderStatus; credentialStatus: CredentialStatus; requiredEnvVars: string[]; configuredEnvVars: string[]; credentialPoolCount: number; harnesses: ProviderHarnessCredentialState[]; docsUrl?: string; updatedAt: string };
export type CredentialView = { providerId: string; providerLabel: string; authMethod: string; scope: string; status: CredentialStatus; fingerprint: string; harnessId?: string; lastValidatedAt?: string; createdAt: string; updatedAt: string };
export type ProviderView = { id: string; label: string; authMethod: string; docsUrl?: string; status: ProviderStatus; credentialStatus: CredentialStatus; credentialFingerprint?: string; modelCount: number; harnesses: string[]; credentialRequirements?: ProviderCredentialRequirementView; updatedAt: string };
export type ModelView = { id: string; providerId: string; displayName: string; modality: string; contextWindow?: number; status: ModelStatus; harnesses: string[]; updatedAt: string };

export type AdapterCapabilitiesView = Record<string, boolean>;
export type HarnessView = { id: string; type: string; label: string; baseUrl: string; enabled: boolean; adapterName: string; status: HarnessStatus; capabilities: AdapterCapabilitiesView; config?: Record<string, unknown>; lastSeenAt?: string; updatedAt: string; message?: string; currentVersion?: string; latestVersion?: string; updateAvailable?: boolean; updateChannel?: string; lastVersionCheckedAt?: string; lastUpdateCheckedAt?: string; lastCatalogRefreshAt?: string; lifecycleMessage?: string };

export type NormalizedLayer = 'external_provider_model_source' | 'harness_instance' | 'harness_dmm_adapter' | 'dmm_ui';
export type NormalizedHarnessProviderState = {
  harnessId: string;
  harnessType: string;
  harnessLabel: string;
  adapterName: string;
  harnessProviderId: string;
  supportStatus: string;
  credentialStatus: CredentialStatus;
  discoverySupported: boolean;
  credentialInstallSupported: boolean;
  modelCount: number;
  lastDiscoveredAt?: string;
  lastValidatedAt?: string;
};
export type NormalizedProviderState = {
  layer: 'dmm_ui';
  providerId: string;
  label: string;
  authMethod: string;
  dmmProviderStatus: ProviderStatus;
  dmmCredentialStatus: CredentialStatus;
  dmmCredentialFingerprint?: string;
  externalSource: string;
  modelCount: number;
  harnessStates: NormalizedHarnessProviderState[];
  updatedAt: string;
};
export type NormalizedDmmStateView = {
  layers: Array<{ id: NormalizedLayer; label: string; description: string }>;
  providers: NormalizedProviderState[];
};



export type CatalogLifecycleView = { harnessId: string; label: string; currentVersion?: string; latestVersion?: string; updateAvailable: boolean; lastVersionCheckedAt?: string; lastUpdateCheckedAt?: string; lastCatalogRefreshAt?: string; latestSnapshotVersion?: string; latestSnapshotCapturedAt?: string; latestSnapshotProviderCount?: number; latestSnapshotModelCount?: number; refreshRecommended: boolean; reason?: string };
export type CatalogLifecycleRefreshResult = { lifecycle: CatalogLifecycleView[]; refreshed: Array<{ harnessId: string; reason: string; result: unknown }>; skipped: Array<{ harnessId: string; reason: string }> };
export type CatalogSnapshotView = { id: string; harnessId: string; harnessVersion?: string; providerCount: number; modelCount: number; sourceMethod: string; capturedAt: string };
export type CatalogDiffSummary = { addedProviders: number; removedProviders: number; changedProviders: number; addedModels: number; removedModels: number; changedModels: number };
export type CatalogDiffView = { id: string; harnessId: string; fromSnapshotId?: string; toSnapshotId: string; createdAt: string; summary: CatalogDiffSummary; addedProviders: unknown[]; removedProviders: unknown[]; changedProviders: unknown[]; addedModels: unknown[]; removedModels: unknown[]; changedModels: unknown[] };
