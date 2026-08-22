const REPORTS_ENDPOINT = "/api/reports";

export const REPORT_TYPES = [
  { id: "executive", title: "Executive" },
  { id: "compliance", title: "Compliance" },
  { id: "remediation", title: "Remediation" },
  { id: "cbom", title: "CBOM" },
  { id: "full", title: "Full Evidence Package" },
];

export const unavailableReports = [];

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

function toNumber(value) {
  if (value === null || value === undefined || value === "") return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function titleCase(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reportTypeTitle(type) {
  return REPORT_TYPES.find((item) => item.id === type)?.title ?? titleCase(type || "report");
}

function normalizeType(value) {
  const type = String(value || "executive").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (type === "full_evidence_package" || type === "full_evidence" || type === "evidence") return "full";
  return REPORT_TYPES.some((item) => item.id === type) ? type : type || "executive";
}

function normalizeSummary(summary) {
  if (!summary) return {};
  if (Array.isArray(summary)) {
    return summary.reduce((acc, item, index) => {
      if (isPlainObject(item)) {
        const key = item.label ?? item.name ?? item.key ?? item.title ?? `metric${index + 1}`;
        acc[String(key)] = toNumber(item.value ?? item.count ?? item.total ?? item.score ?? item.summary ?? "");
        return acc;
      }
      acc[`metric${index + 1}`] = toNumber(item);
      return acc;
    }, {});
  }
  if (isPlainObject(summary)) {
    return Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, toNumber(value)]));
  }
  return { summary: String(summary) };
}

function normalizeSection(section, index, key = "") {
  const id = String(section?.id ?? section?.sectionId ?? section?.section_id ?? key ?? `section-${index + 1}`) || `section-${index + 1}`;

  if (!isPlainObject(section)) {
    return {
      id,
      title: key ? titleCase(key) : `Section ${index + 1}`,
      summary: String(section ?? ""),
      items: [],
      raw: section,
    };
  }

  const items = section.items ?? section.findings ?? section.actions ?? section.controls ?? section.evidence ?? section.entries ?? [];
  return {
    id,
    title: String(section.title ?? section.heading ?? section.name ?? (key ? titleCase(key) : `Section ${index + 1}`)),
    summary: String(section.summary ?? section.description ?? section.text ?? ""),
    items: Array.isArray(items) ? items : [],
    raw: section,
  };
}

function normalizeSections(sections) {
  if (!sections) return [];
  if (Array.isArray(sections)) {
    return sections.map((section, index) => normalizeSection(section, index));
  }
  if (isPlainObject(sections)) {
    return Object.entries(sections).map(([key, section], index) => normalizeSection(section, index, key));
  }
  return [normalizeSection(sections, 0)];
}

function normalizeEvidenceRef(ref, index) {
  if (!isPlainObject(ref)) {
    const id = String(ref ?? `evidence-${index + 1}`);
    return { id, label: id, type: "evidence" };
  }

  const id = String(ref.id ?? ref.refId ?? ref.ref_id ?? ref.key ?? ref.url ?? `evidence-${index + 1}`);
  return {
    id,
    label: String(ref.label ?? ref.title ?? ref.name ?? ref.description ?? id),
    type: String(ref.type ?? ref.kind ?? "evidence"),
  };
}

function normalizeEvidenceRefs(report) {
  const refs = report.evidenceRefs ?? report.evidence_refs ?? report.evidence ?? report.refs ?? [];
  if (Array.isArray(refs)) return refs.map((ref, index) => normalizeEvidenceRef(ref, index));
  if (isPlainObject(refs)) return Object.entries(refs).map(([id, ref], index) => normalizeEvidenceRef(isPlainObject(ref) ? { id, ...ref } : id, index));
  return [];
}

function getReportsPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.reports)) return payload.reports;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data?.reports)) return payload.data.reports;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  throw new Error("Expected reports payload to be an array");
}

function getReportPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("Expected report payload to be an object");
  }

  if (isPlainObject(payload.data)) return getReportPayload(payload.data);
  if (isPlainObject(payload.report)) return getReportPayload(payload.report);
  if (isPlainObject(payload.item)) return getReportPayload(payload.item);
  return payload;
}

async function fetchJson(fetcher, path, options = {}) {
  const request = {};
  if (options.headers) request.headers = options.headers;

  const response = await fetcher(withBaseUrl(path, options.baseUrl), request);

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }

  return response.json();
}

function unavailableReportList() {
  return clone(unavailableReports);
}

function unavailableReport(type) {
  return null;
}

export function normalizeReport(report, index = 0, defaultType = "executive") {
  const rawType = report.type ?? report.reportType ?? report.report_type ?? report.kind ?? defaultType;
  const type = normalizeType(rawType);
  const rawReportId = report.reportId ?? report.report_id ?? report.id ?? report.uuid;
  const reportId = String(rawReportId || `${type}-report-${index + 1}`);

  return {
    reportId,
    type,
    title: String(report.title ?? report.name ?? reportTypeTitle(type)),
    generatedAt: report.generatedAt ?? report.generated_at ?? report.createdAt ?? report.created_at ?? new Date().toISOString(),
    scope: isPlainObject(report.scope) ? report.scope : {},
    summary: normalizeSummary(report.summary ?? report.metrics ?? report.counters),
    sections: normalizeSections(report.sections),
    evidenceRefs: normalizeEvidenceRefs(report),
    raw: report,
  };
}

export async function loadReports(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    const reports = unavailableReportList();
    return { reports, count: reports.length };
  }

  try {
    const payload = await fetchJson(fetcher, REPORTS_ENDPOINT, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    const reports = getReportsPayload(payload).map((report, index) => normalizeReport(report, index));
    return {
      reports,
      count: Number(payload?.count ?? payload?.data?.count ?? reports.length) || reports.length,
    };
  } catch {
    const reports = unavailableReportList();
    return { reports, count: reports.length };
  }
}

export async function loadReport(type, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";
  const normalizedType = normalizeType(type);

  if (typeof fetcher !== "function") {
    return unavailableReport(normalizedType);
  }

  try {
    const payload = await fetchJson(fetcher, `${REPORTS_ENDPOINT}/${encodeURIComponent(normalizedType)}`, {
      baseUrl,
      headers: { Accept: "application/json" },
    });
    return normalizeReport(getReportPayload(payload), 0, normalizedType);
  } catch {
    return unavailableReport(normalizedType);
  }
}

export default {
  REPORT_TYPES,
  loadReport,
  loadReports,
  normalizeReport,
  unavailableReports,
};
