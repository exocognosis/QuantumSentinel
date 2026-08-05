import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import { ALGO_DIST, ALERTS, ASSETS, COMPLIANCE, TREND_DATA } from "../src/mockData.js";
import { createApiServer } from "./app.js";

const listen = async () => {
  const server = createApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const getJson = async (baseUrl, path) => {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.json();
  return { response, body };
};

test("serves health and seed-backed collection endpoints with CORS", async () => {
  const api = await listen();

  try {
    const expectations = [
      ["/api/assets", ASSETS],
      ["/api/alerts", ALERTS],
      ["/api/compliance", COMPLIANCE],
      ["/api/trends", TREND_DATA],
      ["/api/algorithms", ALGO_DIST],
    ];

    const health = await getJson(api.baseUrl, "/api/health");
    assert.equal(health.response.status, 200);
    assert.equal(health.response.headers.get("access-control-allow-origin"), "*");
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.service, "QuantumSentinel API");

    for (const [path, expected] of expectations) {
      const { response, body } = await getJson(api.baseUrl, path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert.deepEqual(body.data, expected, path);
      assert.equal(body.count, expected.length, path);
    }
  } finally {
    await api.close();
  }
});

test("derives a stable portfolio summary from the asset, alert, compliance, and trend seeds", async () => {
  const api = await listen();

  try {
    const { response, body } = await getJson(api.baseUrl, "/api/summary");

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      data: {
        assets: {
          total: 15,
          critical: 8,
          high: 4,
          medium: 1,
          monitor: 2,
          shorCritical: 12,
          quantumSafe: 1,
          hybrid: 1,
          deprecated: 1,
          noPfs: 8,
          averageRisk: 77,
        },
        alerts: {
          total: 7,
          critical: 3,
          high: 2,
          medium: 1,
          info: 1,
        },
        compliance: {
          averagePct: 44,
          red: 2,
          amber: 3,
          green: 1,
        },
        trends: {
          latestRisk: 79,
          latestSafe: 21,
          riskDelta: -15,
          safeDelta: 15,
        },
      },
    });
  } finally {
    await api.close();
  }
});

test("generates deterministic CBOM entries and aggregate crypto posture", async () => {
  const api = await listen();

  try {
    const { response, body } = await getJson(api.baseUrl, "/api/cbom");

    assert.equal(response.status, 200);
    assert.equal(body.count, ASSETS.length);
    assert.deepEqual(body.summary, {
      totalComponents: 15,
      vulnerableComponents: 13,
      pfsEnabled: 7,
      requiresHardwareRefresh: 2,
      migrationTargets: {
        "ML-KEM-768 + ML-DSA-65": 2,
        "ML-KEM-1024": 1,
        "ML-DSA-87": 1,
        "ML-KEM-768": 4,
        "REQUIRES HW REFRESH": 2,
        "ML-DSA-65": 1,
        "ML-DSA-65 + ML-KEM-768": 2,
        "None required": 1,
        "Full PQC when ready": 1,
      },
    });
    assert.deepEqual(body.data[0], {
      componentId: "asset-1",
      assetId: 1,
      hostname: "api-gateway-prod-01",
      assetType: "Load Balancer",
      networkSegment: "DMZ",
      cryptography: {
        algorithm: "RSA-2048",
        protocol: "TLS 1.3",
        classification: "SHOR-CRITICAL",
        perfectForwardSecrecy: false,
        certificateExpiration: "2026-09-14",
      },
      risk: {
        hndl: 91,
        tnfl: 72,
        score: 94,
        priority: "CRITICAL",
      },
      migration: {
        target: "ML-KEM-768 + ML-DSA-65",
        complexity: "MEDIUM",
        hardwareRefreshRequired: false,
      },
    });
  } finally {
    await api.close();
  }
});

test("handles preflight, not found, and SSE event streams", async () => {
  const api = await listen();

  try {
    const options = await fetch(`${api.baseUrl}/api/assets`, { method: "OPTIONS" });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-origin"), "*");

    const missing = await getJson(api.baseUrl, "/api/unknown");
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "Not found" });

    const controller = new AbortController();
    const eventResponse = await fetch(`${api.baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(eventResponse.status, 200);
    assert.equal(eventResponse.headers.get("content-type"), "text/event-stream; charset=utf-8");

    const reader = eventResponse.body.getReader();
    const { value } = await reader.read();
    controller.abort();

    const chunk = new TextDecoder().decode(value);
    assert.match(chunk, /^event: summary\n/m);
    assert.match(chunk, /"assets":\{"total":15/);
  } finally {
    await api.close();
  }
});
