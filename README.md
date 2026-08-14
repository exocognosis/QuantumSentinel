# QuantumSentinel

An evidence-backed post-quantum cryptography readiness dashboard and assessment appliance.

## Install and launch

Use the one-command installer for the normal first-run path:

```sh
curl -fsSL https://raw.githubusercontent.com/exocognosis/QuantumSentinel/main/install.sh | sh
```

That single command downloads Quantum Sentinel into `./QuantumSentinel`, installs its dependencies, builds it, starts the API and dashboard, and opens the verified local dashboard URL. It starts at `http://127.0.0.1:5173` and automatically selects the next available port when another application is already using it. Press `Ctrl+C` to stop it. Run the same command later to update and relaunch it safely.

Requirements: Git and Node.js 20.19 or newer. To choose a different installation location, set `QS_INSTALL_DIR` before the command.

Use GitHub **Download ZIP** only when you want to inspect the source without running the installer. If you choose the ZIP path, unzip it, open a terminal in the extracted folder, run `npm ci`, run `npm run build`, and then run `npm start`.

## Q-Day Repository Scanner

QuantumSentinel includes an evidence-backed static scanner for cryptographic migration discovery. It identifies deprecated cryptography, Shor-vulnerable public-key references, post-quantum algorithms, and quantum-resistant symmetric/hash primitives without collapsing those categories into a single "safe" label.

```sh
npm run scan -- /path/to/repository
npm run scan -- /path/to/repository --output quantum-readiness.json
npm run scan -- /path/to/repository --html quantum-readiness.html
npm run scan -- /path/to/repository --datastore .quantumsentinel/datastore.db
```

Every observation includes its file, line, evidence confidence, likely usage context, rationale, and migration guidance. The readiness score is transparent and deliberately assigns lower weight to documentation and dependency references. It is a prioritization aid, not a certification or substitute for runtime and architectural review.

The optional `--datastore` mode ingests repository evidence into the existing asset inventory, remediation queue, CBOM snapshots, audit chain, and report APIs. Files are read only by the local CLI; the HTTP API does not expose an arbitrary filesystem-scanning endpoint.

## Authorized External Domain Scanning

Scan the publicly observable cryptographic posture of an explicitly authorized domain:

```sh
npm run scan-domain -- example.com --ports 443,8443 --output example-qday.json --html example-qday.html
```

Domain scans are limited to an allowlist of implicit-TLS service ports (`443`, `465`, `636`, `853`, `993`, `995`, `8443`, and `9443`), use strict connection timeouts, and do not crawl, exploit, or test general web vulnerabilities. Results describe the observed edge; CDNs, proxies, origin services, internal systems, runtime fallback, and third-party trust paths remain separate evidence boundaries.

Public-sector or critical-infrastructure comparisons should be based on authorized, rate-limited observations and described as **external Q-Day posture**, not proof of an organization's internal security. A classical public edge warrants an internal inventory; it does not establish what that inventory will find.

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
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:5173`.

The launcher starts both services and opens the dashboard. The API listens on `http://127.0.0.1:8787`; the web server proxies `/api` to that API. Set `HOST`, `PORT`, `WEB_PORT`, `QS_NO_OPEN=1`, or `QS_DATASTORE_PATH` when you need a different bind address, API port, dashboard port, browser behavior, or datastore file.

`npm start` resumes the current local assessment, including its scans, scores,
findings, and reports. To start a clean isolated assessment without deleting or
changing the existing evidence store, run:

```sh
npm run fresh
```

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
