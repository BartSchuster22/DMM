import { randomUUID } from 'node:crypto';
// node:sqlite is built into Node 22+ and keeps DMM lightweight (no native npm sqlite package).
import { DatabaseSync } from 'node:sqlite';
import type { AuditEvent } from '@dmm/shared';

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harnesses (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      adapter_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      config_json TEXT NOT NULL DEFAULT '{}',
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      auth_method TEXT NOT NULL DEFAULT 'unknown',
      docs_url TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_providers (
      id TEXT PRIMARY KEY,
      harness_id TEXT NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      harness_provider_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      credential_status TEXT NOT NULL DEFAULT 'missing',
      discovery_supported INTEGER NOT NULL DEFAULT 0,
      credential_install_supported INTEGER NOT NULL DEFAULT 0,
      model_count INTEGER NOT NULL DEFAULT 0,
      last_discovered_at TEXT,
      last_validated_at TEXT,
      UNIQUE(harness_id, provider_id)
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      modality TEXT NOT NULL DEFAULT 'text',
      context_window INTEGER,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      pricing_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'available',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS harness_models (
      id TEXT PRIMARY KEY,
      harness_id TEXT NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      harness_model_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      discovered_at TEXT NOT NULL,
      last_seen_at TEXT,
      UNIQUE(harness_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      harness_id TEXT,
      scope TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'saved',
      last_validated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS provider_health (
      provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'unknown',
      health_score INTEGER NOT NULL DEFAULT 0,
      last_success TEXT,
      last_failure TEXT,
      last_error_class TEXT,
      average_latency_ms INTEGER,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_snapshots (
      id TEXT PRIMARY KEY,
      harness_id TEXT NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
      harness_version TEXT,
      provider_count INTEGER NOT NULL DEFAULT 0,
      model_count INTEGER NOT NULL DEFAULT 0,
      source_method TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalog_diffs (
      id TEXT PRIMARY KEY,
      harness_id TEXT NOT NULL REFERENCES harnesses(id) ON DELETE CASCADE,
      from_snapshot_id TEXT,
      to_snapshot_id TEXT NOT NULL REFERENCES catalog_snapshots(id) ON DELETE CASCADE,
      added_providers_json TEXT NOT NULL DEFAULT '[]',
      removed_providers_json TEXT NOT NULL DEFAULT '[]',
      changed_providers_json TEXT NOT NULL DEFAULT '[]',
      added_models_json TEXT NOT NULL DEFAULT '[]',
      removed_models_json TEXT NOT NULL DEFAULT '[]',
      changed_models_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  addColumnIfMissing(db, 'harnesses', 'current_version', 'TEXT');
  addColumnIfMissing(db, 'harnesses', 'latest_version', 'TEXT');
  addColumnIfMissing(db, 'harnesses', 'update_available', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'harnesses', 'update_channel', 'TEXT');
  addColumnIfMissing(db, 'harnesses', 'last_version_checked_at', 'TEXT');
  addColumnIfMissing(db, 'harnesses', 'last_update_checked_at', 'TEXT');
  addColumnIfMissing(db, 'harnesses', 'last_catalog_refresh_at', 'TEXT');
  addColumnIfMissing(db, 'harnesses', 'lifecycle_message', 'TEXT');
}

function addColumnIfMissing(db: Db, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}


export function nowIso(): string { return new Date().toISOString(); }

export function insertAudit(db: Db, input: Omit<AuditEvent, 'id' | 'createdAt' | 'payload'> & { payload: unknown }): AuditEvent {
  const event: AuditEvent = { id: randomUUID(), eventType: input.eventType, actor: input.actor, targetType: input.targetType, targetId: input.targetId, payload: input.payload, createdAt: nowIso() };
  db.prepare('INSERT INTO audit_events (id,event_type,actor,target_type,target_id,payload_json,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(event.id, event.eventType, event.actor, event.targetType, event.targetId, JSON.stringify(event.payload), event.createdAt);
  return event;
}

export function listAudit(db: Db, limit = 100): AuditEvent[] {
  return db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?').all(limit).map((r: any) => ({
    id: r.id, eventType: r.event_type, actor: r.actor, targetType: r.target_type, targetId: r.target_id, payload: JSON.parse(r.payload_json), createdAt: r.created_at
  }));
}
