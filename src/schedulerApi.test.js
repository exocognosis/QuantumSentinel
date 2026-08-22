import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadSchedulerStatus,
  normalizeSchedulerStatus,
  unavailableSchedulerStatus,
  startScheduler,
  stopScheduler,
  tickSchedulerNow,
  updateSchedulerConfig,
} from "./schedulerApi.js";

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

test("loadSchedulerStatus fetches and normalizes nested status payloads", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        enabled: "true",
        running: 1,
        tick_interval_seconds: "1200",
        max_runs_per_tick: "4",
        last_tick_at: "2026-06-06T18:00:00.000Z",
        last_tick_result: { summary: "2 runs queued" },
        scan_window: { mode: "rolling", seconds: 900 },
      },
    });
  };

  const status = await loadSchedulerStatus({ fetcher, baseUrl: "https://sentinel.example/" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/scheduler");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.deepEqual(status, {
    running: true,
    enabled: true,
    tickIntervalSeconds: 1200,
    maxRunsPerTick: 4,
    lastTickAt: "2026-06-06T18:00:00.000Z",
    lastTickResult: { summary: "2 runs queued" },
    scanWindow: { mode: "rolling", seconds: 900 },
  });
});

test("startScheduler and stopScheduler post controls and accept direct status payloads", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      running: url.endsWith("/start"),
      enabled: url.endsWith("/start"),
      tickIntervalSeconds: "900",
      maxRunsPerTick: 2,
    });
  };

  const started = await startScheduler({ fetcher });
  const stopped = await stopScheduler({ fetcher });

  assert.equal(calls[0].url, "/api/scheduler/start");
  assert.deepEqual(calls[0].options, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  assert.equal(calls[1].url, "/api/scheduler/stop");
  assert.equal(started.running, true);
  assert.equal(started.enabled, true);
  assert.equal(stopped.running, false);
  assert.equal(stopped.enabled, false);
});

test("tickSchedulerNow normalizes status plus returned run records", async () => {
  const tick = await tickSchedulerNow({
    fetcher: async () => jsonResponse({
      data: {
        status: {
          running: true,
          enabled: true,
          tick_interval_seconds: 600,
          max_runs_per_tick: 3,
          last_tick_at: "2026-06-06T18:10:00.000Z",
        },
        result: {
          runs: [
            {
              run_id: "scheduled-run-1",
              monitor_id: "policy-1",
              monitor_name: "Edge Sweep",
              status: "completed",
              trigger: "scheduler",
              started_at: "2026-06-06T18:09:00.000Z",
              completed_at: "2026-06-06T18:09:08.000Z",
              job_id: "job-1",
              observations_count: "5",
              findings_count: "1",
            },
          ],
          summary: { message: "1 run completed" },
        },
      },
    }),
  });

  assert.equal(tick.status.running, true);
  assert.equal(tick.status.lastTickAt, "2026-06-06T18:10:00.000Z");
  assert.equal(tick.summary, "1 run completed");
  assert.deepEqual(tick.runs, [
    {
      id: "scheduled-run-1",
      policyId: "policy-1",
      policyName: "Edge Sweep",
      status: "COMPLETED",
      trigger: "SCHEDULER",
      startedAt: "2026-06-06T18:09:00.000Z",
      completedAt: "2026-06-06T18:09:08.000Z",
      jobId: "job-1",
      error: "",
      summary: "",
      observationsCount: 5,
      findingsCount: 1,
      evidenceCount: 0,
      evidenceRefs: [],
      findingIds: [],
    },
  ]);
});

test("tickSchedulerNow treats data-only payloads as status", async () => {
  const tick = await tickSchedulerNow({
    fetcher: async () => jsonResponse({
      data: {
        running: false,
        enabled: false,
        tickIntervalSeconds: 1800,
        maxRunsPerTick: 1,
        lastTickResult: "no due policies",
      },
    }),
  });

  assert.equal(tick.status.running, false);
  assert.equal(tick.status.tickIntervalSeconds, 1800);
  assert.equal(tick.summary, "no due policies");
  assert.deepEqual(tick.runs, []);
});

test("updateSchedulerConfig patches JSON config and falls back to POST when PATCH is unavailable", async () => {
  const calls = [];
  const request = { tickIntervalSeconds: 450, maxRunsPerTick: 5 };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "PATCH") {
      return jsonResponse({ error: "method not allowed" }, { ok: false, status: 405 });
    }
    return jsonResponse({
      data: {
        enabled: true,
        running: false,
        tick_interval_seconds: request.tickIntervalSeconds,
        max_runs_per_tick: request.maxRunsPerTick,
      },
    });
  };

  const status = await updateSchedulerConfig(request, { fetcher });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/scheduler/config");
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(calls[0].options.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.equal(calls[0].options.body, JSON.stringify(request));
  assert.equal(calls[1].options.method, "POST");
  assert.equal(status.tickIntervalSeconds, 450);
  assert.equal(status.maxRunsPerTick, 5);
});

test("scheduler status returns a cloned unavailable status when offline", async () => {
  const unavailable = await loadSchedulerStatus({
    fetcher: async () => jsonResponse({ error: "offline" }, { ok: false, status: 503 }),
  });
  const missingFetch = await loadSchedulerStatus({ fetcher: null });

  assert.deepEqual(unavailable, unavailableSchedulerStatus);
  assert.notEqual(unavailable, unavailableSchedulerStatus);
  assert.deepEqual(missingFetch, unavailableSchedulerStatus);

  unavailable.running = true;
  assert.equal((await loadSchedulerStatus({ fetcher: null })).running, unavailableSchedulerStatus.running);
});

test("normalizeSchedulerStatus accepts alternate config names and clamps invalid values", () => {
  const status = normalizeSchedulerStatus({
    active: "yes",
    schedulerEnabled: "no",
    interval_seconds: "bad",
    maxRuns: "-5",
    window: "rolling",
  });

  assert.deepEqual(status, {
    running: true,
    enabled: false,
    tickIntervalSeconds: unavailableSchedulerStatus.tickIntervalSeconds,
    maxRunsPerTick: unavailableSchedulerStatus.maxRunsPerTick,
    lastTickAt: null,
    lastTickResult: null,
    scanWindow: "rolling",
  });
});
