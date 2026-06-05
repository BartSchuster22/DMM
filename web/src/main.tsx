import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AuthUser, ProviderView, ModelView, AuditEvent, HarnessView,
  CatalogSnapshotView, CatalogDiffView, ProviderCredentialRequirementView,
  CatalogLifecycleView, CredentialView, ModelStatus, NormalizedDmmStateView, NormalizedProviderState
} from '@dmm/shared';
import { dmmSectionManifest } from '@dmm/shared';
import './styles.css';

type Me = { user: AuthUser; csrfToken: string };
type Api<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
type PageId = 'modelboard' | 'catalog' | 'providers' | 'harnesses' | 'audit';

const NAV_ITEMS = dmmSectionManifest.navItems as Array<{ id: PageId; label: string; path: string }>;
const DEFAULT_PAGE: PageId = 'modelboard';
const PAGE_TITLES: Record<PageId, string> = {
  modelboard: 'ModelBoard',
  catalog: 'Catalog Truth',
  providers: 'Providers',
  harnesses: 'Harnesses',
  audit: 'Audit',
};
const PAGE_HINTS: Record<PageId, string> = {
  modelboard: 'DMM-local model status across normalized catalogs',
  catalog: 'normalized harness catalog snapshots and diffs',
  providers: 'external providers, DMM credentials, and harness credential state',
  harnesses: 'available harness instances, health, and lifecycle',
  audit: 'recent administrative events',
};

function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#/, '').split('/')[0] as PageId;
  return NAV_ITEMS.some(i => i.id === id) ? id : DEFAULT_PAGE;
}

function providerIdFromHash(hash: string): string | null {
  const [page, providerId] = hash.replace(/^#/, '').split('/');
  return page === 'providers' && providerId ? decodeURIComponent(providerId) : null;
}

async function api<T>(path: string, init?: RequestInit): Promise<Api<T>> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  return res.json();
}

const ts = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '\u2014');

function Badge({ text }: { text: string }) {
  return <em className={`badge ${text}`}>{text}</em>;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

function CredDot({ status }: { status: string }) {
  return <span className={`dot ${status}`} />;
}

function LoginPage({ onLogin }: { onLogin: (me: Me) => void }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const r = await api<Me>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setBusy(false); if (!r.ok) return setError(r.error.message); onLogin(r.data);
  }
  return (
    <main className="login"><form className="login-card" onSubmit={submit}>
      <div className="eyebrow">Aquiero Instance Management</div><h1>DMM</h1><p>Direct Model Management</p>
      <label>Username<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" /></label>
      <label>Password<input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="current-password" autoFocus /></label>
      {error && <div className="error-box">{error}</div>}
      <button disabled={busy}>{busy ? 'Signing in\u2026' : 'Sign in'}</button>
    </form></main>
  );
}

function HarnessesSection({ harnesses, busy, onRefresh, onLifecycle, onCatalog }: {
  harnesses: HarnessView[]; busy: string; onRefresh: () => void; onLifecycle: () => void; onCatalog: () => void;
}) {
  return (
    <div className="panel" id="harnesses">
      <div className="panel-head"><h2>Harness Instances</h2>
        <div className="panel-actions">
          <button className="ghost sm" onClick={onLifecycle} disabled={!!busy}>{busy === 'lifecycle' ? 'Checking\u2026' : 'Check versions'}</button>
          <button className="sm" onClick={onRefresh} disabled={!!busy}>{busy === 'refresh' ? 'Refreshing\u2026' : 'Refresh health'}</button>
          <button className="ghost sm" onClick={onCatalog} disabled={!!busy}>{busy === 'catalog' ? 'Refreshing\u2026' : 'Refresh normalized catalog'}</button>
        </div>
      </div>
      <div className="item-list">{harnesses.map(h => (
        <div className="item" key={h.id}>
          <div className="item-head"><strong>{h.label}</strong><Badge text={h.status} /></div>
          <div className="item-meta">{h.baseUrl}</div>
          <div className="item-meta">Adapter capabilities: {Object.entries(h.capabilities).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}</div>
          <div className="kv">
            <span>Current version</span><b>{h.currentVersion || 'unknown'}</b>
            <span>Latest version</span><b>{h.latestVersion || 'unknown'}</b>
            <span>Update</span><b style={h.updateAvailable ? { color: 'var(--warn)' } : {}}>{h.updateAvailable ? 'available' : 'none'}</b>
            <span>Channel</span><b>{h.updateChannel || 'unknown'}</b>
            <span>Version checked</span><b>{ts(h.lastVersionCheckedAt)}</b>
            <span>Update checked</span><b>{ts(h.lastUpdateCheckedAt)}</b>
          </div>
          {h.lifecycleMessage && <div className="note">{h.lifecycleMessage}</div>}
          {h.type === 'free-model-router' && <FmrVisibilityDetails harness={h} allHarnesses={harnesses} />}
        </div>
      ))}</div>
    </div>
  );
}


function FmrVisibilityDetails({ harness, allHarnesses }: { harness: HarnessView; allHarnesses: HarnessView[] }) {
  const cfg = harness.config || {};
  const supported = Array.isArray(cfg.supportedHarnesses) ? cfg.supportedHarnesses.map(String) : [];
  const compatibility = allHarnesses.filter(h => h.id !== harness.id && h.type !== 'free-model-router');
  return (
    <div className="subsection" style={{ marginTop: 12 }}>
      <h3>FMRv2 visibility</h3>
      <div className="kv">
        <span>Service module</span><b>{cfg.serviceModule === false ? 'no' : 'separate'}</b>
        <span>Availability</span><b>{String(cfg.availability || 'active')}</b>
        <span>Role</span><b>curated free-model policy/ranking source</b>
        <span>Fallback placement owner</span><b>{String(cfg.fallbackPlacementOwner || 'agent-management')}</b>
      </div>
      <div className="item-meta" style={{ marginTop: 10 }}>DMM shows FMRv2 availability and harness capability. Per-agent fallback-chain order is not decided here.</div>
      <div className="table-rows" style={{ marginTop: 10 }}>
        {compatibility.map(target => {
          const state = supported.includes(target.id) ? 'supported' : 'unknown';
          return <div className="table-row" key={target.id}><div className="info"><strong>{target.label}</strong><p>{target.id} | {target.type}</p></div><Badge text={state} /></div>;
        })}
      </div>
    </div>
  );
}

function CatalogSection({ snapshots, diffs, lifecycle, busy, onRefresh, onLifecycleRefresh }: {
  snapshots: CatalogSnapshotView[]; diffs: CatalogDiffView[]; lifecycle: CatalogLifecycleView[];
  busy: string; onRefresh: () => void; onLifecycleRefresh: () => void;
}) {
  return (
    <div className="panel" id="catalog">
      <div className="panel-head"><h2>Catalog Truth</h2>
        <div className="panel-actions">
          <button className="ghost sm" onClick={onLifecycleRefresh} disabled={!!busy}>{busy === 'catalog-lifecycle' ? 'Checking\u2026' : 'Update-driven catalog refresh'}</button>
          <button className="ghost sm" onClick={onRefresh} disabled={!!busy}>{busy === 'catalog' ? 'Refreshing\u2026' : 'Refresh snapshots'}</button>
        </div>
      </div>
      <div className="panel-desc">Snapshots are normalized by DMM core; harness-specific ingestion stays inside each harness adapter/module.</div>
      <div className="stats-grid">
        <StatCard label="Snapshots" value={String(snapshots.length)} hint="captured harness catalogs" />
        <StatCard label="Diffs" value={String(diffs.length)} hint="catalog changes detected" />
        <StatCard label="Latest models" value={String(snapshots[0]?.modelCount ?? 0)} hint={snapshots[0]?.harnessId ?? 'no snapshot yet'} />
      </div>
      <div className="subsection"><h3>Catalog lifecycle</h3><div className="item-list">{lifecycle.map(c => (
        <div className="item" key={c.harnessId}>
          <div className="item-head"><strong>{c.label}</strong><Badge text={c.refreshRecommended ? 'stale' : 'current'} /></div>
          <div className="kv">
            <span>Current version</span><b>{c.currentVersion || 'unknown'}</b>
            <span>Snapshot version</span><b>{c.latestSnapshotVersion || 'unknown'}</b>
            <span>Last catalog</span><b>{ts(c.lastCatalogRefreshAt)}</b>
            <span>Reason</span><b>{c.reason || 'catalog_current'}</b>
          </div>
        </div>
      ))}</div></div>
      <div className="subsection"><h3>Snapshots</h3><div className="item-list">{snapshots.slice(0, 6).map(s => (
        <div className="item" key={s.id}>
          <div className="item-head"><strong>{s.harnessId}</strong><Badge text={s.sourceMethod} /></div>
          <div className="kv">
            <span>Harness version</span><b>{s.harnessVersion || 'unknown'}</b>
            <span>Providers</span><b>{s.providerCount}</b>
            <span>Models</span><b>{s.modelCount}</b>
            <span>Captured</span><b>{ts(s.capturedAt)}</b>
          </div>
        </div>
      ))}</div></div>
      <div className="subsection"><h3>Recent catalog diffs</h3><div className="table-rows">{diffs.slice(0, 10).map(d => (
        <div className="table-row" key={d.id}>
          <div className="info"><strong>{d.harnessId}</strong><p>Providers +{d.summary.addedProviders} -{d.summary.removedProviders} ~{d.summary.changedProviders} | Models +{d.summary.addedModels} -{d.summary.removedModels} ~{d.summary.changedModels}</p></div>
          <span className="meta">{ts(d.createdAt)}</span>
        </div>
      ))}</div></div>
    </div>
  );
}

function ProvidersSection({ providerStates, requirements, credentials, busy, onByok, onValidate, onDeleteCred }: {
  providerStates: NormalizedProviderState[]; requirements: ProviderCredentialRequirementView[]; credentials: CredentialView[]; busy: string;
  onByok: (p: ProviderView) => void; onValidate: (id: string) => void; onDeleteCred: (id: string) => void;
}) {
  const credentialByProvider = new Map(credentials.map(c => [c.providerId, c]));
  const requirementByProvider = new Map(requirements.map(r => [r.providerId, r]));
  const toProviderView = (p: NormalizedProviderState): ProviderView => ({ id: p.providerId, label: p.label, authMethod: p.authMethod, status: p.dmmProviderStatus, credentialStatus: p.dmmCredentialStatus, credentialFingerprint: p.dmmCredentialFingerprint, modelCount: p.modelCount, harnesses: p.harnessStates.map(h => h.harnessId), updatedAt: p.updatedAt });
  return (
    <div className="panel" id="providers">
      <div className="panel-head"><h2>External Providers + DMM Credentials</h2></div>
      <div className="panel-desc">Credential management is DMM-local first: secrets stay encrypted in the DMM vault, validation/install is delegated only to Layer 3 adapters that advertise support.</div>
      <div className="provider-grid">{providerStates.map(p => {
        const saved = credentialByProvider.get(p.providerId);
        return <div className="item" key={p.providerId}>
          <div className="item-head"><strong><a className="entity-link" href={`#providers/${encodeURIComponent(p.providerId)}`} aria-label={`Open ${p.label} models`}>{p.label}</a></strong><Badge text={p.dmmProviderStatus} /></div>
          <div className="item-meta">{p.authMethod} | {p.modelCount} models | source: {p.externalSource}</div>
          <div className="cred-strip"><CredDot status={p.dmmCredentialStatus} /><span>DMM credential: {p.dmmCredentialStatus}</span>{p.dmmCredentialFingerprint && <span>({p.dmmCredentialFingerprint})</span>}</div>
          <div className="kv" style={{ marginTop: 10 }}>
            <span>DMM provider status</span><b>{p.dmmProviderStatus}</b>
            <span>Vault record</span><b>{saved ? `${saved.scope} | ${saved.status} | ${saved.fingerprint}` : 'none'}</b>
            <span>Layer 3 harness states</span><b>{p.harnessStates.length > 0 ? p.harnessStates.map(h => <span key={h.harnessId} style={{ marginRight: 10 }}><CredDot status={h.credentialStatus} /> {h.harnessId}: {h.credentialStatus} / install {h.credentialInstallSupported ? 'supported' : 'unsupported'} ({h.modelCount})</span>) : 'none'}</b>
          </div>
          <div className="panel-actions" style={{ marginTop: 12 }}>
            <button className="ghost sm" onClick={() => onByok(toProviderView(p))}>Save / rotate BYOK</button>
            {saved && <button className="ghost sm" onClick={() => onValidate(p.providerId)} disabled={busy === p.providerId + 'validate'}>{busy === p.providerId + 'validate' ? 'Validating…' : 'Validate + sync adapters'}</button>}
            {saved && <button className="ghost sm danger" onClick={() => onDeleteCred(p.providerId)}>Delete DMM key</button>}
          </div>
        </div>;
      })}</div>
      <div className="subsection"><h3>Credential requirements</h3><div className="table-rows">{providerStates.map(p => {
        const r = requirementByProvider.get(p.providerId);
        return <div className="table-row" key={p.providerId}>
          <div className="info"><strong>{p.label}</strong><p>{r?.requiredEnvVars.length ? `requires ${r.requiredEnvVars.join(', ')}` : 'no required env vars declared'} | configured env: {r?.configuredEnvVars.join(', ') || 'none'} | pool: {r?.credentialPoolCount ?? 0}</p></div>
          <Badge text={p.dmmCredentialStatus} />
        </div>;
      })}</div></div>
    </div>
  );
}

type ModelFilterStatus = 'all' | ModelStatus;

function ProviderModelsPage({ provider, models, busy, onByok, onValidate, onDeleteCred, onToggleProvider, onToggleModel }: {
  provider: ProviderView; models: ModelView[]; busy: string;
  onByok: (p: ProviderView) => void; onValidate: (id: string) => void; onDeleteCred: (id: string) => void;
  onToggleProvider: (id: string, current: string) => void; onToggleModel: (id: string, current: ModelStatus) => void;
}) {
  const [search, setSearch] = useState('');
  const providerModels = useMemo(() => {
    const list = models.filter(m => m.providerId === provider.id);
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(m => (m.displayName + m.id + m.modality + m.status).toLowerCase().includes(q));
  }, [models, provider.id, search]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { total: models.filter(m => m.providerId === provider.id).length };
    for (const m of models.filter(m => m.providerId === provider.id)) c[m.status] = (c[m.status] || 0) + 1;
    return c;
  }, [models, provider.id]);
  return (
    <div className="panel" id="provider-models">
      <div className="panel-head">
        <div>
          <a className="back-link" href="#providers">← Providers</a>
          <h2>{provider.label} Models</h2>
          <div className="panel-desc" style={{ margin: '6px 0 0' }}>{provider.id} | {provider.authMethod} | harness bindings: {provider.harnesses.join(', ') || 'none yet'} | DMM provider status is not runtime model routing</div>
        </div>
        <div className="panel-actions">
          <Badge text={provider.status} />
          <button className="ghost sm" onClick={() => onByok(provider)}>Save BYOK in DMM</button>
          {provider.credentialStatus !== 'missing' && <button className="ghost sm" onClick={() => onValidate(provider.id)} disabled={busy === provider.id + 'validate'}>{busy === provider.id + 'validate' ? 'Validating\u2026' : 'Validate via adapters'}</button>}
          {provider.credentialStatus !== 'missing' && <button className="ghost sm danger" onClick={() => onDeleteCred(provider.id)}>Delete DMM key</button>}
          <button className="sm" onClick={() => onToggleProvider(provider.id, provider.status)}>{provider.status === 'disabled' ? 'Mark available in DMM' : 'Disable in DMM'}</button>
        </div>
      </div>
      <div className="stats-grid">
        <StatCard label="Provider Models" value={String(counts.total || 0)} hint="models normalized for this provider" />
        <StatCard label="DMM Enabled" value={String(counts.enabled || 0)} hint="DMM-local model status" />
        <StatCard label="DMM Available" value={String(counts.available || 0)} hint="available but not DMM-enabled" />
        <StatCard label="DMM Credential" value={provider.credentialStatus} hint={provider.credentialFingerprint || 'no fingerprint'} />
      </div>
      <div className="filter-bar">
        <input className="search-input" placeholder={`Search ${provider.label} models...`} value={search} onChange={e => setSearch(e.target.value)} />
        <span className="count">{providerModels.length} of {counts.total || 0}</span>
      </div>
      <div className="table-rows">
        {providerModels.map(m => (
          <div className="table-row" key={m.id}>
            <div className="info"><strong>{m.displayName}</strong><p>{m.id} | {m.modality}{m.contextWindow ? ` | ${m.contextWindow} context` : ''} | {m.harnesses.join(', ') || 'no harness binding yet'}</p></div>
            <Badge text={m.status} />
            <div className="actions"><button className="ghost sm" onClick={() => onToggleModel(m.id, m.status)} disabled={busy === m.id + (m.status === 'enabled' ? 'disable' : 'enable')}>{m.status === 'enabled' ? 'Disable in DMM' : 'Enable in DMM'}</button></div>
          </div>
        ))}
        {providerModels.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)' }}>No models found for this provider.</div>}
      </div>
    </div>
  );
}

function ModelBoardSection({ models, busy, onToggle }: { models: ModelView[]; busy: string; onToggle: (id: string, current: ModelStatus) => void; }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ModelFilterStatus>('all');
  const filtered = useMemo(() => {
    let list = models;
    if (statusFilter !== 'all') list = list.filter(m => m.status === statusFilter);
    if (search) { const q = search.toLowerCase(); list = list.filter(m => (m.displayName + m.providerId + m.id).toLowerCase().includes(q)); }
    return list;
  }, [models, search, statusFilter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: models.length };
    for (const m of models) c[m.status] = (c[m.status] || 0) + 1;
    return c;
  }, [models]);
  return (
    <div className="panel" id="modelboard">
      <div className="panel-head"><h2>ModelBoard</h2></div>
      <div className="filter-bar">
        <input className="search-input" placeholder="Search models / providers..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="panel-actions">{(['all', 'available', 'enabled', 'disabled', 'deprecated', 'unavailable'] as ModelFilterStatus[]).map(s => (
          <button key={s} className="ghost sm" style={statusFilter === s ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}} onClick={() => setStatusFilter(s)}>{s === 'all' ? 'All' : s} {counts[s] != null ? `(${counts[s]})` : ''}</button>
        ))}</div>
        <span className="count">{filtered.length} of {models.length}</span>
      </div>
      <div className="table-rows">
        {filtered.map(m => (
          <div className="table-row" key={m.id}>
            <div className="info"><strong>{m.displayName}</strong><p>{m.providerId} | {m.harnesses.join(', ') || 'no harness binding yet'}</p></div>
            <Badge text={m.status} />
            <div className="actions"><button className="ghost sm" onClick={() => onToggle(m.id, m.status)} disabled={busy === m.id + (m.status === 'enabled' ? 'disable' : 'enable')}>{m.status === 'enabled' ? 'Disable in DMM' : 'Enable in DMM'}</button></div>
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--muted)' }}>No models match the current filter.</div>}
      </div>
    </div>
  );
}

function AuditSection({ events }: { events: AuditEvent[] }) {
  return (
    <div className="panel" id="audit">
      <div className="panel-head"><h2>Recent Audit</h2><span className="panel-desc" style={{ margin: 0 }}>{events.length} events</span></div>
      <div className="table-rows">{events.slice(0, 30).map(e => (
        <div className="table-row" key={e.id}>
          <div className="info"><strong>{e.eventType}</strong><p>{e.actor} | {e.targetType}:{e.targetId}</p></div>
          <span className="meta">{ts(e.createdAt)}</span>
        </div>
      ))}</div>
    </div>
  );
}

function ByokModal({ provider, busy, onSave, onCancel }: { provider: ProviderView; busy: string; onSave: (secret: string) => void; onCancel: () => void; }) {
  const [secret, setSecret] = useState('');
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h2>BYOK | {provider.label}</h2>
        <p>Secret is encrypted in the DMM vault. If a harness adapter supports install, DMM can pass it to that harness without returning the raw value to the UI.</p>
        <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="API key / token" autoFocus />
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button onClick={() => onSave(secret)} disabled={!secret || busy === 'secret'}>{busy === 'secret' ? 'Saving\u2026' : 'Save DMM credential'}</button>
        </div>
      </div>
    </div>
  );
}

function ModelBoard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [harnesses, setHarnesses] = useState<HarnessView[]>([]);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [requirements, setRequirements] = useState<ProviderCredentialRequirementView[]>([]);
  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [models, setModels] = useState<ModelView[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [snapshots, setSnapshots] = useState<CatalogSnapshotView[]>([]);
  const [diffs, setDiffs] = useState<CatalogDiffView[]>([]);
  const [catalogLifecycle, setCatalogLifecycle] = useState<CatalogLifecycleView[]>([]);
  const [normalizedState, setNormalizedState] = useState<NormalizedDmmStateView | null>(null);
  const [busy, setBusy] = useState('');
  const [secretProvider, setSecretProvider] = useState<ProviderView | null>(null);
  const [currentPage, setCurrentPage] = useState<PageId>(() => pageFromHash(window.location.hash));
  const [currentProviderId, setCurrentProviderId] = useState<string | null>(() => providerIdFromHash(window.location.hash));
  const headers = { 'x-csrf-token': me.csrfToken };

  async function load() {
    const [h, p, pr, cr, m, a, cs, cd, cl, ns] = await Promise.all([
      api<{ harnesses: HarnessView[] }>('/api/harnesses'),
      api<{ providers: ProviderView[] }>('/api/providers'),
      api<{ requirements: ProviderCredentialRequirementView[] }>('/api/providers/requirements'),
      api<{ credentials: CredentialView[] }>('/api/credentials'),
      api<{ models: ModelView[] }>('/api/models'),
      api<{ events: AuditEvent[] }>('/api/audit'),
      api<{ snapshots: CatalogSnapshotView[] }>('/api/catalog/snapshots'),
      api<{ diffs: CatalogDiffView[] }>('/api/catalog/diffs'),
      api<{ lifecycle: CatalogLifecycleView[] }>('/api/catalog/lifecycle'),
      api<NormalizedDmmStateView>('/api/normalized-state'),
    ]);
    if (h.ok) setHarnesses(h.data.harnesses); if (p.ok) setProviders(p.data.providers);
    if (pr.ok) setRequirements(pr.data.requirements); if (cr.ok) setCredentials(cr.data.credentials); if (m.ok) setModels(m.data.models);
    if (a.ok) setAudit(a.data.events); if (cs.ok) setSnapshots(cs.data.snapshots);
    if (cd.ok) setDiffs(cd.data.diffs); if (cl.ok) setCatalogLifecycle(cl.data.lifecycle);
    if (ns.ok) setNormalizedState(ns.data);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const syncPage = () => {
      setCurrentPage(pageFromHash(window.location.hash));
      setCurrentProviderId(providerIdFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', syncPage);
    if (!window.location.hash) window.history.replaceState(null, '', `#${DEFAULT_PAGE}`);
    syncPage();
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  async function act(key: string, fn: () => Promise<void>) {
    setBusy(key); try { await fn(); } finally { setBusy(''); } await load();
  }
  const refreshHarnesses = () => act('refresh', () => api('/api/harnesses/refresh', { method: 'POST', headers }).then(() => {}));
  const refreshLifecycle = () => act('lifecycle', () => api('/api/harnesses/lifecycle/refresh', { method: 'POST', headers }).then(() => {}));
  const refreshCatalog = () => act('catalog', () => api('/api/catalog/refresh', { method: 'POST', headers }).then(() => {}));
  const refreshCatalogLifecycle = () => act('catalog-lifecycle', () => api('/api/catalog/lifecycle/refresh', { method: 'POST', headers }).then(() => {}));

  async function saveSecret(secret: string) {
    if (!secretProvider) return; setBusy('secret');
    const r = await api(`/api/providers/${secretProvider.id}/credential`, { method: 'POST', headers, body: JSON.stringify({ secret }) });
    setBusy(''); setSecretProvider(null); await load(); if (!r.ok) alert(r.error.message);
  }
  function providerAction(id: string, action: string) { act(id + action, () => api(`/api/providers/${id}/${action}`, { method: 'POST', headers }).then(() => {})); }
  function deleteCredential(id: string) { act(id + 'delete', () => api(`/api/providers/${id}/credential`, { method: 'DELETE', headers }).then(() => {})); }
  function validateCredential(id: string) { act(id + 'validate', () => api(`/api/providers/${id}/validate`, { method: 'POST', headers }).then(() => {})); }
  function toggleProvider(id: string, current: string) { providerAction(id, current === 'disabled' ? 'enable' : 'disable'); }
  function toggleModel(id: string, current: ModelStatus) {
    act(id + (current === 'enabled' ? 'disable' : 'enable'), () =>
      api(`/api/models/${encodeURIComponent(id)}/${current === 'enabled' ? 'disable' : 'enable'}`, { method: 'POST', headers }).then(() => {}));
  }
  async function logout() { await api('/api/auth/logout', { method: 'POST', headers }); onLogout(); }

  const enabledModels = models.filter(m => m.status === 'enabled').length;
  const totalModels = models.length;
  const providerStates = normalizedState?.providers ?? providers.map(p => ({ layer: 'dmm_ui' as const, providerId: p.id, label: p.label, authMethod: p.authMethod, dmmProviderStatus: p.status, dmmCredentialStatus: p.credentialStatus, dmmCredentialFingerprint: p.credentialFingerprint, externalSource: 'legacy-provider-view', modelCount: p.modelCount, harnessStates: [], updatedAt: p.updatedAt }));
  const currentProvider = providers.find(p => p.id === currentProviderId) || null;
  const currentProviderModels = currentProvider ? models.filter(m => m.providerId === currentProvider.id) : [];
  const pageTitle = currentProvider ? currentProvider.label : PAGE_TITLES[currentPage];
  const pageHint = currentProvider ? 'provider model list' : PAGE_HINTS[currentPage];
  const pageStats: Partial<Record<PageId, React.ReactNode>> = {
    modelboard: <div className="stats-grid">
      <StatCard label="DMM Enabled Models" value={String(enabledModels)} hint="DMM-local model status" />
      <StatCard label="Total Models" value={String(totalModels)} hint="discovered across all harnesses" />
      <StatCard label="External Providers" value={String(providers.length)} hint="seeded + discovered provider sources" />
      <StatCard label="Harness Instances" value={String(harnesses.length)} hint="available runtime instances" />
    </div>,
    catalog: <div className="stats-grid">
      <StatCard label="Snapshots" value={String(snapshots.length)} hint="captured harness catalogs" />
      <StatCard label="Diffs" value={String(diffs.length)} hint="catalog changes detected" />
      <StatCard label="Latest Models" value={String(snapshots[0]?.modelCount ?? 0)} hint={snapshots[0]?.harnessId ?? 'no snapshot yet'} />
    </div>,
    providers: currentProvider ? <div className="stats-grid">
      <StatCard label="Provider Models" value={String(currentProviderModels.length)} hint={currentProvider.id} />
      <StatCard label="Enabled" value={String(currentProviderModels.filter(m => m.status === 'enabled').length)} hint="enabled in DMM" />
      <StatCard label="Available" value={String(currentProviderModels.filter(m => m.status === 'available').length)} hint="available models" />
    </div> : <div className="stats-grid">
      <StatCard label="Providers" value={String(providers.length)} hint="seeded + discovered catalog" />
      <StatCard label="DMM Credentials Saved" value={String(providerStates.filter(r => r.dmmCredentialStatus !== 'missing').length)} hint="vault + normalized harness state" />
      <StatCard label="Missing DMM Credentials" value={String(providerStates.filter(r => r.dmmCredentialStatus === 'missing').length)} hint="needs BYOK or harness config" />
    </div>,
    harnesses: <div className="stats-grid">
      <StatCard label="Harness Instances" value={String(harnesses.length)} hint="configured Layer 2 instances" />
      <StatCard label="Online" value={String(harnesses.filter(h => h.status === 'online').length)} hint="healthy harness instances" />
      <StatCard label="Updates" value={String(harnesses.filter(h => h.updateAvailable).length)} hint="available harness updates" />
    </div>,
    audit: <div className="stats-grid">
      <StatCard label="Audit Events" value={String(audit.length)} hint="recent administrative events" />
    </div>,
  };
  const pageContent: Record<PageId, React.ReactNode> = {
    modelboard: <ModelBoardSection models={models} busy={busy} onToggle={toggleModel} />,
    catalog: <CatalogSection snapshots={snapshots} diffs={diffs} lifecycle={catalogLifecycle} busy={busy} onRefresh={refreshCatalog} onLifecycleRefresh={refreshCatalogLifecycle} />,
    providers: currentProvider ? <ProviderModelsPage provider={currentProvider} models={models} busy={busy} onByok={setSecretProvider} onValidate={validateCredential} onDeleteCred={deleteCredential} onToggleProvider={toggleProvider} onToggleModel={toggleModel} /> : <ProvidersSection providerStates={providerStates} requirements={requirements} credentials={credentials} busy={busy} onByok={setSecretProvider} onValidate={validateCredential} onDeleteCred={deleteCredential} />,
    harnesses: <HarnessesSection harnesses={harnesses} busy={busy} onRefresh={refreshHarnesses} onLifecycle={refreshLifecycle} onCatalog={refreshCatalog} />,
    audit: <AuditSection events={audit} />,
  };

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">DMM</div>
        <div className="side-label">Navigation</div>
        <nav>{NAV_ITEMS.map(i => <a key={i.id} href={`#${i.id}`} className={currentPage === i.id ? 'active' : ''}>{i.label}</a>)}</nav>
        <div className="side-footer">{me.user.username} | <button className="ghost sm" onClick={logout}>Logout</button></div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="topbar-left"><div className="eyebrow">Direct Model Management | normalized harness layer</div><h1>{pageTitle}</h1></div>
          <div className="topbar-right"><span>{pageHint}</span></div>
        </div>
        <div className="content">
          <section className="page" data-page={currentPage}>
            {pageStats[currentPage]}
            {pageContent[currentPage]}
          </section>
          {secretProvider && <ByokModal provider={secretProvider} busy={busy} onSave={saveSecret} onCancel={() => setSecretProvider(null)} />}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<Me>('/api/auth/me').then(r => { if (r.ok) setMe(r.data); setLoading(false); }); }, []);
  if (loading) return <div className="loading">Loading DMM...</div>;
  return me ? <ModelBoard me={me} onLogout={() => setMe(null)} /> : <LoginPage onLogin={setMe} />;
}

createRoot(document.getElementById('root')!).render(<App />);
