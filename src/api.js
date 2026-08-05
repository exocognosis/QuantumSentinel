import {
  ALGO_DIST as FALLBACK_ALGORITHMS,
  ALERTS as FALLBACK_ALERTS,
  ASSETS as FALLBACK_ASSETS,
  COMPLIANCE as FALLBACK_COMPLIANCE,
  TREND_DATA as FALLBACK_TRENDS,
} from "./mockData.js";

const ENDPOINTS = {
  assets: "/api/assets",
  alerts: "/api/alerts",
  compliance: "/api/compliance",
  trends: "/api/trends",
  algorithms: "/api/algorithms",
  summary: "/api/summary",
};

const CBOM_ENDPOINT = "/api/cbom";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function average(items, field) {
  if (!items.length) return 0;
  return Math.round(items.reduce((sum, item) => sum + Number(item[field] || 0), 0) / items.length);
}

export function deriveSummary(assets, alerts = [], compliance = []) {
  const totalAssets = assets.length;
  const criticalCount = assets.filter((asset) => asset.prio === "CRITICAL").length;
  const highCount = assets.filter((asset) => asset.prio === "HIGH").length;
  const mediumCount = assets.filter((asset) => asset.prio === "MEDIUM").length;
  const shorCount = assets.filter((asset) => asset.cls === "SHOR-CRITICAL").length;
  const deprecatedCount = assets.filter((asset) => asset.cls === "DEPRECATED").length;
  const hybridCount = assets.filter((asset) => asset.cls === "HYBRID").length;
  const quantumSafeCount = assets.filter((asset) => asset.cls === "QUANTUM-SAFE").length;
  const safeCount = hybridCount + quantumSafeCount;
  const criticalAlerts = alerts.filter((alert) => alert.sev === "CRITICAL").length;
  const highAlerts = alerts.filter((alert) => alert.sev === "HIGH").length;

  return {
    totalAssets,
    criticalCount,
    highCount,
    mediumCount,
    shorCount,
    deprecatedCount,
    hybridCount,
    quantumSafeCount,
    safeCount,
    unsafeCount: Math.max(0, totalAssets - safeCount),
    overallRisk: average(assets, "risk"),
    averageHndl: average(assets, "hndl"),
    averageTnfl: average(assets, "tnfl"),
    criticalAlerts,
    highAlerts,
    alertCount: alerts.length,
    complianceRed: compliance.filter((item) => item.status === "RED").length,
    complianceAmber: compliance.filter((item) => item.status === "AMBER").length,
    complianceGreen: compliance.filter((item) => item.status === "GREEN").length,
  };
}

function getArrayPayload(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  throw new Error(`Expected ${key} payload to be an array`);
}

function getSummaryPayload(payload) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("Expected summary payload to be an object");
  }
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return payload.data;
  }
  return payload.summary && typeof payload.summary === "object" ? payload.summary : payload;
}

function normalizeData(payloads, source) {
  const assets = getArrayPayload(payloads.assets, "assets");
  const alerts = getArrayPayload(payloads.alerts, "alerts");
  const compliance = getArrayPayload(payloads.compliance, "compliance");
  const trends = getArrayPayload(payloads.trends, "trends");
  const algorithms = getArrayPayload(payloads.algorithms, "algorithms");
  const apiSummary = payloads.summary ? getSummaryPayload(payloads.summary) : {};
  const summary = {
    ...deriveSummary(assets, alerts, compliance),
    ...apiSummary,
  };

  return {
    source,
    isFallback: source === "fallback",
    assets,
    alerts,
    compliance,
    trends,
    algorithms,
    summary,
    cbomUrl: getCbomUrl(),
    ASSETS: assets,
    ALERTS: alerts,
    COMPLIANCE: compliance,
    TREND_DATA: trends,
    ALGO_DIST: algorithms,
  };
}

function fallbackData() {
  return normalizeData(
    {
      assets: clone(FALLBACK_ASSETS),
      alerts: clone(FALLBACK_ALERTS),
      compliance: clone(FALLBACK_COMPLIANCE),
      trends: clone(FALLBACK_TRENDS),
      algorithms: clone(FALLBACK_ALGORITHMS),
      summary: {},
    },
    "fallback",
  );
}

function withBaseUrl(path, baseUrl) {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function fetchJson(fetcher, path, baseUrl) {
  const response = await fetcher(withBaseUrl(path, baseUrl), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${path}: ${response.status}`);
  }

  return response.json();
}

export async function loadApplianceData(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return fallbackData();
  }

  try {
    const [assets, alerts, compliance, trends, algorithms, summary] = await Promise.all([
      fetchJson(fetcher, ENDPOINTS.assets, baseUrl),
      fetchJson(fetcher, ENDPOINTS.alerts, baseUrl),
      fetchJson(fetcher, ENDPOINTS.compliance, baseUrl),
      fetchJson(fetcher, ENDPOINTS.trends, baseUrl),
      fetchJson(fetcher, ENDPOINTS.algorithms, baseUrl),
      fetchJson(fetcher, ENDPOINTS.summary, baseUrl),
    ]);

    return normalizeData(
      {
        assets,
        alerts,
        compliance,
        trends,
        algorithms,
        summary,
      },
      "api",
    );
  } catch {
    return fallbackData();
  }
}

export function getCbomUrl(baseUrl = "") {
  return withBaseUrl(CBOM_ENDPOINT, baseUrl);
}

export function downloadCbom(filename = "quantumsentinel-cbom.json", options = {}) {
  const url = getCbomUrl(options.baseUrl ?? "");

  if (typeof document === "undefined") {
    return url;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  return url;
}

export default {
  loadApplianceData,
  getCbomUrl,
  downloadCbom,
};
