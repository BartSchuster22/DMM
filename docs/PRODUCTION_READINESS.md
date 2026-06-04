# DMM production readiness assessment

Generated: 2026-06-04

## Scope

This document records the additional readiness phase after the Layer 1-4 restructuring and OpenClaw credential-install work.

Goal: identify what is complete and what remains before DMM can be considered full production readiness **QA10/10**.

## Current status summary

Status: **not yet QA10/10**.

Current readiness score: **QA8/10**.

Reason: the codebase passes local QA and live smoke for the currently deployed service, but the latest Phase 3-6 code has **not been deployed**, disk usage is at the critical threshold, and final post-deploy authenticated verification has not been run against the updated production container.

## Evidence collected

### Source QA

Command:

```bash
sudo -u dmm -H npm run qa
```

Result:

```text
PASS
- typecheck: PASS
- tests: 15 passed, 0 failed
- build: PASS
```

Report:

```text
/srv/dmm/qa-reports/qa-summary.json
```

### Public live authenticated smoke

Command:

```bash
sudo bash -lc 'set -a; source /srv/dmm/.env; set +a; DMM_QA_BASE_URL=$DMM_PUBLIC_URL DMM_QA_JSON=/srv/dmm/qa-reports/public-smoke-auth.json npm run qa:smoke'
```

Result:

```text
PASS — 15 passed, 0 failed
```

Report:

```text
/srv/dmm/qa-reports/public-smoke-auth.json
```

### Runtime checks

Observed:

```text
Docker container dmm: running healthy
/health: HTTP 200
Caddy: active
Caddy config: valid
Public HTTPS /health: HTTP/2 200
DMM DB integrity: ok
DMM DB: 2 harnesses, 42 providers, 269 models
Recent DMM backup: exists
DMM host helper: active
```

### Current deployed code state

The currently deployed container does **not** expose the new endpoint:

```text
GET /api/normalized-state -> 404
```

Therefore the latest Phase 3-6 work is verified in source/build/tests, but it is **not yet deployed to production**.

## Blockers for QA10/10

### 1. Deploy latest Phase 3-6 code

Required because the running DMM container is behind the current source tree.

Evidence:

```text
/api/normalized-state returns 404 on the running service
```

Required action after approval:

```bash
cd /srv/dmm
sudo bash -lc 'set -a; source /srv/dmm/.env; set +a; cd /srv/dmm; DMM_QA_SMOKE=1 DMM_QA_BASE_URL=$DMM_PUBLIC_URL npm run ops:deploy'
```

This performs backup, QA, docker build/up, ops health, and live smoke.

### 2. Free disk space below the critical threshold

Observed:

```text
/dev/sda1 capacity: 95%
```

Current ops-health requires disk usage below 95%.

Recommended safe cleanup target:

```text
free at least 5-8 GiB before production deploy
```

Likely reclaimable area:

```text
Docker build cache: ~6.48 GiB reclaimable
Docker images: ~1.05 GiB reclaimable
```

Suggested command after approval:

```bash
docker builder prune -af
```

Do not prune volumes without explicit review.

### 3. Run post-deploy authenticated QA against the updated production container

Required endpoints after deploy:

```text
/api/normalized-state -> 200
/api/providers -> 200
/api/providers/requirements -> 200
/api/models -> 200
/api/catalog/lifecycle -> 200
/api/catalog/snapshots -> 200
/api/catalog/diffs -> 200
/api/audit -> 200
```

### 4. Verify OpenClaw credential install against real OpenClaw only with explicit test key

The helper was tested safely in a temp directory. Real install should be tested only with a deliberate non-production or approved provider key.

Required acceptance:

```text
- DMM saves BYOK credential
- OpenClaw adapter reports install supported
- OpenClaw auth profile appears for provider
- existing OpenClaw OAuth profiles remain intact
- DMM API/UI never returns raw secret
- catalog refresh reflects installed/saved state
```

### 5. Commit or package the change set

The source tree has many uncommitted changes from the staged restructuring. QA10/10 should have a clean, traceable deployment artifact.

Required:

```bash
cd /srv/dmm
git status --short
git diff --check
git add ...
git commit -m 'Formalize DMM adapter layers and OpenClaw credential install'
```

## Non-blocking improvements for QA10+ hardening

- Extend smoke to include `/api/normalized-state` explicitly.
- Extend smoke to verify OpenClaw adapter capability flags after deploy.
- Add a no-secret scan to generated catalog snapshots and normalized state.
- Add a scripted rollback drill using the latest backup.
- Add a scheduled backup/health cron or systemd timer if not already managed elsewhere.
- Add disk alerting before 90% instead of waiting for ops-health failure.
- Add a deploy preflight that refuses deploy when disk is >=95%.

## QA10/10 checklist

- [x] source typecheck passes
- [x] source tests pass
- [x] source build passes
- [x] current public service smoke passes
- [x] database integrity is ok
- [x] recent backup exists
- [x] Caddy/public HTTPS route is valid
- [x] host helper is active
- [ ] disk usage is below critical threshold
- [ ] latest Phase 3-6 code is deployed
- [ ] deployed service exposes `/api/normalized-state`
- [ ] post-deploy authenticated smoke passes against public URL
- [ ] ops-health passes after deploy
- [ ] OpenClaw credential install is verified with an approved real/test key
- [ ] release/change set is committed or otherwise checkpointed

## Recommended next action

Do **not** deploy until disk space is fixed.

Recommended order:

1. Free Docker build cache.
2. Re-run `npm run ops:health` as root or from the deploy script.
3. Deploy latest DMM with `DMM_QA_SMOKE=1`.
4. Verify `/api/normalized-state` is live.
5. Run public authenticated smoke.
6. Test OpenClaw credential install with approved test key.
7. Commit/tag the release.
