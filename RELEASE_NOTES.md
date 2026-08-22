# QuantumSentinel v0.1.1-demo

## Release Type

Demo product release.

## Positioning

QuantumSentinel is a local demo assessment utility for post-quantum
cryptography and Q-Day migration planning.

It turns authorized scan evidence into:

- a cryptographic bill of materials,
- a Q-Day Readiness Score,
- scan-specific results,
- priority findings,
- a migration plan,
- exportable report packages.

## What This Release Proves

- The public README includes the launch tagline, badges, quick start commands,
  embedded demo video, GIF fallback, limitations, contributor labels, and
  repository topics.
- The repository includes an MIT license, GitHub CI workflow, shell installer,
  and Windows PowerShell installer.
- The app starts from source with `npm start`.
- The dashboard and API run locally.
- The default datastore is session-only.
- Public website, device, authorized network, and repository evidence can feed
  the assessment workflow.
- Results and Plan can switch between organization-wide and scan-specific scope.
- Default HTTPS port `443` is hidden in display labels.
- Non-default ports remain visible.
- Generated recommendations are distinct from owned migration actions.
- Report and CBOM exports are available for demo review.

## What This Release Does Not Prove

- Complete internal cryptographic inventory.
- Enterprise deployment readiness.
- Multi-user access control.
- Tenant isolation.
- Formal compliance attestation.
- Continuous production monitoring.
- Full network discovery.
- Full endpoint software, key, package, and application inspection.

## Required Local Verification

Run:

```sh
npm ci --no-audit --no-fund
npm run build
npm run lint
npm test
npm run smoke
npm run smoke:runtime
```

Then verify a clean demo session:

```sh
QS_NO_OPEN=1 npm run fresh
```

The session must start with no prior evidence.

## Known Limits

- Scan evidence is bounded by the selected mode.
- Reports are local point-in-time outputs.
- Scheduler controls are local runtime primitives.
- Persistent evidence is opt-in.
- Production deployment needs authentication, authorization, service
  supervision, evidence retention policy, integrity controls, and operational
  alerting.
