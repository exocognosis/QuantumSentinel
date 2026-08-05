const APPROVALS_ENDPOINT = "/api/approvals";
const REPORTS_ENDPOINT = "/api/reports";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function withBaseUrl(path, baseUrl) {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
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

function actorHeaders({ actor = null, role = null } = {}) {
  const headers = { Accept: "application/json" };
  if (actor) headers["x-qs-actor"] = actor;
  if (role) headers["x-qs-role"] = role;
  return headers;
}

function getCollectionPayload(payload, field) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.[field])) return payload[field];
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  throw new Error(`Expected ${field} payload to be an array`);
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

async function fetchJson(fetcher, path, {
  baseUrl = "",
  headers = {},
  method = "GET",
  body = null,
} = {}) {
  const request = {
    method,
    headers,
  };

  if (body != null) {
    request.headers = { "content-type": "application/json", ...headers };
    request.body = JSON.stringify(body);
  }

  const response = await fetcher(withBaseUrl(path, baseUrl), request);

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }

  return response.json();
}

export function normalizeApproval(approval = {}) {
  const id = String(approval.id ?? approval.approvalId ?? "approval");
  const entityType = String(approval.entityType ?? approval.entity_type ?? "system");
  const entityId = String(approval.entityId ?? approval.entity_id ?? "");

  return {
    id,
    entityType,
    entityId,
    action: String(approval.action ?? "approval"),
    status: String(approval.status ?? "pending").toLowerCase(),
    requestedBy: approval.requestedBy ?? approval.requested_by ?? approval.actor ?? "system",
    assignedTo: approval.assignedTo ?? approval.assigned_to ?? null,
    justification: String(approval.justification ?? approval.reason ?? ""),
    requestedAt: approval.requestedAt ?? approval.requested_at ?? "",
    updatedAt: approval.updatedAt ?? approval.updated_at ?? "",
    decidedAt: approval.decidedAt ?? approval.decided_at ?? "",
    decidedBy: approval.decidedBy ?? approval.decided_by ?? null,
    decisionNote: String(approval.decisionNote ?? approval.decision_note ?? approval.note ?? ""),
    metadata: isPlainObject(approval.metadata) ? approval.metadata : {},
    raw: approval,
  };
}

export function normalizeReportExport(record = {}) {
  const reportType = String(record.reportType ?? record.report_type ?? record.type ?? "report");

  return {
    id: String(record.id ?? record.exportId ?? "report-export"),
    reportType,
    reportId: String(record.reportId ?? record.report_id ?? `${reportType}-export`),
    generatedAt: record.generatedAt ?? record.generated_at ?? record.createdAt ?? record.created_at ?? "",
    createdBy: record.createdBy ?? record.created_by ?? "system",
    scope: isPlainObject(record.scope) ? record.scope : {},
    summary: isPlainObject(record.summary) ? record.summary : {},
    evidenceRefs: Array.isArray(record.evidenceRefs ?? record.evidence_refs)
      ? (record.evidenceRefs ?? record.evidence_refs)
      : [],
    payloadHash: String(record.payloadHash ?? record.payload_hash ?? ""),
    auditEventId: record.auditEventId ?? record.audit_event_id ?? null,
    approvalId: record.approvalId ?? record.approval_id ?? null,
    metadata: isPlainObject(record.metadata) ? record.metadata : {},
    raw: record,
  };
}

export async function loadApprovals(filters = {}, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return { approvals: [], count: 0 };
  }

  try {
    const payload = await fetchJson(fetcher, `${APPROVALS_ENDPOINT}${queryString(filters)}`, {
      baseUrl,
      headers: actorHeaders(options),
    });
    const approvals = getCollectionPayload(payload, "approvals").map(normalizeApproval);
    return {
      approvals,
      count: Number(payload.count ?? payload.data?.count ?? approvals.length) || approvals.length,
    };
  } catch {
    return { approvals: [], count: 0 };
  }
}

export async function createApprovalRequest(request, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return normalizeApproval({ ...request, id: `local-approval-${Date.now()}`, status: "pending" });
  }

  const payload = await fetchJson(fetcher, APPROVALS_ENDPOINT, {
    baseUrl,
    method: "POST",
    headers: actorHeaders(options),
    body: request,
  });
  return normalizeApproval(getObjectPayload(payload, "approval"));
}

export async function decideApprovalRequest(id, decision, body = {}, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";
  const action = decision === "reject" ? "reject" : "approve";

  if (typeof fetcher !== "function") {
    return normalizeApproval({ id, status: action === "approve" ? "approved" : "rejected", ...body });
  }

  const payload = await fetchJson(fetcher, `${APPROVALS_ENDPOINT}/${encodeURIComponent(id)}/${action}`, {
    baseUrl,
    method: "POST",
    headers: actorHeaders(options),
    body,
  });
  return normalizeApproval(getObjectPayload(payload, "approval"));
}

export async function createReportExport(type, request = {}, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";
  const reportType = String(type || "full");

  if (typeof fetcher !== "function") {
    return normalizeReportExport({ ...request, id: `local-export-${Date.now()}`, reportType });
  }

  const payload = await fetchJson(fetcher, `${REPORTS_ENDPOINT}/${encodeURIComponent(reportType)}/exports`, {
    baseUrl,
    method: "POST",
    headers: actorHeaders(options),
    body: request,
  });
  return normalizeReportExport(getObjectPayload(payload, "reportExport"));
}

export default {
  createApprovalRequest,
  createReportExport,
  decideApprovalRequest,
  loadApprovals,
  normalizeApproval,
  normalizeReportExport,
};
