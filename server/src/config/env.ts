import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
};

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
    cookieSecure: publicUrl.startsWith('https://') || nodeEnv === 'production'
  };
}
