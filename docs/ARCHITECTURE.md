# DMM architecture and ownership contract

## Authority

Agent frameworks own provider/model/credential truth. DMM is an operations and presentation layer over configured framework adapters.

The current production configuration contains one active framework: **Hermes**.

DMM must never:

- create provider or model availability from a local seed catalog;
- present records from inactive frameworks as currently available;
- maintain a parallel model-routing policy;
- label local metadata changes as runtime activation;
- accept a key for a provider that the active framework does not report;
- install an API key for a provider whose framework auth type is not `api_key`.

## Layers

1. **Provider/model services** — external services represented by the framework catalog.
2. **Agent framework instances** — currently Hermes; additional adapters may be configured later.
3. **Framework adapters** — normalize health, catalog, credential validation, and credential installation.
4. **DMM core and UI** — read models/providers, display observed state, protect credentials, invoke supported adapter operations, and audit actions.

## Catalog flow

1. DMM invokes the configured framework adapter.
2. The adapter reads the framework's canonical provider/model registry and active configuration.
3. DMM stores a timestamped snapshot and diff.
4. Current provider/model views include only records with an active binding to an enabled framework.
5. Missing framework records are marked removed and disappear from current views; historical snapshots remain audit evidence.
6. Static provider manifests can enrich a discovered provider with a documentation URL. They cannot insert a provider or model.

For Hermes, the adapter reads canonical provider/model information through the allowlisted host-helper operation `hermes.catalogStatus`.

## Provider-key activation

1. The user selects a provider reported by an enabled framework.
2. DMM verifies that the framework reports `auth_method=api_key`.
3. DMM validates and encrypts the submitted key in its vault.
4. DMM delegates installation to the provider's active framework binding.
5. The adapter reports per-framework and aggregate results.
6. DMM stores only status/fingerprint data for UI output; raw keys are never returned.

Deleting the DMM vault copy does not claim to remove a credential already installed in a framework. Framework credential removal requires an explicit adapter capability and is outside the current operation set.

## Model state

Model state is observed, not controlled by DMM. Current normalized statuses include:

- `available`
- `configured_default`
- `configured_fallback`
- `disabled`
- `deprecated`
- `unavailable`

DMM has no model enable/disable API. Runtime defaults and fallback order remain framework-owned.

## Adapter boundary

Adapters may expose:

- health/version/update status;
- provider/model discovery and catalog refresh;
- provider-key validation and installation;
- future explicit credential removal or reload capabilities.

Framework-specific paths, CLI commands, and credential formats stay behind adapters and the allowlisted host helper.

## Security invariants

- Authentication and CSRF protection cover administrative APIs.
- Raw provider keys are encrypted at rest and never returned or logged.
- API responses redact fields whose names indicate secrets, keys, tokens, passwords, or credentials.
- Key activation is rejected for undiscovered, removed, inactive, or non-API-key providers.
- Every key save, validation, installation result, and deletion is audited.
