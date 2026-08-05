import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createApiServer, persistProbeResult } from "./app.js";
import { createDatastore } from "./datastore.js";
import {
  createMonitorScheduler,
  createMonitorPolicy,
  getMonitorHealth,
  listDueMonitorPolicies,
  runDueMonitorPolicies,
  runMonitorPolicy,
} from "./probeScheduler.js";
import { getProbeJob, resetProbeJobs } from "./probeEngine.js";

async function withTempStore(testName, fn) {
  const dir = await mkdtemp(join(tmpdir(), `quantumsentinel-monitor-${testName}-`));
  const datastore = await createDatastore({
    filePath: join(dir, "datastore.db"),
    now: () => "2026-06-03T12:00:00.000Z",
  });

  try {
    await fn(datastore);
  } finally {
    await datastore.close();
    await rm(dir, { force: true, recursive: true });
  }
}

async function listen() {
  const dir = await mkdtemp(join(tmpdir(), "quantumsentinel-monitor-routes-"));
  const datastore = await createDatastore({
    filePath: join(dir, "datastore.db"),
    now: () => "2026-06-03T12:00:00.000Z",
  });
  const server = createApiServer({ datastore });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const { port } = server.address();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    datastore,
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

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

async function patchJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

test("creates monitor policies with normalized cadence and probe request validation", async () => {
  resetProbeJobs();
  await withTempStore("create", async (datastore) => {
    const policy = await createMonitorPolicy(datastore, {
      name: "Perimeter discovery",
      enabled: true,
      cadenceSeconds: 300,
      probeRequest: {
        mode: "discovery",
        hosts: [" example.com ", "example.com", "127.0.0.1"],
        port: 443,
        timeoutMs: 1000,
      },
    }, {
      now: () => "2026-06-03T12:00:00.000Z",
    });

    assert.equal(policy.id, "monitor-1");
    assert.equal(policy.name, "Perimeter discovery");
    assert.equal(policy.enabled, true);
    assert.equal(policy.intervalSeconds, 300);
    assert.equal(policy.createdAt, "2026-06-03T12:00:00.000Z");
    assert.equal(policy.updatedAt, "2026-06-03T12:00:00.000Z");
    assert.equal(policy.nextRunAt, "2026-06-03T12:05:00.000Z");
    assert.equal(policy.lastRunAt, null);
    assert.equal(policy.lastJobId, null);
    assert.deepEqual(policy.probeRequest, {
      mode: "discovery",
      hosts: ["example.com", "127.0.0.1"],
      port: 443,
      timeoutMs: 1000,
    });
    assert.deepEqual(await datastore.listMonitorPolicies(), [policy]);
  });
});

test("rejects unsafe monitor schedules and invalid discovery probe requests", async () => {
  await withTempStore("validation", async (datastore) => {
    await assert.rejects(
      () => createMonitorPolicy(datastore, {
        name: "Too frequent",
        intervalSeconds: 30,
        probeRequest: { mode: "simulate", assetId: 1 },
      }),
      /intervalSeconds must be at least 60/,
    );

    await assert.rejects(
      () => createMonitorPolicy(datastore, {
        name: "Too broad",
        intervalSeconds: 60,
        probeRequest: {
          mode: "discovery",
          hosts: Array.from({ length: 17 }, (_, index) => `127.0.0.${index + 1}`),
        },
      }),
      /discovery probes are limited to 16 hosts/,
    );
  });
});

test("runs monitor policies immediately and persists job/result metadata", async () => {
  resetProbeJobs();
  await withTempStore("run", async (datastore) => {
    const policy = await createMonitorPolicy(datastore, {
      name: "Seed asset check",
      intervalSeconds: 120,
      probeRequest: { mode: "simulate", assetId: 1 },
    }, {
      now: () => "2026-06-03T12:00:00.000Z",
    });

    const { policy: updatedPolicy, job, run } = await runMonitorPolicy(datastore, policy.id, {
      now: () => "2026-06-03T12:01:00.000Z",
    });

    assert.equal(job.id, "probe-1");
    assert.equal(job.status, "completed");
    assert.equal(job.target.assetId, 1);
    assert.deepEqual(await datastore.getProbeJob(job.id), job);
    assert.deepEqual(getProbeJob(job.id), job);

    assert.equal(updatedPolicy.lastJobId, job.id);
    assert.equal(updatedPolicy.lastRunAt, "2026-06-03T12:01:00.000Z");
    assert.equal(updatedPolicy.nextRunAt, "2026-06-03T12:03:00.000Z");
    assert.deepEqual(await datastore.getMonitorPolicy(policy.id), updatedPolicy);

    assert.equal(run.id, "monitor-run-1");
    assert.equal(run.policyId, policy.id);
    assert.equal(run.policyName, "Seed asset check");
    assert.equal(run.status, "completed");
    assert.equal(run.trigger, "manual");
    assert.equal(run.startedAt, "2026-06-03T12:01:00.000Z");
    assert.equal(run.completedAt, "2026-06-03T12:01:00.000Z");
    assert.equal(run.jobId, job.id);
    assert.equal(run.error, null);
    assert.equal(run.observationsCount, 1);
    assert.deepEqual(await datastore.getMonitorRun(run.id), run);
  });
});

test("scheduled TLS monitors preserve asset identity and archive evidence through persistence callback", async () => {
  resetProbeJobs();
  await withTempStore("tls-run", async (datastore) => {
    const policy = await createMonitorPolicy(datastore, {
      name: "TLS certificate posture",
      intervalSeconds: 120,
      probeRequest: {
        mode: "tls",
        assetId: 1,
        host: "api-gateway-prod-01",
        port: 443,
        timeoutMs: 1000,
      },
    }, {
      now: () => "2026-06-03T12:00:00.000Z",
    });

    assert.deepEqual(policy.probeRequest, {
      mode: "tls",
      assetId: 1,
      host: "api-gateway-prod-01",
      port: 443,
      timeoutMs: 1000,
    });

    const tlsJob = {
      id: "probe-scheduled-tls-1",
      mode: "tls",
      status: "completed",
      createdAt: "2026-06-03T12:01:00.000Z",
      updatedAt: "2026-06-03T12:01:01.000Z",
      completedAt: "2026-06-03T12:01:01.000Z",
      target: {
        assetId: 1,
        host: "api-gateway-prod-01",
        port: 443,
      },
      result: {
        observedAt: "2026-06-03T12:01:01.000Z",
        protocol: {
          name: "TLSv1.2",
          cipher: "ECDHE-RSA-AES256-GCM-SHA384",
          perfectForwardSecrecy: true,
        },
        certificate: {
          subject: "CN=api-gateway-prod-01",
          issuer: "CN=Internal RSA CA",
          algorithm: "RSA-2048",
          fingerprint256: "AA:BB:CC",
        },
        classification: {
          label: "SHOR-CRITICAL",
          priority: "HIGH",
          quantumVulnerable: true,
          notes: ["Quantum-vulnerable key exchange observed"],
        },
        findings: ["Quantum-vulnerable key exchange observed"],
      },
      error: null,
    };

    const { run } = await runMonitorPolicy(datastore, policy.id, {
      now: () => "2026-06-03T12:01:00.000Z",
      createProbeJobFn: async (request) => {
        assert.deepEqual(request, policy.probeRequest);
        return tlsJob;
      },
      persistProbeResult: async (store) => persistProbeResult(store, tlsJob),
    });

    assert.equal(run.status, "completed");
    assert.equal(run.jobId, tlsJob.id);
    assert.equal(run.observationsCount, 1);
    assert.equal(run.findingsCount, run.findingIds.length);
    assert.equal(run.evidenceCount, 1);
    assert.equal(run.evidenceRefs.length, 1);
    assert.equal(run.evidenceRefs[0].kind, "audit-event");
    assert.equal(run.findingIds.length >= 1, true);
    assert.equal(run.summary.target.assetId, 1);
    assert.equal(run.summary.certificate.fingerprint256, "AA:BB:CC");
    assert.equal(run.summary.classification.label, "SHOR-CRITICAL");

    const findings = await datastore.listFindings({ assetId: 1, source: "tls-probe" });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].evidence.evidenceRefs.some((ref) => ref.kind === "audit-event"), true);

    const evidenceEvents = await datastore.listAuditEvents({
      entityType: "probe-job",
      action: "probe.tls_evidence_archived",
    });
    assert.equal(evidenceEvents.length, 1);
    assert.equal(run.evidenceRefs[0].id, evidenceEvents[0].id);
    assert.equal(evidenceEvents[0].metadata.evidenceKind, "tls-probe");
  });
});

test("selects due monitor policies and skips disabled, future, and running policies", async () => {
  await withTempStore("due", async (datastore) => {
    const due = await createMonitorPolicy(datastore, {
      name: "Due monitor",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:00:00.000Z",
      probeRequest: { mode: "simulate", assetId: 1 },
    });
    await createMonitorPolicy(datastore, {
      name: "Future monitor",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:10:00.000Z",
      probeRequest: { mode: "simulate", assetId: 2 },
    });
    await createMonitorPolicy(datastore, {
      name: "Disabled monitor",
      enabled: false,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:00:00.000Z",
      probeRequest: { mode: "simulate", assetId: 3 },
    });
    const running = await createMonitorPolicy(datastore, {
      name: "Already running",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:00:00.000Z",
      probeRequest: { mode: "simulate", assetId: 4 },
    });
    await datastore.createMonitorRun({
      policyId: running.id,
      policyName: running.name,
      status: "running",
      trigger: "scheduled",
    });

    assert.deepEqual(
      (await listDueMonitorPolicies(datastore, "2026-06-03T12:05:00.000Z")).map((policy) => policy.id),
      [due.id],
    );
  });
});

test("rejects monitor runs when the policy already has a running run", async () => {
  resetProbeJobs();
  await withTempStore("duplicate", async (datastore) => {
    const policy = await createMonitorPolicy(datastore, {
      name: "Duplicate guard",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:00:00.000Z",
      probeRequest: { mode: "simulate", assetId: 1 },
    });
    await datastore.createMonitorRun({
      policyId: policy.id,
      policyName: policy.name,
      status: "running",
      trigger: "scheduled",
    });

    await assert.rejects(
      () => runMonitorPolicy(datastore, policy.id),
      /Monitor policy is already running/,
    );
    assert.equal((await datastore.listMonitorRuns({ policyId: policy.id })).length, 1);
  });
});

test("runs due monitor policies up to maxRuns and records scheduled runs", async () => {
  resetProbeJobs();
  await withTempStore("tick", async (datastore) => {
    const first = await createMonitorPolicy(datastore, {
      name: "First due",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:00:00.000Z",
      probeRequest: { mode: "simulate", assetId: 1 },
    });
    const second = await createMonitorPolicy(datastore, {
      name: "Second due",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:00:00.000Z",
      probeRequest: { mode: "simulate", assetId: 2 },
    });

    const tick = await runDueMonitorPolicies(datastore, {
      maxRuns: 1,
      now: () => "2026-06-03T12:05:00.000Z",
    });

    assert.equal(tick.runs.length, 1);
    assert.equal(tick.skipped, 1);
    assert.equal(tick.runs[0].policy.id, first.id);
    assert.equal(tick.runs[0].run.trigger, "scheduled");
    assert.equal(tick.runs[0].run.status, "completed");
    assert.equal((await datastore.getMonitorPolicy(first.id)).lastJobId, tick.runs[0].job.id);
    assert.equal((await datastore.getMonitorPolicy(second.id)).lastJobId, null);
  });
});

test("monitor routes create, list, detail, run, and report missing policies", async () => {
  resetProbeJobs();
  const api = await listen();

  try {
    const created = await postJson(api.baseUrl, "/api/monitors", {
      name: "Route monitor",
      intervalSeconds: 60,
      probeRequest: { mode: "simulate", assetId: 1 },
    });

    assert.equal(created.response.status, 201);
    assert.equal(created.body.data.id, "monitor-1");
    assert.equal(created.body.data.enabled, false);
    assert.equal(created.body.data.intervalSeconds, 60);

    const list = await getJson(api.baseUrl, "/api/monitors");
    assert.equal(list.response.status, 200);
    assert.equal(list.body.count, 1);
    assert.deepEqual(list.body.data, [created.body.data]);

    const detail = await getJson(api.baseUrl, "/api/monitors/monitor-1");
    assert.equal(detail.response.status, 200);
    assert.deepEqual(detail.body.data, created.body.data);

    const run = await postJson(api.baseUrl, "/api/monitors/monitor-1/run", {});
    assert.equal(run.response.status, 200);
    assert.equal(run.body.data.job.status, "completed");
    assert.equal(run.body.data.policy.lastJobId, run.body.data.job.id);
    assert.equal(run.body.data.run.status, "completed");
    assert.equal(run.body.data.run.trigger, "manual");
    assert.equal(run.body.data.run.jobId, run.body.data.job.id);

    const persistedPolicy = await api.datastore.getMonitorPolicy("monitor-1");
    assert.equal(persistedPolicy.lastJobId, run.body.data.job.id);
    assert.deepEqual(await api.datastore.getProbeJob(run.body.data.job.id), run.body.data.job);
    assert.deepEqual(await api.datastore.getMonitorRun(run.body.data.run.id), run.body.data.run);

    const runs = await getJson(api.baseUrl, "/api/monitor-runs");
    assert.equal(runs.response.status, 200);
    assert.equal(runs.body.count, 1);
    assert.deepEqual(runs.body.data, [run.body.data.run]);

    const policyRuns = await getJson(api.baseUrl, "/api/monitors/monitor-1/runs");
    assert.equal(policyRuns.response.status, 200);
    assert.deepEqual(policyRuns.body.data, [run.body.data.run]);

    const health = await getJson(api.baseUrl, "/api/monitor-health");
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body.data, {
      totalPolicies: 1,
      enabledPolicies: 0,
      duePolicies: 0,
      runningRuns: 0,
      failedRuns: 0,
      lastRunAt: run.body.data.run.completedAt,
    });

    const missing = await getJson(api.baseUrl, "/api/monitors/missing");
    assert.equal(missing.response.status, 404);
    assert.deepEqual(missing.body, { error: "Monitor policy not found" });
  } finally {
    await api.close();
  }
});

test("monitor health aggregates policy and run lifecycle state", async () => {
  await withTempStore("health", async (datastore) => {
    await createMonitorPolicy(datastore, {
      name: "Due enabled",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:00:00.000Z",
      probeRequest: { mode: "simulate", assetId: 1 },
    });
    await createMonitorPolicy(datastore, {
      name: "Future enabled",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:30:00.000Z",
      probeRequest: { mode: "simulate", assetId: 2 },
    });
    await datastore.createMonitorRun({
      policyId: "monitor-1",
      policyName: "Due enabled",
      status: "running",
      trigger: "scheduled",
      startedAt: "2026-06-03T12:01:00.000Z",
    });
    await datastore.createMonitorRun({
      policyId: "monitor-2",
      policyName: "Future enabled",
      status: "failed",
      trigger: "scheduled",
      startedAt: "2026-06-03T12:02:00.000Z",
      completedAt: "2026-06-03T12:02:01.000Z",
    });

    assert.deepEqual(await getMonitorHealth(datastore, "2026-06-03T12:05:00.000Z"), {
      totalPolicies: 2,
      enabledPolicies: 2,
      duePolicies: 0,
      runningRuns: 1,
      failedRuns: 1,
      lastRunAt: "2026-06-03T12:02:01.000Z",
    });
  });
});

test("monitor scheduler exposes safe default status and bounded config updates", async () => {
  await withTempStore("scheduler-config", async (datastore) => {
    const scheduler = createMonitorScheduler({
      datastore,
      tickIntervalSeconds: 5,
      maxRunsPerTick: 500,
      scanWindowSeconds: -30,
      now: () => "2026-06-03T12:00:00.000Z",
    });

    assert.deepEqual(scheduler.getStatus(), {
      enabled: false,
      running: false,
      config: {
        tickIntervalSeconds: 60,
        maxRunsPerTick: 20,
        scanWindowSeconds: 0,
      },
      lastTickAt: null,
      lastTickResult: null,
    });

    assert.deepEqual(scheduler.updateConfig({
      enabled: true,
      tickIntervalSeconds: 30,
      maxRunsPerTick: 0,
      scanWindowSeconds: 90,
    }).config, {
      tickIntervalSeconds: 60,
      maxRunsPerTick: 1,
      scanWindowSeconds: 90,
    });

    assert.equal(scheduler.getStatus().enabled, true);
    assert.equal(scheduler.getStatus().running, false);
  });
});

test("monitor scheduler start and stop control the loop without duplicate timers", async () => {
  await withTempStore("scheduler-loop", async (datastore) => {
    const timers = [];
    const cleared = [];
    const scheduler = createMonitorScheduler({
      datastore,
      tickIntervalSeconds: 75,
      setTimer: (callback, milliseconds) => {
        const timer = { callback, milliseconds };
        timers.push(timer);
        return timer;
      },
      clearTimer: (timer) => cleared.push(timer),
    });

    const started = scheduler.start();
    assert.equal(started.enabled, true);
    assert.equal(started.running, true);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].milliseconds, 75_000);

    scheduler.start();
    assert.equal(timers.length, 1);

    const stopped = scheduler.stop();
    assert.equal(stopped.enabled, false);
    assert.equal(stopped.running, false);
    assert.deepEqual(cleared, [timers[0]]);
  });
});

test("monitor scheduler tick runs due policies deterministically and records last result", async () => {
  resetProbeJobs();
  await withTempStore("scheduler-tick", async (datastore) => {
    await createMonitorPolicy(datastore, {
      name: "Due through scan window",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:01:00.000Z",
      probeRequest: { mode: "simulate", assetId: 1 },
    });
    await createMonitorPolicy(datastore, {
      name: "Still future",
      enabled: true,
      intervalSeconds: 120,
      nextRunAt: "2026-06-03T12:10:00.000Z",
      probeRequest: { mode: "simulate", assetId: 2 },
    });
    const scheduler = createMonitorScheduler({
      datastore,
      maxRunsPerTick: 1,
      scanWindowSeconds: 60,
      now: () => "2026-06-03T12:00:00.000Z",
    });

    const tick = await scheduler.tick();

    assert.equal(tick.at, "2026-06-03T12:00:00.000Z");
    assert.equal(tick.effectiveNow, "2026-06-03T12:01:00.000Z");
    assert.equal(tick.runs.length, 1);
    assert.equal(tick.skipped, 0);
    assert.equal(tick.runs[0].run.trigger, "scheduled");
    assert.deepEqual(scheduler.getStatus().lastTickResult, tick);
  });
});

test("scheduler routes expose status, config, tick, start, and stop", async () => {
  resetProbeJobs();
  const api = await listen();

  try {
    await postJson(api.baseUrl, "/api/monitors", {
      name: "Route scheduled monitor",
      enabled: true,
      intervalSeconds: 60,
      nextRunAt: "2026-06-03T12:00:00.000Z",
      probeRequest: { mode: "simulate", assetId: 1 },
    });

    const initial = await getJson(api.baseUrl, "/api/scheduler");
    assert.equal(initial.response.status, 200);
    assert.equal(initial.body.data.enabled, false);
    assert.equal(initial.body.data.running, false);
    assert.deepEqual(initial.body.data.config, {
      tickIntervalSeconds: 60,
      maxRunsPerTick: 5,
      scanWindowSeconds: 0,
    });

    const configured = await patchJson(api.baseUrl, "/api/scheduler/config", {
      tickIntervalSeconds: 15,
      maxRunsPerTick: 100,
      scanWindowSeconds: 30,
    });
    assert.equal(configured.response.status, 200);
    assert.deepEqual(configured.body.data.config, {
      tickIntervalSeconds: 60,
      maxRunsPerTick: 20,
      scanWindowSeconds: 30,
    });

    const tick = await postJson(api.baseUrl, "/api/scheduler/tick", {});
    assert.equal(tick.response.status, 200);
    assert.equal(tick.body.data.runs.length, 1);
    assert.equal(tick.body.data.runs[0].run.trigger, "scheduled");
    assert.deepEqual((await getJson(api.baseUrl, "/api/scheduler")).body.data.lastTickResult, tick.body.data);

    const started = await postJson(api.baseUrl, "/api/scheduler/start", {});
    assert.equal(started.response.status, 200);
    assert.equal(started.body.data.enabled, true);
    assert.equal(started.body.data.running, true);

    const stopped = await postJson(api.baseUrl, "/api/scheduler/stop", {});
    assert.equal(stopped.response.status, 200);
    assert.equal(stopped.body.data.enabled, false);
    assert.equal(stopped.body.data.running, false);
  } finally {
    await postJson(api.baseUrl, "/api/scheduler/stop", {}).catch(() => {});
    await api.close();
  }
});

test("monitor routes return bad request for invalid create payloads", async () => {
  const api = await listen();

  try {
    const invalid = await postJson(api.baseUrl, "/api/monitors", {
      name: "Invalid",
      intervalSeconds: 59,
      probeRequest: { mode: "simulate", assetId: 1 },
    });

    assert.equal(invalid.response.status, 400);
    assert.deepEqual(invalid.body, { error: "intervalSeconds must be at least 60" });
  } finally {
    await api.close();
  }
});
