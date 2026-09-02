import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalNetworkJob,
  discoverPrimaryPrivateNetwork,
  parseNetworkConnectorArguments,
  runNetworkConnector,
  validateConnectorUploadUrl,
} from "./networkConnector.js";
import {
  LOCAL_NETWORK_CONCURRENCY,
  LOCAL_NETWORK_MAX_HOSTS,
  LOCAL_NETWORK_MAX_OBSERVATIONS,
  LOCAL_NETWORK_PORTS,
  LOCAL_NETWORK_TIMEOUT_MS,
} from "./networkScanPolicy.js";

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

test("network connector selects a physical private IPv4 network and creates its /24 host list", () => {
  const discovery = discoverPrimaryPrivateNetwork({
    utun4: [{ family: "IPv4", address: "10.8.0.2", internal: false }],
    en5: [{ family: "IPv4", address: "192.168.50.22", internal: false }],
    en0: [
      { family: "IPv6", address: "fe80::1", internal: false },
      { family: "IPv4", address: "10.20.30.44", internal: false },
    ],
    lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
  });

  assert.equal(discovery.interfaceName, "en0");
  assert.equal(discovery.address, "10.20.30.44");
  assert.equal(discovery.cidr, "10.20.30.0/24");
  assert.equal(discovery.hosts.length, LOCAL_NETWORK_MAX_HOSTS);
  assert.equal(discovery.hosts[0], "10.20.30.1");
  assert.equal(discovery.hosts.at(-1), "10.20.30.254");
  assert.throws(
    () => discoverPrimaryPrivateNetwork({ en0: [{ family: "IPv4", address: "203.0.113.4", internal: false }] }),
    /No private IPv4 network was found/,
  );
});

test("automatic network scan uses fixed limits and uploads only reachable services", async () => {
  const requests = [];
  let approvedDiscovery = null;
  let scanRequest = null;
  await runNetworkConnector({ deviceCode: "ABCDEF-123456-ABCDEF-123456" }, {
    allowedOrigin: "http://127.0.0.1:8787",
    networkInterfacesFn: () => ({
      en0: [{ family: "IPv4", address: "192.168.7.20", internal: false }],
    }),
    confirmLocalNetwork: async (discovery) => {
      approvedDiscovery = discovery;
      return true;
    },
    scanNetwork: async (request) => {
      scanRequest = request;
      return {
        observedAt: "2026-09-02T12:00:00.000Z",
        observations: [
          {
            observedAt: "2026-09-02T12:00:00.000Z",
            source: "tls",
            host: "192.168.7.10",
            port: 443,
            status: "completed",
            reachability: { tcp: true, tls: true },
            protocol: { name: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384", perfectForwardSecrecy: true },
            certificate: { algorithm: "RSA-2048", expiresAt: null, fingerprint256: "AA" },
            classification: { label: "SHOR-CRITICAL", quantumVulnerable: true },
            findings: ["Classical public-key cryptography was found"],
          },
          {
            host: "192.168.7.11",
            port: 443,
            status: "failed",
            reachability: { tcp: false, tls: false },
          },
        ],
      };
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
            scope: {
              discoveryMode: "local-network",
              ports: [...LOCAL_NETWORK_PORTS],
              maxHosts: LOCAL_NETWORK_MAX_HOSTS,
              maxObservations: LOCAL_NETWORK_MAX_OBSERVATIONS,
              timeoutMs: LOCAL_NETWORK_TIMEOUT_MS,
              concurrency: LOCAL_NETWORK_CONCURRENCY,
            },
          } }),
        };
      }
      return { ok: true, status: 200 };
    },
  });

  assert.equal(approvedDiscovery.cidr, "192.168.7.0/24");
  assert.deepEqual(scanRequest, {
    hosts: approvedDiscovery.hosts,
    ports: [...LOCAL_NETWORK_PORTS],
    timeoutMs: LOCAL_NETWORK_TIMEOUT_MS,
    concurrency: LOCAL_NETWORK_CONCURRENCY,
  });
  const uploaded = JSON.parse(requests[1].options.body).job;
  assert.equal(uploaded.result.observations.length, 1);
  assert.equal(uploaded.result.observations[0].host, "192.168.7.10");
  assert.equal(uploaded.result.summary.hostsScanned, 254);
  assert.equal(uploaded.result.summary.targetsScanned, 254 * LOCAL_NETWORK_PORTS.length);
  assert.equal(uploaded.result.summary.reachableCount, 1);
  assert.equal(uploaded.result.summary.failedCount, (254 * LOCAL_NETWORK_PORTS.length) - 1);
});

test("automatic network results cap uploaded evidence and keep accurate totals", () => {
  const discovery = discoverPrimaryPrivateNetwork({
    en0: [{ family: "IPv4", address: "10.10.20.5", internal: false }],
  });
  const observations = Array.from({ length: 450 }, (_, index) => ({
    host: `10.10.20.${(index % 254) + 1}`,
    port: LOCAL_NETWORK_PORTS[index % LOCAL_NETWORK_PORTS.length],
    status: "completed",
    reachability: { tcp: true, tls: false },
  }));
  const job = buildLocalNetworkJob(discovery, { observations, observedAt: "2026-09-02T12:00:00.000Z" });

  assert.equal(job.result.observations.length, LOCAL_NETWORK_MAX_OBSERVATIONS);
  assert.equal(job.result.summary.reachableCount, 450);
  assert.equal(job.result.summary.observationsIncluded, LOCAL_NETWORK_MAX_OBSERVATIONS);
  assert.equal(job.result.summary.observationsOmitted, 50);
});
