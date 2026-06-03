import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessHealth, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput } from '../types.js';
import { fetchJsonOrText } from '../http.js';

export class OpenClawAdapter implements HarnessAdapter {
  adapterId = 'openclaw';
  harnessType = 'openclaw';

  capabilities() {
    return { health: true, providerDiscovery: false, modelDiscovery: false, credentialValidation: false, credentialInstall: false, hotReload: false, oauth: false };
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
    // Current probed /v1/providers route returns SPA fallback, not a JSON management API.
    return [];
  }

  async discoverModels(_ctx: AdapterContext): Promise<DiscoveredModel[]> {
    // Current probed /v1/models route is auth-gated. Auth mapping belongs inside this adapter in a later phase.
    return [];
  }

  async validateCredential(_ctx: AdapterContext, _input: ValidateCredentialInput): Promise<CredentialValidationResult> {
    return { status: 'unsupported', message: 'OpenClaw credential validation endpoint is not mapped yet' };
  }

  async installCredential(_ctx: AdapterContext, _input: InstallCredentialInput): Promise<InstallCredentialResult> {
    return { status: 'unsupported', message: 'OpenClaw credential install endpoint is not mapped yet' };
  }
}
