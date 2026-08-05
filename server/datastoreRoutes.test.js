import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { backfillProbeAssets, createApiServer, persistProbeResult } from "./app.js";
import { createDatastore } from "./datastore.js";
import { buildReport } from "./reporting.js";

async function listen() {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-routes-"));
  const datastore = await createDatastore({ filePath: join(dir, "datastore.db") });
  const server = createApiServer({ datastore });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await datastore.close();
      await rm(dir, { force: true, recursive: true });
    },
  };
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { response, body: await response.json() };
}

test("serves datastore-backed asset detail and history routes", async () => {
  const api = await listen();

  try {
    const asset = await getJson(api.baseUrl, "/api/assets/1");
    assert.equal(asset.response.status, 200);
    assert.equal(asset.body.data.hostname, "api-gateway-prod-01");

    const history = await getJson(api.baseUrl, "/api/assets/1/history");
    assert.equal(history.response.status, 200);
    assert.equal(history.body.count, 1);
    assert.equal(history.body.data[0].source, "seed");

    const missing = await getJson(api.baseUrl, "/api/assets/999");
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "Asset not found" });
  } finally {
    await api.close();
  }
});

test("persists TLS probe certificate posture into asset history and findings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-tls-persist-"));
  const datastore = await createDatastore({ filePath: join(dir, "datastore.db") });

  try {
    await persistProbeResult(datastore, {
      id: "probe-tls-1",
      mode: "tls",
      status: "completed",
      createdAt: "2026-06-08T12:00:00.000Z",
      updatedAt: "2026-06-08T12:00:01.000Z",
      completedAt: "2026-06-08T12:00:01.000Z",
      target: {
        assetId: 1,
        host: "api-gateway-prod-01",
        port: 443,
      },
      result: {
        observedAt: "2026-06-08T12:00:01.000Z",
        source: "tls",
        protocol: {
          name: "TLSv1.2",
          cipher: "ECDHE-RSA-AES256-GCM-SHA384",
          perfectForwardSecrecy: true,
        },
        certificate: {
          subject: "CN=api-gateway-prod-01",
          issuer: "CN=Internal RSA CA",
          algorithm: "RSA-2048",
          expiresAt: "Jun 08 12:00:00 2027 GMT",
          fingerprint256: "AA:BB:CC",
        },
        classification: {
          label: "SHOR-CRITICAL",
          priority: "HIGH",
          quantumVulnerable: true,
          notes: ["Public-key cryptography is vulnerable to a future cryptographically relevant quantum computer"],
        },
        findings: ["Public-key cryptography is vulnerable to a future cryptographically relevant quantum computer"],
      },
      error: null,
    });

    const asset = await datastore.getAsset(1);
    assert.equal(asset.algo, "RSA-2048");
    assert.equal(asset.proto, "TLSv1.2");
    assert.equal(asset.cls, "SHOR-CRITICAL");
    assert.equal(asset.pfs, true);
    assert.equal(asset.cert_exp, "Jun 08 12:00:00 2027 GMT");

    const history = await datastore.listAssetHistory(1);
    const probeHistory = history.find((entry) => entry.source === "probe");
    assert.equal(probeHistory.reason, "tls-observation");
    assert.equal(probeHistory.asset.algo, "RSA-2048");
    assert.equal(history.at(-1).source, "risk-engine");

    const findings = await datastore.listFindings({ assetId: 1, source: "tls-probe" });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].severity, "HIGH");
    assert.equal(findings[0].type, "HNDL");
    assert.equal(findings[0].evidence.probeId, "probe-tls-1");
    assert.equal(findings[0].evidence.certificate.fingerprint256, "AA:BB:CC");
    assert.deepEqual(findings[0].evidence.evidenceRefs.map((ref) => ref.kind), ["probe-job", "audit-event"]);
    assert.equal(findings[0].evidence.evidenceRefs[1].id, "audit-3");

    const tlsAuditEvents = await datastore.listAuditEvents({
      entityType: "probe-job",
      action: "probe.tls_evidence_archived",
    });
    assert.equal(tlsAuditEvents.length, 1);
    assert.equal(tlsAuditEvents[0].id, "audit-3");
    assert.equal(tlsAuditEvents[0].correlationId, "probe-tls-1");
    assert.equal(tlsAuditEvents[0].metadata.evidenceKind, "tls-probe");
    assert.equal(tlsAuditEvents[0].metadata.fingerprint256, "AA:BB:CC");
    assert.equal(tlsAuditEvents[0].after.classification.label, "SHOR-CRITICAL");

    const neutralJob = {
      id: "probe-tls-2",
      mode: "tls",
      status: "completed",
      createdAt: "2026-06-08T12:10:00.000Z",
      updatedAt: "2026-06-08T12:10:01.000Z",
      completedAt: "2026-06-08T12:10:01.000Z",
      target: {
        assetId: 2,
        host: "vpn-concentrator-01",
        port: 443,
      },
      result: {
        observedAt: "2026-06-08T12:10:01.000Z",
        source: "tls",
        protocol: {
          name: "TLSv1.3",
          cipher: "TLS_AES_256_GCM_SHA384",
          perfectForwardSecrecy: true,
        },
        certificate: {
          subject: "CN=vpn-concentrator-01",
          issuer: "CN=Internal Hybrid CA",
          algorithm: "ML-DSA",
          expiresAt: "Jun 08 12:00:00 2027 GMT",
          fingerprint256: "DD:EE:FF",
        },
        classification: {
          label: "HYBRID",
          priority: "MONITOR",
          quantumVulnerable: false,
          notes: [],
        },
        findings: [],
      },
      error: null,
    };
    await persistProbeResult(datastore, neutralJob);
    const neutralFindings = await datastore.listFindings({ assetId: 2, source: "tls-probe" });
    assert.equal(neutralFindings.length, 1);
    assert.equal(neutralFindings[0].severity, "INFO");
    assert.equal(neutralFindings[0].type, "CRYPTO_OBSERVATION");
    assert.equal(neutralFindings[0].evidence.certificate.fingerprint256, "DD:EE:FF");

    await persistProbeResult(datastore, {
      ...neutralJob,
      id: "probe-tls-3",
      target: {
        assetId: 3,
        host: "legacy-auth",
        port: 443,
      },
      result: {
        ...neutralJob.result,
        certificate: {
          ...neutralJob.result.certificate,
          algorithm: "RSA-1024",
          fingerprint256: "EE:FF:00",
        },
        classification: {
          label: "DEPRECATED",
          priority: "HIGH",
          quantumVulnerable: true,
          notes: ["Deprecated certificate algorithm observed"],
        },
        findings: ["Deprecated certificate algorithm observed"],
      },
    });
    const deprecatedFindings = await datastore.listFindings({ assetId: 3, source: "tls-probe" });
    assert.equal(deprecatedFindings.length, 1);
    assert.equal(deprecatedFindings[0].severity, "HIGH");
    assert.equal(deprecatedFindings[0].type, "CRYPTO_DEPRECATED");

    const remediationReport = await buildReport("remediation", { datastore });
    const reportFinding = remediationReport.sections
      .find((section) => section.id === "findings")
      .items.find((item) => item.id === findings[0].id);
    assert.deepEqual(reportFinding.evidenceRefs.map((ref) => ref.kind), ["probe-job", "audit-event"]);
    assert.equal(remediationReport.evidenceRefs.some((ref) => ref.kind === "audit-event" && ref.id === "audit-3"), true);

    const evidenceArchive = await datastore.getEvidenceArchiveSummary({
      entityType: "probe-job",
      action: "probe.tls_evidence_archived",
    });
    assert.equal(evidenceArchive.auditChain.count, 3);
    assert.equal(evidenceArchive.auditChain.valid, true);

    const server = createApiServer({ datastore });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const probes = await getJson(baseUrl, "/api/probes");
      assert.equal(probes.response.status, 200);
      assert.deepEqual(probes.body.data.map((job) => job.id), ["probe-tls-1", "probe-tls-2", "probe-tls-3"]);

      const probe = await getJson(baseUrl, "/api/probes/probe-tls-2");
      assert.equal(probe.response.status, 200);
      assert.equal(probe.body.data.result.certificate.fingerprint256, "DD:EE:FF");

      const exportResponse = await fetch(`${baseUrl}/api/reports/remediation/exports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-qs-role": "auditor",
          "x-qs-actor": "auditor",
        },
        body: JSON.stringify({ createdBy: "auditor" }),
      });
      const exported = await exportResponse.json();
      assert.equal(exportResponse.status, 201);
      assert.equal(exported.data.evidenceRefs.some((ref) => ref.kind === "audit-event" && ref.id === "audit-3"), true);

      const manifest = await getJson(baseUrl, `/api/report-exports/${exported.data.id}/manifest`);
      assert.equal(manifest.response.status, 200);
      assert.equal(manifest.body.data.evidenceRefs.some((ref) => ref.kind === "probe-job" && ref.id === "probe-tls-1"), true);
      assert.equal(manifest.body.data.evidenceRefs.some((ref) => ref.kind === "audit-event" && ref.id === "audit-3"), true);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    await datastore.close();
    await rm(dir, { force: true, recursive: true });
  }
});

test("deduplicates recurring TLS findings and suppresses INFO observations from alerts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-tls-dedupe-"));
  const datastore = await createDatastore({ filePath: join(dir, "datastore.db") });

  const tlsJob = (id, observedAt, overrides = {}) => ({
    id,
    mode: "tls",
    status: "completed",
    createdAt: observedAt,
    updatedAt: observedAt,
    completedAt: observedAt,
    target: {
      assetId: overrides.assetId ?? 1,
      host: overrides.host ?? "api-gateway-prod-01",
      port: overrides.port ?? 443,
    },
    result: {
      observedAt,
      protocol: {
        name: "TLSv1.2",
        perfectForwardSecrecy: true,
      },
      certificate: {
        algorithm: overrides.algorithm ?? "RSA-2048",
        fingerprint256: overrides.fingerprint256 ?? "AA:BB:CC",
      },
      classification: {
        label: overrides.label ?? "SHOR-CRITICAL",
        priority: overrides.priority ?? "HIGH",
        quantumVulnerable: overrides.quantumVulnerable ?? true,
        notes: [],
      },
      findings: overrides.findings ?? ["Quantum-vulnerable certificate observed"],
    },
    error: null,
  });

  try {
    const first = await persistProbeResult(datastore, tlsJob("probe-dedupe-1", "2026-06-08T12:00:00.000Z"));
    const second = await persistProbeResult(datastore, tlsJob("probe-dedupe-2", "2026-06-08T12:10:00.000Z"));

    assert.deepEqual(second.directFindingIds, first.directFindingIds);

    let tlsFindings = await datastore.listFindings({ assetId: 1, source: "tls-probe" });
    assert.equal(tlsFindings.length, 1);
    assert.equal(tlsFindings[0].evidence.dedupeKey.length > 0, true);
    assert.equal(tlsFindings[0].evidence.recurrence.count, 2);
    assert.equal(tlsFindings[0].evidence.recurrence.firstObservedAt, "2026-06-08T12:00:00.000Z");
    assert.equal(tlsFindings[0].evidence.recurrence.lastObservedAt, "2026-06-08T12:10:00.000Z");
    assert.deepEqual(tlsFindings[0].evidence.recurrence.probeIds, ["probe-dedupe-1", "probe-dedupe-2"]);
    assert.deepEqual(tlsFindings[0].evidence.recurrence.fingerprints, ["AA:BB:CC"]);

    await datastore.updateFinding(tlsFindings[0].id, { status: "remediated", author: "analyst" });
    await persistProbeResult(datastore, tlsJob("probe-dedupe-3", "2026-06-08T12:20:00.000Z"));
    tlsFindings = await datastore.listFindings({ assetId: 1, source: "tls-probe" });
    assert.equal(tlsFindings.length, 1);
    assert.equal(tlsFindings[0].id, first.directFindingIds[0]);
    assert.equal(tlsFindings[0].status, "open");
    assert.equal(tlsFindings[0].evidence.recurrence.count, 3);

    await persistProbeResult(datastore, tlsJob("probe-dedupe-info", "2026-06-08T12:30:00.000Z", {
      assetId: 2,
      host: "vpn-concentrator-01",
      label: "HYBRID",
      priority: "MONITOR",
      quantumVulnerable: false,
      fingerprint256: "DD:EE:FF",
      findings: [],
    }));

    const server = createApiServer({ datastore });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const alerts = await getJson(baseUrl, "/api/alerts");
      assert.equal(alerts.body.data.every((alert) => alert.sev !== "INFO"), true);
      assert.equal(alerts.body.data.some((alert) => alert.findingId === tlsFindings[0].id), true);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  } finally {
    await datastore.close();
    await rm(dir, { force: true, recursive: true });
  }
});

test("creates and filters datastore-backed findings", async () => {
  const api = await listen();

  try {
    const createdResponse = await fetch(`${api.baseUrl}/api/findings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: 5,
        severity: "CRITICAL",
        type: "HNDL",
        title: "RSA key material requires migration",
      }),
    });
    const created = await createdResponse.json();

    assert.equal(createdResponse.status, 201);
    assert.equal(created.data.id, "finding-1");
    assert.equal(created.data.asset.hostname, "db-primary-finance");
    assert.equal(created.data.status, "open");
    assert.equal(created.data.priority, "CRITICAL");
    assert.equal(created.data.closedAt, null);
    assert.deepEqual(created.data.notes, []);

    const all = await getJson(api.baseUrl, "/api/findings");
    assert.equal(all.body.count, 1);

    const filtered = await getJson(api.baseUrl, "/api/findings?assetId=5");
    assert.deepEqual(filtered.body.data, [created.data]);

    const empty = await getJson(api.baseUrl, "/api/findings?assetId=1");
    assert.deepEqual(empty.body.data, []);
  } finally {
    await api.close();
  }
});

test("serves finding detail, lifecycle updates, notes, filters, and remediation summary", async () => {
  const api = await listen();

  try {
    const firstResponse = await fetch(`${api.baseUrl}/api/findings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: 5,
        severity: "CRITICAL",
        type: "HNDL",
        title: "RSA key material requires migration",
        source: "probe",
        dueAt: "2026-06-01T00:00:00.000Z",
      }),
    });
    const first = await firstResponse.json();

    const secondResponse = await fetch(`${api.baseUrl}/api/findings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: 1,
        severity: "HIGH",
        type: "PFS",
        title: "Perfect forward secrecy not observed",
        source: "risk-engine",
        status: "triaged",
        owner: "platform",
      }),
    });
    const second = await secondResponse.json();

    const detail = await getJson(api.baseUrl, `/api/findings/${first.data.id}`);
    assert.equal(detail.response.status, 200);
    assert.deepEqual(detail.body.data, first.data);

    const patchResponse = await fetch(`${api.baseUrl}/api/findings/${first.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "in_progress",
        owner: "crypto-team",
        priority: "P0",
        resolution: { ticket: "QS-42" },
        note: "Migration started",
        author: "analyst",
      }),
    });
    const patched = await patchResponse.json();

    assert.equal(patchResponse.status, 200);
    assert.equal(patched.data.status, "in_progress");
    assert.equal(patched.data.owner, "crypto-team");
    assert.equal(patched.data.priority, "P0");
    assert.deepEqual(patched.data.resolution, { ticket: "QS-42" });
    assert.equal(patched.data.notes[0].text, "Migration started");

    const noteResponse = await fetch(`${api.baseUrl}/api/findings/${first.data.id}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Waiting on maintenance window", author: "operator" }),
    });
    const noted = await noteResponse.json();
    assert.equal(noteResponse.status, 201);
    assert.equal(noted.data.notes.length, 2);
    assert.equal(noted.data.notes[1].author, "operator");

    const filtered = await getJson(api.baseUrl, "/api/findings?status=in_progress&owner=crypto-team&source=probe&severity=CRITICAL");
    assert.deepEqual(filtered.body.data.map((finding) => finding.id), [first.data.id]);

    const summary = await getJson(api.baseUrl, "/api/remediation/summary");
    assert.equal(summary.response.status, 200);
    assert.equal(summary.body.data.byStatus.in_progress, 1);
    assert.equal(summary.body.data.byStatus.triaged, 1);
    assert.equal(summary.body.data.byOwner["crypto-team"], 1);
    assert.equal(summary.body.data.byOwner.platform, 1);
    assert.equal(summary.body.data.openCritical, 1);

    const invalidResponse = await fetch(`${api.baseUrl}/api/findings/${first.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "invalid" }),
    });
    const invalid = await invalidResponse.json();
    assert.equal(invalidResponse.status, 400);
    assert.match(invalid.error, /finding status must be one of/);

    const missing = await getJson(api.baseUrl, "/api/findings/missing");
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "Finding not found" });

    const missingPatchResponse = await fetch(`${api.baseUrl}/api/findings/missing`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    const missingPatch = await missingPatchResponse.json();
    assert.equal(missingPatchResponse.status, 404);
    assert.deepEqual(missingPatch, { error: "Finding not found" });

    const secondDetail = await getJson(api.baseUrl, `/api/findings/${second.data.id}`);
    assert.equal(secondDetail.body.data.owner, "platform");
  } finally {
    await api.close();
  }
});

test("serves audit event collection, detail, and entity audit routes", async () => {
  const api = await listen();

  try {
    const createdResponse = await fetch(`${api.baseUrl}/api/findings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: 5,
        severity: "CRITICAL",
        type: "HNDL",
        title: "RSA key material requires migration",
        author: "analyst",
      }),
    });
    const created = await createdResponse.json();

    await fetch(`${api.baseUrl}/api/findings/${created.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "in_progress",
        owner: "crypto-team",
        author: "analyst",
      }),
    });

    const findingAudit = await getJson(api.baseUrl, `/api/findings/${created.data.id}/audit`);
    assert.equal(findingAudit.response.status, 200);
    assert.deepEqual(findingAudit.body.data.map((event) => event.action), [
      "finding.updated",
      "finding.created",
    ]);
    assert.equal(findingAudit.body.data[1].previousHash, null);
    assert.equal(findingAudit.body.data[0].previousHash, findingAudit.body.data[1].hash);

    const filtered = await getJson(api.baseUrl, "/api/audit-events?entityType=finding&actor=analyst");
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.body.count, 2);

    const detail = await getJson(api.baseUrl, `/api/audit-events/${findingAudit.body.data[0].id}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.entityId, created.data.id);

    const missing = await getJson(api.baseUrl, "/api/audit-events/missing");
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "Audit event not found" });
  } finally {
    await api.close();
  }
});

test("creates, lists, and retrieves datastore-backed CBOM snapshots", async () => {
  const api = await listen();

  try {
    const createdResponse = await fetch(`${api.baseUrl}/api/cbom/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "baseline",
        createdBy: "route-test",
        metadata: { ticket: "QS-ROUTE-1" },
      }),
    });
    const created = await createdResponse.json();

    assert.equal(createdResponse.status, 201);
    assert.equal(created.data.id, "cbom-1");
    assert.equal(created.data.cbom.count, 15);

    const list = await getJson(api.baseUrl, "/api/cbom/snapshots");
    assert.equal(list.body.count, 1);
    assert.equal(list.body.data[0].id, "cbom-1");
    assert.equal(list.body.data[0].count, 15);

    const detail = await getJson(api.baseUrl, "/api/cbom/snapshots/cbom-1");
    assert.deepEqual(detail.body.data, created.data);

    const missing = await getJson(api.baseUrl, "/api/cbom/snapshots/missing");
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "CBOM snapshot not found" });
  } finally {
    await api.close();
  }
});

test("persists completed probe observations into asset history and findings", async () => {
  const api = await listen();

  try {
    const probeResponse = await fetch(`${api.baseUrl}/api/probes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: 1, mode: "simulate" }),
    });
    const probe = await probeResponse.json();

    assert.equal(probeResponse.status, 201);
    assert.equal(probe.data.status, "completed");

    const history = await getJson(api.baseUrl, "/api/assets/1/history");
    assert.equal(history.body.count, 3);
    assert.equal(history.body.data[1].source, "probe");
    assert.equal(history.body.data[2].source, "risk-engine");

    const findings = await getJson(api.baseUrl, "/api/findings?assetId=1");
    assert.equal(findings.body.count, 2);
    assert.equal(findings.body.data[0].source, "risk-engine");
  } finally {
    await api.close();
  }
});

test("a direct TLS scan creates an inventory asset when the datastore starts empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-direct-tls-"));
  const datastore = await createDatastore({ filePath: join(dir, "evidence.db"), seedAssets: [] });
  try {
    const job = {
      id: "probe-public-endpoint",
      mode: "tls",
      status: "completed",
      createdAt: "2026-08-05T12:00:00.000Z",
      completedAt: "2026-08-05T12:00:01.000Z",
      target: { host: "www.dytallix.com", port: 443 },
      result: {
        observedAt: "2026-08-05T12:00:01.000Z",
        protocol: { name: "TLSv1.3", perfectForwardSecrecy: true },
        certificate: { algorithm: "RSA-2048", fingerprint256: "DD:YY:TT" },
        classification: { label: "SHOR-CRITICAL", priority: "HIGH", quantumVulnerable: true },
        findings: ["Quantum-vulnerable certificate observed"],
      },
    };

    await persistProbeResult(datastore, job);
    const assets = await datastore.listAssets();
    assert.equal(assets.length, 1);
    assert.equal(assets[0].hostname, "www.dytallix.com");
    assert.equal((await datastore.listFindings({ assetId: assets[0].id })).length > 0, true);
  } finally {
    await datastore.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("network discovery promotes TLS observations into inventory and findings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-discovery-assets-"));
  const datastore = await createDatastore({ filePath: join(dir, "evidence.db"), seedAssets: [] });
  try {
    await persistProbeResult(datastore, {
      id: "probe-network-ecc",
      mode: "discovery",
      status: "completed",
      createdAt: "2026-08-05T12:00:00.000Z",
      completedAt: "2026-08-05T12:00:02.000Z",
      target: { hosts: ["ecc256.badssl.com"], ports: [443] },
      result: {
        observations: [{
          observedAt: "2026-08-05T12:00:01.000Z",
          host: "ecc256.badssl.com",
          port: 443,
          status: "completed",
          reachability: { tcp: true, tls: true },
          protocol: { name: "TLSv1.2", perfectForwardSecrecy: true },
          certificate: { algorithm: "EC-prime256v1", fingerprint256: "EC:25:6" },
          classification: { label: "SHOR-CRITICAL", priority: "HIGH", quantumVulnerable: true },
          findings: ["Quantum-vulnerable certificate observed"],
        }],
      },
      error: null,
    });

    const assets = await datastore.listAssets();
    assert.equal(assets.length, 1);
    assert.equal(assets[0].hostname, "ecc256.badssl.com");
    assert.equal(assets[0].cls, "SHOR-CRITICAL");
    assert.equal((await datastore.listFindings({ assetId: assets[0].id })).length > 0, true);
  } finally {
    await datastore.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("device discovery promotes reachable non-TLS services for remediation follow-up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-device-assets-"));
  const datastore = await createDatastore({ filePath: join(dir, "evidence.db"), seedAssets: [] });
  try {
    await persistProbeResult(datastore, {
      id: "probe-device-local",
      mode: "device",
      status: "completed",
      createdAt: "2026-08-05T12:00:00.000Z",
      completedAt: "2026-08-05T12:00:02.000Z",
      target: { hosts: ["127.0.0.1"], ports: [3000] },
      result: {
        observations: [{
          observedAt: "2026-08-05T12:00:01.000Z",
          host: "127.0.0.1",
          port: 3000,
          status: "completed",
          reachability: { tcp: true, tls: false },
          classification: { label: "UNKNOWN", priority: "INFO", quantumVulnerable: false },
          findings: ["Reachable service did not present TLS evidence"],
        }],
      },
      error: null,
    });

    const assets = await datastore.listAssets();
    assert.equal(assets.length, 1);
    assert.equal(assets[0].hostname, "127.0.0.1");
    assert.equal(assets[0].cls, "UNKNOWN");
    assert.equal((await datastore.listFindings({ assetId: assets[0].id })).length > 0, true);
  } finally {
    await datastore.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("startup backfill promotes discovery scans saved before endpoint persistence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-probe-backfill-"));
  const datastore = await createDatastore({ filePath: join(dir, "evidence.db"), seedAssets: [] });
  try {
    await datastore.createProbeJob({
      id: "probe-legacy-network",
      mode: "discovery",
      status: "completed",
      createdAt: "2026-08-05T12:00:00.000Z",
      completedAt: "2026-08-05T12:00:02.000Z",
      result: { observations: [{
        observedAt: "2026-08-05T12:00:01.000Z",
        host: "ecc256.badssl.com",
        port: 443,
        status: "completed",
        reachability: { tcp: true, tls: true },
        protocol: { name: "TLSv1.2", perfectForwardSecrecy: true },
        certificate: { algorithm: "EC-prime256v1" },
        classification: { label: "SHOR-CRITICAL", priority: "HIGH", quantumVulnerable: true },
      }] },
    });

    assert.deepEqual(await backfillProbeAssets(datastore), { promoted: 1 });
    assert.equal((await datastore.listAssets())[0].hostname, "ecc256.badssl.com");
    assert.deepEqual(await backfillProbeAssets(datastore), { promoted: 0 });
  } finally {
    await datastore.close();
    await rm(dir, { recursive: true, force: true });
  }
});
