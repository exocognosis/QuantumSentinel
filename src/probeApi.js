const PROBES_ENDPOINT = "/api/probes";

export const probeFallbackJobs = [
  {
    id: "fallback-tls-gateway",
    name: "TLS Handshake Probe",
    type: "tls-handshake",
    target: "api-gateway-prod-01:443",
    status: "COMPLETED",
    progress: 100,
    createdAt: "2026-05-31T12:00:00.000Z",
    updatedAt: "2026-05-31T12:02:30.000Z",
    completedAt: "2026-05-31T12:02:30.000Z",
    findingsCount: 2,
    riskScore: 82,
    error: "",
    request: {
      target: "api-gateway-prod-01:443",
      type: "tls-handshake",
    },
    result: {
      summary: "RSA certificate chain detected on production TLS endpoint.",
    },
  },
  {
    id: "fallback-certificate-ca",
    name: "Certificate Audit Probe",
    type: "certificate-audit",
    target: "ca-root-internal",
    status: "QUEUED",
    progress: 0,
    createdAt: "2026-05-31T12:10:00.000Z",
    updatedAt: null,
    completedAt: null,
    findingsCount: 0,
    riskScore: 0,
    error: "",
    request: {
      target: "ca-root-internal",
      type: "certificate-audit",
    },
    result: null,
  },
];

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

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value))));
}

function normalizeStatus(value) {
  const status = String(value || "UNKNOWN").trim();
  if (!status) return "UNKNOWN";
  return status.replace(/[\s-]+/g, "_").toUpperCase();
}

function titleCase(value) {
  const acronyms = new Set(["api", "cbom", "dns", "http", "https", "ike", "pqc", "ssh", "tls"]);
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => (acronyms.has(word.toLowerCase()) ? word.toUpperCase() : word.replace(/\b\w/g, (letter) => letter.toUpperCase())))
    .join(" ");
}

function summarizeHosts(hosts) {
  if (!Array.isArray(hosts)) return "";
  return hosts
    .map((host) => String(host ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

function getArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  throw new Error("Expected probes payload to be an array");
}

function getJobPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Expected probe job payload to be an object");
  }

  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) return payload.data;
  if (payload.job && typeof payload.job === "object" && !Array.isArray(payload.job)) return payload.job;
  if (payload.probe && typeof payload.probe === "object" && !Array.isArray(payload.probe)) return payload.probe;
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

function fallbackJobs() {
  return clone(probeFallbackJobs);
}

function normalizeTarget(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return clone(value);
  return value ?? null;
}

function targetLabel(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(targetLabel).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (Array.isArray(value.hosts)) return value.hosts.join(", ");
    const host = value.hostname ?? value.host ?? value.ip ?? value.name ?? value.id;
    const port = value.port ? `:${value.port}` : "";
    return host ? `${host}${port}` : JSON.stringify(value);
  }
  return String(value);
}

export function normalizeProbeJob(job, index = 0) {
  const request = job.request && typeof job.request === "object" && !Array.isArray(job.request) ? job.request : {};
  const result = job.result ?? job.results ?? null;
  const type = job.probe_type ?? job.probeType ?? job.type ?? job.kind ?? job.mode ?? request.probeType ?? request.type ?? request.mode ?? "probe";
  const target = job.target ?? job.host ?? job.asset ?? job.hostname ?? job.ip ?? request.target ?? request.host ?? summarizeHosts(request.hosts);
  const observations = result?.observations ?? result?.targets;
  const findings = job.findings ?? result?.findings ?? observations;
  const status = job.status ?? job.state ?? job.phase;

  return {
    id: String(job.id ?? job.job_id ?? job.jobId ?? job.probe_id ?? job.probeId ?? job.uuid ?? `probe-${index + 1}`),
    name: job.name ?? job.title ?? `${titleCase(type)} Probe`,
    type: String(type),
    target: normalizeTarget(target),
    targetLabel: targetLabel(target),
    status: normalizeStatus(status),
    progress: clampPercent(job.progress ?? job.progress_pct ?? job.progressPct ?? job.percentComplete ?? job.percent_complete),
    createdAt: job.createdAt ?? job.created_at ?? job.created ?? job.startedAt ?? job.started_at ?? job.queuedAt ?? job.queued_at ?? null,
    updatedAt: job.updatedAt ?? job.updated_at ?? null,
    completedAt: job.completedAt ?? job.completed_at ?? job.finishedAt ?? job.finished_at ?? job.endedAt ?? job.ended_at ?? null,
    findingsCount: toNumber(
      job.findingsCount ?? job.findings_count ?? (Array.isArray(findings) ? findings.length : undefined),
    ),
    riskScore: toNumber(job.riskScore ?? job.risk_score ?? job.score ?? result?.score ?? job.risk?.score),
    error: String(job.error ?? job.error_message ?? ""),
    request,
    result,
  };
}

export async function loadProbeJobs(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackJobs();
  }

  try {
    const payload = await fetchJson(fetcher, PROBES_ENDPOINT, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return getArrayPayload(payload).map((job, index) => normalizeProbeJob(job, index));
  } catch {
    return fallbackJobs();
  }
}

export async function createProbeJob(request, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return normalizeProbeJob({
      ...request,
      id: "local-probe-job",
      status: "queued",
      request,
    });
  }

  const payload = await fetchJson(fetcher, PROBES_ENDPOINT, {
    baseUrl,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  return normalizeProbeJob(getJobPayload(payload));
}

export async function getProbeJob(id, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackJobs().find((job) => job.id === String(id)) ?? null;
  }

  const payload = await fetchJson(fetcher, `${PROBES_ENDPOINT}/${encodeURIComponent(id)}`, {
    baseUrl,
    headers: { Accept: "application/json" },
  });

  return normalizeProbeJob(getJobPayload(payload));
}

export default {
  loadProbeJobs,
  createProbeJob,
  getProbeJob,
  probeFallbackJobs,
};
