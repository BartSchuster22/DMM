import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessCatalogSnapshotInput, HarnessHealth, HarnessVersion, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput } from '../types.js';
import { fetchJsonOrText } from '../http.js';
import { callHostHelper } from '../host-helper.js';

type FmrRepoStatus = {
  repoPath?: string;
  exists?: boolean;
  clean?: boolean;
  branch?: string;
  commit?: string;
  short?: string;
  authorDate?: string;
  committerDate?: string;
  subject?: string;
  remote?: string;
  testSummary?: string;
};

type FmrApiStatus = {
  service?: string;
  version?: string;
  environment?: string;
  database?: string;
  phase?: string;
  time?: string;
};

export class FreeModelRouterAdapter implements HarnessAdapter {
  adapterId = 'free-model-router';
  harnessType = 'free-model-router';

  capabilities() {
    return {
      health: true,
      providerDiscovery: true,
      modelDiscovery: true,
      credentialValidation: false,
      credentialInstall: false,
      hotReload: false,
      oauth: false,
      version: true,
      updateStatus: false,
      updateDryRun: false,
      updateApply: false,
      restart: false,
      catalogRefresh: true
    };
  }

  async health(ctx: AdapterContext): Promise<HarnessHealth> {
    const started = Date.now();
    const checkedAt = new Date().toISOString();
    const api = await this.tryApiStatus(ctx);
    if (api?.ok) {
      const body = api.body as FmrApiStatus;
      return {
        status: 'online',
        latencyMs: Date.now() - started,
        message: `FMRv2 service module online${body.version ? ` (${body.version})` : ''}; availability active; fallback placement managed by Agent Management`,
        checkedAt,
        raw: body
      };
    }

    const repo = await this.repoStatus(ctx);
    if (repo?.exists) {
      return {
        status: 'degraded',
        latencyMs: Date.now() - started,
        message: `FMRv2 service module repo present; API not online at ${ctx.harness.baseUrl}. Availability active by default; policy-provider only; fallback placement managed by Agent Management.`,
        checkedAt,
        raw: { repo, apiError: api?.message }
      };
    }

    return {
      status: 'offline',
      latencyMs: Date.now() - started,
      message: api?.message ?? 'FMRv2 API offline and repo status unavailable',
      checkedAt,
      raw: { apiError: api?.message, repo }
    };
  }

  async version(ctx: AdapterContext): Promise<HarnessVersion> {
    const checkedAt = new Date().toISOString();
    const repo = await this.repoStatus(ctx);
    const api = await this.tryApiStatus(ctx);
    const apiBody = api?.ok ? api.body as FmrApiStatus : undefined;
    return {
      checkedAt,
      source: repo?.commit ? 'git' : apiBody?.version ? 'api' : 'unknown',
      currentVersion: apiBody?.version ?? repo?.short,
      commit: repo?.commit,
      message: repo?.subject ? `${repo.short}: ${repo.subject} | availability active | service module separate | agent fallback placement outside DMM` : apiBody?.phase ?? repo?.testSummary,
      raw: { repo, api: apiBody }
    };
  }

  async discoverProviders(_ctx: AdapterContext): Promise<DiscoveredProvider[]> {
    return [
      {
        id: 'openrouter',
        label: 'OpenRouter',
        harnessProviderId: 'openrouter',
        authMethod: 'api_key',
        status: 'policy_source',
        metadata: {
          source: 'free-model-router-v2-provider-plugin',
          routerRole: 'catalog_policy_provider',
          runtimeMutation: false
        }
      }
    ];
  }

  async discoverModels(ctx: AdapterContext): Promise<DiscoveredModel[]> {
    const response = await this.fetchAuthed(ctx, '/v1/models/free');
    if (!response?.ok || !Array.isArray(response.body)) return [];
    return (response.body as any[]).map((m) => ({
      id: String(m.canonical_id ?? m.canonicalId ?? m.provider_model_id ?? m.id),
      providerId: String(m.provider_id ?? m.providerId ?? 'openrouter'),
      displayName: String(m.display_name ?? m.displayName ?? m.provider_model_id ?? m.id),
      harnessModelId: String(m.canonical_id ?? m.provider_model_id ?? m.id),
      status: m.degraded_free ? 'degraded_free' : 'free_candidate',
      modality: 'text',
      contextWindow: typeof m.context_length === 'number' ? m.context_length : undefined,
      metadata: {
        source: 'free-model-router-v2-api',
        freeReason: m.free_reason,
        riskFlags: Array.isArray(m.risk_flags) ? m.risk_flags : [],
        pricingEvidence: m.pricing_evidence
      }
    }));
  }

  async catalogRefresh(ctx: AdapterContext): Promise<HarnessCatalogSnapshotInput> {
    const [version, providers, models, repo] = await Promise.all([
      this.version(ctx),
      this.discoverProviders(ctx),
      this.discoverModels(ctx),
      this.repoStatus(ctx)
    ]);
    return {
      harnessId: ctx.harness.id,
      harnessType: this.harnessType,
      harnessVersion: version.currentVersion,
      capturedAt: new Date().toISOString(),
      source: {
        method: models.length ? 'api' : 'manifest',
        endpoints: models.length ? [`${ctx.harness.baseUrl}/v1/models/free`] : undefined,
        files: ['/home/herman/freemodelrouterv2/README.md', '/home/herman/freemodelrouterv2/docs/api-contract.md'],
        notes: [
          'Free Model Router V2 is treated as a read-only policy/catalog/ranking harness.',
          'DMM does not mutate Model Router V1, Hermes, OpenClaw, or consumer runtimes through this adapter.',
          models.length ? 'Free models were read from the running FMRv2 API.' : 'FMRv2 API is not online/configured for authenticated model discovery; snapshot records provider plugin presence only.'
        ]
      },
      providers,
      models,
      raw: { version, repo, policyProviderOnly: true, runtimeMutation: false }
    };
  }

  async validateCredential(_ctx: AdapterContext, _input: ValidateCredentialInput): Promise<CredentialValidationResult> {
    return { status: 'unsupported', message: 'FMRv2 adapter is read-only; credentials stay with provider/harness adapters.' };
  }

  async installCredential(_ctx: AdapterContext, _input: InstallCredentialInput): Promise<InstallCredentialResult> {
    return { status: 'unsupported', message: 'FMRv2 adapter does not install credentials or mutate runtimes.' };
  }

  private async repoStatus(ctx: AdapterContext): Promise<FmrRepoStatus | undefined> {
    const result = await callHostHelper(ctx.harness, 'fmr.v2RepoStatus', Math.max(ctx.timeoutMs * 4, 10_000));
    if (!result?.ok) return undefined;
    return result.data as FmrRepoStatus;
  }

  private async tryApiStatus(ctx: AdapterContext): Promise<{ ok: boolean; body?: unknown; message?: string } | undefined> {
    try {
      const res = await fetchJsonOrText(`${ctx.harness.baseUrl}/v1/status`, ctx.timeoutMs);
      return { ok: res.ok, body: res.body, message: `HTTP ${res.status}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'FMRv2 API status check failed' };
    }
  }

  private async fetchAuthed(ctx: AdapterContext, path: string): Promise<{ ok: boolean; body?: unknown; message?: string } | undefined> {
    const token = typeof ctx.harness.config?.machineToken === 'string' ? ctx.harness.config.machineToken : process.env.DMM_FMR_V2_TOKEN;
    if (!token) return undefined;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs);
      try {
        const res = await fetch(`${ctx.harness.baseUrl.replace(/\/$/, '')}${path}`, {
          signal: controller.signal,
          headers: { authorization: `Bearer ${token}` }
        });
        const body = await res.json().catch(() => null);
        return { ok: res.ok, body, message: `HTTP ${res.status}` };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'FMRv2 API request failed' };
    }
  }
}
