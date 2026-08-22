import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ASSETS } from "../test-fixtures/mockData.js";
import { createApiServer } from "./app.js";
import { createDatastore } from "./datastore.js";

async function listen() {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-risk-routes-"));
  const datastore = await createDatastore({ filePath: join(dir, "datastore.db"), seedAssets: ASSETS });
  const server = createApiServer({ datastore });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();

  return {
    datastore,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await datastore.close();
      await rm(dir, { force: true, recursive: true });
    },
  };
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { response, body: await response.json() };
}

test("serves asset-level risk analysis with drift and findings context", async () => {
  const api = await listen();

  try {
    const { response, body } = await getJson(api.baseUrl, "/api/assets/1/risk");

    assert.equal(response.status, 200);
    assert.equal(body.data.asset.hostname, "api-gateway-prod-01");
    assert.equal(body.data.analysis.classification.label, "SHOR-CRITICAL");
    assert.equal(body.data.analysis.priority, "CRITICAL");
    assert.equal(body.data.drift.driftDetected, false);
    assert.deepEqual(body.data.findings, []);

    const missing = await getJson(api.baseUrl, "/api/assets/999/risk");
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "Asset not found" });
  } finally {
    await api.close();
  }
});

test("detects portfolio drift from datastore asset history", async () => {
  const api = await listen();

  try {
    await api.datastore.upsertAsset({
      ...ASSETS[12],
      id: 13,
      algo: "RSA-2048",
      proto: "TLS 1.2",
      cls: "SHOR-CRITICAL",
      pfs: false,
      risk: 91,
      prio: "CRITICAL",
    }, {
      source: "test",
      reason: "regression",
      observedAt: "2026-06-03T12:00:00.000Z",
    });

    const { response, body } = await getJson(api.baseUrl, "/api/drift");

    assert.equal(response.status, 200);
    assert.equal(body.data.driftDetected, true);
    assert.equal(body.data.count, 1);
    assert.equal(body.data.assets[0].asset.id, 13);
    assert.equal(body.data.assets[0].events.some((event) => event.type === "PQC_HYBRID_REGRESSION"), true);
  } finally {
    await api.close();
  }
});

test("recomputes risk and persists generated findings", async () => {
  const api = await listen();

  try {
    const response = await fetch(`${api.baseUrl}/api/risk/recompute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: 5 }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.analyses.length, 1);
    assert.equal(body.data.analyses[0].analysis.classification.label, "SHOR-CRITICAL");
    assert.equal(body.data.createdFindings.length, 2);

    const findings = await getJson(api.baseUrl, "/api/findings?assetId=5");
    assert.equal(findings.body.count, 2);
    assert.equal(findings.body.data[0].source, "risk-recompute");

    const missingResponse = await fetch(`${api.baseUrl}/api/risk/recompute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId: 999 }),
    });
    const missing = await missingResponse.json();

    assert.equal(missingResponse.status, 404);
    assert.deepEqual(missing, { error: "Asset not found" });
  } finally {
    await api.close();
  }
});
