import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuthUser, ProviderView, ModelView, AuditEvent, HarnessView } from '@dmm/shared';
import { dmmSectionManifest } from '@dmm/shared';
import './styles.css';

type Me = { user: AuthUser; csrfToken: string };
type Api<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function api<T>(path: string, init?: RequestInit): Promise<Api<T>> {
  const res = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(init?.headers || {}) }, ...init });
  return res.json();
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
  return <main className="login"><form className="login-card" onSubmit={submit}><div className="eyebrow">Aquiero Instance Management</div><h1>DMM</h1><p>Direct Model Management</p><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label><label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" autoFocus /></label>{error && <div className="error">{error}</div>}<button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></main>;
}

function ModelBoard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [harnesses, setHarnesses] = useState<HarnessView[]>([]);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [models, setModels] = useState<ModelView[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [secretProvider, setSecretProvider] = useState<ProviderView|null>(null);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState('');
  const headers = { 'x-csrf-token': me.csrfToken };
  async function load() {
    const [h,p,m,a] = await Promise.all([api<{harnesses:HarnessView[]}>('/api/harnesses'), api<{providers:ProviderView[]}>('/api/providers'), api<{models:ModelView[]}>('/api/models'), api<{events:AuditEvent[]}>('/api/audit')]);
    if (h.ok) setHarnesses(h.data.harnesses); if (p.ok) setProviders(p.data.providers); if (m.ok) setModels(m.data.models); if (a.ok) setAudit(a.data.events);
  }
  useEffect(() => { load(); }, []);
  async function refreshHarnesses() { setBusy('refresh'); await api('/api/harnesses/refresh', { method: 'POST', headers }); await load(); setBusy(''); }
  async function refreshLifecycle() { setBusy('lifecycle'); await api('/api/harnesses/lifecycle/refresh', { method: 'POST', headers }); await load(); setBusy(''); }
  async function saveSecret() { if (!secretProvider) return; setBusy('secret'); const r = await api(`/api/providers/${secretProvider.id}/credential`, { method: 'POST', headers, body: JSON.stringify({ secret }) }); setBusy(''); setSecret(''); setSecretProvider(null); await load(); if (!r.ok) alert(r.error.message); }
  async function providerAction(id:string, action:string) { setBusy(id+action); await api(`/api/providers/${id}/${action}`, { method:'POST', headers }); await load(); setBusy(''); }
  async function deleteCredential(id:string) { setBusy(id+'delete'); await api(`/api/providers/${id}/credential`, { method:'DELETE', headers }); await load(); setBusy(''); }
  async function modelAction(id:string, action:string) { setBusy(id+action); await api(`/api/models/${encodeURIComponent(id)}/${action}`, { method:'POST', headers }); await load(); setBusy(''); }
  async function logout() { await api('/api/auth/logout', { method:'POST', headers }); onLogout(); }
  const shown = useMemo(() => models.filter(m => (m.displayName + m.providerId + m.id).toLowerCase().includes(filter.toLowerCase())), [models, filter]);
  const enabledModels = models.filter(m => m.status === 'enabled').length;
  return <div className="shell"><aside className="side"><div className="brand">DMM</div>{dmmSectionManifest.navItems.map(i => <a key={i.id} href={`#${i.id}`}>{i.label}</a>)}</aside><main className="main"><div className="top"><div><div className="eyebrow">Universal section · standalone now · module-ready later</div><h1>Direct Model Management</h1></div><div className="row"><span>{me.user.username}</span><button className="ghost" onClick={logout}>Logout</button></div></div>
    <section className="grid"><Card title="Harnesses" value={String(harnesses.length)} hint="configured instance harnesses"/><Card title="Providers" value={String(providers.length)} hint="seeded + discovered catalog"/><Card title="Enabled Models" value={String(enabledModels)} hint="DMM availability state"/></section>
    <section className="panel" id="harnesses"><div className="row"><h2>Harnesses</h2><div className="row"><button className="ghost" onClick={refreshLifecycle} disabled={!!busy}>{busy==='lifecycle'?'Checking…':'Check versions'}</button><button onClick={refreshHarnesses} disabled={!!busy}>{busy==='refresh'?'Refreshing…':'Refresh health + lifecycle'}</button></div></div><div className="list">{harnesses.map(h => <div className="mini" key={h.id}><div className="row"><strong>{h.label}</strong><Badge text={h.status}/></div><p>{h.baseUrl}</p><p>Capabilities: {Object.entries(h.capabilities).filter(([,v])=>v).map(([k])=>k).join(', ') || 'none'}</p><div className="kv"><span>Current version</span><b>{h.currentVersion || 'unknown'}</b><span>Latest version</span><b>{h.latestVersion || 'unknown'}</b><span>Update</span><b className={h.updateAvailable ? 'warn-text' : ''}>{h.updateAvailable ? 'available' : 'none/unknown'}</b><span>Channel</span><b>{h.updateChannel || 'unknown'}</b><span>Version checked</span><b>{h.lastVersionCheckedAt ? new Date(h.lastVersionCheckedAt).toLocaleString() : 'never'}</b><span>Update checked</span><b>{h.lastUpdateCheckedAt ? new Date(h.lastUpdateCheckedAt).toLocaleString() : 'never'}</b></div>{h.lifecycleMessage && <p className="note">{h.lifecycleMessage}</p>}</div>)}</div></section>
    <section className="panel" id="providers"><h2>Providers + BYOK</h2><div className="provider-grid">{providers.map(p => <div className="mini" key={p.id}><div className="row"><strong>{p.label}</strong><Badge text={p.status}/></div><p>{p.authMethod} · {p.modelCount} models · credential: {p.credentialStatus}{p.credentialFingerprint ? ` (${p.credentialFingerprint})` : ''}</p><div className="row"><button className="ghost" onClick={()=>setSecretProvider(p)}>BYOK</button>{p.credentialStatus !== 'missing' && <button className="ghost" onClick={()=>deleteCredential(p.id)}>Delete key</button>}<button onClick={()=>providerAction(p.id, p.status==='disabled'?'enable':'disable')}>{p.status==='disabled'?'Enable':'Disable'}</button></div></div>)}</div></section>
    <section className="panel" id="modelboard"><div className="row"><h2>Model Catalog</h2><input className="search" placeholder="Search models/providers" value={filter} onChange={e=>setFilter(e.target.value)}/></div><div className="table">{shown.map(m => <div className="tr" key={m.id}><div><strong>{m.displayName}</strong><p>{m.providerId} · {m.harnesses.join(', ') || 'no harness binding yet'}</p></div><Badge text={m.status}/><button className="ghost" onClick={()=>modelAction(m.id, m.status==='enabled'?'disable':'enable')}>{m.status==='enabled'?'Disable':'Enable'}</button></div>)}</div></section>
    <section className="panel" id="audit"><h2>Recent Audit</h2><div className="table">{audit.slice(0,20).map(e => <div className="tr" key={e.id}><div><strong>{e.eventType}</strong><p>{e.actor} → {e.targetType}:{e.targetId}</p></div><span>{new Date(e.createdAt).toLocaleString()}</span></div>)}</div></section>
    {secretProvider && <div className="modal"><div className="modal-card"><h2>BYOK · {secretProvider.label}</h2><p>Secret is encrypted server-side. Raw value is never returned.</p><input type="password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="API key / token" autoFocus/><div className="row"><button className="ghost" onClick={()=>setSecretProvider(null)}>Cancel</button><button onClick={saveSecret} disabled={!secret || busy==='secret'}>Save credential</button></div></div></div>}
  </main></div>;
}
function Card({title,value,hint}:{title:string;value:string;hint:string}) { return <div className="card"><span>{title}</span><strong>{value}</strong><p>{hint}</p></div>; }
function Badge({text}:{text:string}) { return <em className={`badge ${text}`}>{text}</em>; }
function App() { const [me,setMe]=useState<Me|null>(null); const [loading,setLoading]=useState(true); useEffect(()=>{api<Me>('/api/auth/me').then(r=>{if(r.ok)setMe(r.data);setLoading(false);});},[]); if(loading) return <div className="loading">Loading DMM…</div>; return me ? <ModelBoard me={me} onLogout={()=>setMe(null)}/> : <LoginPage onLogin={setMe}/>; }
createRoot(document.getElementById('root')!).render(<App/>);
