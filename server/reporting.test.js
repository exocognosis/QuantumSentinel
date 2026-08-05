import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ASSETS } from "../src/mockData.js";
import { createApiServer } from "./app.js";
import { createDatastore } from "./datastore.js";

async function listen(options = {}) {
  const server = createApiServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

async function listenWithDatastore() {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-reports-"));
  const datastore = await createDatastore({ filePath: join(dir, "datastore.db") });
  const api = await listen({ datastore });

  return {
    ...api,
    datastore,
    close: async () => {
      await api.close();
      await datastore.close();
      await rm(dir, { force: true, recursive: true });
    },
  };
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { response, body: await response.json() };
}

function assertReportPackage(report, type) {
  assert.equal(report.type, type);
  assert.match(report.reportId, new RegExp(`^${type}-`));
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof report.scope, "object");
  assert.equal(typeof report.summary, "object");
  assert.ok(Array.isArray(report.sections));
  assert.ok(Array.isArray(report.evidenceRefs));
}

test("lists available JSON report packages", async () => {
  const api = await listen();

  try {
    const { response, body } = await getJson(api.baseUrl, "/api/reports");

    assert.equal(response.status, 200);
    assert.equal(body.count, 5);
    assert.deepEqual(body.data.map((report) => report.type), [
      "executive",
      "compliance",
      "remediation",
      "cbom",
      "full",
    ]);
    assert.equal(body.data[0].href, "/api/reports/executive");
    assert.equal(body.data[0].format, "json");
  } finally {
    await api.close();
  }
});

test("serves seed-backed report packages when no datastore is configured", async () => {
  const api = await listen();

  try {
    const executive = await getJson(api.baseUrl, "/api/reports/executive");
    assert.equal(executive.response.status, 200);
    assertReportPackage(executive.body.data, "executive");
    assert.equal(executive.body.data.scope.source, "seed");
    assert.equal(executive.body.data.summary.assets.total, ASSETS.length);
    assert.deepEqual(
      executive.body.data.sections.map((section) => section.id),
      ["portfolio-posture", "critical-exposure", "migration-readiness"],
    );

    const remediation = await getJson(api.baseUrl, "/api/reports/remediation");
    assert.equal(remediation.response.status, 200);
    assertReportPackage(remediation.body.data, "remediation");
    assert.equal(remediation.body.data.summary.totalFindings, 0);
    assert.deepEqual(remediation.body.data.sections.find((section) => section.id === "findings").items, []);
  } finally {
    await api.close();
  }
});

test("includes datastore-backed findings and remediation evidence", async () => {
  const api = await listenWithDatastore();

  try {
    const createdResponse = await fetch(`${api.baseUrl}/api/findings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        assetId: 5,
        severity: "CRITICAL",
        type: "HNDL",
        title: "RSA key material requires migration",
        source: "probe",
        status: "in_progress",
        owner: "crypto-team",
        dueAt: "2026-06-01T00:00:00.000Z",
      }),
    });
    const created = await createdResponse.json();

    const { response, body } = await getJson(api.baseUrl, "/api/reports/remediation");

    assert.equal(response.status, 200);
    assertReportPackage(body.data, "remediation");
    assert.equal(body.data.scope.source, "datastore");
    assert.equal(body.data.summary.totalFindings, 1);
    assert.equal(body.data.summary.openCritical, 1);
    assert.equal(body.data.summary.byOwner["crypto-team"], 1);

    const findingsSection = body.data.sections.find((section) => section.id === "findings");
    assert.equal(findingsSection.items[0].id, created.data.id);
    assert.equal(findingsSection.items[0].asset.hostname, "db-primary-finance");
    assert.equal(findingsSection.items[0].status, "in_progress");
    assert.ok(body.data.evidenceRefs.some((ref) => ref.kind === "finding" && ref.id === created.data.id));
  } finally {
    await api.close();
  }
});

test("builds compliance, CBOM, and full report packages with evidence references", async () => {
  const api = await listenWithDatastore();

  try {
    const snapshotResponse = await fetch(`${api.baseUrl}/api/cbom/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "baseline",
        createdBy: "report-test",
        metadata: { ticket: "QS-REPORT-1" },
      }),
    });
    const snapshot = await snapshotResponse.json();

    const compliance = await getJson(api.baseUrl, "/api/reports/compliance");
    assert.equal(compliance.response.status, 200);
    assertReportPackage(compliance.body.data, "compliance");
    assert.ok(compliance.body.data.sections.find((section) => section.id === "controls").items.length > 0);
    assert.ok(compliance.body.data.evidenceRefs.some((ref) => ref.kind === "compliance-control"));

    const cbom = await getJson(api.baseUrl, "/api/reports/cbom");
    assert.equal(cbom.response.status, 200);
    assertReportPackage(cbom.body.data, "cbom");
    assert.equal(cbom.body.data.summary.totalComponents, ASSETS.length);
    assert.equal(cbom.body.data.sections.find((section) => section.id === "components").items[0].componentId, "asset-1");
    assert.ok(cbom.body.data.evidenceRefs.some((ref) => ref.kind === "cbom-snapshot" && ref.id === snapshot.data.id));

    const full = await getJson(api.baseUrl, "/api/reports/full");
    assert.equal(full.response.status, 200);
    assertReportPackage(full.body.data, "full");
    assert.deepEqual(
      full.body.data.sections.map((section) => section.type),
      ["executive", "compliance", "remediation", "cbom"],
    );
    assert.ok(full.body.data.evidenceRefs.some((ref) => ref.kind === "cbom-snapshot" && ref.id === snapshot.data.id));
  } finally {
    await api.close();
  }
});

test("creates and lists persisted report export records with payload hashes", async () => {
  const api = await listenWithDatastore();

  try {
    const exportResponse = await fetch(`${api.baseUrl}/api/reports/full/exports`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-qs-role": "auditor" },
      body: JSON.stringify({
        createdBy: "auditor",
        metadata: { ticket: "QS-REPORT-EXPORT-1" },
      }),
    });
    const exported = await exportResponse.json();

    assert.equal(exportResponse.status, 201);
    assert.equal(exported.data.id, "report-export-1");
    assert.equal(exported.data.reportType, "full");
    assert.equal(exported.data.createdBy, "auditor");
    assert.match(exported.data.payloadHash, /^[a-f0-9]{64}$/);
    assert.ok(exported.data.auditEventId);
    assert.equal(exported.data.metadata.ticket, "QS-REPORT-EXPORT-1");
    assert.ok(exported.data.evidenceRefs.length > 0);

    const exports = await getJson(api.baseUrl, "/api/report-exports?reportType=full");
    assert.equal(exports.response.status, 200);
    assert.deepEqual(exports.body.data, [exported.data]);

    const detail = await getJson(api.baseUrl, `/api/report-exports/${exported.data.id}`);
    assert.equal(detail.response.status, 200);
    assert.deepEqual(detail.body.data, exported.data);

    const audit = await getJson(api.baseUrl, `/api/audit-events/${exported.data.auditEventId}`);
    assert.equal(audit.response.status, 200);
    assert.equal(audit.body.data.action, "report.exported");
    assert.equal(audit.body.data.entityId, exported.data.id);
    assert.equal(audit.body.data.after.payloadHash, exported.data.payloadHash);

    const missing = await getJson(api.baseUrl, "/api/report-exports/missing");
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "Report export not found" });
  } finally {
    await api.close();
  }
});

test("rejects report exports for unknown report types", async () => {
  const api = await listenWithDatastore();

  try {
    const response = await fetch(`${api.baseUrl}/api/reports/missing/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ createdBy: "auditor" }),
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: "Report type not found" });
  } finally {
    await api.close();
  }
});
