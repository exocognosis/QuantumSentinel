# QuantumSentinel Demo Guide

QuantumSentinel is a local demo assessment utility.

It shows how post-quantum cryptography evidence can move from authorized scans
into a cryptographic bill of materials, readiness score, findings, and
migration plan.

It is not a certification tool.
It is not a complete enterprise scanner.
It is not a compliance attestation system.

## Demo Goal

Use this demo to show this flow:

1. Enter organization context.
2. Select a Q-Day horizon.
3. Run one or more authorized scans.
4. Review the CBOM and Q-Day Readiness Score.
5. Review scan-specific results.
6. Open the migration plan.
7. Export the report package.

## Clean Start

Start a new demo session with no prior evidence:

```sh
npm start
```

The default launcher uses a clean session datastore.
Prior evidence does not load on restart.

Use persistent evidence only when you explicitly need it:

```sh
QS_PERSIST_EVIDENCE=1 npm start
```

Use a fully isolated session when testing:

```sh
QS_NO_OPEN=1 npm run fresh
```

## Demo Walkthrough

### 1. Onboarding

Open **Onboarding**.

Enter:

- organization name,
- industry,
- geography,
- organization size,
- regulated data types.

Select a Q-Day horizon in **Settings** if the default scenario is not correct.

### 2. Scan

Open **Scan**.

Select one scan type:

- **Public website**: tests one authorized internet-facing TLS endpoint.
- **This device**: tests bounded loopback services on the current machine.
- **Authorized network**: tests only entered hosts and bounded ports.

Run the scan.

Do not scan systems that you do not own or do not have permission to test.

### 3. Results

Open **Results**.

Use **Results for** to select:

- overall organization,
- one public website scan,
- one device scan,
- one authorized network scan.

Review:

- observed assets,
- CBOM components,
- priority findings,
- score drivers,
- evidence boundary.

Generate or download the CBOM.

### 4. Plan

Open **Plan**.

Use **Plan for** to select the same scope.

Review:

- decision state,
- path forward,
- generated recommendations,
- owned actions,
- reports and decisions.

Create an owned action when a generated recommendation has a real owner,
target state, deadline, and evidence requirement.

### 5. Export

Download the PQC migration plan.

Use the export as a demo report package.
Do not describe it as a formal compliance attestation.

## Evidence Boundaries

Public website scans observe one public TLS endpoint.
They do not prove the internal cryptographic inventory.

Device scans observe bounded loopback TCP/TLS services.
They do not inspect files, applications, package inventories, stored keys, or
all local ports.
Reachable non-TLS services appear as migration review components.
They are not confirmed cryptographic components until follow-up evidence exists.

Authorized network scans test only the supplied hosts and ports.
They do not discover unknown devices or scan a full network.

Repository scans classify source evidence.
They do not execute the code or prove runtime cryptographic behavior.

The Q-Day Readiness Score is a prioritization aid.
It is not a certification.

## Reset And Uninstall

Stop the app with `Ctrl+C`.

Remove persistent evidence:

```sh
rm -rf .quantumsentinel
```

Remove the local checkout:

```sh
cd ..
rm -rf QuantumSentinel
```

## Demo Ship Gate

Before each demo release, run:

```sh
npm ci --no-audit --no-fund
npm run build
npm run lint
npm test
npm run smoke
npm run smoke:runtime
```

Then run a clean start and verify:

- dashboard opens,
- API health is OK,
- no old evidence appears,
- public website scan completes,
- CBOM export works,
- Results scope selector works,
- Plan scope selector works,
- PDF and JSON exports work.
