# DMM Production Operations

P10 defines the production operating model for DMM.

## Standard commands

Run from `/srv/dmm`.

```bash
npm run ops:health
npm run ops:backup
npm run ops:deploy
npm run ops:restore -- /srv/dmm/backups/dmm-YYYY.sqlite
```

## Health gate

`npm run ops:health` checks:

- Docker container is `running healthy`
- `/health` responds correctly
- security/no-cache headers are present
- SQLite integrity check returns `ok`
- DB file exists and is non-empty
- disk usage is below critical 95% threshold; >=90% is reported as a warning detail
- a backup less than 48h old exists

Report:

```text
qa-reports/ops-health.json
```

## Backup

`npm run ops:backup` creates a SQLite backup in:

```text
backups/dmm-<timestamp>.sqlite
backups/dmm-<timestamp>.sqlite.json
```

The backup script:

- uses SQLite `.backup` when available
- falls back to file copy if the CLI backup fails
- runs `PRAGMA integrity_check` on the backup
- retains the newest 14 backups by default

Optional env:

```bash
DMM_BACKUP_DIR=/srv/dmm/backups
DMM_BACKUP_RETENTION=30
```

## Deploy

`npm run ops:deploy` performs:

1. pre-deploy backup
2. full QA gate (`npm run qa`)
3. `docker compose up -d --build`
4. post-deploy ops health
5. optional live smoke if `DMM_QA_SMOKE=1`

Example live deploy gate:

```bash
set -a; source /srv/dmm/.env; set +a
DMM_QA_SMOKE=1 DMM_QA_BASE_URL=https://dmm.aquiero.com npm run ops:deploy
```

## Restore

Restore is explicit and requires a backup path:

```bash
npm run ops:restore -- /srv/dmm/backups/dmm-2026-06-04T10-00-00-000Z.sqlite
```

The restore script:

1. validates backup integrity
2. stops the DMM container
3. replaces `data/dmm.sqlite`
4. starts DMM
5. runs ops health

## Runtime

Docker Compose runs DMM as a host-networked service with:

- restart policy: `unless-stopped`
- healthcheck on `http://127.0.0.1:4100/health`
- JSON file log rotation (`10m`, 5 files)
- persistent data volume: `./data:/app/data`

## Manual checks

```bash
docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' dmm
curl -fsS http://127.0.0.1:4100/health
sqlite3 /srv/dmm/data/dmm.sqlite 'PRAGMA integrity_check;'
df -h /srv/dmm
```
