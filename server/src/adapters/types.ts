import type { HarnessConfig } from '../config/env.js';

export type AdapterCapabilityKey = 'health' | 'providerDiscovery' | 'modelDiscovery' | 'credentialValidation' | 'credentialInstall' | 'hotReload' | 'oauth';
export type AdapterCapabilities = Record<AdapterCapabilityKey, boolean>;
export type HarnessHealthStatus = 'unknown' | 'online' | 'degraded' | 'offline';

export type HarnessHealth = {
  status: HarnessHealthStatus;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
  raw?: unknown;
};

export type DiscoveredProvider = { id: string; label: string; harnessProviderId: string; authMethod: string; metadata?: Record<string, unknown> };
export type DiscoveredModel = { id: string; providerId: string; displayName: string; harnessModelId: string; metadata?: Record<string, unknown> };
export type ValidateCredentialInput = { providerId: string; secretRef: string };
export type CredentialValidationResult = { status: 'healthy' | 'invalid' | 'unsupported' | 'error'; message?: string };
export type InstallCredentialInput = { providerId: string; secretRef: string };
export type InstallCredentialResult = { status: 'installed' | 'unsupported' | 'error'; message?: string };

export type AdapterContext = { harness: HarnessConfig; timeoutMs: number };

export interface HarnessAdapter {
  adapterId: string;
  harnessType: string;
  capabilities(): AdapterCapabilities;
  health(ctx: AdapterContext): Promise<HarnessHealth>;
  discoverProviders(ctx: AdapterContext): Promise<DiscoveredProvider[]>;
  discoverModels(ctx: AdapterContext, providerId?: string): Promise<DiscoveredModel[]>;
  validateCredential(ctx: AdapterContext, input: ValidateCredentialInput): Promise<CredentialValidationResult>;
  installCredential(ctx: AdapterContext, input: InstallCredentialInput): Promise<InstallCredentialResult>;
}

export type HarnessView = {
  id: string;
  type: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  adapterName: string;
  status: HarnessHealthStatus;
  capabilities: AdapterCapabilities;
  lastSeenAt?: string;
  updatedAt: string;
  message?: string;
};

export const unsupportedCapabilities: AdapterCapabilities = {
  health: false,
  providerDiscovery: false,
  modelDiscovery: false,
  credentialValidation: false,
  credentialInstall: false,
  hotReload: false,
  oauth: false
};
