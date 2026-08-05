import { ASSETS as FALLBACK_ASSETS } from "./mockData.js";

const FINDINGS_ENDPOINT = "/api/findings";
const REMEDIATION_SUMMARY_ENDPOINT = "/api/remediation/summary";
const DUE_SOON_DAYS = 14;

export const findingFallbackFindings = [
  {
    id: "fallback-ca-root-trust",
    assetId: "3",
    assetName: "ca-root-internal",
    severity: "CRITICAL",
    type: "TNFL",
    title: "CA root signing chain requires PQC migration",
    description: "RSA-4096 root signing remains a trust forge exposure for future certificate impersonation.",
    evidence: "PKIX chain uses RSA-4096 root certificate expiring 2031-06-30.",
    source: "fallback",
    status: "IN_PROGRESS",
    owner: "pki-team",
    dueAt: "2026-06-12T18:00:00.000Z",
    priority: "CRITICAL",
    remediation: { target: "ML-DSA-87" },
    remediationTarget: "ML-DSA-87",
    resolution: "",
    updatedAt: "2026-06-06T15:20:00.000Z",
    closedAt: null,
    notes: [{ text: "Migration window requested with PKI owners.", author: "system" }],
    asset: FALLBACK_ASSETS.find((asset) => asset.id === 3),
  },
  {
    id: "fallback-api-gateway-hndl",
    assetId: "1",
    assetName: "api-gateway-prod-01",
    severity: "CRITICAL",
    type: "HNDL",
    title: "Internet gateway exposes RSA key exchange path",
    description: "Production gateway still presents a classical certificate path without PQC key establishment.",
    evidence: "TLS asset classified SHOR-CRITICAL with PFS disabled.",
    source: "fallback",
    status: "OPEN",
    owner: "edge-team",
    dueAt: "2026-06-05T18:00:00.000Z",
    priority: "CRITICAL",
    remediation: { target: "ML-KEM-768 + ML-DSA-65" },
    remediationTarget: "ML-KEM-768 + ML-DSA-65",
    resolution: "",
    updatedAt: "2026-06-06T14:35:00.000Z",
    closedAt: null,
    notes: [],
    asset: FALLBACK_ASSETS.find((asset) => asset.id === 1),
  },
  {
    id: "fallback-vpn-concentrator",
    assetId: "2",
    assetName: "vpn-concentrator-01",
    severity: "HIGH",
    type: "HNDL",
    title: "VPN concentrator migration queued",
    description: "IKEv2 path remains quantum-vulnerable and has downgrade exposure.",
    evidence: "ECDH-P256 observed on perimeter VPN gateway.",
    source: "fallback",
    status: "TRIAGED",
    owner: "network-team",
    dueAt: "2026-06-20T18:00:00.000Z",
    priority: "HIGH",
    remediation: { target: "ML-KEM-1024" },
    remediationTarget: "ML-KEM-1024",
    resolution: "",
    updatedAt: "2026-06-06T13:10:00.000Z",
    closedAt: null,
    notes: [{ text: "Awaiting client compatibility review.", author: "system" }],
    asset: FALLBACK_ASSETS.find((asset) => asset.id === 2),
  },
  {
    id: "fallback-ot-refresh",
    assetId: "15",
    assetName: "plc-boiler-ctrl-07",
    severity: "CRITICAL",
    type: "OT",
    title: "OT controller requires hardware refresh",
    description: "DES-56 controller has no viable cryptographic migration path.",
    evidence: "Deprecated protocol and algorithm observed on OT segment.",
    source: "fallback",
    status: "ACCEPTED_RISK",
    owner: "ot-ops",
    dueAt: "2026-07-15T18:00:00.000Z",
    priority: "CRITICAL",
    remediation: { target: "REQUIRES HW REFRESH" },
    remediationTarget: "REQUIRES HW REFRESH",
    resolution: "Risk accepted until scheduled OT maintenance window.",
    updatedAt: "2026-06-06T12:00:00.000Z",
    closedAt: "2026-06-06T12:00:00.000Z",
    notes: [{ text: "Accepted by OT risk owner.", author: "system" }],
    asset: FALLBACK_ASSETS.find((asset) => asset.id === 15),
  },
  {
    id: "fallback-pqc-pilot",
    assetId: "13",
    assetName: "api-gw-pqc-pilot",
    severity: "LOW",
    type: "PQC",
    title: "PQC pilot confirmed",
    description: "Hybrid key establishment is active on the pilot gateway.",
    evidence: "X25519+ML-KEM negotiated successfully.",
    source: "fallback",
    status: "REMEDIATED",
    owner: "edge-team",
    dueAt: null,
    priority: "LOW",
    remediation: { target: "Full PQC when ready" },
    remediationTarget: "Full PQC when ready",
    resolution: "Hybrid profile deployed.",
    updatedAt: "2026-06-06T11:40:00.000Z",
    closedAt: "2026-06-06T11:40:00.000Z",
    notes: [],
    asset: FALLBACK_ASSETS.find((asset) => asset.id === 13),
  },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function compactText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isPlainObject(value)) {
    const preferred = value.target ?? value.action ?? value.summary ?? value.title ?? value.name ?? value.message ?? value.description;
    if (preferred !== undefined && preferred !== null) return String(preferred);
    return Object.entries(value).slice(0, 3).map(([key, item]) => `${key}:${item}`).join(" ");
  }
  return "";
}

function normalizeToken(value, fallback = "UNKNOWN") {
  const token = String(value ?? fallback).trim();
  if (!token) return fallback;
  return token.replace(/[\s-]+/g, "_").toUpperCase();
}

function humanizeToken(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fallbackAssetFor(finding) {
  const explicit = finding.asset && isPlainObject(finding.asset) ? finding.asset : null;
  const rawAssetId = finding.assetId ?? finding.asset_id ?? finding.assetID ?? explicit?.id ?? explicit?.assetId;
  const rawAssetName = finding.assetName ?? finding.asset_name ?? finding.hostname ?? finding.host ?? explicit?.hostname ?? explicit?.name;
  const byId = rawAssetId !== undefined && rawAssetId !== null
    ? FALLBACK_ASSETS.find((asset) => String(asset.id) === String(rawAssetId))
    : null;
  const byName = rawAssetName
    ? FALLBACK_ASSETS.find((asset) => asset.hostname === String(rawAssetName))
    : null;
  return explicit ?? byId ?? byName ?? null;
}

function getArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.findings)) return payload.findings;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  throw new Error("Expected findings payload to be an array");
}

function getFindingPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("Expected finding payload to be an object");
  }

  if (isPlainObject(payload.data)) return getFindingPayload(payload.data);
  if (isPlainObject(payload.finding)) return getFindingPayload(payload.finding);
  if (isPlainObject(payload.item)) return getFindingPayload(payload.item);
  return payload;
}

function getSummaryPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("Expected remediation summary payload to be an object");
  }

  if (isPlainObject(payload.data)) return getSummaryPayload(payload.data);
  if (isPlainObject(payload.summary)) return getSummaryPayload(payload.summary);
  if (isPlainObject(payload.remediation)) return getSummaryPayload(payload.remediation);
  return payload;
}

function queryString(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === "ALL") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
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

function fallbackFindings() {
  return clone(findingFallbackFindings);
}

function normalizeNotes(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (value === null || value === undefined || value === "") return [];
  return [value];
}

export function normalizeFinding(finding, index = 0) {
  const asset = fallbackAssetFor(finding) ?? {};
  const assetId = finding.assetId ?? finding.asset_id ?? finding.assetID ?? asset.id ?? finding.host ?? finding.hostname ?? "";
  const assetName = finding.assetName ?? finding.asset_name ?? finding.assetHostname ?? finding.asset_hostname
    ?? finding.hostname ?? finding.host ?? asset.hostname ?? asset.name ?? String(assetId || "");
  const severity = normalizeToken(finding.severity ?? finding.sev ?? finding.priority ?? asset.prio, "MEDIUM");
  const type = normalizeToken(finding.type ?? finding.findingType ?? finding.finding_type ?? finding.category ?? finding.kind ?? "finding");
  const title = String(
    finding.title ?? finding.name ?? finding.summary
      ?? `${humanizeToken(severity)} ${humanizeToken(type).toLowerCase()} finding on ${assetName || "unknown asset"}`,
  );
  const remediation = finding.remediation ?? finding.recommendation ?? finding.fix ?? finding.action ?? null;
  const remediationTarget = compactText(
    finding.remediationTarget ?? finding.remediation_target ?? finding.targetRemediation ?? finding.target_remediation
      ?? remediation ?? asset.migration,
  );
  const notes = normalizeNotes(finding.notes ?? finding.history ?? finding.events);

  return {
    id: String(finding.id ?? finding.finding_id ?? finding.findingId ?? finding.uuid ?? `finding-${index + 1}`),
    assetId: String(assetId),
    assetName: String(assetName || assetId || "unknown asset"),
    severity,
    type,
    title,
    description: String(finding.description ?? finding.details ?? finding.message ?? ""),
    evidence: compactText(finding.evidence ?? finding.observation ?? finding.observations ?? finding.proof),
    source: String(finding.source ?? "api"),
    status: normalizeToken(finding.status ?? finding.state ?? finding.lifecycle ?? "OPEN", "OPEN"),
    owner: String(finding.owner ?? finding.assignee ?? finding.assignedTo ?? finding.assigned_to ?? "Unassigned"),
    dueAt: finding.dueAt ?? finding.due_at ?? finding.dueDate ?? finding.due_date ?? null,
    priority: normalizeToken(finding.priority ?? severity, severity),
    approvalId: finding.approvalId ?? finding.approval_id ?? null,
    remediation,
    remediationTarget,
    resolution: compactText(finding.resolution ?? finding.outcome ?? ""),
    updatedAt: finding.updatedAt ?? finding.updated_at ?? finding.modifiedAt ?? finding.modified_at ?? null,
    closedAt: finding.closedAt ?? finding.closed_at ?? finding.resolvedAt ?? finding.resolved_at ?? null,
    notes,
    asset: isPlainObject(finding.asset) ? finding.asset : asset,
  };
}

function isClosedStatus(status) {
  return ["CLOSED", "REMEDIATED", "ACCEPTED_RISK", "RISK_ACCEPTED", "RESOLVED"].includes(status);
}

function isInProgressStatus(status) {
  return ["IN_PROGRESS", "STARTED", "WORKING", "REMEDIATING"].includes(status);
}

export function deriveRemediationSummary(findings, now = new Date()) {
  const dueSoonMs = DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
  const openFindings = findings.filter((finding) => !isClosedStatus(finding.status));
  const overdue = openFindings.filter((finding) => {
    if (!finding.dueAt) return false;
    const due = new Date(finding.dueAt);
    return !Number.isNaN(due.getTime()) && due < now;
  }).length;
  const dueSoon = openFindings.filter((finding) => {
    if (!finding.dueAt) return false;
    const due = new Date(finding.dueAt);
    if (Number.isNaN(due.getTime()) || due < now) return false;
    return due.getTime() - now.getTime() <= dueSoonMs;
  }).length;
  const remediatedClosed = findings.filter((finding) => isClosedStatus(finding.status)).length;

  return {
    openCritical: openFindings.filter((finding) => finding.severity === "CRITICAL").length,
    overdue,
    dueSoon,
    inProgress: findings.filter((finding) => isInProgressStatus(finding.status)).length,
    remediatedClosed,
    total: findings.length,
  };
}

export function normalizeRemediationSummary(payload) {
  const summary = getSummaryPayload(payload);
  const remediatedClosed = toNumber(
    summary.remediatedClosed ?? summary.remediated_closed ?? summary.closed ?? summary.resolved
      ?? summary.closedCount ?? summary.closed_count ?? summary.remediated,
  );

  return {
    openCritical: toNumber(summary.openCritical ?? summary.open_critical ?? summary.criticalOpen ?? summary.critical_open),
    overdue: toNumber(summary.overdue ?? summary.overdueCount ?? summary.overdue_count),
    dueSoon: toNumber(summary.dueSoon ?? summary.due_soon ?? summary.dueSoonCount ?? summary.due_soon_count),
    inProgress: toNumber(summary.inProgress ?? summary.in_progress ?? summary.started ?? summary.active),
    remediatedClosed,
    total: toNumber(summary.total ?? summary.count, 0)
      || toNumber(summary.openCritical ?? summary.open_critical)
      + toNumber(summary.overdue)
      + toNumber(summary.dueSoon ?? summary.due_soon)
      + toNumber(summary.inProgress ?? summary.in_progress)
      + remediatedClosed,
  };
}

export async function loadFindings(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackFindings();
  }

  try {
    const payload = await fetchJson(fetcher, `${FINDINGS_ENDPOINT}${queryString(options.filters)}`, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return getArrayPayload(payload).map((finding, index) => normalizeFinding(finding, index));
  } catch {
    return fallbackFindings();
  }
}

export async function getFinding(id, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackFindings().find((finding) => finding.id === String(id)) ?? null;
  }

  try {
    const payload = await fetchJson(fetcher, `${FINDINGS_ENDPOINT}/${encodeURIComponent(id)}`, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return normalizeFinding(getFindingPayload(payload));
  } catch {
    return fallbackFindings().find((finding) => finding.id === String(id)) ?? null;
  }
}

export async function updateFinding(id, updates, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";
  const method = options.method ?? "PATCH";

  if (typeof fetcher !== "function") {
    return normalizeFinding({ ...updates, id, updatedAt: new Date().toISOString() });
  }

  const requestOptions = {
    baseUrl,
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updates),
  };

  try {
    const payload = await fetchJson(fetcher, `${FINDINGS_ENDPOINT}/${encodeURIComponent(id)}`, requestOptions);
    return normalizeFinding(getFindingPayload(payload));
  } catch (error) {
    if (method === "PATCH" && (error.status === 404 || error.status === 405)) {
      const payload = await fetchJson(fetcher, `${FINDINGS_ENDPOINT}/${encodeURIComponent(id)}`, {
        ...requestOptions,
        method: "POST",
      });
      return normalizeFinding(getFindingPayload(payload));
    }
    throw error;
  }
}

export async function appendFindingNote(id, note, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";
  const body = {
    note: String(note),
    ...(options.author ? { author: options.author } : {}),
  };

  if (typeof fetcher !== "function") {
    return normalizeFinding({
      id,
      notes: [{ text: body.note, author: body.author ?? "local", createdAt: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    });
  }

  const payload = await fetchJson(fetcher, `${FINDINGS_ENDPOINT}/${encodeURIComponent(id)}/notes`, {
    baseUrl,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return normalizeFinding(getFindingPayload(payload));
}

export async function loadRemediationSummary(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return deriveRemediationSummary(fallbackFindings());
  }

  try {
    const payload = await fetchJson(fetcher, REMEDIATION_SUMMARY_ENDPOINT, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return normalizeRemediationSummary(payload);
  } catch {
    return deriveRemediationSummary(fallbackFindings());
  }
}

export default {
  appendFindingNote,
  deriveRemediationSummary,
  findingFallbackFindings,
  getFinding,
  loadFindings,
  loadRemediationSummary,
  normalizeFinding,
  normalizeRemediationSummary,
  updateFinding,
};
