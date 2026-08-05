const AUDIT_CHAIN_ENDPOINT = "/api/audit-chain/verify";
const EVIDENCE_ARCHIVE_ENDPOINT = "/api/evidence/archive";
const EVIDENCE_BUNDLE_ENDPOINT = "/api/evidence/bundle";
const REPORT_EXPORTS_ENDPOINT = "/api/report-exports";
const EVIDENCE_FILTER_FIELDS = ["reportType", "action", "entityType"];

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function withBaseUrl(path, baseUrl) {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function getObjectPayload(payload, field) {
  if (!isPlainObject(payload)) {
    throw new Error(`Expected ${field} payload to be an object`);
  }
  if (isPlainObject(payload.data)) return getObjectPayload(payload.data, field);
  if (isPlainObject(payload[field])) return getObjectPayload(payload[field], field);
  if (isPlainObject(payload.item)) return getObjectPayload(payload.item, field);
  return payload;
}

function withEvidenceFilters(path, options = {}) {
  const params = new URLSearchParams();

  for (const field of EVIDENCE_FILTER_FIELDS) {
    const value = options[field];
    if (value != null && String(value) !== "") {
      params.set(field, String(value));
    }
  }

  const query = params.toString();
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

async function fetchJson(fetcher, path, options = {}) {
  const response = await fetcher(withBaseUrl(path, options.baseUrl ?? ""), {
    headers: { Accept: "application/json", ...(options.headers ?? {}) },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }

  return response.json();
}

function normalizeCount(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeAuditChain(chain = {}) {
  return {
    valid: chain.valid === true,
    count: normalizeCount(chain.count),
    headHash: String(chain.headHash ?? chain.head_hash ?? ""),
    tailHash: String(chain.tailHash ?? chain.tail_hash ?? ""),
    brokenAt: chain.brokenAt ?? chain.broken_at ?? null,
    actions: Array.isArray(chain.actions) ? chain.actions.map(String) : [],
    latestEvent: chain.latestEvent ?? chain.latest_event ?? null,
    raw: chain,
  };
}

export function normalizeReportExportManifest(record = {}) {
  const reportType = String(record.reportType ?? record.report_type ?? record.type ?? "report");

  return {
    id: String(record.id ?? record.exportId ?? "report-export"),
    reportType,
    reportId: String(record.reportId ?? record.report_id ?? `${reportType}-export`),
    generatedAt: record.generatedAt ?? record.generated_at ?? record.createdAt ?? record.created_at ?? "",
    createdBy: record.createdBy ?? record.created_by ?? "system",
    payloadHash: String(record.payloadHash ?? record.payload_hash ?? ""),
    auditEventId: record.auditEventId ?? record.audit_event_id ?? null,
    approvalId: record.approvalId ?? record.approval_id ?? null,
    metadata: isPlainObject(record.metadata) ? record.metadata : {},
    auditChain: normalizeAuditChain(record.auditChain ?? record.audit_chain ?? {}),
    raw: record,
  };
}

export function normalizeEvidenceArchive(archive = {}) {
  const rawExports = isPlainObject(archive.reportExports ?? archive.report_exports)
    ? (archive.reportExports ?? archive.report_exports)
    : {};
  const approvals = isPlainObject(archive.approvals) ? archive.approvals : {};

  return {
    generatedAt: archive.generatedAt ?? archive.generated_at ?? "",
    auditChain: normalizeAuditChain(archive.auditChain ?? archive.audit_chain ?? {}),
    reportExports: {
      count: normalizeCount(rawExports.count),
      latest: rawExports.latest ? normalizeReportExportManifest(rawExports.latest) : null,
      byType: isPlainObject(rawExports.byType ?? rawExports.by_type) ? (rawExports.byType ?? rawExports.by_type) : {},
      items: Array.isArray(rawExports.items) ? rawExports.items.map(normalizeReportExportManifest) : [],
    },
    approvals: {
      total: normalizeCount(approvals.total),
      pending: normalizeCount(approvals.pending),
      approved: normalizeCount(approvals.approved),
      rejected: normalizeCount(approvals.rejected),
    },
    raw: archive,
  };
}

export function normalizeEvidenceBundle(bundle = {}) {
  const rawReportExports = bundle.reportExports ?? bundle.report_exports;
  const reportExports = Array.isArray(rawReportExports)
    ? rawReportExports
    : (isPlainObject(rawReportExports) && Array.isArray(rawReportExports.items) ? rawReportExports.items : []);
  const rawApprovals = bundle.approvals;
  const approvals = Array.isArray(rawApprovals)
    ? rawApprovals
    : (isPlainObject(rawApprovals) && Array.isArray(rawApprovals.items) ? rawApprovals.items : []);
  const rawAuditEvents = bundle.auditEvents ?? bundle.audit_events;
  const auditEvents = Array.isArray(rawAuditEvents)
    ? rawAuditEvents
    : (isPlainObject(rawAuditEvents) && Array.isArray(rawAuditEvents.items) ? rawAuditEvents.items : []);

  return {
    generatedAt: bundle.generatedAt ?? bundle.generated_at ?? "",
    bundleId: String(bundle.bundleId ?? bundle.bundle_id ?? ""),
    filters: isPlainObject(bundle.filters) ? bundle.filters : {},
    archive: normalizeEvidenceArchive(bundle.archive ?? bundle.evidenceArchive ?? bundle.evidence_archive ?? {}),
    reportExports: reportExports.map(normalizeReportExportManifest),
    approvals,
    auditEvents,
    raw: bundle,
  };
}

export async function loadAuditChainVerification(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return normalizeAuditChain({});
  }

  try {
    const payload = await fetchJson(fetcher, AUDIT_CHAIN_ENDPOINT, options);
    return normalizeAuditChain(getObjectPayload(payload, "auditChain"));
  } catch {
    return normalizeAuditChain({});
  }
}

export async function loadReportExportManifest(id, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return normalizeReportExportManifest({ id });
  }

  try {
    const payload = await fetchJson(fetcher, `${REPORT_EXPORTS_ENDPOINT}/${encodeURIComponent(id)}/manifest`, options);
    return normalizeReportExportManifest(getObjectPayload(payload, "manifest"));
  } catch {
    return normalizeReportExportManifest({ id });
  }
}

export async function loadEvidenceArchive(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return normalizeEvidenceArchive({});
  }

  try {
    const payload = await fetchJson(fetcher, withEvidenceFilters(EVIDENCE_ARCHIVE_ENDPOINT, options), options);
    return normalizeEvidenceArchive(getObjectPayload(payload, "archive"));
  } catch {
    return normalizeEvidenceArchive({});
  }
}

export async function loadEvidenceBundle(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    return normalizeEvidenceBundle({});
  }

  try {
    const payload = await fetchJson(fetcher, withEvidenceFilters(EVIDENCE_BUNDLE_ENDPOINT, options), options);
    return normalizeEvidenceBundle(getObjectPayload(payload, "bundle"));
  } catch {
    return normalizeEvidenceBundle({});
  }
}

export default {
  loadAuditChainVerification,
  loadEvidenceArchive,
  loadEvidenceBundle,
  loadReportExportManifest,
  normalizeAuditChain,
  normalizeEvidenceArchive,
  normalizeEvidenceBundle,
  normalizeReportExportManifest,
};
