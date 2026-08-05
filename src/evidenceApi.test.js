import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadAuditChainVerification,
  loadEvidenceArchive,
  loadEvidenceBundle,
  loadReportExportManifest,
  normalizeAuditChain,
  normalizeEvidenceArchive,
  normalizeEvidenceBundle,
  normalizeReportExportManifest,
} from "./evidenceApi.js";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

test("loadAuditChainVerification fetches and normalizes chain status", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        valid: true,
        count: 3,
        headHash: "a".repeat(64),
        tailHash: "b".repeat(64),
        actions: ["finding.created"],
      },
    });
  };

  const chain = await loadAuditChainVerification({ fetcher });

  assert.equal(calls[0].url, "/api/audit-chain/verify");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.equal(chain.valid, true);
  assert.equal(chain.count, 3);
  assert.equal(chain.headHash.slice(0, 4), "aaaa");
  assert.deepEqual(chain.actions, ["finding.created"]);
});

test("loadReportExportManifest fetches export manifest details", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return jsonResponse({
      data: {
        id: "report-export-1",
        reportType: "full",
        reportId: "full-20260606160000",
        payloadHash: "c".repeat(64),
        auditEventId: "audit-1",
        approvalId: "approval-1",
        auditChain: { valid: true, count: 1 },
      },
    });
  };

  const manifest = await loadReportExportManifest("report-export-1", { fetcher });

  assert.equal(calls[0], "/api/report-exports/report-export-1/manifest");
  assert.equal(manifest.id, "report-export-1");
  assert.equal(manifest.auditChain.valid, true);
  assert.equal(manifest.approvalId, "approval-1");
});

test("loadEvidenceArchive fetches archive summary", async () => {
  const fetcher = async () => jsonResponse({
    data: {
      generatedAt: "2026-06-06T16:00:00.000Z",
      auditChain: { valid: true, count: 2, tailHash: "d".repeat(64) },
      reportExports: {
        count: 1,
        latest: { id: "report-export-1", reportType: "executive" },
        byType: { executive: 1 },
        items: [{ id: "report-export-1", reportType: "executive" }],
      },
      approvals: { total: 1, pending: 0, approved: 1, rejected: 0 },
    },
  });

  const archive = await loadEvidenceArchive({ fetcher });

  assert.equal(archive.auditChain.valid, true);
  assert.equal(archive.reportExports.count, 1);
  assert.equal(archive.reportExports.items[0].reportType, "executive");
  assert.equal(archive.approvals.approved, 1);
});

test("loadEvidenceArchive appends optional evidence filters", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return jsonResponse({ data: {} });
  };

  await loadEvidenceArchive({
    fetcher,
    reportType: "executive",
    action: "report.export",
    entityType: "report",
  });

  assert.equal(calls[0], "/api/evidence/archive?reportType=executive&action=report.export&entityType=report");
});

test("loadEvidenceBundle fetches and normalizes filtered bundle payloads", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return jsonResponse({
      data: {
        generatedAt: "2026-06-06T16:00:00.000Z",
        bundleId: "evidence-bundle-abc123",
        filters: { reportType: "executive" },
        archive: {
          auditChain: { valid: true, count: 4 },
          reportExports: {
            count: 1,
            latest: { id: "report-export-1", reportType: "executive" },
            items: [{ id: "report-export-1", report_type: "executive" }],
          },
          approvals: { total: 1, approved: 1 },
        },
        reportExports: {
          count: 1,
          items: [{ id: "report-export-1", report_type: "executive", audit_chain: { valid: true, count: 1 } }],
        },
        approvals: {
          count: 1,
          items: [{ id: "approval-1", status: "approved" }],
        },
        auditEvents: {
          count: 1,
          actions: ["report.exported"],
          items: [{ id: "audit-1", action: "report.exported", entityType: "report-export" }],
        },
      },
    });
  };

  const bundle = await loadEvidenceBundle({
    fetcher,
    reportType: "executive",
    action: "report.export",
    entityType: "report",
  });

  assert.equal(calls[0], "/api/evidence/bundle?reportType=executive&action=report.export&entityType=report");
  assert.equal(bundle.generatedAt, "2026-06-06T16:00:00.000Z");
  assert.equal(bundle.bundleId, "evidence-bundle-abc123");
  assert.deepEqual(bundle.filters, { reportType: "executive" });
  assert.equal(bundle.archive.auditChain.valid, true);
  assert.equal(bundle.archive.reportExports.items[0].reportType, "executive");
  assert.equal(bundle.reportExports[0].reportType, "executive");
  assert.equal(bundle.reportExports[0].auditChain.valid, true);
  assert.deepEqual(bundle.approvals, [{ id: "approval-1", status: "approved" }]);
  assert.deepEqual(bundle.auditEvents, [{ id: "audit-1", action: "report.exported", entityType: "report-export" }]);
});

test("normalizers provide stable defaults for sparse evidence payloads", () => {
  assert.deepEqual(normalizeAuditChain({}), {
    valid: false,
    count: 0,
    headHash: "",
    tailHash: "",
    brokenAt: null,
    actions: [],
    latestEvent: null,
    raw: {},
  });

  assert.deepEqual(normalizeReportExportManifest({ id: "export-1" }), {
    id: "export-1",
    reportType: "report",
    reportId: "report-export",
    generatedAt: "",
    createdBy: "system",
    payloadHash: "",
    auditEventId: null,
    approvalId: null,
    metadata: {},
    auditChain: normalizeAuditChain({}),
    raw: { id: "export-1" },
  });

  assert.deepEqual(normalizeEvidenceArchive({}), {
    generatedAt: "",
    auditChain: normalizeAuditChain({}),
    reportExports: {
      count: 0,
      latest: null,
      byType: {},
      items: [],
    },
    approvals: {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    },
    raw: {},
  });
});

test("normalizeEvidenceBundle provides stable defaults for sparse payloads", () => {
  assert.deepEqual(normalizeEvidenceBundle({}), {
    generatedAt: "",
    bundleId: "",
    filters: {},
    archive: normalizeEvidenceArchive({}),
    reportExports: [],
    approvals: [],
    auditEvents: [],
    raw: {},
  });
});
