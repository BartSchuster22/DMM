# DMM development rules

- Standalone service. Agent frameworks are the source of truth for provider and model availability.
- DMM is the operator interface for framework-discovered provider/model information and provider-key activation.
- Adapter modules must be isolated and removable.
- Raw provider credentials must never be returned to the browser or written to logs.
