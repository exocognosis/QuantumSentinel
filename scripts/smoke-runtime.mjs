import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiServer, persistProbeResult } from "../server/app.js";
import { createDatastore } from "../server/datastore.js";
import { createMonitorPolicy, runMonitorPolicy } from "../server/probeScheduler.js";
import { buildReport } from "../server/reporting.js";
import { findingRecurrenceSummary } from "../src/findingDisplay.js";

function tlsJob({
  id,
  observedAt,
  assetId = 1,
  host = "api-gateway-prod-01",
  port = 443,
  label = "SHOR-CRITICAL",
  priority = "HIGH",
  quantumVulnerable = true,
  fingerprint256 = "AA:BB:CC",
} = {}) {
  return {
    id,
    mode: "tls",
    status: "completed",
    createdAt: observedAt,
    updatedAt: observedAt,
    completedAt: observedAt,
    target: { assetId, host, port },
    result: {
      observedAt,
      protocol: { name: "TLSv1.2", perfectForwardSecrecy: true },
      certificate: { algorithm: "RSA-2048", fingerprint256 },
      classification: { label, priority, quantumVulnerable, notes: [] },
      findings: quantumVulnerable ? ["Quantum-vulnerable certificate observed"] : [],
    },
    error: null,
  };
}

async function withServer(datastore, callback) {
  const server = createApiServer({ datastore });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-runtime-smoke-"));
const datastore = await createDatastore({
  backend: "json",
  filePath: join(dir, "datastore.json"),
  now: () => "2026-06-08T12:00:00.000Z",
});

try {
  const first = await persistProbeResult(datastore, tlsJob({
    id: "probe-smoke-1",
    observedAt: "2026-06-08T12:00:00.000Z",
  }));
  const second = await persistProbeResult(datastore, tlsJob({
    id: "probe-smoke-2",
    observedAt: "2026-06-08T12:10:00.000Z",
  }));

  assert.deepEqual(second.directFindingIds, first.directFindingIds);

  const tlsFindings = await datastore.listFindings({ assetId: 1, source: "tls-probe" });
  assert.equal(tlsFindings.length, 1);
  assert.equal(tlsFindings[0].evidence.recurrence.count, 2);
  assert.deepEqual(tlsFindings[0].evidence.recurrence.probeIds, ["probe-smoke-1", "probe-smoke-2"]);
  assert.equal(findingRecurrenceSummary(tlsFindings[0]).count, 2);

  await persistProbeResult(datastore, tlsJob({
    id: "probe-smoke-info",
    observedAt: "2026-06-08T12:20:00.000Z",
    assetId: 2,
    host: "vpn-concentrator-01",
    label: "HYBRID",
    priority: "MONITOR",
    quantumVulnerable: false,
    fingerprint256: "DD:EE:FF",
  }));

  const policy = await createMonitorPolicy(datastore, {
    name: "TLS posture smoke",
    enabled: true,
    intervalSeconds: 120,
    probeRequest: {
      mode: "tls",
      assetId: 3,
      host: "legacy-auth",
      port: 443,
      timeoutMs: 1000,
    },
  });
  const scheduledJob = tlsJob({
    id: "probe-smoke-monitor",
    observedAt: "2026-06-08T12:30:00.000Z",
    assetId: 3,
    host: "legacy-auth",
    label: "DEPRECATED",
    fingerprint256: "EE:FF:00",
  });
  const monitorResult = await runMonitorPolicy(datastore, policy.id, {
    createProbeJobFn: async (request) => {
      assert.equal(request.assetId, 3);
      return scheduledJob;
    },
    persistProbeResult,
  });
  assert.equal(monitorResult.run.findingsCount, monitorResult.run.findingIds.length);
  assert.equal(monitorResult.run.evidenceCount, 1);

  const report = await buildReport("executive", { datastore });
  assert.equal(report.summary.alerts.info, 0);
  assert.equal(report.summary.alerts.high >= 1, true);

  const apiResult = await withServer(datastore, async (baseUrl) => {
    const alerts = await (await fetch(`${baseUrl}/api/alerts`)).json();
    const summary = await (await fetch(`${baseUrl}/api/summary`)).json();
    assert.equal(alerts.data.every((alert) => alert.sev !== "INFO"), true);
    assert.equal(alerts.data.some((alert) => alert.findingId === tlsFindings[0].id), true);
    assert.equal(summary.data.alerts.info, 0);
    return { alerts: alerts.count, highAlerts: summary.data.alerts.high };
  });

  console.log(JSON.stringify({
    tlsFindings: tlsFindings.length,
    recurrence: tlsFindings[0].evidence.recurrence.count,
    monitorFindings: monitorResult.run.findingsCount,
    monitorEvidence: monitorResult.run.evidenceCount,
    ...apiResult,
  }));
} finally {
  await datastore.close();
  await rm(dir, { force: true, recursive: true });
}
