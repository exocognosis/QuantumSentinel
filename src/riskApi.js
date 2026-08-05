import { ASSETS as FALLBACK_ASSETS } from "./mockData.js";

const DRIFT_FALLBACK = { driftDetected: false, count: 0, assets: [] };

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

function unwrapData(payload) {
  if (isPlainObject(payload?.data)) return unwrapData(payload.data);
  return payload;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeToken(value, fallback = "UNKNOWN") {
  const token = String(value ?? fallback).trim();
  if (!token) return fallback;
  return token.replace(/[\s-]+/g, "_").toUpperCase();
}

function normalizeClassificationLabel(value, fallback = "UNKNOWN") {
  const token = normalizeToken(value, fallback);
  if (token === "SHOR_CRITICAL") return "SHOR-CRITICAL";
  if (token === "QUANTUM_SAFE") return "QUANTUM-SAFE";
  return token;
}

function slug(value, fallback = "driver") {
  const token = String(value ?? fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return token || fallback;
}

function compactText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isPlainObject(value)) {
    const preferred = value.label ?? value.title ?? value.name ?? value.action ?? value.target ?? value.summary ?? value.detail ?? value.description;
    if (preferred !== undefined && preferred !== null) return String(preferred);
    return Object.entries(value).slice(0, 3).map(([key, item]) => `${key}:${item}`).join(" ");
  }
  return "";
}

function normalizeAsset(asset = {}, source = {}) {
  const risk = isPlainObject(asset.risk) ? asset.risk : isPlainObject(source.risk) ? source.risk : {};
  const id = asset.id ?? asset.assetId ?? asset.asset_id ?? asset.componentId ?? source.assetId ?? source.asset_id ?? source.id ?? source.componentId ?? "";
  return {
    ...asset,
    id: String(id),
    hostname: String(asset.hostname ?? asset.host ?? asset.name ?? source.hostname ?? source.host ?? source.name ?? id ?? "unknown asset"),
    ip: asset.ip ?? asset.address ?? source.ip ?? source.address ?? "",
    type: asset.type ?? asset.assetType ?? asset.asset_type ?? source.type ?? source.assetType ?? "",
    segment: asset.segment ?? asset.networkSegment ?? asset.network_segment ?? source.segment ?? source.networkSegment ?? "",
    algo: asset.algo ?? asset.algorithm ?? asset.cryptography?.algorithm ?? source.algo ?? source.algorithm ?? source.evidence?.algorithm ?? "",
    proto: asset.proto ?? asset.protocol ?? asset.cryptography?.protocol ?? source.proto ?? source.protocol ?? source.evidence?.protocol ?? "",
    cls: normalizeClassificationLabel(asset.cls ?? asset.classification ?? asset.cryptography?.classification ?? source.cls ?? source.classification?.label ?? source.classification, "UNKNOWN"),
    hndl: toNumber(asset.hndl ?? risk.hndl ?? source.hndl ?? source.scores?.hndl),
    tnfl: toNumber(asset.tnfl ?? risk.tnfl ?? source.tnfl ?? source.scores?.tnfl),
    risk: toNumber(asset.risk?.score ?? asset.risk ?? risk.score ?? source.risk?.score ?? source.risk ?? source.scores?.risk),
    prio: normalizeToken(asset.prio ?? asset.priority ?? risk.priority ?? source.prio ?? source.priority ?? source.scores?.priority, "MONITOR"),
    pfs: asset.pfs ?? asset.perfectForwardSecrecy ?? asset.cryptography?.perfectForwardSecrecy ?? source.pfs ?? source.evidence?.perfectForwardSecrecy ?? null,
    cert_exp: asset.cert_exp ?? asset.certExp ?? asset.certificateExpiration ?? asset.cryptography?.certificateExpiration ?? source.cert_exp ?? "",
    migration: asset.migration ?? source.migration ?? source.remediation?.target ?? "",
    complexity: asset.complexity ?? source.complexity ?? source.remediation?.complexity ?? "",
  };
}

function normalizeClassification(value, asset, scores, priority) {
  const source = isPlainObject(value) ? value : { label: value };
  return {
    ...source,
    label: normalizeClassificationLabel(source.label ?? asset.cls, "UNKNOWN"),
    priority: normalizeToken(source.priority ?? priority ?? scores.priority ?? asset.prio, "MONITOR"),
    reason: String(source.reason ?? source.rationale ?? source.description ?? ""),
  };
}

function normalizeRemediation(value, asset) {
  const source = isPlainObject(value) ? value : isPlainObject(asset.migration) ? asset.migration : {};
  const migrationText = compactText(asset.migration);
  return {
    action: String(source.action ?? source.title ?? (asset.cls === "QUANTUM_SAFE" ? "Monitor quantum-safe control" : "Migrate cryptographic control")),
    target: String(source.target ?? source.recommendation ?? source.migrationTarget ?? migrationText ?? "Collect migration evidence"),
    detail: String(source.detail ?? source.description ?? source.summary ?? ""),
    complexity: String(source.complexity ?? asset.complexity ?? "UNKNOWN"),
    raw: value ?? asset.migration ?? null,
  };
}

function normalizeDriver(driver, index, kind = "risk") {
  if (!isPlainObject(driver)) {
    const label = compactText(driver) || `driver-${index + 1}`;
    return {
      id: `${kind}-${slug(label, `driver-${index + 1}`)}`,
      kind,
      label,
      score: 0,
      weight: 0,
      raw: driver,
    };
  }

  const label = String(driver.label ?? driver.name ?? driver.title ?? driver.type ?? driver.id ?? `driver-${index + 1}`);
  return {
    id: String(driver.id ?? `${kind}-${slug(label, `driver-${index + 1}`)}`),
    kind: String(driver.kind ?? driver.category ?? kind),
    label,
    score: toNumber(driver.score ?? driver.value ?? driver.points ?? driver.weight, 0),
    weight: toNumber(driver.weight ?? driver.score ?? driver.value, 0),
    raw: driver,
  };
}

function normalizeDrivers(source = {}) {
  const candidates = source.riskDrivers ?? source.drivers ?? source.factors;
  if (Array.isArray(candidates)) return candidates.map((driver, index) => normalizeDriver(driver, index));

  const scoreFactors = source.scores?.factors ?? source.factors;
  if (isPlainObject(scoreFactors)) {
    return Object.entries(scoreFactors).flatMap(([kind, drivers]) => {
      if (Array.isArray(drivers)) return drivers.map((driver, index) => normalizeDriver(driver, index, kind));
      if (drivers) return [normalizeDriver(drivers, 0, kind)];
      return [];
    });
  }

  return [];
}

function normalizeDrift(value = {}) {
  if (!isPlainObject(value)) return clone(DRIFT_FALLBACK);
  const events = Array.isArray(value.events) ? value.events : [];
  const assets = Array.isArray(value.assets) ? value.assets : [];
  const driftDetected = Boolean(value.driftDetected ?? value.drift_detected ?? value.detected ?? (events.length > 0 || assets.length > 0));
  return {
    ...value,
    driftDetected,
    count: toNumber(value.count ?? value.total ?? events.length ?? assets.length, driftDetected ? 1 : 0),
    events,
    assets,
  };
}

function normalizeFinding(finding, index) {
  if (!isPlainObject(finding)) {
    const id = String(finding ?? `finding-${index + 1}`);
    return { id, title: id, severity: "INFO", status: "OPEN", raw: finding };
  }

  const id = String(finding.id ?? finding.findingId ?? finding.finding_id ?? `finding-${index + 1}`);
  return {
    ...finding,
    id,
    severity: normalizeToken(finding.severity ?? finding.priority, "INFO"),
    status: normalizeToken(finding.status ?? finding.state, "OPEN"),
    title: String(finding.title ?? finding.name ?? finding.summary ?? id),
    remediationTarget: finding.remediationTarget ?? finding.remediation_target ?? finding.remediation?.target ?? "",
    raw: finding,
  };
}

export function normalizeAssetRisk(payload = {}, options = {}) {
  const source = unwrapData(payload) ?? {};
  const analysis = isPlainObject(source.analysis) ? source.analysis : source;
  const asset = normalizeAsset(isPlainObject(source.asset) ? source.asset : {}, analysis);
  const scoresSource = analysis.scores ?? source.scores ?? {};
  const scores = {
    hndl: toNumber(scoresSource.hndl ?? analysis.hndl ?? source.hndl ?? asset.hndl),
    tnfl: toNumber(scoresSource.tnfl ?? analysis.tnfl ?? source.tnfl ?? asset.tnfl),
    risk: toNumber(scoresSource.risk ?? scoresSource.score ?? analysis.risk ?? source.risk ?? asset.risk),
  };
  const priority = normalizeToken(analysis.priority ?? source.priority ?? scoresSource.priority ?? asset.prio, "MONITOR");
  const classification = normalizeClassification(analysis.classification ?? source.classification ?? asset.cls, asset, scoresSource, priority);
  const findings = Array.isArray(source.findings)
    ? source.findings.map(normalizeFinding)
    : Array.isArray(analysis.findings)
      ? analysis.findings.map(normalizeFinding)
      : [];

  return {
    asset: { ...asset, cls: classification.label, hndl: scores.hndl, tnfl: scores.tnfl, risk: scores.risk, prio: priority },
    classification,
    scores,
    priority,
    drivers: normalizeDrivers({ ...source, ...analysis, scores: { ...scoresSource, factors: scoresSource.factors ?? analysis.factors } }),
    drift: normalizeDrift(source.drift ?? analysis.drift),
    findings,
    remediation: normalizeRemediation(analysis.remediation ?? source.remediation ?? source.migration, asset),
    evidence: analysis.evidence ?? source.evidence ?? {},
    source: options.source ?? source.source ?? "api",
    raw: source,
  };
}

function fallbackRiskForAsset(assetId) {
  const asset = FALLBACK_ASSETS.find((item) => String(item.id) === String(assetId) || item.hostname === String(assetId));
  if (!asset) return null;
  return normalizeAssetRisk({
    asset: clone(asset),
    analysis: {
      classification: { label: asset.cls, priority: asset.prio },
      scores: { hndl: asset.hndl, tnfl: asset.tnfl, risk: asset.risk },
      riskDrivers: [
        { label: `${asset.algo} exposure`, score: asset.risk },
        { label: `${asset.segment} ${asset.type}`, score: Math.max(asset.hndl, asset.tnfl) },
      ],
      remediation: {
        action: asset.cls === "QUANTUM-SAFE" ? "Monitor quantum-safe control" : "Migrate cryptographic control",
        target: asset.migration,
        detail: "Fallback analysis uses the local asset inventory until the risk endpoint is available.",
        complexity: asset.complexity,
      },
      evidence: {
        algorithm: asset.algo,
        protocol: asset.proto,
        perfectForwardSecrecy: asset.pfs,
        type: asset.type,
        segment: asset.segment,
      },
    },
    drift: clone(DRIFT_FALLBACK),
    findings: [],
  }, { source: "fallback" });
}

export function normalizeRecomputeRiskResult(payload = {}) {
  const source = unwrapData(payload) ?? {};
  const rawAnalyses = Array.isArray(source.analyses)
    ? source.analyses
    : Array.isArray(source.results)
      ? source.results
      : source.analysis
        ? [source.analysis]
        : [];
  const analyses = rawAnalyses.map((item) => {
    if (isPlainObject(item) && (item.analysis || item.asset)) {
      return normalizeAssetRisk({
        asset: item.asset,
        analysis: item.analysis ?? item,
        drift: item.drift,
        findings: item.findings,
      });
    }
    return normalizeAssetRisk(item);
  });
  const createdFindings = Array.isArray(source.createdFindings)
    ? source.createdFindings.map(normalizeFinding)
    : Array.isArray(source.created_findings)
      ? source.created_findings.map(normalizeFinding)
      : [];

  return {
    analyses,
    createdFindings,
    count: toNumber(source.count ?? analyses.length, analyses.length),
    raw: source,
  };
}

export async function loadDrift(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return clone(DRIFT_FALLBACK);
  }

  try {
    const response = await fetcher(withBaseUrl("/api/drift", baseUrl), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const payload = await response.json();
    return normalizeDrift(unwrapData(payload));
  } catch {
    return clone(DRIFT_FALLBACK);
  }
}

export async function loadAssetRisk(assetId, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";
  const fallback = fallbackRiskForAsset(assetId);

  if (typeof fetcher !== "function") return fallback;

  try {
    const response = await fetcher(withBaseUrl(`/api/assets/${encodeURIComponent(assetId)}/risk`, baseUrl), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const payload = await response.json();
    return normalizeAssetRisk(payload);
  } catch {
    return fallback;
  }
}

export async function recomputeRisk(request = {}, options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "";

  if (typeof fetcher !== "function") {
    return normalizeRecomputeRiskResult({});
  }

  const response = await fetcher(withBaseUrl("/api/risk/recompute", baseUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const payload = await response.json();
  return normalizeRecomputeRiskResult(payload);
}
