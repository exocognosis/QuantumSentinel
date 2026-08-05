import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createApprovalRequest,
  createReportExport,
  decideApprovalRequest,
  loadApprovals,
  normalizeApproval,
  normalizeReportExport,
} from "./approvalApi.js";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

test("loadApprovals fetches and normalizes flexible approval payloads", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: [{
        id: "approval-7",
        entity_type: "report",
        entity_id: "full",
        action: "report.export",
        status: "approved",
        requested_by: "analyst",
        decided_by: "risk-board",
      }],
      count: 1,
    });
  };

  const result = await loadApprovals({ status: "approved", entityType: "report" }, { fetcher });

  assert.equal(calls[0].url, "/api/approvals?status=approved&entityType=report");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.equal(result.count, 1);
  assert.deepEqual(result.approvals[0], {
    id: "approval-7",
    entityType: "report",
    entityId: "full",
    action: "report.export",
    status: "approved",
    requestedBy: "analyst",
    assignedTo: null,
    justification: "",
    requestedAt: "",
    updatedAt: "",
    decidedAt: "",
    decidedBy: "risk-board",
    decisionNote: "",
    metadata: {},
    raw: {
      id: "approval-7",
      entity_type: "report",
      entity_id: "full",
      action: "report.export",
      status: "approved",
      requested_by: "analyst",
      decided_by: "risk-board",
    },
  });
});

test("createApprovalRequest posts approval payloads with actor headers", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        id: "approval-1",
        entityType: "finding",
        entityId: "finding-1",
        action: "finding.transition.remediated",
        status: "pending",
        requestedBy: "analyst",
      },
    }, { status: 201 });
  };

  const approval = await createApprovalRequest({
    entityType: "finding",
    entityId: "finding-1",
    action: "finding.transition.remediated",
    requestedBy: "analyst",
    justification: "Migration evidence attached",
  }, { fetcher, actor: "analyst", role: "analyst" });

  assert.equal(calls[0].url, "/api/approvals");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["x-qs-actor"], "analyst");
  assert.equal(calls[0].options.headers["x-qs-role"], "analyst");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    entityType: "finding",
    entityId: "finding-1",
    action: "finding.transition.remediated",
    requestedBy: "analyst",
    justification: "Migration evidence attached",
  });
  assert.equal(approval.id, "approval-1");
});

test("decideApprovalRequest posts approve and reject decisions", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        id: "approval-1",
        status: url.endsWith("/approve") ? "approved" : "rejected",
        decidedBy: "risk-board",
      },
    });
  };

  const approved = await decideApprovalRequest("approval-1", "approve", {
    actor: "risk-board",
    note: "Approved",
  }, { fetcher, role: "approver" });
  const rejected = await decideApprovalRequest("approval-1", "reject", {
    actor: "risk-board",
  }, { fetcher, role: "approver" });

  assert.equal(calls[0].url, "/api/approvals/approval-1/approve");
  assert.equal(calls[1].url, "/api/approvals/approval-1/reject");
  assert.equal(calls[0].options.headers["x-qs-role"], "approver");
  assert.equal(approved.status, "approved");
  assert.equal(rejected.status, "rejected");
});

test("createReportExport posts role and approval metadata", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        id: "report-export-1",
        reportType: "full",
        reportId: "full-20260606160000",
        payloadHash: "a".repeat(64),
        approvalId: "approval-1",
      },
    }, { status: 201 });
  };

  const exported = await createReportExport("full", {
    createdBy: "analyst",
    approvalId: "approval-1",
    metadata: { ticket: "QS-1" },
  }, { fetcher, role: "analyst", actor: "analyst" });

  assert.equal(calls[0].url, "/api/reports/full/exports");
  assert.equal(calls[0].options.headers["x-qs-role"], "analyst");
  assert.equal(JSON.parse(calls[0].options.body).approvalId, "approval-1");
  assert.equal(exported.id, "report-export-1");
  assert.equal(exported.payloadHash, "a".repeat(64));
});

test("normalizers provide stable defaults for sparse approval and export payloads", () => {
  assert.deepEqual(normalizeApproval({ id: "approval-9" }), {
    id: "approval-9",
    entityType: "system",
    entityId: "",
    action: "approval",
    status: "pending",
    requestedBy: "system",
    assignedTo: null,
    justification: "",
    requestedAt: "",
    updatedAt: "",
    decidedAt: "",
    decidedBy: null,
    decisionNote: "",
    metadata: {},
    raw: { id: "approval-9" },
  });

  assert.deepEqual(normalizeReportExport({ id: "export-1", report_type: "cbom" }), {
    id: "export-1",
    reportType: "cbom",
    reportId: "cbom-export",
    generatedAt: "",
    createdBy: "system",
    scope: {},
    summary: {},
    evidenceRefs: [],
    payloadHash: "",
    auditEventId: null,
    approvalId: null,
    metadata: {},
    raw: { id: "export-1", report_type: "cbom" },
  });
});
