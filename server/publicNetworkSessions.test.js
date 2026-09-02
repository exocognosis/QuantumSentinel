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
  assert.equal(created.uploadToken, undefined);
  const connected = store.connect(created.deviceCode);
  assert.equal(connected.status, "connector_connected");
  assert.throws(() => store.connect(created.deviceCode), /invalid or expired|already been used/);
  assert.throws(() => store.submit(created.id, "wrong", completedJob()), /token is invalid/);

  const submitted = store.submit(created.id, connected.uploadToken, completedJob());
  assert.equal(submitted.status, "completed");
  assert.equal(store.get(created.id, created.readToken).result.result.observations.length, 1);
  assert.throws(() => store.submit(created.id, connected.uploadToken, completedJob()), /already has a result/);
});

test("network session rejects connector observations outside the approved scope", () => {
  const store = createPublicNetworkSessionStore();
  const created = store.create({ hosts: ["10.0.0.10"], ports: [443] });
  const connected = store.connect(created.deviceCode);

  assert.throws(
    () => store.submit(created.id, connected.uploadToken, completedJob("10.0.0.11", 443)),
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

test("network session limits active sessions per client", () => {
  const store = createPublicNetworkSessionStore({ maxActiveSessionsPerClient: 2 });
  store.create({ hosts: ["10.0.0.10"], ports: [443] }, { clientKey: "client-a" });
  store.create({ hosts: ["10.0.0.11"], ports: [443] }, { clientKey: "client-a" });

  assert.throws(
    () => store.create({ hosts: ["10.0.0.12"], ports: [443] }, { clientKey: "client-a" }),
    /too many active network scan sessions for this client/,
  );
  assert.doesNotThrow(
    () => store.create({ hosts: ["10.0.0.12"], ports: [443] }, { clientKey: "client-b" }),
  );
});

test("network session evicts a completed session before denying new work", () => {
  const store = createPublicNetworkSessionStore({ maxSessions: 1 });
  const first = store.create({ hosts: ["10.0.0.10"], ports: [443] }, { clientKey: "client-a" });
  const connected = store.connect(first.deviceCode);
  store.submit(first.id, connected.uploadToken, completedJob());

  const second = store.create({ hosts: ["10.0.0.11"], ports: [443] }, { clientKey: "client-b" });
  assert.equal(second.status, "waiting_for_connector");
  assert.throws(() => store.get(first.id, first.readToken), /not found or has expired/);
});
