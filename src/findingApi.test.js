import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendFindingNote,
  findingFallbackFindings,
  loadFindings,
  loadRemediationSummary,
  normalizeFinding,
  updateFinding,
} from "./findingApi.js";

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

test("loadFindings fetches and normalizes flexible API fields", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: [
        {
          finding_id: 42,
          asset_id: 7,
          severity: "critical",
          finding_type: "tnfl",
          name: "Code signing trust chain exposed",
          details: "ECDSA-P256 signing path remains active.",
          state: "in progress",
          assignee: "crypto-ops",
          due_at: "2026-06-10T12:00:00.000Z",
          remediation: { target: "ML-DSA-65 signing profile" },
          asset: { id: 7, hostname: "code-sign-srv-01" },
          history: [{ note: "Owner accepted" }],
        },
      ],
      count: 1,
    });
  };

  const findings = await loadFindings({
    fetcher,
    baseUrl: "https://sentinel.example/",
    filters: { status: "open", severity: "critical", owner: "crypto-ops", empty: "" },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/findings?status=open&severity=critical&owner=crypto-ops");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.deepEqual(findings, [
    {
      id: "42",
      assetId: "7",
      assetName: "code-sign-srv-01",
      severity: "CRITICAL",
      type: "TNFL",
      title: "Code signing trust chain exposed",
      description: "ECDSA-P256 signing path remains active.",
      evidence: "",
      source: "api",
      status: "IN_PROGRESS",
      owner: "crypto-ops",
      dueAt: "2026-06-10T12:00:00.000Z",
      priority: "CRITICAL",
      approvalId: null,
      remediation: { target: "ML-DSA-65 signing profile" },
      remediationTarget: "ML-DSA-65 signing profile",
      resolution: "",
      updatedAt: null,
      closedAt: null,
      notes: [{ note: "Owner accepted" }],
      asset: { id: 7, hostname: "code-sign-srv-01" },
    },
  ]);
});

test("updateFinding patches lifecycle fields and normalizes nested finding payloads", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      finding: {
        id: "finding/a",
        assetId: "1",
        severity: "high",
        type: "hndl",
        title: "Gateway HNDL exposure",
        status: "remediated",
        owner: "edge-team",
        closedAt: "2026-06-12T17:00:00.000Z",
      },
    });
  };

  const finding = await updateFinding("finding/a", { status: "remediated", owner: "edge-team" }, { fetcher });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/findings/finding%2Fa");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(calls[0].options.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.equal(calls[0].options.body, JSON.stringify({ status: "remediated", owner: "edge-team" }));
  assert.equal(finding.id, "finding/a");
  assert.equal(finding.status, "REMEDIATED");
  assert.equal(finding.owner, "edge-team");
  assert.equal(finding.closedAt, "2026-06-12T17:00:00.000Z");
});

test("appendFindingNote posts note text and accepts returned finding data", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        id: "finding-2",
        asset_id: "ca-root-internal",
        severity: "critical",
        status: "triaged",
        notes: [{ text: "PKI owner notified", author: "analyst" }],
      },
    });
  };

  const finding = await appendFindingNote("finding-2", "PKI owner notified", { fetcher, author: "analyst" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/findings/finding-2/notes");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    note: "PKI owner notified",
    author: "analyst",
  });
  assert.equal(finding.id, "finding-2");
  assert.equal(finding.status, "TRIAGED");
  assert.deepEqual(finding.notes, [{ text: "PKI owner notified", author: "analyst" }]);
});

test("loadRemediationSummary fetches and normalizes summary counters", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        open_critical: "3",
        overdue: 2,
        dueSoon: "4",
        in_progress: 5,
        closed: 7,
      },
    });
  };

  const summary = await loadRemediationSummary({ fetcher, baseUrl: "https://sentinel.example" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/remediation/summary");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.deepEqual(summary, {
    openCritical: 3,
    overdue: 2,
    dueSoon: 4,
    inProgress: 5,
    remediatedClosed: 7,
    total: 21,
  });
});

test("loadFindings and summary fall back to cloned local data when API is unavailable", async () => {
  const findings = await loadFindings({
    fetcher: async () => jsonResponse({ error: "offline" }, { ok: false, status: 503 }),
  });
  const summary = await loadRemediationSummary({
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.deepEqual(findings, findingFallbackFindings);
  assert.notEqual(findings, findingFallbackFindings);
  assert.equal(summary.openCritical > 0, true);

  findings[0].status = "MUTATED";
  const nextFindings = await loadFindings({ fetcher: undefined });
  assert.equal(nextFindings[0].status, findingFallbackFindings[0].status);
});

test("normalizeFinding derives titles and remediation targets from asset-shaped records", () => {
  const finding = normalizeFinding({
    asset: { id: 3, hostname: "ca-root-internal", migration: "ML-DSA-87" },
    severity: "critical",
    category: "trust chain",
    description: "CA root still uses RSA-4096.",
    state: "open",
  });

  assert.equal(finding.id, "finding-1");
  assert.equal(finding.assetId, "3");
  assert.equal(finding.assetName, "ca-root-internal");
  assert.equal(finding.type, "TRUST_CHAIN");
  assert.equal(finding.title, "Critical trust chain finding on ca-root-internal");
  assert.equal(finding.remediationTarget, "ML-DSA-87");
});
