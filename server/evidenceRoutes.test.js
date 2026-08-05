import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createApiServer } from "./app.js";
import { createDatastore } from "./datastore.js";

async function listen() {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-evidence-"));
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

async function postJson(baseUrl, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("verifies the audit hash chain and exposes latest chain state", async () => {
  const api = await listen();

  try {
    const finding = await postJson(api.baseUrl, "/api/findings", {
      assetId: 5,
      severity: "CRITICAL",
      type: "HNDL",
      title: "RSA key material requires migration",
      author: "analyst",
    });
    await postJson(api.baseUrl, "/api/approvals", {
      entityType: "finding",
      entityId: finding.body.data.id,
      action: "finding.transition.remediated",
      requestedBy: "analyst",
      justification: "Migration completed",
    });

    const verified = await getJson(api.baseUrl, "/api/audit-chain/verify");

    assert.equal(verified.response.status, 200);
    assert.equal(verified.body.data.valid, true);
    assert.equal(verified.body.data.brokenAt, null);
    assert.equal(verified.body.data.count, 2);
    assert.match(verified.body.data.headHash, /^[a-f0-9]{64}$/);
    assert.match(verified.body.data.tailHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(verified.body.data.actions, ["finding.created", "approval.requested"]);
  } finally {
    await api.close();
  }
});

test("serves report export manifests with audit-chain verification context", async () => {
  const api = await listen();

  try {
    const exported = await postJson(api.baseUrl, "/api/reports/full/exports", {
      createdBy: "auditor",
      metadata: { ticket: "QS-EVIDENCE-1" },
    }, { "x-qs-role": "auditor" });

    const manifest = await getJson(api.baseUrl, `/api/report-exports/${exported.body.data.id}/manifest`);

    assert.equal(manifest.response.status, 200);
    assert.equal(manifest.body.data.id, exported.body.data.id);
    assert.equal(manifest.body.data.reportType, "full");
    assert.equal(manifest.body.data.reportId, exported.body.data.reportId);
    assert.equal(manifest.body.data.payloadHash, exported.body.data.payloadHash);
    assert.equal(manifest.body.data.auditEventId, exported.body.data.auditEventId);
    assert.equal(manifest.body.data.auditChain.valid, true);
    assert.match(manifest.body.data.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(manifest.body.data.metadata, { ticket: "QS-EVIDENCE-1" });
  } finally {
    await api.close();
  }
});

test("serves evidence archive summaries for exports, approvals, and audit chain", async () => {
  const api = await listen();

  try {
    const approval = await postJson(api.baseUrl, "/api/approvals", {
      entityType: "report",
      entityId: "executive",
      action: "report.export",
      requestedBy: "analyst",
      justification: "Executive package",
    });
    await postJson(api.baseUrl, `/api/approvals/${approval.body.data.id}/approve`, {
      actor: "risk-board",
    }, { "x-qs-role": "approver" });
    const exported = await postJson(api.baseUrl, "/api/reports/executive/exports", {
      createdBy: "analyst",
      approvalId: approval.body.data.id,
    }, { "x-qs-role": "analyst" });

    const archive = await getJson(api.baseUrl, "/api/evidence/archive");

    assert.equal(archive.response.status, 200);
    assert.equal(archive.body.data.auditChain.valid, true);
    assert.equal(archive.body.data.approvals.total, 1);
    assert.equal(archive.body.data.approvals.approved, 1);
    assert.equal(archive.body.data.reportExports.count, 1);
    assert.equal(archive.body.data.reportExports.latest.id, exported.body.data.id);
    assert.equal(archive.body.data.reportExports.latest.approvalId, approval.body.data.id);
  } finally {
    await api.close();
  }
});

test("filters evidence archive audit actions and report exports from query parameters", async () => {
  const api = await listen();

  try {
    const approval = await postJson(api.baseUrl, "/api/approvals", {
      entityType: "report",
      entityId: "executive",
      action: "report.export",
      requestedBy: "analyst",
      justification: "Executive package",
    });
    await postJson(api.baseUrl, `/api/approvals/${approval.body.data.id}/approve`, {
      actor: "risk-board",
    }, { "x-qs-role": "approver" });
    const executiveExport = await postJson(api.baseUrl, "/api/reports/executive/exports", {
      createdBy: "analyst",
      approvalId: approval.body.data.id,
    }, { "x-qs-role": "analyst" });
    await postJson(api.baseUrl, "/api/reports/full/exports", {
      createdBy: "auditor",
    }, { "x-qs-role": "auditor" });

    const archive = await getJson(
      api.baseUrl,
      "/api/evidence/archive?reportType=executive&entityType=approval&action=approval.requested",
    );

    assert.equal(archive.response.status, 200);
    assert.deepEqual(archive.body.data.filters, {
      reportType: "executive",
      entityType: "approval",
      action: "approval.requested",
    });
    assert.equal(archive.body.data.auditChain.valid, true);
    assert.deepEqual(archive.body.data.auditChain.actions, ["approval.requested"]);
    assert.equal(archive.body.data.auditChain.count, 1);
    assert.equal(archive.body.data.reportExports.count, 1);
    assert.deepEqual(
      archive.body.data.reportExports.items.map((record) => record.id),
      [executiveExport.body.data.id],
    );
    assert.deepEqual(archive.body.data.reportExports.byType, { executive: 1 });
  } finally {
    await api.close();
  }
});

test("serves JSON evidence bundles with filters, verification, exports, approvals, and audit events", async () => {
  const api = await listen();

  try {
    const approval = await postJson(api.baseUrl, "/api/approvals", {
      entityType: "report",
      entityId: "executive",
      action: "report.export",
      requestedBy: "analyst",
      justification: "Executive package",
    });
    await postJson(api.baseUrl, `/api/approvals/${approval.body.data.id}/approve`, {
      actor: "risk-board",
    }, { "x-qs-role": "approver" });
    const executiveExport = await postJson(api.baseUrl, "/api/reports/executive/exports", {
      createdBy: "analyst",
      approvalId: approval.body.data.id,
    }, { "x-qs-role": "analyst" });
    await postJson(api.baseUrl, "/api/reports/full/exports", {
      createdBy: "auditor",
    }, { "x-qs-role": "auditor" });

    const bundle = await getJson(api.baseUrl, "/api/evidence/bundle?reportType=executive&entityType=report&action=report.export");

    assert.equal(bundle.response.status, 200);
    assert.match(bundle.body.data.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(bundle.body.data.bundleId, /^evidence-bundle-[a-f0-9]{16}$/);
    assert.deepEqual(bundle.body.data.filters, {
      reportType: "executive",
      entityType: "report",
      action: "report.export",
    });
    assert.equal(bundle.body.data.auditChain.valid, true);
    assert.equal(bundle.body.data.reportExports.count, 1);
    assert.deepEqual(
      bundle.body.data.reportExports.items.map((record) => record.id),
      [executiveExport.body.data.id],
    );
    assert.equal(bundle.body.data.approvals.count, 1);
    assert.deepEqual(
      bundle.body.data.approvals.items.map((record) => record.id),
      [approval.body.data.id],
    );
    assert.equal(bundle.body.data.auditEvents.count, 0);
    assert.deepEqual(bundle.body.data.auditEvents.items, []);
  } finally {
    await api.close();
  }
});
