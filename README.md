# DMM — Direct Model Management

DMM is the operator interface for provider and model information reported by configured agent frameworks.

## Ownership contract

- The configured agent framework is the source of truth for provider availability, model inventory, and runtime credential state.
- In the current deployment, the configured framework is **Hermes**.
- DMM does not seed provider/model inventory and does not own model routing.
- DMM can accept a provider-issued API key for a framework-reported `api_key` provider, encrypt it in the DMM vault, and delegate activation to the framework adapter.
- Static provider metadata is enrichment only; it cannot make a provider appear available.

## Current operations

- refresh framework health, lifecycle, and catalog state;
- inspect framework-reported providers and models;
- inspect primary/fallback model roles reported by the framework;
- activate or rotate supported provider API keys through the framework adapter;
- validate stored keys without returning raw secrets;
- inspect catalog snapshots, diffs, and audit events.

## Run locally

```bash
npm install
npm run build
DMM_SESSION_SECRET=dev-session-secret DMM_MASTER_KEY=dev-master DMM_ADMIN_PASSWORD=change-me npm start -w @dmm/server
```

Open `http://127.0.0.1:3000`.
