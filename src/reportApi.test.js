import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadReport,
  loadReports,
  normalizeReport,
} from "./reportApi.js";

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

test("loadReports fetches reports and normalizes array payloads", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: [
        {
          report_id: "exec-2026-06-06",
          report_type: "executive",
          name: "Executive Risk Brief",
          generated_at: "2026-06-06T16:00:00.000Z",
          scope: { assets: 18, critical: 4 },
          summary: { criticalAssets: "4", openFindings: 9 },
          sections: [{ heading: "Risk posture", findings: 3 }],
          evidence_refs: ["probe:tls-1", { id: "cbom:asset-1", label: "CBOM asset 1" }],
        },
      ],
      count: 1,
    });
  };

  const result = await loadReports({ fetcher, baseUrl: "https://sentinel.example/" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/reports");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.equal(result.count, 1);
  assert.deepEqual(result.reports, [
    {
      reportId: "exec-2026-06-06",
      type: "executive",
      title: "Executive Risk Brief",
      generatedAt: "2026-06-06T16:00:00.000Z",
      scope: { assets: 18, critical: 4 },
      summary: { criticalAssets: 4, openFindings: 9 },
      sections: [
        {
          id: "section-1",
          title: "Risk posture",
          summary: "",
          items: [],
          raw: { heading: "Risk posture", findings: 3 },
        },
      ],
      evidenceRefs: [
        { id: "probe:tls-1", label: "probe:tls-1", type: "evidence" },
        { id: "cbom:asset-1", label: "CBOM asset 1", type: "evidence" },
      ],
      raw: {
        report_id: "exec-2026-06-06",
        report_type: "executive",
        name: "Executive Risk Brief",
        generated_at: "2026-06-06T16:00:00.000Z",
        scope: { assets: 18, critical: 4 },
        summary: { criticalAssets: "4", openFindings: 9 },
        sections: [{ heading: "Risk posture", findings: 3 }],
        evidence_refs: ["probe:tls-1", { id: "cbom:asset-1", label: "CBOM asset 1" }],
      },
    },
  ]);
});

test("loadReports accepts nested reports payloads", async () => {
  const result = await loadReports({
    fetcher: async () => jsonResponse({
      data: {
        reports: [
          { id: "compliance-1", type: "compliance", title: "Compliance Export" },
          { id: "cbom-1", type: "cbom", title: "CBOM Snapshot" },
        ],
      },
    }),
  });

  assert.equal(result.count, 2);
  assert.deepEqual(result.reports.map((report) => report.reportId), ["compliance-1", "cbom-1"]);
});

test("loadReport fetches the selected report type endpoint", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        reportId: "remediation-2026-06-06",
        type: "remediation",
        title: "Remediation Queue",
        generatedAt: "2026-06-06T16:10:00.000Z",
        summary: [
          { label: "Open", value: "7" },
          { label: "Overdue", value: 2 },
        ],
        sections: {
          immediate: {
            title: "Immediate",
            summary: "Critical service owners",
            items: ["edge-team", "pki-team"],
          },
        },
        evidenceRefs: [{ refId: "finding-1", type: "finding", title: "Gateway finding" }],
      },
    });
  };

  const report = await loadReport("remediation", { fetcher });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/reports/remediation");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.equal(report.reportId, "remediation-2026-06-06");
  assert.equal(report.type, "remediation");
  assert.deepEqual(report.summary, { Open: 7, Overdue: 2 });
  assert.deepEqual(report.sections, [
    {
      id: "immediate",
      title: "Immediate",
      summary: "Critical service owners",
      items: ["edge-team", "pki-team"],
      raw: {
        title: "Immediate",
        summary: "Critical service owners",
        items: ["edge-team", "pki-team"],
      },
    },
  ]);
  assert.deepEqual(report.evidenceRefs, [
    { id: "finding-1", label: "Gateway finding", type: "finding" },
  ]);
});

test("loadReport uses the requested type when the payload omits type", async () => {
  const report = await loadReport("cbom", {
    fetcher: async () => jsonResponse({
      data: {
        reportId: "cbom-generated",
        generatedAt: "2026-06-06T16:15:00.000Z",
        summary: { algorithms: 7 },
      },
    }),
  });

  assert.equal(report.reportId, "cbom-generated");
  assert.equal(report.type, "cbom");
  assert.equal(report.title, "CBOM");
  assert.deepEqual(report.summary, { algorithms: 7 });
});

test("loadReport returns null when unavailable", async () => {
  const report = await loadReport("executive", {
    fetcher: async () => jsonResponse({ error: "offline" }, { ok: false, status: 503 }),
  });

  const nextReport = await loadReport("executive", {
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(report, null);
  assert.equal(nextReport, null);
});

test("normalizeReport fills operational defaults for sparse reports", () => {
  const report = normalizeReport({ reportId: "", type: "full" }, 2);

  assert.equal(report.reportId, "full-report-3");
  assert.equal(report.type, "full");
  assert.equal(report.title, "Full Evidence Package");
  assert.equal(typeof report.generatedAt, "string");
  assert.deepEqual(report.scope, {});
  assert.deepEqual(report.summary, {});
  assert.deepEqual(report.sections, []);
  assert.deepEqual(report.evidenceRefs, []);
});

test("loadReports returns no reports without fetch", async () => {
  const result = await loadReports({ fetcher: null });

  const nextResult = await loadReports({ fetcher: null });

  assert.deepEqual(result, { reports: [], count: 0 });
  assert.deepEqual(nextResult, { reports: [], count: 0 });
});
