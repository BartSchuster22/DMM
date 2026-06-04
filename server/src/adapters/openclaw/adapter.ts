import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessHealth, HarnessUpdateStatus, HarnessVersion, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput, HarnessCatalogSnapshotInput } from '../types.js';
import { fetchJsonOrText } from '../http.js';
import { callHostHelper, parseTextVersion } from '../host-helper.js';

type OpenClawModelListItem = {
  key?: string;
  name?: string;
  input?: string;
  contextWindow?: number;
  local?: boolean;
  available?: boolean;
  tags?: string[];
  missing?: boolean;
};

type OpenClawAuthProvider = {
  provider?: string;
  effective?: { kind?: string; detail?: string };
  profiles?: { count?: number; oauth?: number; token?: number; apiKey?: number; labels?: string[] };
};

type OpenClawStatus = {
  defaultModel?: string;
  resolvedDefault?: string;
  fallbacks?: string[];
  imageModel?: string | null;
  imageFallbacks?: string[];
  aliases?: Record<string, string>;
  allowed?: string[];
  auth?: {
    providers?: OpenClawAuthProvider[];
    missingProvidersInUse?: string[];
    providersWithOAuth?: string[];
    oauth?: { providers?: Array<{ provider?: string; status?: string; expiresAt?: number; remainingMs?: number }> };
  };
};

type OpenClawCatalogRaw = {
  status?: { json?: OpenClawStatus; stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean };
  modelsList?: { json?: { count?: number; models?: OpenClawModelListItem[] }; stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean };
};

export class OpenClawAdapter implements HarnessAdapter {
  adapterId = 'openclaw';
  harnessType = 'openclaw';

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
    const result = await callHostHelper(ctx.harness, 'openclaw.version', ctx.timeoutMs * 4);
    if (!result) return { checkedAt, source: 'unknown', message: 'DMM host helper is not configured' };
    if (!result.ok) return { checkedAt, source: 'unknown', message: result.error.message, raw: result };
    const data = result.data as { stdout?: string; currentVersion?: string; commit?: string; message?: string };
    return { checkedAt, source: 'binary', currentVersion: data.currentVersion ?? parseTextVersion(data.stdout ?? ''), commit: data.commit, message: data.message, raw: data };
  }

  async updateStatus(ctx: AdapterContext): Promise<HarnessUpdateStatus> {
    const checkedAt = new Date().toISOString();
    const result = await callHostHelper(ctx.harness, 'openclaw.updateStatus', ctx.timeoutMs * 6);
    if (!result) return { checkedAt, available: false, message: 'DMM host helper is not configured' };
    if (!result.ok) return { checkedAt, available: false, message: result.error.message, raw: result };
    const data = result.data as { json?: any; stdout?: string; currentVersion?: string; latestVersion?: string; available?: boolean; channel?: string; message?: string };
    const j = data.json ?? {};
    return {
      checkedAt,
      available: data.available ?? Boolean(j.availability?.available),
      currentVersion: data.currentVersion ?? j.currentVersion,
      latestVersion: data.latestVersion ?? j.availability?.latestVersion ?? j.update?.registry?.latestVersion,
      channel: data.channel ?? j.channel?.value,
      source: 'openclaw-cli',
      message: data.message ?? (j.availability?.available ? `Update available: ${j.availability?.latestVersion ?? 'yes'}` : 'No update available'),
      raw: data
    };
  }

  async discoverProviders(ctx: AdapterContext): Promise<DiscoveredProvider[]> {
    const raw = await this.readCatalog(ctx);
    return normalizeOpenClawCatalog(raw).providers;
  }

  async discoverModels(ctx: AdapterContext): Promise<DiscoveredModel[]> {
    const raw = await this.readCatalog(ctx);
    return normalizeOpenClawCatalog(raw).models;
  }

  async catalogRefresh(ctx: AdapterContext): Promise<HarnessCatalogSnapshotInput> {
    const [version, raw] = await Promise.all([this.version(ctx), this.readCatalog(ctx)]);
    const normalized = normalizeOpenClawCatalog(raw);
    return {
      harnessId: ctx.harness.id,
      harnessType: this.harnessType,
      harnessVersion: version.currentVersion,
      capturedAt: new Date().toISOString(),
      source: {
        method: 'cli',
        commands: ['openclaw models status --json', 'openclaw models list --json'],
        notes: [
          'OpenClaw adapter-owned catalog ingestion. Provider support is inferred from configured auth profiles and models in use because this OpenClaw version does not expose a providers command.',
          ...(raw.modelsList?.timedOut ? ['models list emitted JSON but did not exit before timeout; partial stdout JSON was consumed.'] : [])
        ]
      },
      providers: normalized.providers,
      models: normalized.models,
      raw: { version, openclaw: raw }
    };
  }

  async validateCredential(ctx: AdapterContext, input: ValidateCredentialInput): Promise<CredentialValidationResult> {
    const result = await callHostHelper(ctx.harness, 'openclaw.validateCredential', ctx.timeoutMs * 4, { providerId: input.providerId, secret: input.secret });
    if (!result) return { status: 'unsupported', message: 'DMM host helper is not configured' };
    if (!result.ok) return { status: 'error', message: result.error.message };
    const data = result.data as CredentialValidationResult;
    return { status: data.status, message: data.message };
  }

  async installCredential(ctx: AdapterContext, input: InstallCredentialInput): Promise<InstallCredentialResult> {
    const result = await callHostHelper(ctx.harness, 'openclaw.installCredential', ctx.timeoutMs * 8, { providerId: input.providerId, secret: input.secret, label: input.label });
    if (!result) return { status: 'unsupported', message: 'DMM host helper is not configured' };
    if (!result.ok) return { status: 'error', message: result.error.message };
    const data = result.data as InstallCredentialResult;
    return { status: data.status, message: data.message };
  }

  private async readCatalog(ctx: AdapterContext): Promise<OpenClawCatalogRaw> {
    const result = await callHostHelper(ctx.harness, 'openclaw.catalogStatus', Math.max(ctx.timeoutMs * 40, 90_000));
    if (!result) throw new Error('DMM host helper is not configured');
    if (!result.ok) throw new Error(result.error.message);
    return result.data as OpenClawCatalogRaw;
  }
}

export function normalizeOpenClawCatalog(raw: OpenClawCatalogRaw): { providers: DiscoveredProvider[]; models: DiscoveredModel[] } {
  const status = raw.status?.json ?? {};
  const listModels = raw.modelsList?.json?.models ?? [];
  const providerIds = new Set<string>();
  const providerMeta = new Map<string, Record<string, unknown>>();
  const providerAuth = new Map<string, string>();
  const providerStatus = new Map<string, string>();

  for (const p of status.auth?.providers ?? []) {
    const id = normalizeProviderId(p.provider);
    if (!id) continue;
    providerIds.add(id);
    providerAuth.set(id, authMethodFromProfiles(p));
    providerStatus.set(id, (p.profiles?.count ?? 0) > 0 ? 'configured' : 'available');
    providerMeta.set(id, {
      source: 'openclaw-models-status',
      effectiveKind: p.effective?.kind,
      profileCounts: {
        count: p.profiles?.count ?? 0,
        oauth: p.profiles?.oauth ?? 0,
        token: p.profiles?.token ?? 0,
        apiKey: p.profiles?.apiKey ?? 0
      }
    });
  }

  for (const p of status.auth?.oauth?.providers ?? []) {
    const id = normalizeProviderId(p.provider);
    if (!id) continue;
    providerIds.add(id);
    providerAuth.set(id, providerAuth.get(id) ?? 'oauth');
    providerMeta.set(id, { ...(providerMeta.get(id) ?? {}), oauthStatus: p.status, oauthExpiresAt: p.expiresAt, oauthRemainingMs: p.remainingMs });
  }

  for (const missing of status.auth?.missingProvidersInUse ?? []) {
    const id = normalizeProviderId(missing);
    if (!id) continue;
    providerIds.add(id);
    providerStatus.set(id, 'unavailable');
    providerMeta.set(id, { ...(providerMeta.get(id) ?? {}), missingProviderInUse: true });
  }

  const modelRefs = collectModelRefs(status, listModels);
  for (const ref of modelRefs.keys()) {
    const parsed = parseModelRef(ref);
    if (parsed) providerIds.add(parsed.providerId);
  }

  const models: DiscoveredModel[] = [];
  for (const [ref, flags] of modelRefs) {
    const parsed = parseModelRef(ref);
    if (!parsed) continue;
    const listItem = listModels.find((m) => m.key === ref);
    models.push({
      id: `${parsed.providerId}:${parsed.modelName}`,
      providerId: parsed.providerId,
      displayName: listItem?.name ?? parsed.modelName,
      harnessModelId: ref,
      status: modelStatus(flags, listItem),
      modality: modalityFromInput(listItem?.input),
      contextWindow: typeof listItem?.contextWindow === 'number' ? listItem.contextWindow : undefined,
      metadata: {
        source: listItem ? 'openclaw-models-list' : 'openclaw-models-status',
        flags: [...flags].sort(),
        input: listItem?.input,
        local: listItem?.local,
        available: listItem?.available,
        missing: listItem?.missing,
        tags: listItem?.tags ?? []
      }
    });
  }

  const providers: DiscoveredProvider[] = [...providerIds].sort().map((id) => ({
    id,
    label: labelForProvider(id),
    harnessProviderId: id,
    authMethod: providerAuth.get(id) ?? 'unknown',
    status: providerStatus.get(id) ?? 'available',
    metadata: { source: 'openclaw-catalog', ...(providerMeta.get(id) ?? {}) }
  }));

  return { providers, models: models.sort((a, b) => a.id.localeCompare(b.id)) };
}

function collectModelRefs(status: OpenClawStatus, listModels: OpenClawModelListItem[]): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  const add = (ref: unknown, flag: string) => {
    if (typeof ref !== 'string' || !ref.includes('/')) return;
    if (!refs.has(ref)) refs.set(ref, new Set());
    refs.get(ref)!.add(flag);
  };
  add(status.defaultModel, 'default');
  add(status.resolvedDefault, 'resolved_default');
  add(status.imageModel, 'image_default');
  for (const ref of status.fallbacks ?? []) add(ref, 'fallback');
  for (const ref of status.imageFallbacks ?? []) add(ref, 'image_fallback');
  for (const ref of status.allowed ?? []) add(ref, 'allowed');
  for (const [alias, ref] of Object.entries(status.aliases ?? {})) add(ref, `alias:${alias}`);
  for (const model of listModels) add(model.key, 'listed');
  return refs;
}

function parseModelRef(ref: string): { providerId: string; modelName: string } | null {
  const slash = ref.indexOf('/');
  if (slash <= 0 || slash === ref.length - 1) return null;
  return { providerId: normalizeProviderId(ref.slice(0, slash))!, modelName: ref.slice(slash + 1) };
}

function normalizeProviderId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase().replace(/\s+\(.+\)$/, '');
  return id || null;
}

function authMethodFromProfiles(provider: OpenClawAuthProvider): string {
  const oauth = provider.profiles?.oauth ?? 0;
  const apiKey = provider.profiles?.apiKey ?? 0;
  const token = provider.profiles?.token ?? 0;
  if (oauth > 0 && apiKey + token === 0) return 'oauth';
  if (apiKey > 0 && oauth + token === 0) return 'api_key';
  if (token > 0 && oauth + apiKey === 0) return 'token';
  if (oauth + apiKey + token > 0) return 'mixed';
  return 'unknown';
}

function labelForProvider(id: string): string {
  const labels: Record<string, string> = { 'openai-codex': 'OpenAI Codex', openrouter: 'OpenRouter', anthropic: 'Anthropic', openai: 'OpenAI' };
  return labels[id] ?? id.split(/[-_]/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(' ');
}

function modelStatus(flags: Set<string>, listItem?: OpenClawModelListItem): string {
  if (listItem?.missing) return 'unavailable';
  if (listItem?.available === false) return 'unavailable';
  if (flags.has('default') || flags.has('resolved_default')) return 'available';
  if (flags.has('allowed')) return 'available';
  if (flags.has('fallback')) return 'available';
  return 'available';
}

function modalityFromInput(input?: string): string {
  if (!input) return 'text';
  return input.includes('image') ? 'text+image' : 'text';
}
