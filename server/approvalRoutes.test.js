import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createApiServer } from "./app.js";
import { createDatastore } from "./datastore.js";

async function listen() {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-approvals-"));
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

async function getJson(baseUrl, path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
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

test("creates, approves, lists, and audits approval requests", async () => {
  const api = await listen();

  try {
    const created = await postJson(api.baseUrl, "/api/approvals", {
      entityType: "report",
      entityId: "full",
      action: "report.export",
      requestedBy: "analyst",
      assignedTo: "risk-board",
      justification: "Monthly audit evidence package",
      metadata: { ticket: "QS-APPROVAL-1" },
    });

    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.id, "approval-1");
    assert.equal(created.body.data.status, "pending");
    assert.equal(created.body.data.entityType, "report");
    assert.equal(created.body.data.entityId, "full");
    assert.equal(created.body.data.action, "report.export");

    const denied = await postJson(api.baseUrl, "/api/approvals/approval-1/approve", {
      actor: "analyst",
      note: "I should not be allowed to approve this",
    }, { "x-qs-role": "analyst" });
    assert.equal(denied.response.status, 403);
    assert.deepEqual(denied.body, { error: "Approver role required" });

    const approved = await postJson(api.baseUrl, "/api/approvals/approval-1/approve", {
      actor: "risk-board",
      note: "Approved for audit export",
    }, { "x-qs-role": "approver" });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.data.status, "approved");
    assert.equal(approved.body.data.decidedBy, "risk-board");

    const list = await getJson(api.baseUrl, "/api/approvals?status=approved&entityType=report");
    assert.equal(list.response.status, 200);
    assert.deepEqual(list.body.data.map((approval) => approval.id), ["approval-1"]);

    const audit = await getJson(api.baseUrl, "/api/audit-events?entityType=approval");
    assert.equal(audit.response.status, 200);
    assert.deepEqual(audit.body.data.map((event) => event.action), [
      "approval.approved",
      "approval.requested",
    ]);
  } finally {
    await api.close();
  }
});

test("requires report export role or approved request", async () => {
  const api = await listen();

  try {
    const blocked = await postJson(api.baseUrl, "/api/reports/full/exports", {
      createdBy: "analyst",
    }, { "x-qs-role": "analyst" });
    assert.equal(blocked.response.status, 403);
    assert.deepEqual(blocked.body, { error: "Report export approval required" });

    const request = await postJson(api.baseUrl, "/api/approvals", {
      entityType: "report",
      entityId: "full",
      action: "report.export",
      requestedBy: "analyst",
      justification: "Evidence export for internal audit",
    });
    const approval = await postJson(api.baseUrl, `/api/approvals/${request.body.data.id}/approve`, {
      actor: "risk-board",
    }, { "x-qs-role": "approver" });

    const exported = await postJson(api.baseUrl, "/api/reports/full/exports", {
      createdBy: "analyst",
      approvalId: approval.body.data.id,
    }, { "x-qs-role": "analyst" });
    assert.equal(exported.response.status, 201);
    assert.equal(exported.body.data.approvalId, approval.body.data.id);

    const auditorExport = await postJson(api.baseUrl, "/api/reports/executive/exports", {
      createdBy: "auditor",
    }, { "x-qs-role": "auditor" });
    assert.equal(auditorExport.response.status, 201);
  } finally {
    await api.close();
  }
});

test("requires approval for terminal finding transitions", async () => {
  const api = await listen();

  try {
    const finding = await postJson(api.baseUrl, "/api/findings", {
      assetId: 5,
      severity: "CRITICAL",
      type: "HNDL",
      title: "RSA key material requires migration",
      author: "analyst",
    });

    const blocked = await fetch(`${api.baseUrl}/api/findings/${finding.body.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-qs-role": "analyst" },
      body: JSON.stringify({
        status: "remediated",
        author: "analyst",
      }),
    });
    assert.equal(blocked.status, 403);
    assert.deepEqual(await blocked.json(), { error: "Finding transition approval required" });

    const request = await postJson(api.baseUrl, "/api/approvals", {
      entityType: "finding",
      entityId: finding.body.data.id,
      action: "finding.transition.remediated",
      requestedBy: "analyst",
      justification: "Migration evidence attached",
    });
    await postJson(api.baseUrl, `/api/approvals/${request.body.data.id}/approve`, {
      actor: "risk-board",
    }, { "x-qs-role": "approver" });

    const patched = await fetch(`${api.baseUrl}/api/findings/${finding.body.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-qs-role": "analyst" },
      body: JSON.stringify({
        status: "remediated",
        approvalId: request.body.data.id,
        author: "analyst",
      }),
    });
    const body = await patched.json();
    assert.equal(patched.status, 200);
    assert.equal(body.data.status, "remediated");
    assert.equal(body.data.approvalId, request.body.data.id);

    const adminFinding = await postJson(api.baseUrl, "/api/findings", {
      assetId: 1,
      severity: "MEDIUM",
      type: "PFS",
      title: "PFS not observed",
    });
    const adminPatch = await fetch(`${api.baseUrl}/api/findings/${adminFinding.body.data.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-qs-role": "admin" },
      body: JSON.stringify({ status: "closed", author: "admin" }),
    });
    assert.equal(adminPatch.status, 200);
  } finally {
    await api.close();
  }
});
