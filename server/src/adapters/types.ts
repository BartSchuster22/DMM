import type { HarnessConfig } from '../config/env.js';

export type AdapterCapabilityKey =
  | 'health'
  | 'providerDiscovery'
  | 'modelDiscovery'
  | 'credentialValidation'
  | 'credentialInstall'
  | 'hotReload'
  | 'oauth'
  | 'version'
  | 'updateStatus'
  | 'updateDryRun'
  | 'updateApply'
  | 'restart'
  | 'catalogRefresh';
export type AdapterCapabilities = Record<AdapterCapabilityKey, boolean>;
export type HarnessHealthStatus = 'unknown' | 'online' | 'degraded' | 'offline';

export type HarnessHealth = {
  status: HarnessHealthStatus;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
  raw?: unknown;
};

export type HarnessVersion = {
  currentVersion?: string;
  build?: string;
  commit?: string;
  source?: 'package' | 'git' | 'binary' | 'api' | 'unknown';
  checkedAt: string;
  message?: string;
  raw?: unknown;
};

export type HarnessUpdateStatus = {
  available: boolean;
  currentVersion?: string;
  latestVersion?: string;
  channel?: string;
  source?: string;
  checkedAt: string;
  message?: string;
  raw?: unknown;
};

export type HarnessUpdatePlan = {
  steps: string[];
  risks: string[];
  requiresRestart: boolean;
  estimatedDowntime?: string;
  raw?: unknown;
};

export type HarnessUpdateResult = {
  status: 'updated' | 'skipped' | 'failed' | 'rolled_back';
  fromVersion?: string;
  toVersion?: string;
  restarted: boolean;
  healthAfter?: HarnessHealth;
  raw?: unknown;
};

export type NormalizedDiscoveredProvider = { id: string; label: string; harnessProviderId: string; authMethod: string; status?: string; metadata?: Record<string, unknown> };
export type NormalizedDiscoveredModel = { id: string; providerId: string; displayName: string; harnessModelId: string; status?: string; modality?: string; contextWindow?: number; metadata?: Record<string, unknown> };
export type DiscoveredProvider = NormalizedDiscoveredProvider;
export type DiscoveredModel = NormalizedDiscoveredModel;
export type NormalizedHarnessCredentialState = { providerId: string; harnessProviderId: string; status: 'missing' | 'saved' | 'healthy' | 'invalid' | 'unsupported' | 'error'; message?: string; lastValidatedAt?: string; metadata?: Record<string, unknown> };
export type RemoveCredentialInput = { providerId: string; secretRef?: string };
export type RemoveCredentialResult = { status: 'removed' | 'unsupported' | 'error'; message?: string };
export type HarnessCatalogSnapshotInput = {
  harnessId: string;
  harnessType: string;
  harnessVersion?: string;
  capturedAt: string;
  source: { method: 'api' | 'cli' | 'config' | 'manifest' | 'mixed' | 'partial'; commands?: string[]; files?: string[]; endpoints?: string[]; notes?: string[] };
  providers: DiscoveredProvider[];
  models: DiscoveredModel[];
  raw?: unknown;
};
export type ValidateCredentialInput = { providerId: string; secretRef?: string; secret?: string };
export type CredentialValidationResult = { status: 'healthy' | 'invalid' | 'unsupported' | 'error'; message?: string };
export type InstallCredentialInput = { providerId: string; secretRef?: string; secret?: string; label?: string };
export type InstallCredentialResult = { status: 'installed' | 'unsupported' | 'error'; message?: string };

export type AdapterContext = { harness: HarnessConfig; timeoutMs: number };

export interface HarnessDmmAdapter {
  adapterId: string;
  harnessType: string;
  capabilities(): AdapterCapabilities;
  health(ctx: AdapterContext): Promise<HarnessHealth>;
  discoverProviders(ctx: AdapterContext): Promise<NormalizedDiscoveredProvider[]>;
  discoverModels(ctx: AdapterContext, providerId?: string): Promise<NormalizedDiscoveredModel[]>;
  getCredentialState?(ctx: AdapterContext): Promise<NormalizedHarnessCredentialState[]>;
  validateCredential(ctx: AdapterContext, input: ValidateCredentialInput): Promise<CredentialValidationResult>;
  installCredential(ctx: AdapterContext, input: InstallCredentialInput): Promise<InstallCredentialResult>;
  removeCredential?(ctx: AdapterContext, input: RemoveCredentialInput): Promise<RemoveCredentialResult>;
  version?(ctx: AdapterContext): Promise<HarnessVersion>;
  updateStatus?(ctx: AdapterContext): Promise<HarnessUpdateStatus>;
  catalogRefresh?(ctx: AdapterContext): Promise<HarnessCatalogSnapshotInput>;
}
export type HarnessAdapter = HarnessDmmAdapter;


export type HarnessView = {
  id: string;
  type: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  adapterName: string;
  status: HarnessHealthStatus;
  capabilities: AdapterCapabilities;
  config?: Record<string, unknown>;
  lastSeenAt?: string;
  updatedAt: string;
  message?: string;
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateChannel?: string;
  lastVersionCheckedAt?: string;
  lastUpdateCheckedAt?: string;
  lastCatalogRefreshAt?: string;
  lifecycleMessage?: string;
};

export const unsupportedCapabilities: AdapterCapabilities = {
  health: false,
  providerDiscovery: false,
  modelDiscovery: false,
  credentialValidation: false,
  credentialInstall: false,
  hotReload: false,
  oauth: false,
  version: false,
  updateStatus: false,
  updateDryRun: false,
  updateApply: false,
  restart: false,
  catalogRefresh: false
};
