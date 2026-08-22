import { createProbeJob, validateProbeRequest } from "./probeEngine.js";

const MIN_INTERVAL_SECONDS = 60;
const DEFAULT_MAX_RUNS_PER_TICK = 5;
const MAX_RUNS_PER_TICK = 20;
const DEFAULT_SCHEDULER_INTERVAL_SECONDS = 60;
const DEFAULT_SCAN_WINDOW_SECONDS = 0;
const MAX_SCAN_WINDOW_SECONDS = 3_600;

class MonitorPolicyError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "MonitorPolicyError";
    this.statusCode = statusCode;
  }
}

function isoNow() {
  return new Date().toISOString();
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function parseIntervalSeconds(payload) {
  const value = payload.intervalSeconds ?? payload.cadenceSeconds;
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    throw new MonitorPolicyError("intervalSeconds must be an integer");
  }

  if (parsed < MIN_INTERVAL_SECONDS) {
    throw new MonitorPolicyError(`intervalSeconds must be at least ${MIN_INTERVAL_SECONDS}`);
  }

  return parsed;
}

function parseRunAt(value, fieldName) {
  if (value == null) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new MonitorPolicyError(`${fieldName} must be an ISO timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function addSeconds(isoTimestamp, seconds) {
  return new Date(Date.parse(isoTimestamp) + seconds * 1000).toISOString();
}

function toIsoTimestamp(value) {
  if (typeof value === "function") return value();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return parseRunAt(value, "now");
  return isoNow();
}

function normalizeName(name) {
  if (name == null) return "Monitor policy";
  if (typeof name !== "string") {
    throw new MonitorPolicyError("name must be a string");
  }

  const trimmed = name.trim();
  return trimmed || "Monitor policy";
}

function normalizeProbeRequest(input) {
  const request = validateProbeRequest(input);

  if (request.mode === "discovery") {
    return {
      mode: "discovery",
      hosts: clone(request.hosts),
      ports: clone(request.ports),
      port: request.port,
      concurrency: request.concurrency,
      timeoutMs: request.timeoutMs,
    };
  }

  if (request.mode === "device") {
    return {
      mode: "device",
      scope: request.scope,
      hosts: clone(request.hosts),
      ports: clone(request.ports),
      discoverActivePorts: request.discoverActivePorts,
      timeoutMs: request.timeoutMs,
    };
  }

  return {
    mode: "tls",
    assetId: request.assetId,
    host: request.host,
    port: request.port,
    timeoutMs: request.timeoutMs,
  };
}

function requireDatastore(datastore) {
  if (!datastore) {
    throw new MonitorPolicyError("Datastore is not configured", 501);
  }
}

function normalizeCreatePayload(payload, { now = isoNow } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new MonitorPolicyError("Monitor policy payload must be an object");
  }

  if (!payload.probeRequest || typeof payload.probeRequest !== "object" || Array.isArray(payload.probeRequest)) {
    throw new MonitorPolicyError("probeRequest is required");
  }

  const createdAt = parseRunAt(payload.createdAt, "createdAt") ?? now();
  const updatedAt = parseRunAt(payload.updatedAt, "updatedAt") ?? createdAt;
  const intervalSeconds = parseIntervalSeconds(payload);

  return {
    name: normalizeName(payload.name),
    enabled: payload.enabled === true,
    probeRequest: normalizeProbeRequest(payload.probeRequest),
    intervalSeconds,
    nextRunAt: parseRunAt(payload.nextRunAt, "nextRunAt") ?? addSeconds(updatedAt, intervalSeconds),
    lastRunAt: parseRunAt(payload.lastRunAt, "lastRunAt"),
    lastJobId: payload.lastJobId ?? null,
    createdAt,
    updatedAt,
  };
}

function normalizeUpdatePayload(existing, patch, { now = isoNow } = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new MonitorPolicyError("Monitor policy payload must be an object");
  }

  const intervalSeconds = patch.intervalSeconds == null && patch.cadenceSeconds == null
    ? existing.intervalSeconds
    : parseIntervalSeconds(patch);
  const updatedAt = parseRunAt(patch.updatedAt, "updatedAt") ?? now();

  return {
    ...existing,
    name: patch.name == null ? existing.name : normalizeName(patch.name),
    enabled: patch.enabled == null ? existing.enabled : patch.enabled === true,
    probeRequest: patch.probeRequest == null ? existing.probeRequest : normalizeProbeRequest(patch.probeRequest),
    intervalSeconds,
    nextRunAt: parseRunAt(patch.nextRunAt, "nextRunAt") ?? existing.nextRunAt,
    lastRunAt: patch.lastRunAt === undefined ? existing.lastRunAt : parseRunAt(patch.lastRunAt, "lastRunAt"),
    lastJobId: patch.lastJobId === undefined ? existing.lastJobId : patch.lastJobId,
    updatedAt,
  };
}

export async function createMonitorPolicy(datastore, payload, options = {}) {
  requireDatastore(datastore);
  return datastore.createMonitorPolicy(normalizeCreatePayload(payload, options));
}

export async function updateMonitorPolicy(datastore, id, patch, options = {}) {
  requireDatastore(datastore);
  const existing = await datastore.getMonitorPolicy(id);
  if (!existing) {
    throw new MonitorPolicyError("Monitor policy not found", 404);
  }

  return datastore.updateMonitorPolicy(id, normalizeUpdatePayload(existing, patch, options));
}

export async function listMonitorPolicies(datastore) {
  if (!datastore) return [];
  return datastore.listMonitorPolicies();
}

export async function getMonitorPolicy(datastore, id) {
  if (!datastore) return null;
  return datastore.getMonitorPolicy(id);
}

export async function listMonitorRuns(datastore, filters = {}) {
  if (!datastore) return [];
  return datastore.listMonitorRuns(filters);
}

function summarizeJobRun(job, persistence = null) {
  const observationsCount = Array.isArray(job.result?.observations)
    ? job.result.observations.length
    : job.result
      ? 1
      : 0;
  const findingsCount = Array.isArray(job.result?.findings)
    ? job.result.findings.length
    : job.mode === "tls" && job.status === "completed" && job.result
      ? 1
      : 0;

  return {
    summary: {
      ...(job.mode === "tls" ? {
        target: clone(job.target ?? null),
        protocol: clone(job.result?.protocol ?? null),
        certificate: clone(job.result?.certificate ?? null),
        classification: clone(job.result?.classification ?? null),
      } : {}),
      ...clone(job.result?.summary ?? job.result?.classification ?? {}),
    },
    observationsCount,
    findingsCount: persistence?.findingCount ?? findingsCount,
    evidenceCount: persistence?.evidenceCount ?? 0,
    evidenceRefs: clone(persistence?.evidenceRefs ?? []),
    findingIds: clone(persistence?.findingIds ?? []),
  };
}

export async function runMonitorPolicy(datastore, id, {
  now = isoNow,
  persistProbeResult = null,
  createProbeJobFn = createProbeJob,
  trigger = "manual",
} = {}) {
  requireDatastore(datastore);
  const policy = await datastore.getMonitorPolicy(id);
  if (!policy) {
    throw new MonitorPolicyError("Monitor policy not found", 404);
  }

  const runningRuns = await datastore.listMonitorRuns({ policyId: policy.id, status: "running" });
  if (runningRuns.length > 0) {
    throw new MonitorPolicyError("Monitor policy is already running", 409);
  }

  const nowFn = () => toIsoTimestamp(now);
  const startedAt = nowFn();
  const run = await datastore.createMonitorRun({
    policyId: policy.id,
    policyName: policy.name,
    status: "running",
    trigger,
    startedAt,
  });

  let job = null;
  let persistence = null;

  try {
    job = await createProbeJobFn(policy.probeRequest);
    if (persistProbeResult) {
      persistence = await persistProbeResult(datastore, job);
    } else {
      await datastore.createProbeJob(job);
    }
  } catch (error) {
    const completedAt = nowFn();
    const failedRun = await datastore.updateMonitorRun(run.id, {
      status: "failed",
      completedAt,
      error: error.message,
    });
    throw Object.assign(error, { monitorRun: failedRun });
  }

  const lastRunAt = nowFn();
  const updatedPolicy = await datastore.updateMonitorPolicy(id, {
    lastRunAt,
    lastJobId: job.id,
    nextRunAt: addSeconds(lastRunAt, policy.intervalSeconds),
    updatedAt: lastRunAt,
  });
  const completedRun = await datastore.updateMonitorRun(run.id, {
    status: job.status === "completed" ? "completed" : "failed",
    completedAt: lastRunAt,
    jobId: job.id,
    error: job.error,
    ...summarizeJobRun(job, persistence),
  });

  return {
    policy: updatedPolicy,
    job,
    run: completedRun,
  };
}

export async function listDueMonitorPolicies(datastore, now = isoNow) {
  if (!datastore) return [];

  const nowIso = toIsoTimestamp(now);
  const [policies, runningRuns] = await Promise.all([
    datastore.listMonitorPolicies(),
    datastore.listMonitorRuns({ status: "running" }),
  ]);
  const runningPolicyIds = new Set(runningRuns.map((run) => run.policyId));

  return policies
    .filter((policy) => policy.enabled === true)
    .filter((policy) => policy.nextRunAt != null && Date.parse(policy.nextRunAt) <= Date.parse(nowIso))
    .filter((policy) => !runningPolicyIds.has(policy.id))
    .toSorted((left, right) => (
      String(left.nextRunAt).localeCompare(String(right.nextRunAt))
      || String(left.createdAt).localeCompare(String(right.createdAt))
      || String(left.id).localeCompare(String(right.id))
    ));
}

export async function runDueMonitorPolicies(datastore, {
  maxRuns = DEFAULT_MAX_RUNS_PER_TICK,
  now = isoNow,
  persistProbeResult = null,
} = {}) {
  requireDatastore(datastore);
  const limit = Math.max(0, Number.isInteger(Number(maxRuns)) ? Number(maxRuns) : DEFAULT_MAX_RUNS_PER_TICK);
  const duePolicies = await listDueMonitorPolicies(datastore, now);
  const selected = duePolicies.slice(0, limit);
  const runs = [];

  for (const policy of selected) {
    runs.push(await runMonitorPolicy(datastore, policy.id, {
      now,
      persistProbeResult,
      trigger: "scheduled",
    }));
  }

  return {
    runs,
    skipped: Math.max(0, duePolicies.length - selected.length),
  };
}

export async function getMonitorHealth(datastore, now = isoNow) {
  if (!datastore) {
    return {
      totalPolicies: 0,
      enabledPolicies: 0,
      duePolicies: 0,
      runningRuns: 0,
      failedRuns: 0,
      lastRunAt: null,
    };
  }

  const [policies, duePolicies, runs] = await Promise.all([
    datastore.listMonitorPolicies(),
    listDueMonitorPolicies(datastore, now),
    datastore.listMonitorRuns(),
  ]);
  const completedRuns = runs.filter((run) => run.completedAt);

  return {
    totalPolicies: policies.length,
    enabledPolicies: policies.filter((policy) => policy.enabled === true).length,
    duePolicies: duePolicies.length,
    runningRuns: runs.filter((run) => run.status === "running").length,
    failedRuns: runs.filter((run) => run.status === "failed").length,
    lastRunAt: completedRuns
      .map((run) => run.completedAt)
      .toSorted((left, right) => String(right).localeCompare(String(left)))[0] ?? null,
  };
}

function clampInteger(value, {
  fallback,
  min,
  max,
}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeSchedulerConfig(patch = {}, existing = {}) {
  return {
    tickIntervalSeconds: clampInteger(
      patch.tickIntervalSeconds ?? existing.tickIntervalSeconds,
      {
        fallback: existing.tickIntervalSeconds ?? DEFAULT_SCHEDULER_INTERVAL_SECONDS,
        min: DEFAULT_SCHEDULER_INTERVAL_SECONDS,
        max: 86_400,
      },
    ),
    maxRunsPerTick: clampInteger(
      patch.maxRunsPerTick ?? existing.maxRunsPerTick,
      {
        fallback: existing.maxRunsPerTick ?? DEFAULT_MAX_RUNS_PER_TICK,
        min: 1,
        max: MAX_RUNS_PER_TICK,
      },
    ),
    scanWindowSeconds: clampInteger(
      patch.scanWindowSeconds ?? patch.scanWindow ?? existing.scanWindowSeconds,
      {
        fallback: existing.scanWindowSeconds ?? DEFAULT_SCAN_WINDOW_SECONDS,
        min: 0,
        max: MAX_SCAN_WINDOW_SECONDS,
      },
    ),
  };
}

export class MonitorSchedulerRuntime {
  constructor({
    datastore = null,
    enabled = false,
    tickIntervalSeconds = DEFAULT_SCHEDULER_INTERVAL_SECONDS,
    maxRunsPerTick = DEFAULT_MAX_RUNS_PER_TICK,
    scanWindowSeconds = DEFAULT_SCAN_WINDOW_SECONDS,
    now = isoNow,
    persistProbeResult = null,
    setTimer = setInterval,
    clearTimer = clearInterval,
  } = {}) {
    this.datastore = datastore;
    this.enabled = enabled === true;
    this.config = normalizeSchedulerConfig({
      tickIntervalSeconds,
      maxRunsPerTick,
      scanWindowSeconds,
    });
    this.now = now;
    this.persistProbeResult = persistProbeResult;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.timer = null;
    this.lastTickAt = null;
    this.lastTickResult = null;
    this.tickInFlight = null;
  }

  get running() {
    return this.timer != null;
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.running,
      config: clone(this.config),
      lastTickAt: this.lastTickAt,
      lastTickResult: clone(this.lastTickResult),
    };
  }

  updateConfig(patch = {}) {
    const wasRunning = this.running;
    this.enabled = patch.enabled == null ? this.enabled : patch.enabled === true;
    this.config = normalizeSchedulerConfig(patch, this.config);

    if (!this.enabled && wasRunning) {
      this.stop();
    } else if (wasRunning) {
      this.stop({ disable: false });
      this.start();
    }

    return this.getStatus();
  }

  start() {
    if (this.running) return this.getStatus();

    requireDatastore(this.datastore);
    this.enabled = true;
    this.timer = this.setTimer(() => {
      void this.tick().catch(() => {});
    }, this.config.tickIntervalSeconds * 1000);
    this.timer?.unref?.();

    return this.getStatus();
  }

  stop({ disable = true } = {}) {
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }

    if (disable) {
      this.enabled = false;
    }

    return this.getStatus();
  }

  async tick() {
    if (this.tickInFlight) return this.tickInFlight;

    this.tickInFlight = this.runTick();

    try {
      return await this.tickInFlight;
    } finally {
      this.tickInFlight = null;
    }
  }

  async runTick() {
    const at = toIsoTimestamp(this.now);
    const effectiveNow = addSeconds(at, this.config.scanWindowSeconds);
    this.lastTickAt = at;

    try {
      const result = await runDueMonitorPolicies(this.datastore, {
        maxRuns: this.config.maxRunsPerTick,
        now: effectiveNow,
        persistProbeResult: this.persistProbeResult,
      });
      this.lastTickResult = {
        at,
        effectiveNow,
        ...result,
      };
      return clone(this.lastTickResult);
    } catch (error) {
      this.lastTickResult = {
        at,
        effectiveNow,
        runs: [],
        skipped: 0,
        error: error.message,
      };
      throw error;
    }
  }
}

export function createMonitorScheduler(options = {}) {
  return new MonitorSchedulerRuntime(options);
}
