# DMM development rules

- Standalone service. Never wire to DashboardV3.
- Keep UI and API merge-ready for a future central Instance Management Dashboard.
- Adapter modules must be isolated and removable.
- Raw provider credentials must never be returned to the browser or written to logs.
