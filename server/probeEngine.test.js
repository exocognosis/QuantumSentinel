import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { test } from "node:test";

import { createApiServer } from "./app.js";
import { createProbeJob, listProbeJobs, portsFromListenerOutput, resetProbeJobs } from "./probeEngine.js";

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

test("rejects simulated probe jobs", async () => {
  resetProbeJobs();

  await assert.rejects(() => createProbeJob({ mode: "simulate", assetId: 1 }), /mode must be tls, discovery, or device/);
  await assert.rejects(() => createProbeJob({ assetId: 1 }), /mode must be tls, discovery, or device/);
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
  const job = await createProbeJob({ mode: "device", scope: "ipv4", ports: [port], discoverActivePorts: false, timeoutMs: 100 });

  assert.equal(job.status, "completed");
  assert.equal(job.mode, "device");
  assert.deepEqual(job.target.hosts, ["127.0.0.1"]);
  assert.deepEqual(job.target.ports, [port]);
  assert.equal(job.result.source, "device");
  assert.equal(job.result.runtime.openssl, process.versions.openssl);
  assert.equal(job.result.summary.targetsScanned, 1);
});

test("parses bounded listening ports from macOS, Linux, and Windows command output", () => {
  const output = [
    "node 123 user 22u IPv6 0x0 TCP *:5173 (LISTEN)",
    "LISTEN 0 511 127.0.0.1:8787 0.0.0.0:*",
    "TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 456",
  ].join("\n");
  assert.deepEqual(portsFromListenerOutput(output), [3000, 5173, 8787]);
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
  const reachable = await listenTcp();
  const api = await listen();

  try {
    const createdResponse = await fetch(`${api.baseUrl}/api/probes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "discovery", hosts: ["127.0.0.1"], port: reachable.port, timeoutMs: 100 }),
    });
    const created = await createdResponse.json();

    assert.equal(createdResponse.status, 201);
    assert.equal(created.data.id, "probe-1");
    assert.equal(created.data.target.hosts[0], "127.0.0.1");
    assert.equal(created.data.result.summary.completedCount, 1);

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
    await reachable.close();
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
    assert.deepEqual(invalidProbe, { error: "mode must be tls, discovery, or device" });
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
