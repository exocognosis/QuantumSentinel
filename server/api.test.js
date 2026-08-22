import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

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

test("serves health and empty collection endpoints with CORS before scans", async () => {
  const api = await listen();

  try {
    const expectations = [
      ["/api/assets", []],
      ["/api/alerts", []],
      ["/api/compliance", []],
      ["/api/trends", []],
      ["/api/algorithms", []],
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

test("derives an empty portfolio summary before scans", async () => {
  const api = await listen();

  try {
    const { response, body } = await getJson(api.baseUrl, "/api/summary");

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      data: {
        assets: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          monitor: 0,
          shorCritical: 0,
          quantumSafe: 0,
          hybrid: 0,
          deprecated: 0,
          noPfs: 0,
          averageRisk: 0,
        },
        alerts: {
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          info: 0,
        },
        compliance: {
          averagePct: 0,
          red: 0,
          amber: 0,
          green: 0,
        },
        trends: {
          latestRisk: 0,
          latestSafe: 0,
          riskDelta: 0,
          safeDelta: 0,
        },
      },
    });
  } finally {
    await api.close();
  }
});

test("generates an empty CBOM before scans", async () => {
  const api = await listen();

  try {
    const { response, body } = await getJson(api.baseUrl, "/api/cbom");

    assert.equal(response.status, 200);
    assert.equal(body.count, 0);
    assert.deepEqual(body.summary, {
      totalComponents: 0,
      vulnerableComponents: 0,
      pfsEnabled: 0,
      requiresHardwareRefresh: 0,
      migrationTargets: {},
    });
    assert.deepEqual(body.data, []);
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
    assert.match(chunk, /"assets":\{"total":0/);
  } finally {
    await api.close();
  }
});
