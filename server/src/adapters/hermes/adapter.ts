import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessHealth, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput } from '../types.js';
import { fetchJsonOrText } from '../http.js';

export class HermesAdapter implements HarnessAdapter {
  adapterId = 'hermes';
  harnessType = 'hermes';

  capabilities() {
    return { health: true, providerDiscovery: false, modelDiscovery: true, credentialValidation: false, credentialInstall: false, hotReload: false, oauth: false };
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

  async discoverProviders(_ctx: AdapterContext): Promise<DiscoveredProvider[]> {
    // Hermes does not currently expose GET /v1/providers on this instance.
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
