import { normalizeProbeJob } from "./probeApi.js";

const MONITORS_ENDPOINT = "/api/monitors";
const MONITOR_RUNS_ENDPOINT = "/api/monitor-runs";
const MONITOR_HEALTH_ENDPOINT = "/api/monitor-health";
const DEFAULT_INTERVAL_SECONDS = 900;

export const monitorFallbackPolicies = [
  {
    id: "fallback-discovery-edge",
    name: "Edge Discovery Sweep",
    enabled: true,
    intervalSeconds: 900,
    nextRunAt: "2026-06-06T16:30:00.000Z",
    lastRunAt: "2026-06-06T16:00:00.000Z",
    lastJob: {
      id: "fallback-discovery-job",
      name: "Discovery Probe",
      type: "discovery",
      target: "api-gateway-prod-01, vpn-concentrator-02",
      status: "COMPLETED",
      progress: 100,
      createdAt: "2026-06-06T16:00:00.000Z",
      updatedAt: "2026-06-06T16:00:08.000Z",
      completedAt: "2026-06-06T16:00:08.000Z",
      findingsCount: 2,
      riskScore: 48,
      error: "",
      request: {
        mode: "discovery",
        hosts: ["api-gateway-prod-01", "vpn-concentrator-02"],
        timeoutMs: 2500,
      },
      result: {
        summary: "2 hosts observed",
      },
    },
    probeRequest: {
      mode: "discovery",
      hosts: ["api-gateway-prod-01", "vpn-concentrator-02"],
      timeoutMs: 2500,
    },
  },
  {
    id: "fallback-discovery-pki",
    name: "PKI Trust Chain Watch",
    enabled: false,
    intervalSeconds: 3600,
    nextRunAt: null,
    lastRunAt: "2026-06-06T14:45:00.000Z",
    lastJob: {
      id: "fallback-pki-job",
      name: "Discovery Probe",
      type: "discovery",
      target: "ca-root-internal, code-signing-01",
      status: "COMPLETED",
      progress: 100,
      createdAt: "2026-06-06T14:45:00.000Z",
      updatedAt: "2026-06-06T14:45:05.000Z",
      completedAt: "2026-06-06T14:45:05.000Z",
      findingsCount: 1,
      riskScore: 64,
      error: "",
      request: {
        mode: "discovery",
        hosts: ["ca-root-internal", "code-signing-01"],
        timeoutMs: 3000,
      },
      result: {
        summary: "PKI endpoints reachable",
      },
    },
    probeRequest: {
      mode: "discovery",
      hosts: ["ca-root-internal", "code-signing-01"],
      timeoutMs: 3000,
    },
  },
];

export const monitorFallbackRuns = [
  {
    id: "fallback-run-edge-latest",
    policyId: "fallback-discovery-edge",
    policyName: "Edge Discovery Sweep",
    status: "RUNNING",
    trigger: "SCHEDULE",
    startedAt: "2026-06-06T16:20:00.000Z",
    completedAt: null,
    jobId: "fallback-discovery-job",
    error: "",
    summary: "Discovery sweep in progress",
    observationsCount: 7,
    findingsCount: 2,
  },
  {
    id: "fallback-run-edge-previous",
    policyId: "fallback-discovery-edge",
    policyName: "Edge Discovery Sweep",
    status: "COMPLETED",
    trigger: "SCHEDULE",
    startedAt: "2026-06-06T16:00:00.000Z",
    completedAt: "2026-06-06T16:00:08.000Z",
    jobId: "fallback-discovery-job",
    error: "",
    summary: "2 hosts observed",
    observationsCount: 2,
    findingsCount: 2,
  },
  {
    id: "fallback-run-pki-failed",
    policyId: "fallback-discovery-pki",
    policyName: "PKI Trust Chain Watch",
    status: "FAILED",
    trigger: "MANUAL",
    startedAt: "2026-06-06T14:45:00.000Z",
    completedAt: "2026-06-06T14:45:05.000Z",
    jobId: "fallback-pki-job",
    error: "Certificate chain drift detected",
    summary: "PKI endpoints reachable",
    observationsCount: 2,
    findingsCount: 1,
  },
];

export const monitorFallbackHealth = {
  totalPolicies: 2,
  enabledPolicies: 1,
  duePolicies: 1,
  runningRuns: 1,
  failedRecentRuns: 1,
  lastRunAt: "2026-06-06T16:20:00.000Z",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withBaseUrl(path, baseUrl) {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveSeconds(value, fallback = DEFAULT_INTERVAL_SECONDS) {
  const numeric = toNumber(value, fallback);
  return numeric > 0 ? Math.round(numeric) : fallback;
}

function toBoolean(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "enabled", "active"].includes(normalized)) return true;
    if (["false", "0", "no", "disabled", "inactive"].includes(normalized)) return false;
  }
  return fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeStatus(value, fallback = "UNKNOWN") {
  const status = String(value ?? fallback).trim();
  if (!status) return fallback;
  return status.replace(/[\s-]+/g, "_").toUpperCase();
}

function getObjectPayload(payload, label) {
  if (!isPlainObject(payload)) {
    throw new Error(`Expected ${label} payload to be an object`);
  }

  if (isPlainObject(payload.data)) return payload.data;
  if (isPlainObject(payload.health)) return payload.health;
  if (isPlainObject(payload.item)) return payload.item;
  return payload;
}

function getArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.monitors)) return payload.monitors;
  if (Array.isArray(payload?.policies)) return payload.policies;
  if (Array.isArray(payload?.runs)) return payload.runs;
  if (Array.isArray(payload?.history)) return payload.history;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  throw new Error("Expected monitor payload to be an array");
}

function getPolicyPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("Expected monitor policy payload to be an object");
  }

  if (isPlainObject(payload.data)) return getPolicyPayload(payload.data);
  if (isPlainObject(payload.policy)) return payload.policy;
  if (isPlainObject(payload.monitor)) return payload.monitor;
  if (isPlainObject(payload.item)) return payload.item;
  return payload;
}

async function fetchJson(fetcher, path, options = {}) {
  const request = {};
  if (options.method) request.method = options.method;
  if (options.headers) request.headers = options.headers;
  if (options.body !== undefined) request.body = options.body;

  const response = await fetcher(withBaseUrl(path, options.baseUrl), request);

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }

  return response.json();
}

function fallbackPolicies() {
  return clone(monitorFallbackPolicies);
}

function fallbackRuns() {
  return clone(monitorFallbackRuns);
}

function fallbackHealth() {
  return clone(monitorFallbackHealth);
}

function cleanProbeJob(job) {
  if (!isPlainObject(job)) return null;
  const normalized = normalizeProbeJob(job);
  return {
    ...normalized,
    name: normalized.name === "Probe Probe" ? "Probe Job" : normalized.name,
    target: normalized.target === "undefined" || normalized.target === "null" ? "" : normalized.target,
  };
}

export function normalizeMonitorPolicy(policy, index = 0) {
  const probeRequest = policy.probeRequest ?? policy.probe_request ?? policy.request ?? {};
  const rawLastJob = policy.lastJob ?? policy.last_job ?? policy.job ?? null;
  const name = String(policy.name ?? policy.title ?? policy.label ?? "").trim();
  const isDiscovery = probeRequest?.mode === "discovery" || probeRequest?.type === "discovery";

  return {
    id: String(policy.id ?? policy.policy_id ?? policy.policyId ?? policy.monitor_id ?? policy.monitorId ?? policy.uuid ?? `monitor-${index + 1}`),
    name: name || (isDiscovery ? "Discovery Monitor" : "Monitor Policy"),
    enabled: toBoolean(policy.enabled ?? policy.active ?? policy.isEnabled ?? policy.is_enabled ?? policy.status, true),
    intervalSeconds: toPositiveSeconds(
      policy.intervalSeconds ?? policy.interval_seconds ?? policy.cadenceSeconds ?? policy.cadence_seconds ?? policy.frequencySeconds ?? policy.frequency_seconds,
    ),
    nextRunAt: policy.nextRunAt ?? policy.next_run_at ?? policy.nextRun ?? policy.next_run ?? null,
    lastRunAt: policy.lastRunAt ?? policy.last_run_at ?? policy.lastRun ?? policy.last_run ?? null,
    lastJob: cleanProbeJob(rawLastJob),
    probeRequest: isPlainObject(probeRequest) ? probeRequest : {},
  };
}

function compactSummary(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isPlainObject(value)) {
    const preferred = value.message ?? value.summary ?? value.status ?? value.description ?? value.text;
    if (preferred !== undefined && preferred !== null) return String(preferred);
    return Object.entries(value).slice(0, 3).map(([key, item]) => `${key}:${item}`).join(" ");
  }
  return "";
}

function countFrom(value, fallback = 0) {
  if (Array.isArray(value)) return value.length;
  return toNumber(value, fallback);
}

export function normalizeMonitorRun(run, index = 0) {
  const policy = isPlainObject(run.policy) ? run.policy : isPlainObject(run.monitor) ? run.monitor : null;
  const job = isPlainObject(run.job) ? run.job : isPlainObject(run.probe) ? run.probe : null;
  const result = isPlainObject(run.result) ? run.result : isPlainObject(run.results) ? run.results : null;
  const observations = run.observations ?? result?.observations ?? result?.targets ?? result?.hosts ?? result?.results;
  const findings = run.findings ?? result?.findings;

  return {
    id: String(run.id ?? run.run_id ?? run.runId ?? run.uuid ?? `monitor-run-${index + 1}`),
    policyId: String(
      run.policyId ?? run.policy_id ?? run.monitorId ?? run.monitor_id ?? policy?.id ?? policy?.policyId ?? policy?.policy_id ?? `monitor-${index + 1}`,
    ),
    policyName: String(run.policyName ?? run.policy_name ?? run.monitorName ?? run.monitor_name ?? policy?.name ?? policy?.title ?? "Monitor Policy"),
    status: normalizeStatus(run.status ?? run.state ?? run.phase),
    trigger: normalizeStatus(run.trigger ?? run.cause ?? run.reason ?? "UNKNOWN"),
    startedAt: run.startedAt ?? run.started_at ?? run.started ?? run.createdAt ?? run.created_at ?? null,
    completedAt: run.completedAt ?? run.completed_at ?? run.finishedAt ?? run.finished_at ?? run.endedAt ?? run.ended_at ?? null,
    jobId: String(run.jobId ?? run.job_id ?? job?.id ?? job?.jobId ?? job?.job_id ?? ""),
    error: String(run.error ?? run.error_message ?? ""),
    summary: compactSummary(run.summary ?? result?.summary),
    observationsCount: toNumber(
      run.observationsCount ?? run.observations_count ?? countFrom(observations, undefined),
    ),
    findingsCount: toNumber(
      run.findingsCount ?? run.findings_count ?? countFrom(findings, undefined),
    ),
    evidenceCount: toNumber(run.evidenceCount ?? run.evidence_count),
    evidenceRefs: Array.isArray(run.evidenceRefs ?? run.evidence_refs) ? clone(run.evidenceRefs ?? run.evidence_refs) : [],
    findingIds: Array.isArray(run.findingIds ?? run.finding_ids) ? clone(run.findingIds ?? run.finding_ids) : [],
  };
}

function lastRunTimestamp(source, runSource) {
  const lastRun = source.lastRun ?? source.last_run ?? runSource.lastRun ?? runSource.last_run;
  if (isPlainObject(lastRun)) {
    return lastRun.completedAt ?? lastRun.completed_at ?? lastRun.startedAt ?? lastRun.started_at ?? null;
  }
  return source.lastRunAt ?? source.last_run_at ?? source.lastCompletedAt ?? source.last_completed_at
    ?? runSource.lastRunAt ?? runSource.last_run_at ?? runSource.lastCompletedAt ?? runSource.last_completed_at ?? null;
}

export function normalizeMonitorHealth(health) {
  const source = getObjectPayload(health, "monitor health");
  const policySource = isPlainObject(source.policies) ? source.policies : {};
  const runSource = isPlainObject(source.runs) ? source.runs : isPlainObject(source.monitorRuns) ? source.monitorRuns : {};

  return {
    totalPolicies: toNumber(source.totalPolicies ?? source.total_policies ?? source.policyCount ?? source.policy_count ?? policySource.total ?? policySource.count),
    enabledPolicies: toNumber(source.enabledPolicies ?? source.enabled_policies ?? source.enabledCount ?? source.enabled_count ?? policySource.enabled),
    duePolicies: toNumber(source.duePolicies ?? source.due_policies ?? source.dueCount ?? source.due_count ?? policySource.due),
    runningRuns: toNumber(source.runningRuns ?? source.running_runs ?? source.runningCount ?? source.running_count ?? runSource.running),
    failedRecentRuns: toNumber(
      source.failedRecentRuns ?? source.failed_recent_runs ?? source.failedRuns ?? source.failed_runs
        ?? source.recentFailures ?? source.recent_failures ?? runSource.failedRecent ?? runSource.failed_recent ?? runSource.failed,
    ),
    lastRunAt: lastRunTimestamp(source, runSource),
  };
}

export async function loadMonitorPolicies(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackPolicies();
  }

  try {
    const payload = await fetchJson(fetcher, MONITORS_ENDPOINT, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return getArrayPayload(payload).map((policy, index) => normalizeMonitorPolicy(policy, index));
  } catch {
    return fallbackPolicies();
  }
}

export async function loadMonitorRuns(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackRuns();
  }

  try {
    const payload = await fetchJson(fetcher, MONITOR_RUNS_ENDPOINT, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return getArrayPayload(payload).map((run, index) => normalizeMonitorRun(run, index));
  } catch {
    return fallbackRuns();
  }
}

export async function loadMonitorPolicyRuns(id, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackRuns().filter((run) => run.policyId === String(id));
  }

  try {
    const payload = await fetchJson(fetcher, `${MONITORS_ENDPOINT}/${encodeURIComponent(id)}/runs`, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return getArrayPayload(payload).map((run, index) => normalizeMonitorRun(run, index));
  } catch {
    return fallbackRuns().filter((run) => run.policyId === String(id));
  }
}

export async function loadMonitorHealth(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackHealth();
  }

  try {
    const payload = await fetchJson(fetcher, MONITOR_HEALTH_ENDPOINT, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return normalizeMonitorHealth(payload);
  } catch {
    return fallbackHealth();
  }
}

export async function createMonitorPolicy(request, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return normalizeMonitorPolicy({
      ...request,
      id: "local-monitor-policy",
    });
  }

  try {
    const payload = await fetchJson(fetcher, MONITORS_ENDPOINT, {
      baseUrl,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    return normalizeMonitorPolicy(getPolicyPayload(payload));
  } catch {
    return normalizeMonitorPolicy({
      ...request,
      id: "local-monitor-policy",
    });
  }
}

export async function getMonitorPolicy(id, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackPolicies().find((policy) => policy.id === String(id)) ?? null;
  }

  const payload = await fetchJson(fetcher, `${MONITORS_ENDPOINT}/${encodeURIComponent(id)}`, {
    baseUrl,
    headers: { Accept: "application/json" },
  });

  return normalizeMonitorPolicy(getPolicyPayload(payload));
}

function normalizeRunPayload(payload) {
  const data = isPlainObject(payload?.data) ? payload.data : payload;

  if (isPlainObject(data?.policy) || isPlainObject(data?.monitor) || isPlainObject(data?.job) || isPlainObject(data?.run)) {
    const policySource = data.policy ?? data.monitor ?? null;
    const jobSource = data.job ?? data.probe ?? null;
    const runSource = data.run ?? data.monitorRun ?? data.monitor_run ?? null;

    return {
      policy: policySource ? normalizeMonitorPolicy(policySource) : null,
      job: cleanProbeJob(jobSource),
      run: runSource ? normalizeMonitorRun(runSource) : null,
    };
  }

  return {
    policy: null,
    job: cleanProbeJob(data),
    run: null,
  };
}

function localRunResult(id) {
  const policy = fallbackPolicies().find((item) => item.id === String(id)) ?? null;
  const probeRequest = policy?.probeRequest ?? { mode: "discovery", hosts: [], timeoutMs: 2500 };

  return {
    policy,
    job: cleanProbeJob({
      id: "local-monitor-run",
      status: "queued",
      progress: 0,
      request: probeRequest,
      type: probeRequest.mode ?? probeRequest.type ?? "probe",
    }),
    run: normalizeMonitorRun({
      id: "local-monitor-run",
      policyId: String(id),
      policyName: policy?.name ?? "Monitor Policy",
      status: "queued",
      trigger: "manual",
      startedAt: new Date().toISOString(),
      jobId: "local-monitor-run",
      summary: "Local monitor run queued",
    }),
  };
}

export async function runMonitorPolicyNow(id, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return localRunResult(id);
  }

  try {
    const payload = await fetchJson(fetcher, `${MONITORS_ENDPOINT}/${encodeURIComponent(id)}/run`, {
      baseUrl,
      method: "POST",
      headers: { Accept: "application/json" },
    });

    return normalizeRunPayload(payload);
  } catch {
    return localRunResult(id);
  }
}

export default {
  createMonitorPolicy,
  getMonitorPolicy,
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
};
