import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type HarnessConfig = {
  id: string;
  type: string;
  label: string;
  baseUrl: string;
  enabled: boolean;
  adapterName: string;
  config?: Record<string, unknown>;
};

export type AppConfig = {
  nodeEnv: string;
  port: number;
  publicUrl: string;
  dbPath: string;
  sessionSecret: string;
  masterKey: string;
  adminUser: string;
  adminPassword?: string;
  cookieSecure: boolean;
  harnesses: HarnessConfig[];
};

const defaultHarnesses: HarnessConfig[] = [
  { id: 'hermes', type: 'hermes', label: 'Hermes', baseUrl: 'http://127.0.0.1:8080', enabled: true, adapterName: 'hermes' },
  { id: 'openclaw', type: 'openclaw', label: 'OpenClaw', baseUrl: 'http://127.0.0.1:18789', enabled: true, adapterName: 'openclaw' }
];

function loadHarnesses(): HarnessConfig[] {
  const raw = process.env.DMM_HARNESSES_JSON;
  if (!raw) return defaultHarnesses;
  const parsed = JSON.parse(raw) as HarnessConfig[];
  if (!Array.isArray(parsed)) throw new Error('DMM_HARNESSES_JSON must be an array');
  return parsed.map((h) => ({ ...h, enabled: h.enabled !== false, adapterName: h.adapterName ?? h.type }));
}

export function loadConfig(): AppConfig {
  const dbPath = process.env.DMM_DB_PATH ?? resolve(process.cwd(), 'data/dmm.sqlite');
  mkdirSync(dirname(dbPath), { recursive: true });
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const publicUrl = process.env.DMM_PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    publicUrl,
    dbPath,
    sessionSecret: process.env.DMM_SESSION_SECRET ?? randomBytes(32).toString('hex'),
    masterKey: process.env.DMM_MASTER_KEY ?? randomBytes(32).toString('hex'),
    adminUser: process.env.DMM_ADMIN_USER ?? 'admin',
    adminPassword: process.env.DMM_ADMIN_PASSWORD,
    cookieSecure: publicUrl.startsWith('https://') || nodeEnv === 'production',
    harnesses: loadHarnesses()
  };
}
