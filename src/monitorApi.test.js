import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMonitorPolicy,
  loadMonitorHealth,
  loadMonitorPolicies,
  loadMonitorPolicyRuns,
  loadMonitorRuns,
  monitorFallbackHealth,
  monitorFallbackPolicies,
  monitorFallbackRuns,
  normalizeMonitorHealth,
  normalizeMonitorPolicy,
  normalizeMonitorRun,
  runMonitorPolicyNow,
} from "./monitorApi.js";

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

test("loadMonitorPolicies fetches monitor policies and normalizes API fields", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: [
        {
          policy_id: 42,
          title: "Edge Discovery Sweep",
          active: true,
          interval_seconds: "900",
          next_run_at: "2026-06-06T16:30:00.000Z",
          last_run_at: "2026-06-06T16:00:00.000Z",
          last_job: {
            job_id: "job-42",
            status: "completed",
            progress_pct: 100,
          },
          request: {
            mode: "discovery",
            hosts: ["edge-01.example.test", "vpn-02.example.test"],
            timeoutMs: 2500,
          },
        },
      ],
      count: 1,
    });
  };

  const policies = await loadMonitorPolicies({ fetcher, baseUrl: "https://sentinel.example/" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/monitors");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.deepEqual(policies, [
    {
      id: "42",
      name: "Edge Discovery Sweep",
      enabled: true,
      intervalSeconds: 900,
      nextRunAt: "2026-06-06T16:30:00.000Z",
      lastRunAt: "2026-06-06T16:00:00.000Z",
      lastJob: {
        id: "job-42",
        name: "Probe Job",
        type: "probe",
        target: "",
        targetLabel: "",
        status: "COMPLETED",
        progress: 100,
        createdAt: null,
        updatedAt: null,
        completedAt: null,
        findingsCount: 0,
        riskScore: 0,
        error: "",
        request: {},
        result: null,
      },
      probeRequest: {
        mode: "discovery",
        hosts: ["edge-01.example.test", "vpn-02.example.test"],
        timeoutMs: 2500,
      },
    },
  ]);
});

test("createMonitorPolicy posts a JSON policy and normalizes the created policy", async () => {
  const calls = [];
  const request = {
    name: "DMZ Discovery",
    enabled: true,
    intervalSeconds: 1800,
    probeRequest: {
      mode: "discovery",
      hosts: ["dmz-01.example.test"],
      timeoutMs: 3000,
    },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        id: "monitor-1",
        name: "DMZ Discovery",
        enabled: true,
        intervalSeconds: 1800,
        nextRunAt: "2026-06-06T17:00:00.000Z",
        probeRequest: request.probeRequest,
      },
    });
  };

  const policy = await createMonitorPolicy(request, { fetcher, baseUrl: "https://sentinel.example" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/monitors");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.equal(calls[0].options.body, JSON.stringify(request));
  assert.equal(policy.id, "monitor-1");
  assert.equal(policy.name, "DMZ Discovery");
  assert.equal(policy.enabled, true);
  assert.equal(policy.intervalSeconds, 1800);
  assert.deepEqual(policy.probeRequest, request.probeRequest);
});

test("createMonitorPolicy returns a local policy when the API is unavailable", async () => {
  const request = {
    name: "Offline Discovery",
    enabled: true,
    intervalSeconds: 1200,
    probeRequest: {
      mode: "discovery",
      hosts: ["offline-01"],
      timeoutMs: 2500,
    },
  };

  const policy = await createMonitorPolicy(request, {
    fetcher: async () => jsonResponse({ error: "offline" }, { ok: false, status: 503 }),
  });

  assert.equal(policy.id, "local-monitor-policy");
  assert.equal(policy.name, "Offline Discovery");
  assert.equal(policy.enabled, true);
  assert.equal(policy.intervalSeconds, 1200);
  assert.deepEqual(policy.probeRequest, request.probeRequest);
});

test("runMonitorPolicyNow accepts nested policy plus job payloads", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        policy: {
          id: "monitor-2",
          name: "Core Sweep",
          enabled: false,
          intervalSeconds: 3600,
        },
        job: {
          id: "job-99",
          type: "discovery",
          status: "running",
          progress: 25,
          request: { mode: "discovery", hosts: ["core-01"] },
        },
      },
    });
  };

  const result = await runMonitorPolicyNow("monitor/2", { fetcher });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/monitors/monitor%2F2/run");
  assert.deepEqual(calls[0].options, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  assert.equal(result.policy.id, "monitor-2");
  assert.equal(result.policy.enabled, false);
  assert.equal(result.job.id, "job-99");
  assert.equal(result.job.status, "RUNNING");
  assert.equal(result.job.type, "discovery");
});

test("runMonitorPolicyNow accepts nested run records", async () => {
  const result = await runMonitorPolicyNow("monitor-2", {
    fetcher: async () => jsonResponse({
      data: {
        policy: {
          id: "monitor-2",
          name: "Core Sweep",
        },
        job: {
          id: "job-99",
          type: "discovery",
          status: "completed",
        },
        run: {
          id: 7,
          policy_id: "monitor-2",
          policy_name: "Core Sweep",
          state: "completed",
          trigger: "manual",
          started_at: "2026-06-06T17:00:00.000Z",
          completed_at: "2026-06-06T17:00:08.000Z",
          job_id: "job-99",
          observations_count: "12",
          findings_count: 3,
          summary: { message: "12 targets checked" },
        },
      },
    }),
  });

  assert.equal(result.policy.id, "monitor-2");
  assert.equal(result.job.id, "job-99");
  assert.deepEqual(result.run, {
    id: "7",
    policyId: "monitor-2",
    policyName: "Core Sweep",
    status: "COMPLETED",
    trigger: "MANUAL",
    startedAt: "2026-06-06T17:00:00.000Z",
    completedAt: "2026-06-06T17:00:08.000Z",
    jobId: "job-99",
    error: "",
    summary: "12 targets checked",
    observationsCount: 12,
    findingsCount: 3,
    evidenceCount: 0,
    evidenceRefs: [],
    findingIds: [],
  });
});

test("runMonitorPolicyNow accepts job-only payloads", async () => {
  const result = await runMonitorPolicyNow("monitor-3", {
    fetcher: async () => jsonResponse({
      data: {
        job_id: "job-only",
        state: "queued",
        request: { mode: "discovery", hosts: ["api-01"] },
      },
    }),
  });

  assert.equal(result.policy, null);
  assert.equal(result.job.id, "job-only");
  assert.equal(result.job.status, "QUEUED");
});

test("runMonitorPolicyNow returns a local job when the API is unavailable", async () => {
  const result = await runMonitorPolicyNow("fallback-discovery-edge", {
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(result.policy?.id, "fallback-discovery-edge");
  assert.equal(result.job.id, "local-monitor-run");
  assert.equal(result.job.status, "QUEUED");
  assert.equal(result.job.type, "discovery");
  assert.equal(result.run.policyId, "fallback-discovery-edge");
  assert.equal(result.run.status, "QUEUED");
});

test("loadMonitorRuns fetches and normalizes global run history", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: [
        {
          run_id: "run-1",
          monitor_id: "monitor-1",
          monitor_name: "DMZ Sweep",
          status: "failed",
          trigger: "schedule",
          started_at: "2026-06-06T15:00:00.000Z",
          completed_at: "2026-06-06T15:00:04.000Z",
          job_id: "job-1",
          error_message: "timeout",
          observations: [{ host: "edge-01" }, { host: "edge-02" }],
          findings: [{ id: "finding-1" }],
        },
      ],
      count: 1,
    });
  };

  const runs = await loadMonitorRuns({ fetcher, baseUrl: "https://sentinel.example/" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/monitor-runs");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.deepEqual(runs, [
    {
      id: "run-1",
      policyId: "monitor-1",
      policyName: "DMZ Sweep",
      status: "FAILED",
      trigger: "SCHEDULE",
      startedAt: "2026-06-06T15:00:00.000Z",
      completedAt: "2026-06-06T15:00:04.000Z",
      jobId: "job-1",
      error: "timeout",
      summary: "",
      observationsCount: 2,
      findingsCount: 1,
      evidenceCount: 0,
      evidenceRefs: [],
      findingIds: [],
    },
  ]);
});

test("loadMonitorPolicyRuns fetches per-policy run history", async () => {
  const calls = [];
  const runs = await loadMonitorPolicyRuns("monitor/1", {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        runs: [
          {
            id: "policy-run-1",
            policyId: "monitor/1",
            status: "running",
            trigger: "manual",
            jobId: "job-22",
          },
        ],
      });
    },
  });

  assert.equal(calls[0].url, "/api/monitors/monitor%2F1/runs");
  assert.equal(runs[0].id, "policy-run-1");
  assert.equal(runs[0].policyId, "monitor/1");
  assert.equal(runs[0].status, "RUNNING");
  assert.equal(runs[0].trigger, "MANUAL");
});

test("loadMonitorHealth fetches and normalizes health counters", async () => {
  const calls = [];
  const health = await loadMonitorHealth({
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        data: {
          total_policies: "5",
          enabled_policies: "4",
          due_policies: 2,
          running_runs: "1",
          failed_recent_runs: "3",
          last_run_at: "2026-06-06T17:15:00.000Z",
        },
      });
    },
    baseUrl: "https://sentinel.example",
  });

  assert.equal(calls[0].url, "https://sentinel.example/api/monitor-health");
  assert.deepEqual(health, {
    totalPolicies: 5,
    enabledPolicies: 4,
    duePolicies: 2,
    runningRuns: 1,
    failedRecentRuns: 3,
    lastRunAt: "2026-06-06T17:15:00.000Z",
  });
});

test("monitor run and health normalizers clamp flexible missing fields", () => {
  const run = normalizeMonitorRun({
    uuid: "run-x",
    policy: { id: "policy-x", name: "Policy X" },
    state: "in progress",
    cause: "scheduler",
    started: "2026-06-06T18:00:00.000Z",
    job: { id: "job-x" },
    result: {
      summary: { status: "pending" },
      observations: [{ id: 1 }],
      findings: [{ id: 2 }, { id: 3 }],
    },
  });
  const health = normalizeMonitorHealth({
    policies: { total: 3, enabled: 2, due: 1 },
    runs: { running: 1, failedRecent: 2, lastCompletedAt: "2026-06-06T18:01:00.000Z" },
  });

  assert.deepEqual(run, {
    id: "run-x",
    policyId: "policy-x",
    policyName: "Policy X",
    status: "IN_PROGRESS",
    trigger: "SCHEDULER",
    startedAt: "2026-06-06T18:00:00.000Z",
    completedAt: null,
    jobId: "job-x",
    error: "",
    summary: "pending",
    observationsCount: 1,
    findingsCount: 2,
    evidenceCount: 0,
    evidenceRefs: [],
    findingIds: [],
  });
  assert.deepEqual(health, {
    totalPolicies: 3,
    enabledPolicies: 2,
    duePolicies: 1,
    runningRuns: 1,
    failedRecentRuns: 2,
    lastRunAt: "2026-06-06T18:01:00.000Z",
  });
});

test("loadMonitorPolicies falls back to cloned sample policies when monitors are unavailable", async () => {
  const policies = await loadMonitorPolicies({
    fetcher: async () => jsonResponse({ error: "offline" }, { ok: false, status: 503 }),
  });

  assert.deepEqual(policies, monitorFallbackPolicies);
  assert.notEqual(policies, monitorFallbackPolicies);

  policies[0].name = "MUTATED";
  const nextPolicies = await loadMonitorPolicies({
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(nextPolicies[0].name, monitorFallbackPolicies[0].name);
});

test("monitor run history and health fall back to cloned samples when APIs are unavailable", async () => {
  const runs = await loadMonitorRuns({
    fetcher: async () => jsonResponse({ error: "offline" }, { ok: false, status: 503 }),
  });
  const health = await loadMonitorHealth({
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.deepEqual(runs, monitorFallbackRuns);
  assert.notEqual(runs, monitorFallbackRuns);
  assert.deepEqual(health, monitorFallbackHealth);
  assert.notEqual(health, monitorFallbackHealth);

  runs[0].status = "MUTATED";
  health.enabledPolicies = 0;

  assert.equal((await loadMonitorRuns({ fetcher: null }))[0].status, monitorFallbackRuns[0].status);
  assert.equal((await loadMonitorHealth({ fetcher: null })).enabledPolicies, monitorFallbackHealth.enabledPolicies);
});

test("normalizeMonitorPolicy clamps missing and invalid fields", () => {
  const policy = normalizeMonitorPolicy({
    uuid: "policy-x",
    name: "",
    enabled: "false",
    cadenceSeconds: "bad",
    probeRequest: {
      mode: "discovery",
      hosts: ["api-01"],
    },
  });

  assert.equal(policy.id, "policy-x");
  assert.equal(policy.name, "Discovery Monitor");
  assert.equal(policy.enabled, false);
  assert.equal(policy.intervalSeconds, 900);
  assert.equal(policy.nextRunAt, null);
  assert.equal(policy.lastRunAt, null);
  assert.equal(policy.lastJob, null);
  assert.deepEqual(policy.probeRequest, {
    mode: "discovery",
    hosts: ["api-01"],
  });
});
