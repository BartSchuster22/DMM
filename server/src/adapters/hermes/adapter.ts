import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessHealth, HarnessUpdateStatus, HarnessVersion, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput, HarnessCatalogSnapshotInput } from '../types.js';
import { fetchJsonOrText } from '../http.js';
import { callHostHelper, parseTextVersion } from '../host-helper.js';

type HermesCatalogProvider = {
  id?: string;
  label?: string;
  description?: string;
  authType?: string;
  configured?: boolean;
  credentialPoolCount?: number;
  configuredEnvVars?: string[];
  requiredEnvVars?: string[];
  baseUrl?: string;
  transport?: string;
  isAggregator?: boolean;
};

type HermesCatalogModel = { provider?: string; id?: string; source?: string; primary?: boolean; fallback?: boolean };
type HermesCatalogRaw = {
  json?: { config?: { provider?: string; model?: string; fallbacks?: Array<{ provider?: string; model?: string }> }; providers?: HermesCatalogProvider[]; models?: HermesCatalogModel[] };
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export class HermesAdapter implements HarnessAdapter {
  adapterId = 'hermes';
  harnessType = 'hermes';

  capabilities() {
    return { health: true, providerDiscovery: true, modelDiscovery: true, credentialValidation: true, credentialInstall: true, hotReload: false, oauth: false, version: true, updateStatus: true, updateDryRun: false, updateApply: false, restart: false, catalogRefresh: true };
  }

  async health(ctx: AdapterContext): Promise<HarnessHealth> {
    const started = Date.now();
    try {
      const res = await fetchJsonOrText(`${ctx.harness.baseUrl}/health`, ctx.timeoutMs);
      return { status: res.ok ? 'online' : 'degraded', latencyMs: Date.now() - started, message: `HTTP ${res.status}`, checkedAt: new Date().toISOString(), raw: res.body };
    } catch (error) {
      return { status: 'offline', latencyMs: Date.now() - started, message: error instanceof Error ? error.message : 'health check failed', checkedAt: new Date().toISOString() };
    }
  }

  async version(ctx: AdapterContext): Promise<HarnessVersion> {
    const checkedAt = new Date().toISOString();
    const result = await callHostHelper(ctx.harness, 'hermes.version', ctx.timeoutMs * 4);
    if (!result) return { checkedAt, source: 'unknown', message: 'DMM host helper is not configured' };
    if (!result.ok) return { checkedAt, source: 'unknown', message: result.error.message, raw: result };
    const data = result.data as { stdout?: string; currentVersion?: string; commit?: string; message?: string };
    return { checkedAt, source: 'binary', currentVersion: data.currentVersion ?? parseTextVersion(data.stdout ?? ''), commit: data.commit, message: data.message, raw: data };
  }

  async updateStatus(ctx: AdapterContext): Promise<HarnessUpdateStatus> {
    const checkedAt = new Date().toISOString();
    const result = await callHostHelper(ctx.harness, 'hermes.updateStatus', ctx.timeoutMs * 6);
    if (!result) return { checkedAt, available: false, message: 'DMM host helper is not configured' };
    if (!result.ok) return { checkedAt, available: false, message: result.error.message, raw: result };
    const data = result.data as { stdout?: string; available?: boolean; currentVersion?: string; latestVersion?: string; channel?: string; message?: string };
    const text = data.stdout ?? data.message ?? '';
    return { checkedAt, available: data.available ?? /update available|commits behind|behind/i.test(text), currentVersion: data.currentVersion, latestVersion: data.latestVersion, channel: data.channel, source: 'hermes-cli', message: data.message ?? text.split(/\r?\n/).find((line) => /update|behind|latest/i.test(line)) ?? text.trim(), raw: data };
  }

  async discoverProviders(ctx: AdapterContext): Promise<DiscoveredProvider[]> {
    return normalizeHermesCatalog(await this.readCatalog(ctx)).providers;
  }

  async discoverModels(ctx: AdapterContext): Promise<DiscoveredModel[]> {
    return normalizeHermesCatalog(await this.readCatalog(ctx)).models;
  }

  async catalogRefresh(ctx: AdapterContext): Promise<HarnessCatalogSnapshotInput> {
    const [version, raw] = await Promise.all([this.version(ctx), this.readCatalog(ctx)]);
    const normalized = normalizeHermesCatalog(raw);
    return {
      harnessId: ctx.harness.id,
      harnessType: this.harnessType,
      harnessVersion: version.currentVersion,
      capturedAt: new Date().toISOString(),
      source: { method: 'cli', commands: ['python /srv/dmm/scripts/hermes-catalog-status.py'], files: ['hermes_cli/models.py', 'hermes_cli/auth.py', 'hermes_cli/providers.py', 'config.yaml'], notes: ['Hermes adapter-owned catalog ingestion from Hermes internal canonical provider/model registry plus current config primary/fallback models. Secret values are not included; only env var names and credential counts are stored.'] },
      providers: normalized.providers,
      models: normalized.models,
      raw: { version, hermes: raw }
    };
  }

  async validateCredential(ctx: AdapterContext, input: ValidateCredentialInput): Promise<CredentialValidationResult> {
    const result = await callHostHelper(ctx.harness, 'hermes.validateCredential', Math.max(ctx.timeoutMs * 6, 15_000), { providerId: input.providerId, secret: input.secret });
    if (!result) return localValidateCredential(input.providerId, input.secret);
    if (!result.ok) return { status: 'error', message: result.error.message };
    const data = result.data as CredentialValidationResult;
    return { status: data.status, message: data.message };
  }

  async installCredential(ctx: AdapterContext, input: InstallCredentialInput): Promise<InstallCredentialResult> {
    const result = await callHostHelper(ctx.harness, 'hermes.installCredential', Math.max(ctx.timeoutMs * 12, 30_000), { providerId: input.providerId, secret: input.secret, label: input.label });
    if (!result) return { status: 'unsupported', message: 'DMM host helper is not configured' };
    if (!result.ok) return { status: 'error', message: result.error.message };
    const data = result.data as InstallCredentialResult;
    return { status: data.status, message: data.message };
  }

  private async readCatalog(ctx: AdapterContext): Promise<HermesCatalogRaw> {
    const result = await callHostHelper(ctx.harness, 'hermes.catalogStatus', Math.max(ctx.timeoutMs * 20, 90_000));
    if (!result) throw new Error('DMM host helper is not configured');
    if (!result.ok) throw new Error(result.error.message);
    return result.data as HermesCatalogRaw;
  }
}

export function normalizeHermesCatalog(raw: HermesCatalogRaw): { providers: DiscoveredProvider[]; models: DiscoveredModel[] } {
  const catalog = raw.json ?? {};
  const providerIds = new Set<string>();
  const providers: DiscoveredProvider[] = [];

  for (const p of catalog.providers ?? []) {
    const id = normalizeProviderId(p.id);
    if (!id || providerIds.has(id)) continue;
    providerIds.add(id);
    providers.push({
      id,
      label: p.label || id,
      harnessProviderId: id,
      authMethod: normalizeAuthMethod(p.authType),
      status: p.configured ? 'configured' : 'available',
      metadata: {
        source: 'hermes-canonical-provider-registry',
        description: p.description,
        transport: p.transport,
        isAggregator: Boolean(p.isAggregator),
        baseUrl: p.baseUrl,
        requiredEnvVars: p.requiredEnvVars ?? [],
        configuredEnvVars: p.configuredEnvVars ?? [],
        credentialPoolCount: p.credentialPoolCount ?? 0
      }
    });
  }

  const modelMap = new Map<string, DiscoveredModel>();
  for (const m of catalog.models ?? []) {
    const providerId = normalizeProviderId(m.provider);
    const modelId = normalizeModelId(m.id);
    if (!providerId || !modelId) continue;
    providerIds.add(providerId);
    const id = `${providerId}:${modelId}`;
    const prior = modelMap.get(id);
    const flags = new Set<string>(Array.isArray(prior?.metadata?.flags) ? prior!.metadata!.flags as string[] : []);
    if (m.primary) flags.add('primary');
    if (m.fallback) flags.add('fallback');
    modelMap.set(id, {
      id,
      providerId,
      displayName: modelId,
      harnessModelId: `${providerId}:${modelId}`,
      status: m.primary ? 'configured_default' : m.fallback ? 'configured_fallback' : 'available',
      modality: 'text',
      metadata: { source: m.source ?? 'hermes-catalog', flags: [...flags].sort() }
    });
  }

  for (const id of [...providerIds].sort()) {
    if (!providers.some((p) => p.id === id)) providers.push({ id, label: id, harnessProviderId: id, authMethod: 'unknown', status: 'available', metadata: { source: 'derived-from-hermes-models' } });
  }

  return { providers: providers.sort((a, b) => a.id.localeCompare(b.id)), models: [...modelMap.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

function normalizeProviderId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return id || null;
}

function normalizeModelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id || null;
}

function normalizeAuthMethod(value: unknown): string {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'oauth_external' || v === 'oauth_device_code' || v === 'oauth_minimax') return 'oauth';
  if (v === 'api_key') return 'api_key';
  if (v === 'external_process') return 'external_process';
  if (v === 'aws_sdk') return 'aws_sdk';
  return v || 'unknown';
}


export function localValidateCredential(providerId: string, secret: unknown): CredentialValidationResult {
  const key = typeof secret === 'string' ? secret.trim() : '';
  if (key.length < 8) return { status: 'invalid', message: 'Credential is too short' };
  const apiKeyProviders = new Set(['anthropic', 'openai', 'openrouter', 'zai', 'google', 'mistral', 'groq', 'xai', 'together', 'deepseek', 'perplexity', 'cohere']);
  if (providerId === 'openai-codex') return { status: 'unsupported', message: 'OpenAI Codex uses OAuth/device credentials, not BYOK API-key install' };
  if (!apiKeyProviders.has(providerId)) return { status: 'unsupported', message: `No local BYOK validator is mapped for ${providerId}` };
  if (/\s/.test(key)) return { status: 'invalid', message: 'API keys must not contain whitespace' };
  return { status: 'healthy', message: 'Credential passed local BYOK format validation' };
}
