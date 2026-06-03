import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessHealth, HarnessUpdateStatus, HarnessVersion, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput } from '../types.js';
import { fetchJsonOrText } from '../http.js';
import { callHostHelper, parseTextVersion } from '../host-helper.js';

export class OpenClawAdapter implements HarnessAdapter {
  adapterId = 'openclaw';
  harnessType = 'openclaw';

  capabilities() {
    return { health: true, providerDiscovery: false, modelDiscovery: false, credentialValidation: false, credentialInstall: false, hotReload: false, oauth: false, version: true, updateStatus: true, updateDryRun: false, updateApply: false, restart: false, catalogRefresh: false };
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

  async discoverProviders(_ctx: AdapterContext): Promise<DiscoveredProvider[]> {
    return [];
  }

  async discoverModels(_ctx: AdapterContext): Promise<DiscoveredModel[]> {
    return [];
  }

  async validateCredential(_ctx: AdapterContext, _input: ValidateCredentialInput): Promise<CredentialValidationResult> {
    return { status: 'unsupported', message: 'OpenClaw credential validation endpoint is not mapped yet' };
  }

  async installCredential(_ctx: AdapterContext, _input: InstallCredentialInput): Promise<InstallCredentialResult> {
    return { status: 'unsupported', message: 'OpenClaw credential install endpoint is not mapped yet' };
  }
}
