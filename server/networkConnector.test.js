import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNetworkConnectorArguments,
  runNetworkConnector,
  validateConnectorUploadUrl,
} from "./networkConnector.js";

test("network connector parses a bounded explicit scope", () => {
  const options = parseNetworkConnectorArguments([
    "--code", "ABCDEF-123456-ABCDEF-123456",
  ]);
  assert.equal(options.deviceCode, "ABCDEF-123456-ABCDEF-123456");
  assert.equal(parseNetworkConnectorArguments([]).deviceCode, null);
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
  const confirmedScopes = [];
  const job = {
    mode: "discovery",
    status: "completed",
    result: { summary: { targetsScanned: 1, completedCount: 1 }, observations: [] },
  };
  const returned = await runNetworkConnector({
    deviceCode: "ABCDEF-123456-ABCDEF-123456",
  }, {
    allowedOrigin: "http://127.0.0.1:8787",
    confirmScope: async (scope) => {
      confirmedScopes.push(scope);
      return true;
    },
    createJob: async (request) => {
      assert.equal(request.mode, "discovery");
      return job;
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/connect")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: {
            id: "123e4567-e89b-12d3-a456-426614174000",
            uploadToken: "b".repeat(43),
            scope: { hosts: ["10.0.0.10"], ports: [443], timeoutMs: 1_500, concurrency: 4 },
          } }),
        };
      }
      return { ok: true, status: 200 };
    },
  });
  assert.equal(returned, job);
  assert.equal(requests.length, 2);
  assert.deepEqual(confirmedScopes, [{ hosts: ["10.0.0.10"], ports: [443], timeoutMs: 1_500, concurrency: 4 }]);
  assert.deepEqual(JSON.parse(requests[0].options.body), { deviceCode: "ABCDEF-123456-ABCDEF-123456" });
  assert.equal(requests[1].options.headers.authorization, `Bearer ${"b".repeat(43)}`);
  assert.deepEqual(JSON.parse(requests[1].options.body), { job });
});

test("network connector does not probe a scope that is not approved locally", async () => {
  let probeStarted = false;
  await assert.rejects(
    runNetworkConnector({ deviceCode: "ABCDEF-123456-ABCDEF-123456" }, {
      allowedOrigin: "http://127.0.0.1:8787",
      confirmScope: async (scope) => {
        assert.deepEqual(scope.hosts, ["router.local"]);
        assert.deepEqual(scope.ports, [443, 8443]);
        return false;
      },
      createJob: async () => {
        probeStarted = true;
        return null;
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          uploadToken: "b".repeat(43),
          scope: { hosts: ["router.local"], ports: [443, 8443], timeoutMs: 1_500, concurrency: 4 },
        } }),
      }),
    }),
    /not approved/,
  );
  assert.equal(probeStarted, false);
});
