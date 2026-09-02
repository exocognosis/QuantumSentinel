import assert from "node:assert/strict";
import test from "node:test";

import { createPublicNetworkSessionStore } from "./publicNetworkSessions.js";

function completedJob(host = "10.0.0.10", port = 443) {
  return {
    id: "probe-1",
    mode: "discovery",
    status: "completed",
    result: {
      summary: { targetsScanned: 1, completedCount: 1, failedCount: 0 },
      observations: [{
        host,
        port,
        status: "completed",
        reachability: { tcp: true, tls: true },
        classification: { label: "SHOR-CRITICAL", priority: "HIGH", quantumVulnerable: true },
      }],
    },
  };
}

test("network session accepts one scoped connector result and protects reads", () => {
  const store = createPublicNetworkSessionStore();
  const created = store.create({ hosts: ["10.0.0.10"], ports: [443] });

  assert.equal(created.status, "waiting_for_connector");
  assert.throws(() => store.get(created.id, "wrong"), /token is invalid/);
  assert.throws(() => store.submit(created.id, "wrong", completedJob()), /token is invalid/);

  const submitted = store.submit(created.id, created.uploadToken, completedJob());
  assert.equal(submitted.status, "completed");
  assert.equal(store.get(created.id, created.readToken).result.result.observations.length, 1);
  assert.throws(() => store.submit(created.id, created.uploadToken, completedJob()), /already has a result/);
});

test("network session rejects connector observations outside the approved scope", () => {
  const store = createPublicNetworkSessionStore();
  const created = store.create({ hosts: ["10.0.0.10"], ports: [443] });

  assert.throws(
    () => store.submit(created.id, created.uploadToken, completedJob("10.0.0.11", 443)),
    /outside the approved scope/,
  );
});

test("network session expires and removes access to pending data", () => {
  let timestamp = Date.parse("2026-09-02T00:00:00.000Z");
  const store = createPublicNetworkSessionStore({ ttlMs: 1_000, now: () => timestamp });
  const created = store.create({ hosts: ["router.local"], ports: [443] });

  timestamp += 1_001;
  assert.throws(() => store.get(created.id, created.readToken), /not found or has expired/);
});
