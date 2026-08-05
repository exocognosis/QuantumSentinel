import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDomainScanInput, scanDomain } from "./domainScanner.js";

test("domain scan validates bounded TLS targets", () => {
  assert.deepEqual(normalizeDomainScanInput("Example.COM", [443, 443, 993]), { hostname: "example.com", ports: [443, 993] });
  assert.throws(() => normalizeDomainScanInput("https://example.com", [443]), /hostname/);
  assert.throws(() => normalizeDomainScanInput("example.com", [22]), /allowlist/);
});

test("domain scan produces DNS, service, evidence, and score output", async () => {
  const report = await scanDomain("example.com", {
    ports: [443, 993],
    resolver: { resolve4: async () => ["192.0.2.10"], resolve6: async () => ["2001:db8::10"] },
    probe: async ({ host, port }) => port === 443 ? {
      status: "completed", target: { host, port }, result: {
        protocol: { name: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384", perfectForwardSecrecy: true },
        certificate: { algorithm: "RSA-2048", expiresAt: "2030-01-01" },
        classification: { quantumVulnerable: true, notes: [] },
      },
    } : { status: "failed", target: { host, port }, error: "connection refused" },
  });
  assert.equal(report.scan.kind, "domain");
  assert.deepEqual(report.scan.addresses.ipv4, ["192.0.2.10"]);
  assert.equal(report.summary.servicesObserved, 1);
  assert.equal(report.summary.servicesFailed, 1);
  assert.equal(report.findings[0].classification, "shor-vulnerable-public-key");
  assert.ok(report.score.readinessScore < 100);
  assert.match(report.interpretation.internalInference, /do not establish/);
});
