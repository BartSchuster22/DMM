import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessHealth, HarnessUpdateStatus, HarnessVersion, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput } from '../types.js';
import { fetchJsonOrText } from '../http.js';
import { callHostHelper, parseTextVersion } from '../host-helper.js';

export class HermesAdapter implements HarnessAdapter {
  adapterId = 'hermes';
  harnessType = 'hermes';

  capabilities() {
    return { health: true, providerDiscovery: false, modelDiscovery: true, credentialValidation: false, credentialInstall: false, hotReload: false, oauth: false, version: true, updateStatus: true, updateDryRun: false, updateApply: false, restart: false, catalogRefresh: false };
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

  async validateCredential(_ctx: AdapterContext, _input: ValidateCredentialInput): Promise<CredentialValidationResult> {
    return { status: 'unsupported', message: 'Hermes credential validation endpoint is not available yet' };
  }

  async installCredential(_ctx: AdapterContext, _input: InstallCredentialInput): Promise<InstallCredentialResult> {
    return { status: 'unsupported', message: 'Hermes credential install endpoint is not available yet' };
  }
}
