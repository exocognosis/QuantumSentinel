import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { test } from "node:test";

import { ASSETS } from "../src/mockData.js";
import { createApiServer } from "./app.js";
import { createProbeJob, getProbeJob, listProbeJobs, resetProbeJobs } from "./probeEngine.js";

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

const listenTcp = async () => {
  const server = net.createServer((socket) => socket.destroy());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();
  return {
    port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
};

const unusedLocalPort = async () => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
};

test("creates, lists, and gets completed simulated probe jobs for seed assets", async () => {
  resetProbeJobs();

  const job = await createProbeJob({ assetId: 1 });

  assert.equal(job.id, "probe-1");
  assert.equal(job.status, "completed");
  assert.equal(job.mode, "simulate");
  assert.equal(job.target.assetId, 1);
  assert.equal(job.target.hostname, "api-gateway-prod-01");
  assert.equal(job.result.protocol.name, "TLS 1.3");
  assert.equal(job.result.certificate.algorithm, "RSA-2048");
  assert.equal(job.result.classification.label, "SHOR-CRITICAL");
  assert.equal(job.result.classification.priority, "CRITICAL");
  assert.equal(job.error, null);
  assert.match(job.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.deepEqual(listProbeJobs(), [job]);
  assert.deepEqual(getProbeJob(job.id), job);
});

test("rejects simulated probes for unknown seed assets", async () => {
  resetProbeJobs();

  await assert.rejects(
    () => createProbeJob({ assetId: ASSETS.length + 100 }),
    /Asset not found/,
  );
  assert.deepEqual(listProbeJobs(), []);
});

test("preserves optional asset identity for direct TLS probes", async () => {
  resetProbeJobs();
  const port = await unusedLocalPort();

  const job = await createProbeJob({
    mode: "tls",
    assetId: 1,
    host: "127.0.0.1",
    port,
    timeoutMs: 100,
  });

  assert.equal(job.mode, "tls");
  assert.equal(job.target.assetId, 1);
  assert.equal(job.target.host, "127.0.0.1");
  assert.equal(job.target.port, port);
});

test("rejects invalid direct TLS probe asset and host inputs", async () => {
  resetProbeJobs();

  await assert.rejects(
    () => createProbeJob({ mode: "tls", assetId: "asset-1", host: "127.0.0.1", timeoutMs: 100 }),
    /assetId must be an integer/,
  );
  await assert.rejects(
    () => createProbeJob({ mode: "tls", assetId: 1, host: "https://example.com", timeoutMs: 100 }),
    /host must be a valid hostname or IP address/,
  );
  assert.deepEqual(listProbeJobs(), []);
});

test("device probes collect runtime metadata across a bounded loopback port set", async () => {
  resetProbeJobs();
  const port = await unusedLocalPort();
  const job = await createProbeJob({ mode: "device", scope: "ipv4", ports: [port], timeoutMs: 100 });

  assert.equal(job.status, "completed");
  assert.equal(job.mode, "device");
  assert.deepEqual(job.target.hosts, ["127.0.0.1"]);
  assert.deepEqual(job.target.ports, [port]);
  assert.equal(job.result.source, "device");
  assert.equal(job.result.runtime.openssl, process.versions.openssl);
  assert.equal(job.result.summary.targetsScanned, 1);
});

test("network discovery probes multiple authorized ports with bounded concurrency", async () => {
  resetProbeJobs();
  const reachable = await listenTcp();
  const unreachablePort = await unusedLocalPort();
  try {
    const job = await createProbeJob({ mode: "discovery", hosts: ["127.0.0.1"], ports: [reachable.port, unreachablePort], concurrency: 2, timeoutMs: 100 });
    assert.equal(job.status, "completed");
    assert.deepEqual(job.target.ports, [reachable.port, unreachablePort]);
    assert.equal(job.target.concurrency, 2);
    assert.equal(job.result.summary.targetsScanned, 2);
    assert.equal(job.result.summary.completedCount, 1);
    assert.equal(job.result.summary.failedCount, 1);
  } finally {
    await reachable.close();
  }
});

test("serves probe collection, detail, and creation routes", async () => {
  resetProbeJobs();
  const api = await listen();

  try {
    const createdResponse = await fetch(`${api.baseUrl}/api/probes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: 13 }),
    });
    const created = await createdResponse.json();

    assert.equal(createdResponse.status, 201);
    assert.equal(created.data.id, "probe-1");
    assert.equal(created.data.target.hostname, "api-gw-pqc-pilot");
    assert.equal(created.data.result.classification.label, "HYBRID");

    const listResponse = await fetch(`${api.baseUrl}/api/probes`);
    const list = await listResponse.json();

    assert.equal(listResponse.status, 200);
    assert.equal(list.count, 1);
    assert.deepEqual(list.data, [created.data]);

    const detailResponse = await fetch(`${api.baseUrl}/api/probes/${created.data.id}`);
    const detail = await detailResponse.json();

    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detail.data, created.data);

    const missingResponse = await fetch(`${api.baseUrl}/api/probes/probe-missing`);
    const missing = await missingResponse.json();

    assert.equal(missingResponse.status, 404);
    assert.deepEqual(missing, { error: "Probe not found" });
  } finally {
    await api.close();
  }
});

test("returns bad request responses for invalid probe payloads", async () => {
  resetProbeJobs();
  const api = await listen();

  try {
    const invalidJsonResponse = await fetch(`${api.baseUrl}/api/probes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const invalidJson = await invalidJsonResponse.json();

    assert.equal(invalidJsonResponse.status, 400);
    assert.deepEqual(invalidJson, { error: "Invalid JSON body" });

    const invalidProbeResponse = await fetch(`${api.baseUrl}/api/probes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "simulate" }),
    });
    const invalidProbe = await invalidProbeResponse.json();

    assert.equal(invalidProbeResponse.status, 400);
    assert.deepEqual(invalidProbe, { error: "assetId is required for simulated probes" });
  } finally {
    await api.close();
  }
});

test("creates discovery jobs with local TCP reachability observations", async () => {
  resetProbeJobs();
  const reachable = await listenTcp();
  const failedPort = await unusedLocalPort();

  try {
    const success = await createProbeJob({
      mode: "discovery",
      hosts: ["127.0.0.1"],
      port: reachable.port,
      timeoutMs: 500,
    });

    assert.equal(success.mode, "discovery");
    assert.equal(success.status, "completed");
    assert.deepEqual(success.target, {
      hosts: ["127.0.0.1"],
      port: reachable.port,
    });
    assert.equal(success.result.summary.targetsScanned, 1);
    assert.equal(success.result.summary.completedCount, 1);
    assert.equal(success.result.summary.failedCount, 0);
    assert.equal(success.result.observations.length, 1);
    assert.equal(success.result.observations[0].host, "127.0.0.1");
    assert.equal(success.result.observations[0].port, reachable.port);
    assert.equal(success.result.observations[0].status, "completed");
    assert.equal(success.result.observations[0].reachability.tcp, true);
    assert.equal(typeof success.result.observations[0].reachability.tls, "boolean");
    assert.ok(Array.isArray(success.result.findings));

    const failure = await createProbeJob({
      mode: "discovery",
      hosts: ["127.0.0.1"],
      port: failedPort,
      timeoutMs: 100,
    });

    assert.equal(failure.status, "completed");
    assert.equal(failure.result.summary.targetsScanned, 1);
    assert.equal(failure.result.summary.completedCount, 0);
    assert.equal(failure.result.summary.failedCount, 1);
    assert.equal(failure.result.observations[0].status, "failed");
    assert.equal(failure.result.observations[0].reachability.tcp, false);
    assert.match(failure.result.observations[0].error, /ECONNREFUSED|timed out/i);
    assert.deepEqual(listProbeJobs().map((job) => job.id), ["probe-1", "probe-2"]);
  } finally {
    await reachable.close();
  }
});

test("rejects discovery payloads without a bounded host list", async () => {
  resetProbeJobs();
  const api = await listen();

  try {
    const missingHostsResponse = await fetch(`${api.baseUrl}/api/probes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "discovery" }),
    });
    const missingHosts = await missingHostsResponse.json();

    assert.equal(missingHostsResponse.status, 400);
    assert.deepEqual(missingHosts, { error: "hosts is required for discovery probes" });

    const tooManyHostsResponse = await fetch(`${api.baseUrl}/api/probes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "discovery",
        hosts: Array.from({ length: 17 }, (_, index) => `127.0.0.${index + 1}`),
      }),
    });
    const tooManyHosts = await tooManyHostsResponse.json();

    assert.equal(tooManyHostsResponse.status, 400);
    assert.deepEqual(tooManyHosts, { error: "discovery probes are limited to 16 hosts" });
  } finally {
    await api.close();
  }
});

test("rejects discovery payloads with invalid targets or excessive timeout", async () => {
  resetProbeJobs();

  await assert.rejects(
    () => createProbeJob({
      mode: "discovery",
      hosts: ["127.0.0.1", "bad host name"],
    }),
    /host entries must be valid hostnames or IP addresses/,
  );

  await assert.rejects(
    () => createProbeJob({
      mode: "discovery",
      hosts: ["127.0.0.1"],
      timeoutMs: 5_001,
    }),
    /timeoutMs must be between 1 and 5000/,
  );
});
