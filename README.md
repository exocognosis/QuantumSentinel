# QuantumSentinel

Local prototype for a post-quantum cryptography readiness dashboard and assessment appliance.

## Product State

QuantumSentinel currently runs as a local React dashboard backed by a Node API and persistent local datastore. It is suitable for MVP demos, local assessment workflows, and API/client development. It is not yet a production appliance.

Implemented capabilities:

- Dashboard views for executive risk, topology, asset inventory, threats, compliance, API posture, probe activity, drift, monitor policies, and recent monitor runs.
- API server for assets, alerts, compliance, trends, summary metrics, CBOM output, findings, probes, monitor policies, monitor run history, monitor health, and scheduler controls.
- Persistent datastore under `.quantumsentinel/`, using Node SQLite when available with a JSON fallback path in the datastore layer.
- Probe engine for seeded asset simulation, TLS endpoint inspection, and bounded TCP discovery sweeps.
- Risk engine for cryptographic posture classification, HNDL/TNFL scoring, remediation guidance, finding generation, recomputation, and asset/portfolio drift detection.
- Monitor policy model with enablement, cadence, next-run timestamps, manual runs, due-policy selection, scheduled-run primitives, duplicate-run guards, and run history.
- Remediation/finding lifecycle slice covering finding ownership, lifecycle status, operator notes, remediation summaries, console surfacing, and datastore/API persistence.
- Reporting and evidence export slice for executive, compliance, remediation, CBOM, and full evidence package JSON reports.

Status:

- Local MVP after this slice: about 84% complete.
- Production product after this slice: about 34% complete.
- Main remaining gaps: authenticated multi-user operation, hardened deployment, role/tenant boundaries, production-grade scheduler service controls, richer discovery coverage, alert delivery, integration connectors, formal approval workflow, audit trails, signed or immutable evidence archives, and production observability.

## Run Locally

```sh
npm install
npm run build
npm run api
npm run web
```

Open `http://127.0.0.1:5173`.

The API listens on `http://127.0.0.1:8787`; the web server proxies `/api` to that API. Set `HOST`, `PORT`, or `QS_DATASTORE_PATH` when you need a different bind address, API port, or datastore file.

## Development Commands

```sh
npm run dev
npm run build
npm run lint
npm run smoke
npm run smoke:runtime
npm test
npm run test:api
npm run test:probes
```

`npm run smoke` performs a bounded static smoke check for core source files only. `npm run smoke:runtime` exercises datastore-backed probe persistence, finding recurrence, monitor run summaries, reports, and alert API projections with a temporary loopback API listener that closes before exit.

## Operational API Notes

Common read surfaces include health, assets, summary, CBOM, findings, drift, probes, monitor policies, monitor runs, monitor health, and scheduler status under `/api/*`.

Findings:

- `GET /api/findings` lists persisted findings. `assetId` filters findings for a single asset.
- `POST /api/findings` creates a manual or workflow-sourced finding when the datastore is configured.
- Finding records carry asset identity, severity, type, title, description, evidence, source, lifecycle status, observed/created timestamps, and the remediation lifecycle fields added by this slice: owner, notes, and remediation summary.
- `GET /api/assets/:id/risk` returns analysis, drift context, and asset findings. `POST /api/risk/recompute` recomputes risk and persists generated findings.

Remediation summary:

- Risk-generated findings include remediation guidance with action, target, detail, and complexity.
- The remediation lifecycle uses ownership, status, notes, and summary fields for operator handoff. Keep notes operational: what changed, evidence reviewed, next action, and blocker.
- Current lifecycle status is datastore-backed and API-visible; formal approvals, RBAC, and audit trails are still production gaps.

Reports:

- `/api/reports/*` endpoints are the operational surface for JSON report generation and evidence export.
- Supported report families are executive, compliance, remediation, CBOM, and full evidence package reports.
- Treat report responses as point-in-time evidence assembled from the local datastore: assets, findings, risk analysis, compliance posture, CBOM snapshots, probe activity, monitor runs, drift, and remediation state.
- Use the full evidence package when exporting a complete assessment record. Use the narrower report families for role-specific review packets.
- Current exports are local JSON artifacts. Production use still needs authorization, retention policy, integrity protection, and delivery workflow.

Probe creation accepts a request body that identifies the probe mode:

- Simulated asset probe: target a known local seed/datastore asset.
- TLS probe: inspect a specific host and port with a bounded timeout.
- Discovery probe: scan a bounded host list and port with a bounded timeout.

Monitors:

- `GET /api/monitors` lists monitor policies. `POST /api/monitors` creates a policy from `name`, `enabled`, `intervalSeconds`, and `probeRequest`.
- `GET /api/monitors/:id` reads a policy. `PATCH /api/monitors/:id` or `POST /api/monitors/:id` updates policy fields.
- `POST /api/monitors/:id/run` runs a policy immediately and persists the probe job plus monitor run record.
- `GET /api/monitor-runs` lists runs, with `policyId` and `status` filters. `GET /api/monitors/:id/runs` lists runs for one policy.
- `GET /api/monitor-health` returns policy and run counters: total, enabled, due, running, recent failures, and last run time.

Scheduler:

- `GET /api/scheduler` reads runtime status.
- `POST /api/scheduler/start` and `POST /api/scheduler/stop` control the local scheduler loop.
- `POST /api/scheduler/tick` runs one bounded due-policy pass and records the tick result.
- `PATCH /api/scheduler/config` or `POST /api/scheduler/config` updates `tickIntervalSeconds` and `maxRunsPerTick`.
- Treat the scheduler as local runtime control. Production deployment still needs service supervision, authorization, alerting, and audit coverage.

## Local State

- Runtime datastore files are written under `.quantumsentinel/`.
- `dist/` is generated by `npm run build` and served by `npm run web`.
- `node_modules.*` directories are generated dependency backups and ignored.
- Probe jobs, asset history, findings, CBOM snapshots, monitor policies, and monitor runs are persisted when the API is started with a datastore.

## Product Gap

The next product work is to turn the local scheduler primitives into an operational automation daemon, broaden active discovery beyond bounded TCP/TLS checks, and harden the lifecycle workflow with approvals, integrations, evidence integrity, auditability, and secure deployment.
