import type { AdapterContext, CredentialValidationResult, DiscoveredModel, DiscoveredProvider, HarnessAdapter, HarnessCatalogSnapshotInput, HarnessHealth, HarnessOperationControl, HarnessOperationResult, HarnessVersion, InstallCredentialInput, InstallCredentialResult, ValidateCredentialInput } from '../types.js';
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


  listOperations(ctx: AdapterContext): HarnessOperationControl[] {
    const hasToken = !!this.machineToken(ctx);
    const operations: HarnessOperationControl[] = [
      { id: 'status', label: 'Read service status', description: 'Read FMRv2 service/database status without changing data.', method: 'GET', destructive: false, requiresToken: false },
      { id: 'hardening-report', label: 'Hardening report', description: 'Read FMRv2 production hardening/readiness report.', method: 'GET', destructive: false, requiresToken: true },
      { id: 'openrouter-sync', label: 'Sync OpenRouter catalog', description: 'Ask FMRv2 to refresh its OpenRouter source catalog and classification inputs.', method: 'POST', destructive: false, requiresToken: true },
      { id: 'capability-verify', label: 'Verify capabilities', description: 'Run FMRv2 capability verification for free model candidates.', method: 'POST', destructive: false, requiresToken: true },
      { id: 'rankings-generate', label: 'Generate rankings', description: 'Generate and persist FMRv2 free-model rankings.', method: 'POST', destructive: false, requiresToken: true },
      { id: 'probe-free-models', label: 'Probe free models', description: 'Run a bounded FMRv2 probe over free model candidates.', method: 'POST', destructive: false, requiresToken: true }
    ];
    return operations.map((op) => ({ ...op, description: op.requiresToken && !hasToken ? `${op.description} Machine token is not configured in DMM.` : op.description }));
  }

  async runOperation(ctx: AdapterContext, operationId: string, input: Record<string, unknown> = {}): Promise<HarnessOperationResult> {
    const operation = this.listOperations(ctx).find((op) => op.id === operationId);
    if (!operation) return { operationId, status: 'unsupported', message: 'FMRv2 operation is not allowlisted by the DMM adapter.' };
    if (operation.requiresToken && !this.machineToken(ctx)) return { operationId, status: 'unsupported', message: 'FMRv2 machine token is not configured in DMM.' };
    const started = Date.now();
    const body = this.operationBody(operationId, input);
    const response = operation.method === 'GET'
      ? await this.fetchMaybeAuthed(ctx, this.operationPath(operationId), 'GET')
      : await this.fetchMaybeAuthed(ctx, this.operationPath(operationId), 'POST', body);
    if (!response?.ok) return { operationId, status: 'error', message: response?.message ?? 'FMRv2 operation failed', data: response?.body };
    return { operationId, status: 'completed', message: `${operation.label} completed in ${Date.now() - started}ms`, data: response.body };
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


  private operationPath(operationId: string): string {
    const paths: Record<string, string> = {
      'status': '/v1/status',
      'hardening-report': '/v1/hardening/report',
      'openrouter-sync': '/v1/providers/openrouter/sync',
      'capability-verify': '/v1/capabilities/verify',
      'rankings-generate': '/v1/rankings/generate',
      'probe-free-models': '/v1/probes/free'
    };
    return paths[operationId] ?? '/v1/status';
  }

  private operationBody(operationId: string, input: Record<string, unknown>): Record<string, unknown> {
    if (operationId === 'capability-verify') return { limit: clampNumber(input.limit, 1, 200, 50), ...(typeof input.canonical_id === 'string' ? { canonical_id: input.canonical_id } : {}) };
    if (operationId === 'rankings-generate') return { limit: clampNumber(input.limit, 1, 500, 50), ...(typeof input.consumer_id === 'string' ? { consumer_id: input.consumer_id } : {}), ...(typeof input.constraints === 'object' && input.constraints ? { constraints: input.constraints } : {}) };
    if (operationId === 'probe-free-models') return { limit: clampNumber(input.limit, 1, 50, 10), prompt: typeof input.prompt === 'string' ? input.prompt.slice(0, 2000) : 'Reply with OK.', ...(typeof input.canonical_id === 'string' ? { canonical_id: input.canonical_id } : {}) };
    if (operationId === 'openrouter-sync') return typeof input.payload === 'object' && input.payload ? { payload: input.payload } : {};
    return {};
  }

  private machineToken(ctx: AdapterContext): string | undefined {
    return typeof ctx.harness.config?.machineToken === 'string' ? ctx.harness.config.machineToken : process.env.DMM_FMR_V2_TOKEN;
  }

  private async fetchMaybeAuthed(ctx: AdapterContext, path: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<{ ok: boolean; body?: unknown; message?: string } | undefined> {
    const token = this.machineToken(ctx);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ctx.timeoutMs * 4);
      try {
        const res = await fetch(`${ctx.harness.baseUrl.replace(/\/$/, '')}${path}`, {
          method,
          signal: controller.signal,
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {})
        });
        const parsed = await res.json().catch(() => null);
        return { ok: res.ok, body: parsed, message: `HTTP ${res.status}` };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'FMRv2 operation request failed' };
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

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
