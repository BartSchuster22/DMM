# DMM QA Automation

P9 establishes the automated quality gate for Direct Model Management.

## Local gates

Run the non-live gate before merging code:

```bash
npm run qa
```

This executes, in order:

1. `npm run typecheck`
2. `npm test`
3. `npm run build`

A machine-readable summary is written to:

```text
qa-reports/qa-summary.json
```

## Live smoke gate

Run against a deployed DMM instance:

```bash
DMM_QA_BASE_URL=https://dmm.aquiero.com \
DMM_ADMIN_USER=admin \
DMM_ADMIN_PASSWORD='...' \
DMM_QA_JSON=qa-reports/live-smoke.json \
npm run qa:smoke
```

The smoke gate verifies:

- `/health` service health
- frontend shell asset references
- security headers and API no-cache headers
- unauthenticated protected-route rejection
- login and hardened cookie flags
- CSRF rejection on mutating calls without token
- authenticated API contracts for harnesses, providers, requirements, models, catalog, audit
- catalog refresh action
- secret-like value leakage scan on API responses

## Full gate

Run build/test plus live smoke:

```bash
DMM_QA_SMOKE=1 DMM_QA_BASE_URL=https://dmm.aquiero.com DMM_ADMIN_PASSWORD='...' npm run qa:full
```

## CI

The GitHub Actions workflow in `.github/workflows/qa.yml` runs the non-live gate on pushes and pull requests. Live smoke is intentionally opt-in because it requires deployment credentials.
