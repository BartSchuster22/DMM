import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuthUser, SectionManifest } from '@dmm/shared';
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
    const result = await api<Me>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setBusy(false);
    if (!result.ok) return setError(result.error.message);
    onLogin(result.data);
  }
  return <main className="login"><form className="login-card" onSubmit={submit}>
    <div className="eyebrow">Aquiero Instance Management</div>
    <h1>DMM</h1><p>Direct Model Management</p>
    <label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" /></label>
    <label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" autoFocus /></label>
    {error && <div className="error">{error}</div>}
    <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form></main>;
}

function Shell({ me, manifest, onLogout }: { me: Me; manifest: SectionManifest; onLogout: () => void }) {
  return <div className="shell">
    <aside className="side"><div className="brand">DMM</div>{manifest.navItems.map(i=><a key={i.id} href={i.path}>{i.label}</a>)}</aside>
    <main className="main"><header className="top"><div><div className="eyebrow">{manifest.label}</div><h1>{manifest.title}</h1></div><button className="ghost" onClick={onLogout}>Logout {me.user.username}</button></header>
      <section className="grid">
        <Card title="Harnesses" value="0" hint="Adapter framework pending next phase" />
        <Card title="Providers" value="0" hint="Provider registry pending next phase" />
        <Card title="Enabled Models" value="0" hint="Model catalog pending next phase" />
      </section>
      <section className="panel"><h2>Universal section skeleton ready</h2><p>DMM is standalone now and exposes a section manifest for future central dashboard merge.</p><code>/api/section-manifest</code></section>
    </main>
  </div>;
}
function Card({ title, value, hint }: { title: string; value: string; hint: string }) { return <div className="card"><span>{title}</span><strong>{value}</strong><p>{hint}</p></div>; }
function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{ api<Me>('/api/auth/me').then(r=>{ if(r.ok) setMe(r.data); setLoading(false); }); }, []);
  async function logout() { if (me) await api('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': me.csrfToken } }); setMe(null); }
  if (loading) return <div className="loading">Loading DMM…</div>;
  return me ? <Shell me={me} manifest={dmmSectionManifest} onLogout={logout}/> : <LoginPage onLogin={setMe}/>;
}

createRoot(document.getElementById('root')!).render(<App />);
