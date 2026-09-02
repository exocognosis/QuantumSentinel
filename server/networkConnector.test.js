import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNetworkConnectorArguments,
  runNetworkConnector,
  validateConnectorUploadUrl,
} from "./networkConnector.js";

test("network connector parses a bounded explicit scope", () => {
  const options = parseNetworkConnectorArguments([
    "--hosts", "10.0.0.10,router.local",
    "--ports", "443,8443",
    "--upload-url", "https://dytallix.com/api/quantumsentinel/public/network-scans/123e4567-e89b-12d3-a456-426614174000/results",
    "--token", "a".repeat(43),
  ]);
  assert.deepEqual(options.hosts, ["10.0.0.10", "router.local"]);
  assert.deepEqual(options.ports, [443, 8443]);
});

test("network connector rejects upload destinations outside Dytallix", () => {
  assert.throws(
    () => validateConnectorUploadUrl("https://attacker.example/api/quantumsentinel/public/network-scans/123e4567-e89b-12d3-a456-426614174000/results"),
    /must be a Dytallix network scan result URL/,
  );
  assert.throws(
    () => validateConnectorUploadUrl("https://user:pass@dytallix.com/api/quantumsentinel/public/network-scans/123e4567-e89b-12d3-a456-426614174000/results"),
    /must be a Dytallix network scan result URL/,
  );
});

test("network connector uploads one completed discovery job", async () => {
  const requests = [];
  const job = {
    mode: "discovery",
    status: "completed",
    result: { summary: { targetsScanned: 1, completedCount: 1 }, observations: [] },
  };
  const returned = await runNetworkConnector({
    hosts: ["10.0.0.10"],
    ports: [443],
    timeoutMs: 1_500,
    concurrency: 4,
    uploadUrl: "http://127.0.0.1:8787/api/quantumsentinel/public/network-scans/123e4567-e89b-12d3-a456-426614174000/results",
    token: "b".repeat(43),
  }, {
    allowedOrigin: "http://127.0.0.1:8787",
    createJob: async (request) => {
      assert.equal(request.mode, "discovery");
      return job;
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    },
  });
  assert.equal(returned, job);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.authorization, `Bearer ${"b".repeat(43)}`);
  assert.deepEqual(JSON.parse(requests[0].options.body), { job });
});
