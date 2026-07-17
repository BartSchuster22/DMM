# DMM QA10 Production-Readiness Assessment

**Assessment date:** 2026-07-17  
**Production URL:** `https://dmm.aquiero.com`  
**Deployment scope:** standalone DMM service with Hermes as the only enabled agent framework

## Verdict

**Application and single-VPS production readiness: PASS.**

DMM's source, build, tests, production image, live API/UI shell, authentication boundary, framework authority, persistence, backups, and restore path were exercised against the real deployment. The final production deployment passed all automated and live gates.

**Residual infrastructure risk:** verified backups are currently stored on the same VPS. This protects against application/database corruption and bad deployments but not total VPS or provider loss. Off-host replication requires an external backup destination and credentials and remains the only material disaster-recovery gap.

## QA10 gate summary

| # | Gate | Result | Evidence |
|---:|---|---|---|
| 1 | Scope and architecture truth | PASS | Hermes is the only enabled framework; current views require active framework bindings; Dashboard V3 and FMR scans return zero. |
| 2 | Static correctness and build | PASS | Workspace typecheck and production builds pass. |
| 3 | Automated regression suite | PASS | 21/21 tests pass. |
| 4 | Live API and UI shell | PASS | 20/20 production smoke checks pass over public HTTPS. |
| 5 | Authentication and request security | PASS | Signed hardened sessions, CSRF enforcement, login limits, trusted proxy handling, safe errors and secret redaction verified. |
| 6 | Dependency and supply-chain hygiene | PASS | Full and production npm audits report zero vulnerabilities; lockfile installs use `npm ci`; Node base image is digest-pinned. |
| 7 | Runtime and network hardening | PASS | Non-root, read-only container; all capabilities dropped; no-new-privileges; bounded CPU, memory, PIDs and tmpfs; services bind loopback only. |
| 8 | Data integrity and persistence | PASS | SQLite integrity and foreign keys pass; database survives deploy/restart/restore; restrictive file permissions enforced. |
| 9 | Operations, backup and recovery | PASS with site-loss caveat | Six-hour verified backups, 56-copy retention, pre-deploy safety backup, WAL-safe restore and a real stop/restore/start/health drill pass. |
| 10 | Release traceability | PASS when corresponding commit is present on GitHub | Clean diff checks, no tracked secret files, reproducible image build, QA reports and this assessment are source-controlled. |

## Final executed evidence

### Source QA

```text
Typecheck: PASS
Tests:    21 passed, 0 failed
Build:    PASS
```

Regression coverage includes:

- provider-issued API-key validation;
- unsupported OAuth/key combinations;
- framework-authoritative current provider/model views;
- empty database has no locally seeded provider/model truth;
- credential encryption and redacted inventory;
- Hermes catalog normalization;
- catalog lifecycle and retention;
- nested model metadata diff detection;
- disabled framework history excluded from current lifecycle/snapshot/diff views;
- hardened browser headers;
- signed-cookie tamper rejection;
- identifier/secret sanitization;
- adapter and error secret redaction.

### Production smoke

```text
20 passed, 0 failed
```

The live smoke suite verifies:

- health endpoint;
- frontend shell and hashed assets;
- status and section manifest;
- anonymous access rejection;
- admin login and hardened cookie;
- CSRF rejection;
- authenticated identity;
- frameworks, providers, credential requirements and credential inventory;
- models, lifecycle, snapshots, diffs and audit;
- normalized active-framework state;
- live catalog refresh;
- logout and QA session destruction.

### Current production truth

```text
Enabled frameworks: Hermes only
Current providers: 39
Current models: 263
Current lifecycle entries: Hermes only
Normalized providers: 39
Hermes canonical feed: 37 providers / 264 model entries
```

Guard behavior:

```text
Non-API-key provider activation: 409 provider_key_activation_unsupported
Unknown/non-framework provider:    404 provider_not_available
Removed local model mutation API:  404 not_found
```

The different canonical and normalized counts are expected: Hermes may expose duplicate/source-specific model entries while DMM normalizes framework bindings and provider aliases. DMM does not create local runtime truth.

### Dependency posture

```text
Production npm audit: 0 vulnerabilities
Full npm audit:       0 vulnerabilities
```

The runtime image installs only server production dependencies. Vite and TypeScript are absent from the runtime container.

### Container and host boundary

```text
Container user:       dmm (UID 999)
Privileged:           false
Read-only rootfs:     true
Capabilities dropped: ALL
No new privileges:    true
PID limit:            256
Memory limit:         512 MiB
CPU limit:            1 CPU
Container health:     healthy
DMM listener:         127.0.0.1:4100
Host helper listener: 127.0.0.1:4120
```

The writable surface is limited to the SQLite data bind mount and a bounded `/tmp` tmpfs.

### Host helper

The active helper exposes only:

- `hermes.version`;
- `hermes.updateStatus`;
- `hermes.catalogStatus`;
- `hermes.validateCredential`;
- `hermes.installCredential`.

Verified behavior:

```text
Missing helper token:       401 unauthorized
Retired OpenClaw operation: 403 operation_not_allowed
Hermes catalog status:      200
```

The helper uses a fixed operation allowlist, constant-time token comparison, bounded request bodies, validated provider IDs, subprocess argument arrays rather than shell interpolation, generic credential-install failures, loopback binding, and a hardened systemd sandbox.

### TLS and browser controls

Verified over public HTTPS:

- valid certificate;
- TLS 1.0 and 1.1 rejected;
- TLS 1.2 and 1.3 accepted;
- HTTP/2;
- HSTS;
- restrictive Content Security Policy;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- restrictive Permissions Policy;
- `Referrer-Policy: no-referrer`;
- API `Cache-Control: no-store`.

### Database, backup and restore

```text
Database directory: 0700, UID/GID 999:999
Database file:      0600, UID/GID 999:999
Backup directory:   0700, root:root
SQLite integrity:   ok
Foreign-key check:  clean
Journal mode:       WAL
```

Operational protection:

- backup every six hours via a persistent systemd timer;
- 56 verified backups retained;
- each backup uses SQLite's consistent `.backup` operation;
- each backup receives an integrity and foreign-key check;
- backups and metadata are private;
- every deployment creates a verified pre-deploy backup;
- restore creates an additional safety backup;
- restore stops DMM, removes stale WAL/SHM files, preserves database ownership, restores mode `0600`, starts DMM, waits for container health and executes operational health checks.

A real restore drill exposed and led to fixes for startup timing and restored-file ownership. The repeated final drill completed successfully through container stop, database restore, container start and operational health verification.

### Repository and secret hygiene

- `.env`, admin password, SQLite databases, backups and QA reports are excluded from Docker build context as appropriate;
- runtime secrets are not copied into the image;
- no sensitive runtime files are tracked by Git;
- targeted source scan reports zero Dashboard V3 references;
- targeted source scan reports zero FMR references;
- no TODO/FIXME/HACK markers remain in tracked source outside dependencies;
- audit history is capped at 5,000 entries;
- smoke-created sessions are destroyed on completion.

## Changes made during QA10

1. Upgraded vulnerable/outdated dependencies and reached zero npm audit findings.
2. Moved frontend build tooling out of production dependencies.
3. Narrowed runtime installation to server production dependencies.
4. Pinned the Node base image by digest and changed image installation to `npm ci`.
5. Excluded databases, backups, credentials and QA artifacts from Docker build context.
6. Bound DMM to loopback and configured trusted-proxy handling for Caddy.
7. Added HSTS and expanded permanent security smoke coverage.
8. Hardened the container with non-root execution, read-only root, dropped capabilities, resource limits and bounded tmpfs.
9. Reduced the host helper to the Hermes production allowlist and removed shell command construction.
10. Hardened helper and backup systemd services.
11. Enforced private database/backup permissions.
12. Added automatic verified backups and retention.
13. Made restore WAL-safe, ownership-safe, health-aware and fail-closed.
14. Added audit retention and QA session cleanup.
15. Fixed canonical nested-diff comparison and active-framework filtering for snapshots, diffs and lifecycle views.

## Residual risks and operating requirements

| Risk/requirement | Severity | Status |
|---|---|---|
| Backups are on the same VPS | Medium for total-site loss | External destination required for off-host replication. |
| Node built-in SQLite reports experimental API status | Low | Functionally covered by tests, integrity checks, backup and restore drill; monitor on Node upgrades. |
| Base image digest is intentionally fixed | Operational | Review and deliberately update it during dependency/security maintenance. |
| Hermes/API credential end-to-end validation depends on provider-issued keys | Expected | Production guard and adapter paths are tested without creating fake provider credentials; existing secrets are never exposed. |

## Release conclusion

DMM is ready for production operation on the current VPS and its application/runtime QA10 gate passes. Its only material infrastructure limitation is lack of off-host backup replication. A total VPS-loss recovery guarantee should not be claimed until an external backup target is attached and tested.
