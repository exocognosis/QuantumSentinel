import { normalizeMonitorRun } from "./monitorApi.js";

const SCHEDULER_ENDPOINT = "/api/scheduler";
const SCHEDULER_CONFIG_ENDPOINT = "/api/scheduler/config";
const DEFAULT_TICK_INTERVAL_SECONDS = 900;
const DEFAULT_MAX_RUNS_PER_TICK = 2;

export const schedulerFallbackStatus = {
  running: false,
  enabled: false,
  tickIntervalSeconds: DEFAULT_TICK_INTERVAL_SECONDS,
  maxRunsPerTick: DEFAULT_MAX_RUNS_PER_TICK,
  lastTickAt: null,
  lastTickResult: null,
  scanWindow: null,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withBaseUrl(path, baseUrl) {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "enabled", "active", "running", "started", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "disabled", "inactive", "stopped", "stop", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function toPositiveInteger(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.round(numeric);
}

function compactSummary(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} runs`;
  if (isPlainObject(value)) {
    const preferred = value.message ?? value.summary ?? value.status ?? value.description ?? value.text;
    if (preferred !== undefined && preferred !== null) return String(preferred);
    return Object.entries(value).slice(0, 3).map(([key, item]) => `${key}:${item}`).join(" ");
  }
  return "";
}

function getStatusPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("Expected scheduler status payload to be an object");
  }

  if (isPlainObject(payload.data)) return getStatusPayload(payload.data);
  if (isPlainObject(payload.status)) return getStatusPayload(payload.status);
  if (isPlainObject(payload.scheduler)) return getStatusPayload(payload.scheduler);
  if (isPlainObject(payload.config)) return { ...payload, ...payload.config };
  return payload;
}

function arrayFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.runs)) return value.runs;
  if (Array.isArray(value?.monitorRuns)) return value.monitorRuns;
  if (Array.isArray(value?.monitor_runs)) return value.monitor_runs;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.results)) return value.results;
  if (isPlainObject(value?.run)) return [value.run];
  return [];
}

async function fetchJson(fetcher, path, options = {}) {
  const request = {};
  if (options.method) request.method = options.method;
  if (options.headers) request.headers = options.headers;
  if (options.body !== undefined) request.body = options.body;

  const response = await fetcher(withBaseUrl(path, options.baseUrl), request);

  if (!response.ok) {
    const error = new Error(`Request failed for ${path}: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function fallbackStatus(overrides = {}) {
  return {
    ...clone(schedulerFallbackStatus),
    ...overrides,
  };
}

export function normalizeSchedulerStatus(payload) {
  const source = getStatusPayload(payload);
  const running = toBoolean(
    source.running ?? source.active ?? source.started ?? source.isRunning ?? source.is_running ?? source.state ?? source.status,
    schedulerFallbackStatus.running,
  );
  const enabled = toBoolean(
    source.enabled ?? source.schedulerEnabled ?? source.scheduler_enabled ?? source.isEnabled ?? source.is_enabled,
    running,
  );

  return {
    running,
    enabled,
    tickIntervalSeconds: toPositiveInteger(
      source.tickIntervalSeconds ?? source.tick_interval_seconds ?? source.intervalSeconds ?? source.interval_seconds
        ?? source.interval ?? source.cadenceSeconds ?? source.cadence_seconds,
      schedulerFallbackStatus.tickIntervalSeconds,
    ),
    maxRunsPerTick: toPositiveInteger(
      source.maxRunsPerTick ?? source.max_runs_per_tick ?? source.maxRuns ?? source.max_runs
        ?? source.runLimit ?? source.run_limit ?? source.limit,
      schedulerFallbackStatus.maxRunsPerTick,
    ),
    lastTickAt: source.lastTickAt ?? source.last_tick_at ?? source.lastRunAt ?? source.last_run_at ?? null,
    lastTickResult: source.lastTickResult ?? source.last_tick_result ?? source.tickResult ?? source.tick_result ?? null,
    scanWindow: source.scanWindow ?? source.scan_window ?? source.window ?? null,
  };
}

function normalizeTickPayload(payload) {
  const source = isPlainObject(payload?.data) ? payload.data : payload;
  const result = source?.result ?? source?.tickResult ?? source?.tick_result ?? source?.lastTickResult ?? source?.last_tick_result ?? null;
  const hasTickShape = isPlainObject(source?.status) || result !== null;
  const statusSource = hasTickShape && isPlainObject(source.status) ? source.status : source;
  const status = normalizeSchedulerStatus(statusSource);
  const runs = arrayFrom(result).map((run, index) => normalizeMonitorRun(run, index));
  const summary = compactSummary(result?.summary ?? result?.message ?? source?.summary ?? status.lastTickResult);

  return {
    status: {
      ...status,
      lastTickResult: status.lastTickResult ?? result,
    },
    result,
    runs,
    summary,
  };
}

export async function loadSchedulerStatus(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackStatus();
  }

  try {
    const payload = await fetchJson(fetcher, SCHEDULER_ENDPOINT, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return normalizeSchedulerStatus(payload);
  } catch {
    return fallbackStatus();
  }
}

async function postSchedulerControl(path, fallbackOverrides, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackStatus(fallbackOverrides);
  }

  try {
    const payload = await fetchJson(fetcher, path, {
      baseUrl,
      method: "POST",
      headers: { Accept: "application/json" },
    });
    return normalizeSchedulerStatus(payload);
  } catch {
    return fallbackStatus(fallbackOverrides);
  }
}

export function startScheduler(options = {}) {
  return postSchedulerControl(`${SCHEDULER_ENDPOINT}/start`, { running: true, enabled: true }, options);
}

export function stopScheduler(options = {}) {
  return postSchedulerControl(`${SCHEDULER_ENDPOINT}/stop`, { running: false, enabled: false }, options);
}

export async function tickSchedulerNow(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return {
      status: fallbackStatus({
        lastTickAt: new Date().toISOString(),
        lastTickResult: "Local scheduler tick queued",
      }),
      result: null,
      runs: [],
      summary: "Local scheduler tick queued",
    };
  }

  try {
    const payload = await fetchJson(fetcher, `${SCHEDULER_ENDPOINT}/tick`, {
      baseUrl,
      method: "POST",
      headers: { Accept: "application/json" },
    });
    return normalizeTickPayload(payload);
  } catch {
    return {
      status: fallbackStatus({
        lastTickAt: new Date().toISOString(),
        lastTickResult: "Local scheduler tick queued",
      }),
      result: null,
      runs: [],
      summary: "Local scheduler tick queued",
    };
  }
}

export async function updateSchedulerConfig(config, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";
  const request = {
    tickIntervalSeconds: toPositiveInteger(config?.tickIntervalSeconds ?? config?.tick_interval_seconds, schedulerFallbackStatus.tickIntervalSeconds),
    maxRunsPerTick: toPositiveInteger(config?.maxRunsPerTick ?? config?.max_runs_per_tick, schedulerFallbackStatus.maxRunsPerTick),
  };

  if (typeof fetcher !== "function") {
    return fallbackStatus(request);
  }

  const fetchConfig = (method) => fetchJson(fetcher, SCHEDULER_CONFIG_ENDPOINT, {
    baseUrl,
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  try {
    return normalizeSchedulerStatus(await fetchConfig("PATCH"));
  } catch (error) {
    if (![404, 405, 501].includes(error.status)) {
      return fallbackStatus(request);
    }
  }

  try {
    return normalizeSchedulerStatus(await fetchConfig("POST"));
  } catch {
    return fallbackStatus(request);
  }
}

export default {
  loadSchedulerStatus,
  normalizeSchedulerStatus,
  schedulerFallbackStatus,
  startScheduler,
  stopScheduler,
  tickSchedulerNow,
  updateSchedulerConfig,
};
