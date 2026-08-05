import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { ASSETS } from "../src/mockData.js";
import { QuantumSentinelDatastore, buildCbomFromAssets, createDatastore } from "./datastore.js";

async function withTempStore(testName, fn, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), `quantumsentinel-${testName}-`));
  const filePath = join(dir, options.fileName ?? "datastore.db");

  try {
    const store = await createDatastore({
      backend: options.backend ?? "auto",
      filePath,
      now: options.now,
    });

    try {
      await fn(store, filePath);
    } finally {
      await store.close();
    }
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

test("initializes a persistent datastore from seed assets", async () => {
  await withTempStore("init", async (store) => {
    assert.ok(store instanceof QuantumSentinelDatastore);

    const assets = await store.listAssets();
    assert.equal(assets.length, ASSETS.length);
    assert.deepEqual(assets[0], ASSETS[0]);

    const asset = await store.getAsset(1);
    assert.deepEqual(asset, ASSETS[0]);
    assert.equal(await store.getAsset(999), null);
  });
});

test("records asset history when seed or probe observations upsert assets", async () => {
  await withTempStore("history", async (store) => {
    const updated = await store.upsertAsset({
      ...ASSETS[0],
      algo: "X25519+ML-KEM",
      cls: "HYBRID",
      prio: "MONITOR",
      risk: 18,
    }, {
      source: "probe",
      reason: "tls-observation",
      observedAt: "2026-06-03T12:00:00.000Z",
    });

    assert.equal(updated.algo, "X25519+ML-KEM");
    assert.equal(updated.cls, "HYBRID");

    const history = await store.listAssetHistory(1);
    assert.equal(history.length, 2);
    assert.equal(history[0].source, "seed");
    assert.equal(history[1].source, "probe");
    assert.equal(history[1].reason, "tls-observation");
    assert.equal(history[1].asset.algo, "X25519+ML-KEM");
  });
});

test("creates and lists findings with stable ids and asset references", async () => {
  await withTempStore("findings", async (store) => {
    const finding = await store.createFinding({
      assetId: 5,
      severity: "CRITICAL",
      type: "HNDL",
      title: "RSA key material requires migration",
      description: "Finance database is still using RSA-2048 for TLS.",
      evidence: { algorithm: "RSA-2048", protocol: "TLS 1.2" },
      remediation: { action: "Migrate key exchange", target: "ML-KEM-768" },
      source: "probe",
      observedAt: "2026-06-03T12:30:00.000Z",
    });

    assert.equal(finding.id, "finding-1");
    assert.equal(finding.assetId, 5);
    assert.equal(finding.asset.hostname, "db-primary-finance");
    assert.deepEqual(finding.evidence, { algorithm: "RSA-2048", protocol: "TLS 1.2" });
    assert.deepEqual(finding.remediation, { action: "Migrate key exchange", target: "ML-KEM-768" });
    assert.equal(finding.owner, null);
    assert.equal(finding.dueAt, null);
    assert.equal(finding.priority, "CRITICAL");
    assert.equal(finding.resolution, null);
    assert.equal(finding.updatedAt, "2026-06-03T12:30:00.000Z");
    assert.equal(finding.closedAt, null);
    assert.deepEqual(finding.notes, []);
    assert.deepEqual(finding.history, [{
      at: "2026-06-03T12:30:00.000Z",
      author: "system",
      action: "created",
      status: "open",
    }]);

    assert.deepEqual(await store.listFindings(), [finding]);
    assert.deepEqual(await store.listFindings({ assetId: 5 }), [finding]);
    assert.deepEqual(await store.listFindings({ assetId: 1 }), []);
  });
});

test("updates findings, appends notes, filters lifecycle fields, and summarizes remediation", async () => {
  await withTempStore("finding-workflow", async (store) => {
    const critical = await store.createFinding({
      assetId: 5,
      severity: "CRITICAL",
      type: "HNDL",
      title: "RSA key material requires migration",
      source: "probe",
      createdAt: "2026-06-01T08:00:00.000Z",
    });
    const medium = await store.createFinding({
      assetId: 1,
      severity: "MEDIUM",
      type: "PFS",
      title: "Perfect forward secrecy not observed",
      source: "risk-engine",
      status: "triaged",
      owner: "platform",
      dueAt: "2026-06-09T08:00:00.000Z",
      createdAt: "2026-06-01T09:00:00.000Z",
    });

    const updated = await store.updateFinding(critical.id, {
      status: "in_progress",
      owner: "crypto-team",
      dueAt: "2026-06-04T08:00:00.000Z",
      priority: "P0",
      resolution: { plan: "Replace certificate chain" },
      note: "Assigned for migration",
      author: "analyst",
      updatedAt: "2026-06-02T08:00:00.000Z",
    });

    assert.equal(updated.status, "in_progress");
    assert.equal(updated.owner, "crypto-team");
    assert.equal(updated.dueAt, "2026-06-04T08:00:00.000Z");
    assert.equal(updated.priority, "P0");
    assert.deepEqual(updated.resolution, { plan: "Replace certificate chain" });
    assert.equal(updated.updatedAt, "2026-06-02T08:00:00.000Z");
    assert.equal(updated.closedAt, null);
    assert.deepEqual(updated.notes, [{
      at: "2026-06-02T08:00:00.000Z",
      author: "analyst",
      text: "Assigned for migration",
    }]);
    assert.deepEqual(updated.history.at(-1), {
      at: "2026-06-02T08:00:00.000Z",
      author: "analyst",
      action: "updated",
      status: "in_progress",
    });

    const noted = await store.appendFindingNote(critical.id, {
      text: "Certificate order opened",
      author: "operator",
      at: "2026-06-03T08:00:00.000Z",
    });
    assert.equal(noted.notes.length, 2);
    assert.deepEqual(noted.notes[1], {
      at: "2026-06-03T08:00:00.000Z",
      author: "operator",
      text: "Certificate order opened",
    });

    const closed = await store.updateFinding(critical.id, {
      status: "remediated",
      updatedAt: "2026-06-05T08:00:00.000Z",
      author: "analyst",
    });
    assert.equal(closed.closedAt, "2026-06-05T08:00:00.000Z");

    const reopened = await store.updateFinding(critical.id, {
      status: "open",
      updatedAt: "2026-06-06T08:00:00.000Z",
      author: "analyst",
    });
    assert.equal(reopened.closedAt, null);

    assert.deepEqual(await store.getFinding(critical.id), reopened);
    assert.equal(await store.getFinding("missing"), null);
    assert.deepEqual(await store.updateFinding("missing", { status: "closed" }), null);
    assert.deepEqual(await store.appendFindingNote("missing", { text: "No-op" }), null);

    assert.deepEqual((await store.listFindings({ status: "open" })).map((finding) => finding.id), [critical.id]);
    assert.deepEqual((await store.listFindings({ severity: "MEDIUM" })).map((finding) => finding.id), [medium.id]);
    assert.deepEqual((await store.listFindings({ owner: "platform" })).map((finding) => finding.id), [medium.id]);
    assert.deepEqual((await store.listFindings({ source: "probe" })).map((finding) => finding.id), [critical.id]);
    assert.deepEqual((await store.listFindings({ assetId: 1, status: "triaged" })).map((finding) => finding.id), [medium.id]);

    const summary = await store.getRemediationSummary({ now: "2026-06-06T08:00:00.000Z" });
    assert.deepEqual(summary.byStatus, { open: 1, triaged: 1 });
    assert.deepEqual(summary.bySeverity, { CRITICAL: 1, MEDIUM: 1 });
    assert.deepEqual(summary.byOwner, { "crypto-team": 1, platform: 1 });
    assert.equal(summary.overdue, 1);
    assert.equal(summary.dueSoon, 1);
    assert.equal(summary.openCritical, 1);

    await assert.rejects(
      () => store.updateFinding(critical.id, { status: "invalid" }),
      /finding status must be one of/,
    );
  });
});

test("creates, lists, and retrieves CBOM snapshots from current assets", async () => {
  await withTempStore("cbom", async (store) => {
    const expected = buildCbomFromAssets(ASSETS);
    const snapshot = await store.createCbomSnapshot({
      name: "baseline",
      createdBy: "node:test",
      metadata: { ticket: "QS-1" },
      createdAt: "2026-06-03T13:00:00.000Z",
    });

    assert.equal(snapshot.id, "cbom-1");
    assert.equal(snapshot.name, "baseline");
    assert.equal(snapshot.createdBy, "node:test");
    assert.deepEqual(snapshot.metadata, { ticket: "QS-1" });
    assert.deepEqual(snapshot.cbom, expected);

    const summaries = await store.listCbomSnapshots();
    assert.deepEqual(summaries, [{
      id: "cbom-1",
      name: "baseline",
      createdAt: "2026-06-03T13:00:00.000Z",
      createdBy: "node:test",
      count: ASSETS.length,
      summary: expected.summary,
      metadata: { ticket: "QS-1" },
    }]);

    assert.deepEqual(await store.getCbomSnapshot("cbom-1"), snapshot);
    assert.equal(await store.getCbomSnapshot("missing"), null);
  });
});

test("records append-only audit events with a verifiable hash chain", async () => {
  await withTempStore("audit", async (store) => {
    const finding = await store.createFinding({
      assetId: 5,
      severity: "CRITICAL",
      type: "HNDL",
      title: "RSA key material requires migration",
      author: "analyst",
      createdAt: "2026-06-03T12:00:00.000Z",
    });
    await store.updateFinding(finding.id, {
      status: "in_progress",
      owner: "crypto-team",
      author: "analyst",
      updatedAt: "2026-06-03T12:05:00.000Z",
    });
    await store.appendFindingNote(finding.id, {
      text: "Certificate rotation scheduled",
      author: "operator",
      at: "2026-06-03T12:10:00.000Z",
    });

    const events = await store.listAuditEvents({ entityType: "finding", entityId: finding.id });
    assert.deepEqual(events.map((event) => event.action), [
      "finding.note_added",
      "finding.updated",
      "finding.created",
    ]);
    assert.equal(events[2].previousHash, null);
    assert.equal(events[1].previousHash, events[2].hash);
    assert.equal(events[0].previousHash, events[1].hash);
    assert.match(events[0].hash, /^[a-f0-9]{64}$/);

    const detail = await store.getAuditEvent(events[1].id);
    assert.equal(detail.actor, "analyst");
    assert.equal(detail.after.status, "in_progress");

    const limited = await store.listAuditEvents({ actor: "analyst", limit: 1 });
    assert.equal(limited.length, 1);
    assert.equal(limited[0].actor, "analyst");
  });
});

test("persists report export records and links them to audit events", async () => {
  await withTempStore("report-export", async (store) => {
    const report = {
      reportId: "executive-20260603120000",
      type: "executive",
      title: "Executive Summary",
      generatedAt: "2026-06-03T12:00:00.000Z",
      scope: { source: "test", assetCount: 1 },
      summary: { assets: { total: 1 } },
      sections: [],
      evidenceRefs: [{ kind: "asset", id: 1, label: "api-gateway-prod-01" }],
    };

    const exported = await store.createReportExport({
      report,
      createdBy: "auditor",
      metadata: { ticket: "QS-AUDIT-1" },
    });

    assert.equal(exported.id, "report-export-1");
    assert.equal(exported.reportType, "executive");
    assert.equal(exported.reportId, report.reportId);
    assert.equal(exported.createdBy, "auditor");
    assert.match(exported.payloadHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(exported.evidenceRefs, report.evidenceRefs);
    assert.equal(exported.auditEventId, "audit-1");

    const auditEvent = await store.getAuditEvent(exported.auditEventId);
    assert.equal(auditEvent.action, "report.exported");
    assert.equal(auditEvent.entityType, "report-export");
    assert.equal(auditEvent.entityId, exported.id);
    assert.equal(auditEvent.after.payloadHash, exported.payloadHash);

    assert.deepEqual(await store.getReportExport(exported.id), exported);
    assert.deepEqual(await store.listReportExports({ reportType: "executive" }), [exported]);
    assert.deepEqual(await store.listReportExports({ reportType: "cbom" }), []);
  });
});

test("creates, lists, updates, and retrieves monitor policies", async () => {
  await withTempStore("monitors", async (store) => {
    const created = await store.createMonitorPolicy({
      name: "Daily perimeter discovery",
      enabled: false,
      probeRequest: {
        mode: "discovery",
        hosts: ["example.com", "127.0.0.1"],
        timeoutMs: 1000,
      },
      intervalSeconds: 3600,
      nextRunAt: "2026-06-03T15:00:00.000Z",
      createdAt: "2026-06-03T14:00:00.000Z",
      updatedAt: "2026-06-03T14:00:00.000Z",
    });

    assert.equal(created.id, "monitor-1");
    assert.equal(created.name, "Daily perimeter discovery");
    assert.equal(created.enabled, false);
    assert.equal(created.intervalSeconds, 3600);
    assert.equal(created.lastRunAt, null);
    assert.equal(created.lastJobId, null);
    assert.deepEqual(created.probeRequest.hosts, ["example.com", "127.0.0.1"]);

    assert.deepEqual(await store.listMonitorPolicies(), [created]);
    assert.deepEqual(await store.getMonitorPolicy("monitor-1"), created);
    assert.equal(await store.getMonitorPolicy("missing"), null);

    const updated = await store.updateMonitorPolicy("monitor-1", {
      enabled: true,
      lastRunAt: "2026-06-03T15:00:00.000Z",
      lastJobId: "probe-42",
      updatedAt: "2026-06-03T15:00:00.000Z",
    });

    assert.equal(updated.enabled, true);
    assert.equal(updated.lastRunAt, "2026-06-03T15:00:00.000Z");
    assert.equal(updated.lastJobId, "probe-42");
    assert.equal(updated.createdAt, created.createdAt);
    assert.deepEqual(await store.getMonitorPolicy("monitor-1"), updated);
  });
});

test("creates, updates, filters, and retrieves monitor run history", async () => {
  await withTempStore("monitor-runs", async (store) => {
    const run = await store.createMonitorRun({
      policyId: "monitor-1",
      policyName: "Seed asset check",
      status: "running",
      trigger: "scheduled",
      startedAt: "2026-06-03T14:00:00.000Z",
    });

    assert.equal(run.id, "monitor-run-1");
    assert.equal(run.policyId, "monitor-1");
    assert.equal(run.policyName, "Seed asset check");
    assert.equal(run.status, "running");
    assert.equal(run.trigger, "scheduled");
    assert.equal(run.startedAt, "2026-06-03T14:00:00.000Z");
    assert.equal(run.completedAt, null);
    assert.equal(run.jobId, null);
    assert.equal(run.error, null);
    assert.deepEqual(run.summary, {});
    assert.equal(run.observationsCount, 0);
    assert.equal(run.findingsCount, 0);

    const completed = await store.updateMonitorRun(run.id, {
      status: "completed",
      completedAt: "2026-06-03T14:00:01.000Z",
      jobId: "probe-1",
      summary: { classification: "SHOR-CRITICAL" },
      observationsCount: 1,
      findingsCount: 2,
    });

    assert.equal(completed.status, "completed");
    assert.equal(completed.jobId, "probe-1");
    assert.deepEqual(completed.summary, { classification: "SHOR-CRITICAL" });
    assert.equal(completed.observationsCount, 1);
    assert.equal(completed.findingsCount, 2);
    assert.deepEqual(await store.getMonitorRun(run.id), completed);
    assert.deepEqual(await store.listMonitorRuns(), [completed]);
    assert.deepEqual(await store.listMonitorRuns({ policyId: "monitor-1" }), [completed]);
    assert.deepEqual(await store.listMonitorRuns({ policyId: "monitor-2" }), []);
  });
});

test("persists assets, history, findings, probes, and snapshots across reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-reopen-"));
  const filePath = join(dir, "datastore.db");

  try {
    const first = await createDatastore({
      filePath,
      now: () => "2026-06-03T14:00:00.000Z",
    });

    await first.upsertAsset({
      ...ASSETS[14],
      risk: 99,
    }, { source: "probe", reason: "high-risk-observation" });
    const finding = await first.createFinding({
      assetId: 15,
      severity: "CRITICAL",
      type: "DEPRECATED",
      title: "Deprecated DES cryptography detected",
    });
    const updatedFinding = await first.updateFinding(finding.id, {
      status: "accepted_risk",
      owner: "ot-security",
      dueAt: "2026-06-10T14:00:00.000Z",
      note: "Accepted through maintenance freeze",
      author: "risk-board",
      updatedAt: "2026-06-03T14:05:00.000Z",
    });
    const probe = await first.createProbeJob({
      id: "probe-42",
      mode: "simulate",
      status: "completed",
      target: { assetId: 15, hostname: "plc-boiler-ctrl-07" },
      result: { classification: { label: "DEPRECATED" } },
    });
    const monitor = await first.createMonitorPolicy({
      name: "PLC crypto check",
      enabled: false,
      probeRequest: { mode: "simulate", assetId: 15 },
      intervalSeconds: 600,
      nextRunAt: "2026-06-03T14:10:00.000Z",
    });
    const run = await first.createMonitorRun({
      policyId: monitor.id,
      policyName: monitor.name,
      status: "completed",
      trigger: "manual",
      startedAt: "2026-06-03T14:00:00.000Z",
      completedAt: "2026-06-03T14:00:01.000Z",
      jobId: probe.id,
    });
    const snapshot = await first.createCbomSnapshot({ name: "after-probe" });
    const reportExport = await first.createReportExport({
      report: {
        reportId: "full-20260603140000",
        type: "full",
        generatedAt: "2026-06-03T14:00:00.000Z",
        scope: { source: "test" },
        summary: {},
        sections: [],
        evidenceRefs: [],
      },
    });
    await first.close();

    const reopened = await createDatastore({ filePath });
    try {
      assert.equal((await reopened.getAsset(15)).risk, 99);
      assert.equal((await reopened.listAssetHistory(15)).length, 2);
      assert.deepEqual(await reopened.listFindings({ assetId: 15 }), [updatedFinding]);
      assert.deepEqual(await reopened.getFinding(finding.id), updatedFinding);
      assert.deepEqual(await reopened.getProbeJob("probe-42"), probe);
      assert.deepEqual(await reopened.listProbeJobs(), [probe]);
      assert.deepEqual(await reopened.getMonitorPolicy(monitor.id), monitor);
      assert.deepEqual(await reopened.listMonitorPolicies(), [monitor]);
      assert.deepEqual(await reopened.getMonitorRun(run.id), run);
      assert.deepEqual(await reopened.listMonitorRuns({ policyId: monitor.id }), [run]);
      assert.deepEqual(await reopened.getCbomSnapshot(snapshot.id), snapshot);
      assert.deepEqual(await reopened.getReportExport(reportExport.id), reportExport);
      assert.ok((await reopened.listAuditEvents()).length >= 1);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("json backend uses the same public API for runtimes without node:sqlite", async () => {
  await withTempStore("json", async (store, filePath) => {
    assert.equal(filePath.endsWith(".json"), true);

    await store.upsertAsset({ ...ASSETS[0], risk: 11 }, { source: "probe" });
    await store.createFinding({ assetId: 1, severity: "LOW", type: "PQC", title: "Pilot verified" });
    await store.createMonitorPolicy({
      name: "JSON monitor",
      probeRequest: { mode: "simulate", assetId: 1 },
      intervalSeconds: 120,
    });
    await store.createMonitorRun({
      policyId: "monitor-1",
      policyName: "JSON monitor",
      status: "completed",
      trigger: "manual",
    });
    await store.createReportExport({
      report: {
        reportId: "executive-20260603120000",
        type: "executive",
        generatedAt: "2026-06-03T12:00:00.000Z",
        scope: {},
        summary: {},
        sections: [],
        evidenceRefs: [],
      },
    });
    await store.close();

    const reopened = await createDatastore({ backend: "json", filePath });
    try {
      assert.equal((await reopened.getAsset(1)).risk, 11);
      assert.equal((await reopened.listFindings({ assetId: 1 })).length, 1);
      assert.equal((await reopened.listMonitorPolicies()).length, 1);
      assert.equal((await reopened.listMonitorRuns()).length, 1);
      assert.equal((await reopened.listReportExports()).length, 1);
      assert.ok((await reopened.listAuditEvents()).length >= 1);
    } finally {
      await reopened.close();
    }
  }, { backend: "json", fileName: "datastore.json" });
});
