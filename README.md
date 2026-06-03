# DMM — Direct Model Management

Standalone, future-mergeable Instance Management section for provider/model discovery, BYOK credentials, model availability state, health, and audit.

## Current stage

Universal section skeleton + login + server/auth/SQLite foundation.

## Run locally

```bash
npm install
npm run build
DMM_SESSION_SECRET=dev-session-secret DMM_MASTER_KEY=dev-master DMM_ADMIN_PASSWORD=change-me npm start -w @dmm/server
```

Open http://127.0.0.1:3000
