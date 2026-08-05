const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const average = (values) => values.length ? values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length : 0;
const percent = (count, total) => total ? (count / total) * 100 : 0;

export function riskClassification(score) {
  if (score >= 80) return "Critical";
  if (score >= 60) return "High";
  if (score >= 40) return "Elevated";
  if (score >= 20) return "Moderate";
  return "Low";
}

export function readinessClassification(score) {
  if (score >= 85) return "Quantum-ready";
  if (score >= 70) return "Prepared";
  if (score >= 50) return "Transitioning";
  if (score >= 25) return "Early-stage";
  return "Unprepared";
}

export function deriveQuantumScores(data = {}) {
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const compliance = Array.isArray(data.compliance) ? data.compliance : [];
  const total = assets.length;
  const vulnerable = assets.filter(asset => ["SHOR-CRITICAL", "DEPRECATED"].includes(asset.cls)).length;
  const safe = assets.filter(asset => ["HYBRID", "QUANTUM-SAFE"].includes(asset.cls)).length;
  const critical = assets.filter(asset => asset.prio === "CRITICAL").length;
  const exposed = assets.filter(asset => ["DMZ", "PERIMETER", "CLOUD", "FINANCE"].includes(String(asset.segment || "").toUpperCase())).length;
  const pfs = assets.filter(asset => asset.pfs === true).length;
  const planned = assets.filter(asset => asset.migration && !/^N\/A$/i.test(String(asset.migration))).length;
  const requiredFields = ["hostname", "algo", "proto", "cls", "prio", "risk", "hndl"];
  const completedFields = assets.reduce((sum, asset) => sum + requiredFields.filter(field => asset[field] !== undefined && asset[field] !== null && asset[field] !== "").length, 0);

  const riskComponents = {
    vulnerableCryptography: percent(vulnerable, total),
    hndlExposure: average(assets.map(asset => asset.hndl)),
    businessCriticality: percent(critical, total),
    networkExposure: percent(exposed, total),
    controlGap: 100 - percent(pfs, total),
  };
  const risk = clamp(
    riskComponents.vulnerableCryptography * 0.35 +
    riskComponents.hndlExposure * 0.25 +
    riskComponents.businessCriticality * 0.20 +
    riskComponents.networkExposure * 0.10 +
    riskComponents.controlGap * 0.10,
  );

  const readinessComponents = {
    cryptoModernization: percent(safe, total),
    inventoryCoverage: percent(completedFields, total * requiredFields.length),
    migrationPlanning: percent(planned, total),
    governanceMaturity: average(compliance.map(item => item.pct)),
    compensatingControls: percent(pfs, total),
  };
  const readiness = clamp(
    readinessComponents.cryptoModernization * 0.35 +
    readinessComponents.inventoryCoverage * 0.20 +
    readinessComponents.migrationPlanning * 0.20 +
    readinessComponents.governanceMaturity * 0.15 +
    readinessComponents.compensatingControls * 0.10,
  );

  const coverage = clamp(readinessComponents.inventoryCoverage);
  const confidence = !total || data.isFallback ? "Low" : coverage >= 90 && total >= 10 ? "Medium" : "Low";

  return {
    risk: { score: risk, classification: riskClassification(risk), direction: "Higher is worse", components: riskComponents },
    readiness: { score: readiness, classification: readinessClassification(readiness), direction: "Higher is better", components: readinessComponents },
    confidence: { level: confidence, coverage, label: `${confidence} evidence confidence` },
  };
}
