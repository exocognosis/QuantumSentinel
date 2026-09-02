import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";

import { createApiServer } from "./app.js";

const listen = async (options = {}) => {
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
};

test("runs only authorized and rate-limited public domain scans", async () => {
  const requests = [];
  const api = await listen({
    publicScanLimitPerMinute: 1,
    publicDomainScanner: async (domain, options) => {
      requests.push({ domain, options });
      return { scan: { target: domain, kind: "domain" }, findings: [] };
    },
  });

  try {
    const denied = await fetch(`${api.baseUrl}/api/public/domain-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "example.com" }),
    });
    assert.equal(denied.status, 400);

    const accepted = await fetch(`${api.baseUrl}/api/public/domain-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "example.com", authorized: true }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(requests, [{ domain: "example.com", options: { ports: [443], timeoutMs: 5_000 } }]);

    const limited = await fetch(`${api.baseUrl}/api/public/domain-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: "example.org", authorized: true }),
    });
    assert.equal(limited.status, 429);
  } finally {
    await api.close();
  }
});

test("runs only authorized, GitHub-only, rate-limited public repository scans", async () => {
  const requests = [];
  const api = await listen({
    publicRepositoryScanLimitPerMinute: 1,
    publicRepositoryScanner: async (repository, options) => {
      requests.push({ repository, options });
      return { scan: { targetName: "owner/repository" }, score: { readinessScore: 100 }, findings: [] };
    },
  });

  try {
    const denied = await fetch(`${api.baseUrl}/api/public/repository-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: "https://github.com/owner/repository" }),
    });
    assert.equal(denied.status, 400);

    const invalid = await fetch(`${api.baseUrl}/api/public/repository-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: "/etc", authorized: true }),
    });
    assert.equal(invalid.status, 400);

    const accepted = await fetch(`${api.baseUrl}/api/public/repository-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: "https://github.com/owner/repository", authorized: true }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].repository, "https://github.com/owner/repository.git");
    assert.deepEqual(requests[0].options, {
      maxFiles: 1_000,
      maxFileBytes: 512 * 1024,
      maxTotalBytes: 10 * 1024 * 1024,
      maxFindings: 500,
      maxCheckoutBytes: 64 * 1024 * 1024,
      cloneTimeoutMs: 30_000,
    });

    const limited = await fetch(`${api.baseUrl}/api/public/repository-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: "https://github.com/owner/second", authorized: true }),
    });
    assert.equal(limited.status, 429);
  } finally {
    await api.close();
  }
});

test("limits concurrent public repository scans", async () => {
  let releaseScan;
  const blockedScan = new Promise((resolve) => { releaseScan = resolve; });
  const api = await listen({
    publicRepositoryScanLimitPerMinute: 5,
    publicRepositoryScanConcurrency: 1,
    publicRepositoryScanner: async () => blockedScan,
  });

  try {
    const first = fetch(`${api.baseUrl}/api/public/repository-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: "https://github.com/owner/first", authorized: true }),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await fetch(`${api.baseUrl}/api/public/repository-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository: "https://github.com/owner/second", authorized: true }),
    });
    assert.equal(second.status, 503);
    releaseScan({ scan: {}, score: {}, findings: [] });
    assert.equal((await first).status, 200);
  } finally {
    await api.close();
  }
});

test("runs only authorized and rate-limited uploaded file scans", async () => {
  const requests = [];
  const api = await listen({
    publicFileScanLimitPerMinute: 1,
    publicFileScanner: async (file, options) => {
      requests.push({ file, options });
      return { scan: { targetName: file.filename, kind: "uploaded-file" }, findings: [] };
    },
  });

  try {
    const denied = await fetch(`${api.baseUrl}/api/public/file-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "crypto.js", content: "RSA" }),
    });
    assert.equal(denied.status, 400);

    const accepted = await fetch(`${api.baseUrl}/api/public/file-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "crypto.js", content: "RSA", authorized: true }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(requests, [{
      file: { filename: "crypto.js", content: "RSA" },
      options: { maxFileBytes: 512 * 1024, maxFindings: 250 },
    }]);

    const limited = await fetch(`${api.baseUrl}/api/public/file-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "second.js", content: "ECDSA", authorized: true }),
    });
    assert.equal(limited.status, 429);
  } finally {
    await api.close();
  }
});

test("creates a protected network connector session and accepts one scoped result", async () => {
  const api = await listen({ publicNetworkSessionLimitPerMinute: 2 });

  try {
    const createdResponse = await fetch(`${api.baseUrl}/api/public/network-scans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hosts: ["10.0.0.10"], ports: [443], authorized: true }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).data;
    assert.equal(created.status, "waiting_for_connector");

    const deniedRead = await fetch(`${api.baseUrl}/api/public/network-scans/${created.id}`);
    assert.equal(deniedRead.status, 403);

    const job = {
      id: "probe-connector",
      mode: "discovery",
      status: "completed",
      result: {
        summary: { targetsScanned: 1, completedCount: 1, failedCount: 0 },
        observations: [{ host: "10.0.0.10", port: 443, status: "completed" }],
      },
    };
    const submittedResponse = await fetch(`${api.baseUrl}/api/public/network-scans/${created.id}/results`, {
      method: "POST",
      headers: { "authorization": `Bearer ${created.uploadToken}`, "content-type": "application/json" },
      body: JSON.stringify({ job }),
    });
    assert.equal(submittedResponse.status, 200);

    const resultResponse = await fetch(`${api.baseUrl}/api/public/network-scans/${created.id}`, {
      headers: { "authorization": `Bearer ${created.readToken}` },
    });
    assert.equal(resultResponse.status, 200);
    const result = (await resultResponse.json()).data;
    assert.equal(result.status, "completed");
    assert.equal(result.result.result.observations[0].host, "10.0.0.10");
  } finally {
    await api.close();
  }
});

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
