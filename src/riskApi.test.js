import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadAssetRisk,
  normalizeAssetRisk,
  normalizeRecomputeRiskResult,
  recomputeRisk,
} from "./riskApi.js";

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

test("loadAssetRisk fetches and normalizes flexible risk analysis payloads", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        asset: {
          asset_id: 5,
          hostname: "db-primary-finance",
          algo: "RSA-2048",
          proto: "TLS 1.2",
          cls: "shor critical",
          risk: { score: "90", hndl: "88", tnfl: "55", priority: "critical" },
        },
        analysis: {
          classification: { label: "SHOR-CRITICAL", reason: "public key exposure" },
          scores: {
            hndl: "88",
            tnfl: "55",
            risk: "90",
            factors: {
              hndl: [{ name: "harvestable-financial-data", score: "30" }],
              tnfl: [{ name: "certificate-signature", score: 18 }],
            },
          },
          remediation: {
            action: "Migrate Shor-vulnerable public-key cryptography",
            target: "ML-KEM-768",
            detail: "Rotate TLS keys after rollout.",
            complexity: "MEDIUM",
          },
        },
        drift: { drift_detected: true, events: [{ type: "PFS_LOSS", severity: "high" }] },
        findings: [{ id: 12, title: "Finance TLS HNDL exposure", severity: "critical" }],
      },
    });
  };

  const risk = await loadAssetRisk(5, { fetcher, baseUrl: "https://sentinel.example/" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/assets/5/risk");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.equal(risk.asset.id, "5");
  assert.equal(risk.asset.hostname, "db-primary-finance");
  assert.equal(risk.classification.label, "SHOR-CRITICAL");
  assert.deepEqual(risk.scores, { hndl: 88, tnfl: 55, risk: 90 });
  assert.deepEqual(risk.drivers.map((driver) => driver.id), ["hndl-harvestable-financial-data", "tnfl-certificate-signature"]);
  assert.equal(risk.drift.driftDetected, true);
  assert.equal(risk.drift.events.length, 1);
  assert.equal(risk.findings[0].id, "12");
  assert.equal(risk.remediation.target, "ML-KEM-768");
});

test("loadAssetRisk returns null when the API is unavailable", async () => {
  const risk = await loadAssetRisk(1, {
    fetcher: async () => jsonResponse({ error: "offline" }, { ok: false, status: 503 }),
  });

  const nextRisk = await loadAssetRisk(1, { fetcher: null });
  assert.equal(risk, null);
  assert.equal(nextRisk, null);
});

test("normalizeAssetRisk handles direct analysis-shaped payloads", () => {
  const risk = normalizeAssetRisk({
    assetId: "asset/x",
    hostname: "edge-x",
    classification: "hybrid",
    priority: "monitor",
    hndl: 12,
    tnfl: 15,
    risk: 14,
    migration: { target: "Full PQC when ready", complexity: "LOW" },
    riskDrivers: ["hybrid key exchange", { label: "downgrade watch", weight: 7 }],
  });

  assert.equal(risk.asset.id, "asset/x");
  assert.equal(risk.classification.label, "HYBRID");
  assert.equal(risk.priority, "MONITOR");
  assert.deepEqual(risk.scores, { hndl: 12, tnfl: 15, risk: 14 });
  assert.deepEqual(risk.drivers.map((driver) => driver.label), ["hybrid key exchange", "downgrade watch"]);
  assert.equal(risk.remediation.target, "Full PQC when ready");
});

test("recomputeRisk posts scope and normalizes created findings", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        analyses: [
          {
            asset: { id: 5, hostname: "db-primary-finance", risk: 90 },
            analysis: {
              classification: { label: "SHOR-CRITICAL" },
              scores: { hndl: 88, tnfl: 55, risk: 90 },
              remediation: { target: "ML-KEM-768" },
            },
            findings: [{ id: "generated-1", severity: "critical", title: "Generated HNDL finding" }],
          },
        ],
        created_findings: [{ id: "persisted-1", severity: "critical" }],
      },
    });
  };

  const result = await recomputeRisk({ assetId: 5, persist: true }, { fetcher });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/risk/recompute");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), { assetId: 5, persist: true });
  assert.equal(result.analyses.length, 1);
  assert.equal(result.analyses[0].classification.label, "SHOR-CRITICAL");
  assert.equal(result.analyses[0].findings[0].id, "generated-1");
  assert.equal(result.createdFindings[0].id, "persisted-1");
  assert.equal(result.count, 1);
});

test("normalizeRecomputeRiskResult accepts sparse payloads", () => {
  const result = normalizeRecomputeRiskResult({
    analysis: {
      asset: { id: 3, hostname: "ca-root-internal" },
      classification: { label: "SHOR-CRITICAL" },
    },
    createdFindings: null,
  });

  assert.equal(result.count, 1);
  assert.equal(result.analyses[0].asset.hostname, "ca-root-internal");
  assert.deepEqual(result.createdFindings, []);
});
