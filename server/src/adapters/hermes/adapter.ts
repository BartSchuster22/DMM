import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessHealth, HarnessUpdateStatus, HarnessVersion, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput, HarnessCatalogSnapshotInput } from '../types.js';
import { fetchJsonOrText } from '../http.js';
import { callHostHelper, parseTextVersion } from '../host-helper.js';

export class HermesAdapter implements HarnessAdapter {
  adapterId = 'hermes';
  harnessType = 'hermes';

  capabilities() {
    return { health: true, providerDiscovery: false, modelDiscovery: true, credentialValidation: false, credentialInstall: false, hotReload: false, oauth: false, version: true, updateStatus: true, updateDryRun: false, updateApply: false, restart: false, catalogRefresh: true };
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
    return {
      checkedAt,
      available: data.available ?? /update available|commits behind|behind/i.test(text),
      currentVersion: data.currentVersion,
      latestVersion: data.latestVersion,
      channel: data.channel,
      source: 'hermes-cli',
      message: data.message ?? text.split(/\r?\n/).find((line) => /update|behind|latest/i.test(line)) ?? text.trim(),
      raw: data
    };
  }

  async discoverProviders(_ctx: AdapterContext): Promise<DiscoveredProvider[]> {
    return [];
  }

  async discoverModels(ctx: AdapterContext): Promise<DiscoveredModel[]> {
    try {
      const res = await fetchJsonOrText(`${ctx.harness.baseUrl}/v1/models`, ctx.timeoutMs);
      if (!res.ok || typeof res.body !== 'object' || res.body === null) return [];
      const data = (res.body as { data?: Array<{ id?: string; owned_by?: string }> }).data ?? [];
      return data.filter((m) => m.id).map((m) => ({ id: `hermes:${m.id}`, providerId: m.owned_by ?? 'hermes', displayName: m.id!, harnessModelId: m.id!, metadata: { source: 'hermes:/v1/models' } }));
    } catch {
      return [];
    }
  }

  async catalogRefresh(ctx: AdapterContext): Promise<HarnessCatalogSnapshotInput> {
    const version = await this.version(ctx);
    const models = await this.discoverModels(ctx);
    const providersById = new Map<string, DiscoveredProvider>();
    for (const model of models) providersById.set(model.providerId, { id: model.providerId, label: model.providerId, harnessProviderId: model.providerId, authMethod: 'unknown', status: 'runtime_visible', metadata: { source: 'derived-from-hermes-v1-models' } });
    if (!providersById.has('hermes') && models.length === 0) providersById.set('hermes', { id: 'hermes', label: 'Hermes runtime', harnessProviderId: 'hermes', authMethod: 'unknown', status: 'runtime_probe_empty', metadata: { source: 'hermes-adapter', note: 'Provider registry endpoint not available yet; /v1/models returned no models or was inaccessible.' } });
    return { harnessId: ctx.harness.id, harnessType: this.harnessType, harnessVersion: version.currentVersion, capturedAt: new Date().toISOString(), source: { method: 'partial', endpoints: [`${ctx.harness.baseUrl}/v1/models`], notes: ['Harness-specific catalog ingestion owned by Hermes adapter. Current implementation records runtime-visible /v1/models; full provider registry remains a Hermes adapter task.'] }, providers: [...providersById.values()], models, raw: { version } };
  }

  async validateCredential(_ctx: AdapterContext, _input: ValidateCredentialInput): Promise<CredentialValidationResult> {
    return { status: 'unsupported', message: 'Hermes credential validation endpoint is not available yet' };
  }

  async installCredential(_ctx: AdapterContext, _input: InstallCredentialInput): Promise<InstallCredentialResult> {
    return { status: 'unsupported', message: 'Hermes credential install endpoint is not available yet' };
  }
}
