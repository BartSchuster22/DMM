# DMM architecture and behavior freeze

This document freezes the current DMM behavior before the Layer 3 adapter refactor continues. It also defines the naming rules used by the UI so future harness integrations stay modular.

## Layer model

DMM is structured as four layers:

1. **External provider/model sources**
   - External providers and model catalogs such as OpenRouter, DeepSeek, Anthropic, OpenAI, Groq, Z.ai, and similar sources.
   - DMM can ingest, seed, snapshot, and normalize this information, but external providers/models are not owned by DMM.

2. **Available harness instances**
   - Runtime/framework instances available on this machine or tenant instance.
   - Examples: Hermes, OpenClaw, and future harnesses.
   - This layer answers: which harnesses exist, where they are, whether they are enabled, health/version state, and base runtime capabilities.

3. **Harness <> DMM adapters**
   - The essential normalization boundary.
   - Each harness type has an adapter that maps harness-specific provider/model/credential/runtime state into DMM-normalized state.
   - Examples: `HermesAdapter`, `OpenClawAdapter`, future adapters.
   - DMM core and UI must not contain harness-specific file paths, CLI commands, or credential-store internals.

4. **DMM core + DMM UI**
   - Unified provider/model/credential/harness surface.
   - Owns DMM credential vault, audit, normalized catalog state, and UI rendering.
   - Consumes Layer 3 normalized output and adapter capabilities.

## Phase 1 behavior freeze

Current behavior to preserve during restructuring:

- Authentication, CSRF protection, and admin session behavior remain unchanged.
- Harness inventory remains driven by configured harness instances.
- Harness health, lifecycle/version checks, and update-driven catalog refresh remain unchanged.
- Catalog snapshots and diffs remain normalized through DMM server logic.
- Provider/model lists remain available through the existing `/api/providers`, `/api/providers/requirements`, and `/api/models` endpoints.
- DMM credential vault behavior remains unchanged:
  - raw credentials are accepted only through credential save actions,
  - raw credentials are encrypted server-side,
  - raw credentials are never returned by the API,
  - fingerprints/status are returned for display.
- Hermes API-key credential install remains real and supported through its adapter/host-helper path.
- OpenClaw provider/model discovery remains real, but OpenClaw credential install remains unsupported until its Layer 3 adapter implementation is explicitly added.
- Model status toggles remain DMM-local status controls; they do not change runtime primary/fallback model routing.
- Provider status toggles remain DMM-local provider availability controls; they do not by themselves install credentials into a harness.

## Phase 2 naming rules

Avoid vague UI/API wording that implies runtime deployment when an action only changes DMM-local state.

Preferred wording:

- **DMM provider status**: DMM-local provider availability/configuration state.
- **DMM model status**: DMM-local model availability/enabled/disabled state.
- **DMM credential**: credential saved in DMM vault.
- **Harness credential state**: what a specific harness reports or what DMM last installed/validated for that harness.
- **Install to harness**: an adapter-supported operation that writes/installs a credential into a harness runtime.
- **Validate credential**: an adapter-supported validation operation.
- **Discovered by harness**: provider/model appears in a harness catalog/status scan.

Avoid or qualify these terms:

- **Enable provider**: ambiguous. Use **Mark available in DMM** or **Disable in DMM**.
- **Enable model**: ambiguous. Use **Enable in DMM** or **Disable in DMM**.
- **Provider deployment enabled**: ambiguous. State the specific harness: **credential install supported for Hermes**, **credential install unsupported for OpenClaw**, etc.

## Layer 3 adapter direction

The next refactor should strengthen the adapter contract, not add harness-specific UI patches. Every new harness should be added by implementing a Layer 3 adapter that reports normalized capabilities and state.

DMM core/UI should ask adapters:

- What providers/models do you discover?
- What credential state do you report?
- Can you validate credentials?
- Can you install credentials?
- Can you remove credentials?
- Do you need reload/restart after install?

DMM UI should render the normalized answer without embedding harness internals.

## Phase 3 adapter contract

Layer 3 adapters implement the `HarnessDmmAdapter` contract in `server/src/adapters/types.ts`.

The contract formalizes these boundaries:

- adapters expose capabilities through `capabilities()`;
- adapters normalize provider discovery through `discoverProviders()`;
- adapters normalize model discovery through `discoverModels()`;
- adapters can optionally report credential state through `getCredentialState()`;
- adapters validate/install/remove credentials only through explicit credential operations;
- adapters may expose version/update/catalog refresh operations when supported.

The compatibility alias `HarnessAdapter = HarnessDmmAdapter` is kept so existing Hermes/OpenClaw code remains stable while the refactor proceeds.

## Phase 4 normalized state model

DMM now exposes a normalized state view through:

```text
GET /api/normalized-state
```

This view separates:

- Layer 1 external provider/model source metadata;
- Layer 2 configured harness instance identity;
- Layer 3 harness adapter capability/state;
- Layer 4 DMM provider/credential/UI state.

The initial normalized view is additive. Existing provider/model/requirement endpoints remain available to preserve current behavior.

## Phase 5 UI normalized rendering

The Providers page now consumes the normalized state endpoint for provider cards. The UI renders DMM credential state and harness credential state from the normalized view instead of deriving wording directly from legacy provider/requirements arrays.

This is intentionally incremental: legacy endpoints remain loaded because model details and existing actions still depend on them. The Provider cards are the first Layer 4 surface moved to normalized state.

## Phase 6 OpenClaw credential install

OpenClaw credential validation/install is implemented through the Layer 3 OpenClaw adapter and the DMM host helper.

Behavior:

- OpenClaw adapter advertises `credentialValidation` and `credentialInstall` as supported.
- DMM calls host-helper operations:
  - `openclaw.validateCredential`
  - `openclaw.installCredential`
- API-key BYOK install is supported for allowlisted API-key providers such as OpenRouter, Anthropic, DeepSeek, OpenAI, Groq, Z.ai, and similar providers.
- OAuth providers such as `openai-codex` remain unsupported for BYOK API-key install.
- DMM does not select primary/fallback/runtime model routing. It only installs provider credentials into OpenClaw's auth profile/config state.

OpenClaw files touched by install:

```text
/home/alice/.openclaw/agents/main/agent/auth-profiles.json
/home/alice/.openclaw/openclaw.json
```

Safety rules:

- raw credentials are never returned to the DMM UI/API response;
- the helper writes JSON directly instead of passing secrets on a CLI command line;
- existing OAuth profiles are preserved;
- backups are created before overwriting existing OpenClaw files;
- writes are atomic per file;
- install verification checks the profile entry exists after writing.
