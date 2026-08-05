import { useEffect, useState } from "react";
import { loadApplianceData } from "./api.js";
import { createApprovalRequest, createReportExport, decideApprovalRequest, loadApprovals } from "./approvalApi.js";
import { loadEvidenceArchive, loadEvidenceBundle, loadReportExportManifest } from "./evidenceApi.js";
import { findingRecurrenceSummary } from "./findingDisplay.js";
import { appendFindingNote, deriveRemediationSummary, loadFindings, loadRemediationSummary, updateFinding } from "./findingApi.js";
import { ALGO_DIST as FALLBACK_ALGO_DIST, ALERTS as FALLBACK_ALERTS, ASSETS as FALLBACK_ASSETS, COMPLIANCE as FALLBACK_COMPLIANCE, TREND_DATA as FALLBACK_TREND_DATA } from "./mockData.js";
import { createMonitorPolicy, loadMonitorHealth, loadMonitorPolicies, loadMonitorRuns, runMonitorPolicyNow } from "./monitorApi.js";
import { createProbeJob, loadProbeJobs } from "./probeApi.js";
import { REPORT_TYPES, loadReport, loadReports, reportFallbackReports } from "./reportApi.js";
import { loadAssetRisk, loadDrift, recomputeRisk } from "./riskApi.js";
import { loadSchedulerStatus, schedulerFallbackStatus, startScheduler, stopScheduler, tickSchedulerNow, updateSchedulerConfig } from "./schedulerApi.js";

// ── Palette & theme ──────────────────────────────────────────────
const THEMES = {
  dark: {
    bg:       "#06090f",
    panel:    "#0c1018",
    border:   "#151c28",
    border2:  "#1e2a3a",
    text:     "#c8d8f0",
    muted:    "#4a6080",
    accent:   "#00c8ff",
    accentDim:"#005a75",
    green:    "#00e5a0",
    greenDim: "#003d2a",
    amber:    "#ffb800",
    amberDim: "#3a2800",
    red:      "#ff3d5a",
    redDim:   "#3a0010",
    purple:   "#b06aff",
    purpleDim:"#2a0a4a",
    hndl:     "#ff6b35",
    hndlDim:  "#3a1500",
    tnfl:     "#ff35b0",
    tnflDim:  "#3a0030",
  },
  light: {
    bg:       "#f4f7fb",
    panel:    "#ffffff",
    border:   "#d8e0ea",
    border2:  "#b9c6d6",
    text:     "#172234",
    muted:    "#5f7088",
    accent:   "#0078b8",
    accentDim:"#d9eef8",
    green:    "#087f5b",
    greenDim: "#d9f3e9",
    amber:    "#b7791f",
    amberDim: "#fff2cc",
    red:      "#c92a3f",
    redDim:   "#ffe0e6",
    purple:   "#7048a8",
    purpleDim:"#ece2ff",
    hndl:     "#c2410c",
    hndlDim:  "#ffe5d5",
    tnfl:     "#b31983",
    tnflDim:  "#ffe0f4",
  },
};
let C = THEMES.dark;

function savedThemeMode() {
  if (typeof localStorage === "undefined") return "dark";
  const value = localStorage.getItem("quantumsentinel-theme");
  return value === "light" ? "light" : "dark";
}

const DISCOVERY_HOST_LIMIT_MAX = 16;
const DISCOVERY_TIMEOUT_MIN_MS = 250;
const DISCOVERY_TIMEOUT_MAX_MS = 5_000;
const TLS_PORT_MIN = 1;
const TLS_PORT_MAX = 65_535;
const TLS_TIMEOUT_MIN_MS = 250;
const TLS_TIMEOUT_MAX_MS = 10_000;
const MONITOR_INTERVAL_MIN_SECONDS = 300;
const MONITOR_INTERVAL_MAX_SECONDS = 86_400;
const SCHEDULER_INTERVAL_MIN_SECONDS = 60;
const SCHEDULER_INTERVAL_MAX_SECONDS = 86_400;
const SCHEDULER_MAX_RUNS_MIN = 1;
const SCHEDULER_MAX_RUNS_MAX = 25;

// ── Helpers ──────────────────────────────────────────────────────
function clsColor(cls) {
  if (cls === "QUANTUM-SAFE") return C.green;
  if (cls === "HYBRID")       return C.accent;
  if (cls === "SHOR-CRITICAL")return C.red;
  if (cls === "DEPRECATED")   return C.amber;
  return C.muted;
}
function prioColor(p) {
  if (p==="CRITICAL") return C.red;
  if (p==="HIGH")     return C.hndl;
  if (p==="MEDIUM")   return C.amber;
  if (p==="LOW")      return C.purple;
  return C.muted;
}
function sevColor(s) {
  if (s==="CRITICAL") return C.red;
  if (s==="HIGH")     return C.hndl;
  if (s==="MEDIUM")   return C.amber;
  return C.accent;
}
function typeColor(t) {
  if (t==="HNDL")  return C.hndl;
  if (t==="TNFL")  return C.tnfl;
  if (t==="OT")    return C.amber;
  if (t==="DRIFT") return C.purple;
  return C.accent;
}
function compColor(s) {
  if (s==="RED")   return C.red;
  if (s==="AMBER") return C.amber;
  if (s==="GREEN") return C.green;
  return C.muted;
}
function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}
function clampDiscoveryLimit(value) {
  return clampNumber(value, 1, DISCOVERY_HOST_LIMIT_MAX, 12);
}
function clampDiscoveryTimeout(value) {
  return clampNumber(value, DISCOVERY_TIMEOUT_MIN_MS, DISCOVERY_TIMEOUT_MAX_MS, 2500);
}
function clampTlsTimeout(value) {
  return clampNumber(value, TLS_TIMEOUT_MIN_MS, TLS_TIMEOUT_MAX_MS, 2500);
}
function clampMonitorInterval(value) {
  return clampNumber(value, MONITOR_INTERVAL_MIN_SECONDS, MONITOR_INTERVAL_MAX_SECONDS, 900);
}
function clampSchedulerInterval(value) {
  return clampNumber(value, SCHEDULER_INTERVAL_MIN_SECONDS, SCHEDULER_INTERVAL_MAX_SECONDS, schedulerFallbackStatus.tickIntervalSeconds);
}
function clampSchedulerMaxRuns(value) {
  return clampNumber(value, SCHEDULER_MAX_RUNS_MIN, SCHEDULER_MAX_RUNS_MAX, schedulerFallbackStatus.maxRunsPerTick);
}
function parseDiscoveryHosts(value, limit) {
  const seen = new Set();
  return String(value || "")
    .split(/[\s,;]+/)
    .map(host => host.trim())
    .filter(Boolean)
    .filter(host => {
      const key = host.toLowerCase();
      if (seen.has(key) || seen.size >= limit) return false;
      seen.add(key);
      return true;
    });
}
function mergeCreatedProbeJob(jobs, createdJob) {
  if (!createdJob?.id) return jobs;
  return jobs.some(job => job.id === createdJob.id) ? jobs : [createdJob, ...jobs];
}
function mergeCreatedMonitorPolicy(policies, createdPolicy) {
  if (!createdPolicy?.id) return policies;
  const filtered = policies.filter(policy => policy.id !== createdPolicy.id);
  return [createdPolicy, ...filtered];
}
function mergeMonitorRun(runs, run) {
  if (!run?.id) return runs;
  const filtered = runs.filter(item => item.id !== run.id);
  return [run, ...filtered].slice(0, 8);
}
function mergeMonitorRuns(runs, incomingRuns) {
  if (!Array.isArray(incomingRuns) || incomingRuns.length === 0) return runs;
  return incomingRuns.reduceRight((nextRuns, run) => mergeMonitorRun(nextRuns, run), runs);
}
function applyMonitorRunResult(policies, policyId, result) {
  const runAt = new Date().toISOString();
  const updatedPolicy = result?.policy;
  const job = result?.job;
  const existingIndex = policies.findIndex(policy => policy.id === policyId || policy.id === updatedPolicy?.id);

  if (updatedPolicy) {
    const merged = {
      ...updatedPolicy,
      lastJob: job ?? updatedPolicy.lastJob,
      lastRunAt: updatedPolicy.lastRunAt ?? runAt,
    };
    return existingIndex >= 0
      ? policies.map((policy, index) => (index === existingIndex ? { ...policy, ...merged } : policy))
      : [merged, ...policies];
  }

  if (existingIndex < 0) return policies;
  return policies.map((policy, index) => (
    index === existingIndex ? { ...policy, lastJob: job ?? policy.lastJob, lastRunAt: runAt } : policy
  ));
}
function runStatusColor(status) {
  if (status === "COMPLETED") return C.green;
  if (status === "FAILED" || status === "ERROR") return C.red;
  if (status === "RUNNING" || status === "QUEUED" || status === "IN_PROGRESS") return C.amber;
  return C.muted;
}
function findingStatusColor(status) {
  if (status === "REMEDIATED" || status === "CLOSED") return C.green;
  if (status === "ACCEPTED_RISK" || status === "RISK_ACCEPTED") return C.purple;
  if (status === "IN_PROGRESS" || status === "STARTED") return C.amber;
  if (status === "TRIAGED") return C.accent;
  if (status === "OPEN") return C.red;
  return C.muted;
}
function isFindingClosed(finding) {
  return ["REMEDIATED", "CLOSED", "ACCEPTED_RISK", "RISK_ACCEPTED", "RESOLVED"].includes(finding?.status);
}
function dueColor(finding) {
  if (!finding?.dueAt || isFindingClosed(finding)) return C.muted;
  const due = new Date(finding.dueAt);
  if (Number.isNaN(due.getTime())) return C.muted;
  const now = new Date();
  if (due < now) return C.red;
  if (due.getTime() - now.getTime() <= 14 * 24 * 60 * 60 * 1000) return C.amber;
  return C.green;
}
function latestRunTimestamp(run) {
  return run?.completedAt ?? run?.startedAt ?? null;
}
function reportAccent(type) {
  if (type === "executive") return C.accent;
  if (type === "compliance") return C.green;
  if (type === "remediation") return C.amber;
  if (type === "cbom") return C.purple;
  if (type === "full") return C.tnfl;
  return C.muted;
}
function humanizeKey(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toUpperCase();
}
function reportEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "");
}
function reportSectionItems(section) {
  if (Array.isArray(section?.items)) return section.items;
  return [];
}
function compactEvidenceFilters(filters = {}) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value != null && value !== ""));
}
function downloadJsonFile(filename, payload) {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
function riskScoreColor(score) {
  const numeric = Number(score) || 0;
  if (numeric > 80) return C.red;
  if (numeric > 50) return C.amber;
  return C.green;
}
function compactReportValue(value) {
  if (value === null || value === undefined) return "--";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length}`;
  if (typeof value === "object") {
    const preferred = value.label ?? value.title ?? value.name ?? value.id ?? value.summary ?? value.status;
    if (preferred !== undefined && preferred !== null) return String(preferred);
    return Object.entries(value).slice(0, 2).map(([key, item]) => `${key}:${item}`).join(" ");
  }
  return String(value);
}
function patchMonitorHealthWithRuns(health, runs) {
  if (!Array.isArray(runs) || runs.length === 0) return health;
  const runningCount = runs.filter(run => ["RUNNING", "QUEUED", "IN_PROGRESS"].includes(run.status)).length;
  const failedCount = runs.filter(run => run.status === "FAILED").length;
  const latest = runs.map(latestRunTimestamp).filter(Boolean).sort().at(-1) ?? health.lastRunAt;

  return {
    ...health,
    runningRuns: Math.max(Number(health.runningRuns) || 0, runningCount),
    failedRecentRuns: Math.max(Number(health.failedRecentRuns) || 0, failedCount),
    lastRunAt: latest,
  };
}
function summarizeMonitorHealth(health, policies, runs) {
  const runningCount = runs.filter(run => ["RUNNING", "QUEUED", "IN_PROGRESS"].includes(run.status)).length;
  const failedCount = runs.filter(run => run.status === "FAILED").length;
  const lastRunAt = health.lastRunAt ?? runs.map(latestRunTimestamp).filter(Boolean).sort().at(-1) ?? null;

  return {
    enabledPolicies: Math.max(Number(health.enabledPolicies) || 0, policies.filter(policy => policy.enabled).length),
    duePolicies: Number(health.duePolicies) || 0,
    runningRuns: Math.max(Number(health.runningRuns) || 0, runningCount),
    failedRecentRuns: Math.max(Number(health.failedRecentRuns) || 0, failedCount),
    lastRunAt,
  };
}
function isDiscoveryJob(job) {
  return job?.type === "discovery" || job?.mode === "discovery" || job?.request?.mode === "discovery";
}
function isTlsMonitorPolicy(policy) {
  const request = policy?.probeRequest ?? {};
  const values = [request.mode, request.type, policy?.lastJob?.type, policy?.lastJob?.request?.mode]
    .map(value => String(value || "").toLowerCase());
  return values.some(value => value.includes("tls")) || Boolean(request.host);
}
function monitorRequestTargetLabel(request = {}) {
  if (request.mode === "tls" || request.type === "tls" || request.host) {
    return [request.host, request.port ? `:${request.port}` : ""].filter(Boolean).join("") || "TLS target";
  }
  if (Array.isArray(request.hosts)) return request.hosts.join(", ");
  if (request.assetId) return `asset ${request.assetId}`;
  return "";
}
function monitorPolicyTargetLabel(policy) {
  return policy?.lastJob?.target || monitorRequestTargetLabel(policy?.probeRequest) || "target pending";
}
function monitorRunEvidenceLabel(run, policy) {
  const target = monitorPolicyTargetLabel(policy);
  const summary = run?.summary || run?.error || "";
  return [target, summary].filter(Boolean).join(" · ");
}
function isTlsProbeJob(job) {
  const values = [
    job?.type,
    job?.mode,
    job?.request?.type,
    job?.request?.mode,
    job?.result?.source,
  ].map(value => String(value || "").toLowerCase());
  return values.some(value => value.includes("tls")) || Boolean(job?.result?.protocol || job?.result?.certificate);
}
function discoveryObservations(result) {
  const source = result?.observations ?? result?.targets ?? result?.hosts ?? result?.results;
  if (Array.isArray(source)) return source;
  if (source && typeof source === "object") {
    return Object.entries(source).map(([host, value]) => (
      value && typeof value === "object" && !Array.isArray(value)
        ? { host, ...value }
        : { host, status: value }
    ));
  }
  return [];
}
function discoverySummary(job) {
  const summary = job?.result?.summary;
  if (typeof summary === "string") return summary;
  if (summary && typeof summary === "object") {
    return summary.message ?? summary.status ?? Object.entries(summary).slice(0,3).map(([key, value]) => `${key}:${value}`).join(" ");
  }
  const observations = discoveryObservations(job?.result);
  if (observations.length) return `${observations.length} observations`;
  return job?.target || "discovery pending";
}
function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function formatTimestamp(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function formatInterval(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "--";
  if (value % 3600 === 0) return `${value / 3600}h`;
  if (value >= 3600) return `${Math.round(value / 60)}m`;
  if (value % 60 === 0) return `${value / 60}m`;
  return `${value}s`;
}
function compactResultSummary(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} runs`;
  if (value && typeof value === "object") {
    const preferred = value.message ?? value.summary ?? value.status ?? value.description ?? value.text;
    if (preferred !== undefined && preferred !== null) return String(preferred);
    return Object.entries(value).slice(0,3).map(([key, item]) => `${key}:${item}`).join(" ");
  }
  return "";
}
function schedulerTickSummary(status, latestSummary) {
  const summary = compactResultSummary(latestSummary || status.lastTickResult);
  if (!status.lastTickAt && !summary) return "No ticks";
  if (!status.lastTickAt) return summary;
  return summary ? `${formatTimestamp(status.lastTickAt)} · ${summary}` : formatTimestamp(status.lastTickAt);
}
function observationValue(observation, keys, fallback = "") {
  for (const key of keys) {
    const value = observation?.[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return fallback;
}
function protocolLabel(protocol) {
  if (!protocol) return "";
  if (typeof protocol === "string") return protocol;
  return [protocol.name, protocol.cipher].filter(Boolean).join(" ");
}
function certificateLabel(certificate) {
  if (!certificate) return "";
  if (typeof certificate === "string") return certificate;
  return [certificate.algorithm, certificate.expiresAt ? `exp ${certificate.expiresAt}` : ""].filter(Boolean).join(" · ");
}
function compactJsonValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
function compactRefLabel(ref, fallbackKind = "ref") {
  if (!ref) return "";
  if (typeof ref === "string" || typeof ref === "number") return String(ref);
  const kind = ref.kind ?? ref.type ?? fallbackKind;
  const id = ref.id ?? ref.entityId ?? ref.hash;
  const label = ref.label ?? ref.summary ?? "";
  return [kind, id, label].filter(Boolean).join(" · ");
}
function arrayValue(...sources) {
  for (const source of sources) {
    if (Array.isArray(source)) return source;
  }
  return [];
}
function observationDetail(observation) {
  const details = [
    observationValue(observation, ["port", "ports"]),
    protocolLabel(observation?.protocol) || observationValue(observation, ["service"]),
    certificateLabel(observation?.certificate),
    observationValue(observation?.classification, ["label", "priority"]),
    observationValue(observation, ["error", "note", "summary"]),
  ].filter(Boolean);
  return details.slice(0,3).join(" · ");
}
function probeTargetLabel(job) {
  const target = job?.target;
  if (!target) return "asset simulation";
  if (typeof target === "string") return target;
  if (Array.isArray(target.hosts)) return target.hosts.join(", ");
  return [target.hostname ?? target.host ?? target.ip, target.port ? `:${target.port}` : ""].filter(Boolean).join("");
}
function tlsEvidence(job) {
  const result = job?.result ?? {};
  const protocol = result.protocol && typeof result.protocol === "object" && !Array.isArray(result.protocol) ? result.protocol : {};
  const certificate = result.certificate && typeof result.certificate === "object" && !Array.isArray(result.certificate) ? result.certificate : {};
  const classification = result.classification && typeof result.classification === "object" && !Array.isArray(result.classification) ? result.classification : {};
  const evidenceRefs = arrayValue(
    result.evidenceRefs,
    result.evidence?.evidenceRefs,
    result.evidence?.refs,
    result.auditRefs,
  );
  const findingRefs = arrayValue(
    result.findingRefs,
    result.findingsRefs,
    job?.findingRefs,
    job?.findings,
  );
  const findings = arrayValue(result.findings);
  const notes = arrayValue(classification.notes);
  return {
    protocol: protocolLabel(result.protocol),
    cipher: compactJsonValue(protocol.cipher),
    pfs: protocol.perfectForwardSecrecy === undefined ? "" : (protocol.perfectForwardSecrecy ? "YES" : "NO"),
    certificate: certificateLabel(result.certificate),
    subject: certificate.subject ?? "",
    issuer: certificate.issuer ?? "",
    fingerprint: certificate.fingerprint256 ?? "",
    classification: classification.label ?? "",
    priority: classification.priority ?? "",
    quantumVulnerable: classification.quantumVulnerable === undefined ? "" : (classification.quantumVulnerable ? "YES" : "NO"),
    notes,
    findings,
    evidenceRefs,
    findingRefs,
  };
}
function mergeFindingRecord(existing, incoming, requested = {}) {
  const next = { ...existing, ...incoming, ...requested };
  return {
    ...next,
    title: incoming.title && !incoming.title.includes("unknown asset") ? incoming.title : existing.title,
    description: incoming.description || existing.description,
    evidence: incoming.evidence || existing.evidence,
    assetName: incoming.assetName && incoming.assetName !== "unknown asset" ? incoming.assetName : existing.assetName,
    owner: incoming.owner && incoming.owner !== "Unassigned" ? incoming.owner : (requested.owner ?? existing.owner),
    remediation: incoming.remediation ?? existing.remediation,
    remediationTarget: incoming.remediationTarget || existing.remediationTarget,
    notes: incoming.notes?.length ? incoming.notes : existing.notes,
    asset: incoming.asset && Object.keys(incoming.asset).length ? incoming.asset : existing.asset,
  };
}
function ScoreBadge({ score, color }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center",
      width:38, height:24, borderRadius:4, fontSize:11, fontWeight:700,
      background: score>80 ? `${color}22` : score>50 ? `${C.amber}22` : `${C.green}22`,
      color: score>80 ? color : score>50 ? C.amber : C.green,
      border:`1px solid ${score>80?color:score>50?C.amber:C.green}44` }}>
      {score}
    </span>
  );
}
function Pill({ label, color }) {
  return (
    <span style={{ padding:"2px 8px", borderRadius:12, fontSize:10, fontWeight:700,
      background:`${color}22`, color, border:`1px solid ${color}44`, whiteSpace:"nowrap" }}>
      {label}
    </span>
  );
}
function MiniBar({ pct, color }) {
  return (
    <div style={{ height:5, borderRadius:3, background:`${color}22`, overflow:"hidden", minWidth:80 }}>
      <div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:3,
        boxShadow:`0 0 6px ${color}88`, transition:"width 0.8s ease" }} />
    </div>
  );
}
function Panel({ title, children, badge, style={} }) {
  return (
    <div style={{ background:C.panel, border:`1px solid ${C.border}`,
      borderRadius:8, overflow:"hidden", display:"flex", flexDirection:"column", ...style }}>
      <div style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}`,
        display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em",
          textTransform:"uppercase", color:C.muted }}>{title}</span>
        {badge && <span style={{ fontSize:10, padding:"2px 8px", borderRadius:10,
          background:`${C.accent}22`, color:C.accent, fontWeight:700 }}>{badge}</span>}
      </div>
      <div style={{ flex:1, overflowY:"auto" }}>{children}</div>
    </div>
  );
}

function QDayScoreMethodology() {
  const severityWeights = [
    ["Critical", "15", C.red],
    ["High", "8", C.amber],
    ["Medium", "4", C.tnfl],
    ["Low", "2", C.accent],
    ["Informational", "0", C.green],
  ];
  const confidenceWeights = [
    ["Confirmed", "1.00×"],
    ["High confidence", "0.90×"],
    ["Candidate", "0.55×"],
    ["Dependency reference", "0.40×"],
    ["Documentation reference", "0.10×"],
  ];
  const grades = [
    ["A", "90–100", C.green],
    ["B", "75–89", C.accent],
    ["C", "60–74", C.tnfl],
    ["D", "40–59", C.amber],
    ["F", "0–39", C.red],
  ];

  return (
    <Panel title="How the Q-Day Readiness Score Is Calculated" badge="TRANSPARENT MODEL" style={{ gridColumn:"1/4" }}>
      <div style={{ padding:16 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1.15fr 1fr 0.9fr", gap:16 }}>
          <div>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.08em", marginBottom:8 }}>
              FORMULA
            </div>
            <div style={{ padding:"14px 16px", background:C.bg, border:`1px solid ${C.border2}`,
              borderRadius:7, color:C.text, lineHeight:1.8 }}>
              <div style={{ color:C.accent, fontSize:12, fontWeight:900 }}>
                Score = 100 − min(100, Σ algorithm penalties)
              </div>
              <div style={{ color:C.muted, fontSize:10, marginTop:6 }}>
                Algorithm penalty = severity weight × strongest evidence confidence
                <br/>+ min(8, 1.5 × log₂(reference count + 1))
              </div>
            </div>
            <div style={{ marginTop:10, fontSize:10, lineHeight:1.6, color:C.muted }}>
              Findings are grouped by detection rule before scoring. Repeated references increase the penalty
              logarithmically, so one widely used algorithm matters more without allowing duplicate matches to
              overwhelm the score.
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1.25fr", gap:10 }}>
            <div>
              <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.08em", marginBottom:8 }}>
                SEVERITY BASE
              </div>
              {severityWeights.map(([label, value, color])=>(
                <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"5px 7px", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:9, color }}>{label}</span>
                  <span style={{ fontSize:10, color:C.text, fontWeight:900 }}>{value}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.08em", marginBottom:8 }}>
                CONFIDENCE MULTIPLIER
              </div>
              {confidenceWeights.map(([label, value])=>(
                <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"5px 7px", borderBottom:`1px solid ${C.border}` }}>
                  <span style={{ fontSize:9, color:C.muted }}>{label}</span>
                  <span style={{ fontSize:10, color:C.text, fontWeight:900 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:"0.08em", marginBottom:8 }}>
              READINESS GRADE
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {grades.map(([grade, range, color])=>(
                <div key={grade} style={{ minWidth:52, flex:1, padding:"8px 6px", textAlign:"center",
                  background:`${color}11`, border:`1px solid ${color}44`, borderRadius:6 }}>
                  <div style={{ fontSize:17, fontWeight:900, color }}>{grade}</div>
                  <div style={{ fontSize:8, color:C.muted }}>{range}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop:12, padding:"9px 10px", background:`${C.green}0c`,
              border:`1px solid ${C.green}33`, borderRadius:6, fontSize:9, color:C.muted, lineHeight:1.55 }}>
              PQC and adequately parameterized symmetric/hash observations are informational and do not reduce
              the score. They still require implementation, downgrade, and operational validation.
            </div>
          </div>
        </div>

        <div style={{ marginTop:14, padding:"9px 12px", background:`${C.amber}0d`,
          borderLeft:`3px solid ${C.amber}`, color:C.muted, fontSize:9, lineHeight:1.6 }}>
          <span style={{ color:C.amber, fontWeight:900 }}>INTERPRETATION BOUNDARY — </span>
          The Q-Day Readiness Score prioritizes repository migration work. It is not a certification, audit opinion,
          proof that detected code is reachable, or guarantee of quantum safety. Runtime negotiation, deployed
          infrastructure, hardware, third parties, and external trust paths require separate evidence.
        </div>
      </div>
    </Panel>
  );
}

// ── Countdown clock ───────────────────────────────────────────────
function QDayClock() {
  const TARGET = new Date("2029-01-01T00:00:00Z");
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t); },[]);
  const diff = Math.max(0, TARGET - now);
  const days  = Math.floor(diff/864e5);
  const hrs   = Math.floor((diff%864e5)/36e5);
  const mins  = Math.floor((diff%36e5)/6e4);
  const secs  = Math.floor((diff%6e4)/1e3);
  const pad = n => String(n).padStart(2,"0");
  return (
    <div style={{ display:"flex", gap:8, alignItems:"center", justifyContent:"center", padding:"12px 0" }}>
      {[["DAYS",days],["HRS",hrs],["MIN",mins],["SEC",secs]].map(([l,v])=>(
        <div key={l} style={{ textAlign:"center" }}>
          <div style={{ fontFamily:"monospace", fontSize:28, fontWeight:900, color:C.red,
            letterSpacing:2, textShadow:`0 0 16px ${C.red}88` }}>{l==="DAYS"?days:pad(v)}</div>
          <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.1em" }}>{l}</div>
        </div>
      )).reduce((a,e,i)=> i===0?[e]:[...a,
        <div key={`d${i}`} style={{color:C.red,fontSize:24,fontWeight:900,alignSelf:"flex-start",marginTop:4}}>:</div>,e
      ],[])}
    </div>
  );
}

// ── Risk gauge ────────────────────────────────────────────────────
function RiskGauge({ score, label }) {
  const r = 48, sw = 9, circ = 2*Math.PI*r;
  const progress = ((100-score)/100)*circ;
  const c = score>80?C.red:score>50?C.amber:C.green;
  return (
    <div style={{ position:"relative", width:120, height:70, display:"flex",
      flexDirection:"column", alignItems:"center" }}>
      <svg width={120} height={70} viewBox="-10 -10 140 80">
        <path d={`M10,60 A${r},${r} 0 0 1 ${120-10},60`} fill="none" stroke={`${c}22`} strokeWidth={sw} />
        <path d={`M10,60 A${r},${r} 0 0 1 ${120-10},60`} fill="none" stroke={c} strokeWidth={sw}
          strokeDasharray={`${circ/2} ${circ}`}
          strokeDashoffset={(score/100)*(circ/2)}
          strokeLinecap="round" style={{ filter:`drop-shadow(0 0 6px ${c})`, transition:"stroke-dashoffset 1s" }} />
        <text x="60" y="55" textAnchor="middle" fill={c} fontSize="20" fontWeight="900"
          style={{ fontFamily:"monospace" }}>{score}</text>
      </svg>
      <div style={{ fontSize:10, color:C.muted, marginTop:-4, letterSpacing:"0.06em",
        textTransform:"uppercase" }}>{label}</div>
    </div>
  );
}

// ── Network map (simplified visual) ──────────────────────────────
function NetworkMap({ assets, onSelect }) {
  const nodes = [
    { id:"internet",  label:"INTERNET",    x:270, y:20,  color:C.muted,  r:18 },
    { id:"dmz",       label:"DMZ",         x:270, y:110, color:C.red,    r:22, count:assets.filter(a=>a.segment==="DMZ").length },
    { id:"perim",     label:"PERIMETER",   x:120, y:110, color:C.red,    r:22, count:assets.filter(a=>a.segment==="Perimeter").length },
    { id:"internal",  label:"INTERNAL",    x:270, y:210, color:C.amber,  r:22, count:assets.filter(a=>a.segment==="Internal").length },
    { id:"finance",   label:"FINANCE",     x:150, y:260, color:C.hndl,   r:18, count:assets.filter(a=>a.segment==="Finance").length },
    { id:"cloud",     label:"CLOUD",       x:400, y:210, color:C.amber,  r:18, count:assets.filter(a=>a.segment==="Cloud").length },
    { id:"ot",        label:"OT/ICS",      x:120, y:300, color:C.red,    r:22, count:assets.filter(a=>a.segment==="OT").length },
    { id:"ca",        label:"PKI/CA",      x:390, y:280, color:C.tnfl,   r:18, count:assets.filter(a=>a.type==="CA Server"||a.type==="Code Signing").length },
  ];
  const edges = [
    ["internet","dmz"],["internet","perim"],["dmz","internal"],
    ["perim","internal"],["internal","finance"],["internal","cloud"],
    ["internal","ot"],["internal","ca"],
  ];
  return (
    <svg viewBox="0 0 520 360" style={{ width:"100%", height:"100%", overflow:"visible" }}>
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      {edges.map(([a,b],i) => {
        const na=nodes.find(n=>n.id===a), nb=nodes.find(n=>n.id===b);
        return <line key={i} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
          stroke={C.border2} strokeWidth={1.5} strokeDasharray="4 3" />;
      })}
      {nodes.map(n => (
        <g key={n.id} style={{ cursor:"pointer" }} onClick={()=>onSelect(n.id)}>
          <circle cx={n.x} cy={n.y} r={n.r+6} fill={`${n.color}11`} />
          <circle cx={n.x} cy={n.y} r={n.r} fill={`${n.color}22`}
            stroke={n.color} strokeWidth={1.5} filter="url(#glow)" />
          {n.count>0 && <text x={n.x} y={n.y+1} textAnchor="middle" dominantBaseline="middle"
            fill={n.color} fontSize={12} fontWeight="900">{n.count}</text>}
          <text x={n.x} y={n.y+n.r+12} textAnchor="middle" fill={C.muted} fontSize={9}
            letterSpacing="0.08em">{n.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ── Main app ─────────────────────────────────────────────────────
export default function App() {
  const [themeMode, setThemeMode] = useState(savedThemeMode);
  C = THEMES[themeMode];

  const [applianceData, setApplianceData] = useState({
    assets: FALLBACK_ASSETS,
    alerts: FALLBACK_ALERTS,
    compliance: FALLBACK_COMPLIANCE,
    trends: FALLBACK_TREND_DATA,
    algorithms: FALLBACK_ALGO_DIST,
    source: "boot",
    isFallback: true,
  });
  const [tab, setTab]         = useState("executive");
  const [selAsset, setSelAsset] = useState(null);
  const [filterCls, setFilterCls] = useState("ALL");
  const [filterSeg, setFilterSeg] = useState("ALL");
  const [sortCol, setSortCol] = useState("risk");
  const [sortAsc, setSortAsc] = useState(false);
  const [liveTs, setLiveTs]   = useState(new Date());
  const [newAlertId, setNewAlertId] = useState(null);
  const [probeJobs, setProbeJobs] = useState([]);
  const [probeStatus, setProbeStatus] = useState("idle");
  const [tlsAssetId, setTlsAssetId] = useState("1");
  const [tlsHost, setTlsHost] = useState("");
  const [tlsPort, setTlsPort] = useState(443);
  const [tlsTimeoutMs, setTlsTimeoutMs] = useState(2500);
  const [tlsStatus, setTlsStatus] = useState("idle");
  const [tlsRunning, setTlsRunning] = useState(false);
  const [discoveryHosts, setDiscoveryHosts] = useState("api-gateway-prod-01\nvpn-concentrator-02");
  const [discoveryTimeoutMs, setDiscoveryTimeoutMs] = useState(2500);
  const [discoveryLimit, setDiscoveryLimit] = useState(12);
  const [discoveryStatus, setDiscoveryStatus] = useState("idle");
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const [monitorPolicies, setMonitorPolicies] = useState([]);
  const [monitorName, setMonitorName] = useState("Edge Discovery Sweep");
  const [monitorIntervalSeconds, setMonitorIntervalSeconds] = useState(900);
  const [monitorStatus, setMonitorStatus] = useState("idle");
  const [monitorCreating, setMonitorCreating] = useState(false);
  const [monitorRunningIds, setMonitorRunningIds] = useState(() => new Set());
  const [monitorRuns, setMonitorRuns] = useState([]);
  const [monitorHealth, setMonitorHealth] = useState({
    totalPolicies: 0,
    enabledPolicies: 0,
    duePolicies: 0,
    runningRuns: 0,
    failedRecentRuns: 0,
    lastRunAt: null,
  });
  const [schedulerStatus, setSchedulerStatus] = useState(schedulerFallbackStatus);
  const [schedulerIntervalSeconds, setSchedulerIntervalSeconds] = useState(schedulerFallbackStatus.tickIntervalSeconds);
  const [schedulerMaxRuns, setSchedulerMaxRuns] = useState(schedulerFallbackStatus.maxRunsPerTick);
  const [schedulerBusy, setSchedulerBusy] = useState("");
  const [schedulerMessage, setSchedulerMessage] = useState("idle");
  const [schedulerTickMessage, setSchedulerTickMessage] = useState("");
  const [drift, setDrift] = useState({ driftDetected: false, count: 0, assets: [] });
  const [findings, setFindings] = useState([]);
  const [remediationSummary, setRemediationSummary] = useState({
    openCritical: 0,
    overdue: 0,
    dueSoon: 0,
    inProgress: 0,
    remediatedClosed: 0,
    total: 0,
  });
  const [findingStatusFilter, setFindingStatusFilter] = useState("ALL");
  const [findingSeverityFilter, setFindingSeverityFilter] = useState("ALL");
  const [findingOwnerFilter, setFindingOwnerFilter] = useState("ALL");
  const [findingOwnerDrafts, setFindingOwnerDrafts] = useState({});
  const [findingNoteDrafts, setFindingNoteDrafts] = useState({});
  const [findingBusyIds, setFindingBusyIds] = useState(() => new Set());
  const [findingMessage, setFindingMessage] = useState("idle");
  const [approvals, setApprovals] = useState([]);
  const [approvalCount, setApprovalCount] = useState(0);
  const [approvalStatus, setApprovalStatus] = useState("idle");
  const [approvalActor, setApprovalActor] = useState("analyst");
  const [approvalRole, setApprovalRole] = useState("analyst");
  const [approvalBusyId, setApprovalBusyId] = useState("");
  const [reportList, setReportList] = useState(reportFallbackReports);
  const [reportCount, setReportCount] = useState(reportFallbackReports.length);
  const [selectedReportType, setSelectedReportType] = useState("executive");
  const [currentReport, setCurrentReport] = useState(() => reportFallbackReports.find(report => report.type === "executive") ?? reportFallbackReports[0]);
  const [reportStatus, setReportStatus] = useState("fallback");
  const [reportBusy, setReportBusy] = useState(false);
  const [evidenceArchive, setEvidenceArchive] = useState(null);
  const [evidenceManifest, setEvidenceManifest] = useState(null);
  const [evidenceBundle, setEvidenceBundle] = useState(null);
  const [evidenceFilters, setEvidenceFilters] = useState({ reportType: "", action: "", entityType: "" });
  const [evidenceStatus, setEvidenceStatus] = useState("idle");
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [riskAssetId, setRiskAssetId] = useState("1");
  const [assetRisk, setAssetRisk] = useState(null);
  const [riskStatus, setRiskStatus] = useState("Select an asset and load risk analysis.");
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskRecomputeBusy, setRiskRecomputeBusy] = useState(false);
  const [riskPersistFindings, setRiskPersistFindings] = useState(true);

  const ASSETS = applianceData.assets;
  const ALERTS = applianceData.alerts;
  const COMPLIANCE = applianceData.compliance;
  const TREND_DATA = applianceData.trends;
  const ALGO_DIST = applianceData.algorithms;
  const tlsHostValue = String(tlsHost || "").trim();
  const tlsNumericPort = Number(tlsPort);
  const tlsPortValid = Number.isInteger(tlsNumericPort) && tlsNumericPort >= TLS_PORT_MIN && tlsNumericPort <= TLS_PORT_MAX;
  const tlsAssetValid = ASSETS.some(asset => String(asset.id) === String(tlsAssetId));
  const tlsCanRun = !tlsRunning && tlsAssetValid && tlsHostValue && tlsPortValid;
  const tlsCanMonitor = !monitorCreating && tlsAssetValid && tlsHostValue && tlsPortValid;
  const boundedDiscoveryLimit = clampDiscoveryLimit(discoveryLimit);
  const discoveryHostList = parseDiscoveryHosts(discoveryHosts, boundedDiscoveryLimit);
  const discoveryJobCount = probeJobs.filter(isDiscoveryJob).length;
  const monitorSummary = summarizeMonitorHealth(monitorHealth, monitorPolicies, monitorRuns);
  const monitorPolicyById = new Map(monitorPolicies.map(policy => [policy.id, policy]));
  const findingOwners = ["ALL", ...new Set(findings.map(finding => finding.owner).filter(Boolean).sort())];
  const findingSeverities = ["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  const findingStatuses = ["ALL", "OPEN", "TRIAGED", "IN_PROGRESS", "REMEDIATED", "CLOSED", "ACCEPTED_RISK"];
  const displayedFindings = findings
    .filter(finding => findingStatusFilter === "ALL" || finding.status === findingStatusFilter)
    .filter(finding => findingSeverityFilter === "ALL" || finding.severity === findingSeverityFilter)
    .filter(finding => findingOwnerFilter === "ALL" || finding.owner === findingOwnerFilter)
    .sort((a,b) => {
      const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
      const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || dueA - dueB;
    });
  const selectedAssetFindings = selAsset
    ? findings.filter(finding => finding.assetId === String(selAsset.id) || finding.assetName === selAsset.hostname)
    : [];
  const reportMetadataByType = new Map(reportList.map(report => [report.type, report]));
  const currentReportSummary = reportEntries(currentReport?.summary);
  const currentReportScope = reportEntries(currentReport?.scope);
  const currentReportGenerated = currentReport?.generatedAt ? formatTimestamp(currentReport.generatedAt) : "--";
  const currentReportSections = currentReport?.sections ?? [];
  const currentReportEvidenceRefs = currentReport?.evidenceRefs ?? [];
  const pendingApprovals = approvals.filter(approval => approval.status === "pending");
  const approvedApprovals = approvals.filter(approval => approval.status === "approved");
  const reportExportApproval = approvedApprovals.find(approval => (
    approval.entityType === "report"
    && approval.entityId === selectedReportType
    && approval.action === "report.export"
  ));
  const approvalSummary = {
    pending: pendingApprovals.length,
    approved: approvedApprovals.length,
    rejected: approvals.filter(approval => approval.status === "rejected").length,
  };
  const evidenceChain = evidenceArchive?.auditChain ?? { valid: false, count: 0, tailHash: "" };
  const evidenceExports = evidenceArchive?.reportExports?.items ?? [];
  const evidenceLatestExport = evidenceArchive?.reportExports?.latest ?? null;
  const activeEvidenceFilters = compactEvidenceFilters(evidenceFilters);
  const evidenceFilterCount = Object.keys(activeEvidenceFilters).length;
  const evidenceBundleEventCount = evidenceBundle?.auditEvents?.length ?? 0;
  const terminalFindingStatuses = new Set(["REMEDIATED", "ACCEPTED_RISK", "CLOSED"]);
  const riskScopedAsset = ASSETS.find(asset => String(asset.id) === String(riskAssetId))
    ?? selAsset
    ?? ASSETS[0]
    ?? null;
  const riskScopedAssetId = riskScopedAsset ? String(riskScopedAsset.id) : "";
  const riskRelatedFindings = riskScopedAsset
    ? findings.filter(finding => finding.assetId === String(riskScopedAsset.id) || finding.assetName === riskScopedAsset.hostname)
    : [];
  const riskDriftEvents = assetRisk?.drift?.events
    ?? drift.assets?.find(item => String(item.asset?.id) === riskScopedAssetId || item.asset?.hostname === riskScopedAsset?.hostname)?.events
    ?? [];
  const riskDrivers = assetRisk?.drivers?.length
    ? assetRisk.drivers
    : [
        { id: "asset-risk", label: "Asset risk score", score: riskScopedAsset?.risk ?? 0, kind: "risk" },
        { id: "hndl-score", label: "HNDL exposure", score: riskScopedAsset?.hndl ?? 0, kind: "hndl" },
        { id: "tnfl-score", label: "TNFL exposure", score: riskScopedAsset?.tnfl ?? 0, kind: "tnfl" },
      ];

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      loadApplianceData(),
      loadProbeJobs(),
      loadMonitorPolicies(),
      loadDrift(),
      loadMonitorRuns(),
      loadMonitorHealth(),
      loadSchedulerStatus(),
      loadFindings(),
      loadRemediationSummary(),
      loadReports(),
      loadReport("executive"),
      loadApprovals(),
      loadEvidenceArchive(),
    ]).then(([data, jobs, policies, driftData, runs, health, scheduler, findingData, remediationData, reportData, executiveReport, approvalData, evidenceData]) => {
      if (cancelled) return;
      setApplianceData(data);
      setProbeJobs(jobs);
      setMonitorPolicies(policies);
      setDrift(driftData);
      setMonitorRuns(runs);
      setMonitorHealth(health);
      setSchedulerStatus(scheduler);
      setSchedulerIntervalSeconds(scheduler.tickIntervalSeconds);
      setSchedulerMaxRuns(scheduler.maxRunsPerTick);
      setFindings(findingData);
      setRemediationSummary(remediationData);
      setReportList(reportData.reports);
      setReportCount(reportData.count);
      setCurrentReport(executiveReport);
      setReportStatus(executiveReport.reportId.startsWith("fallback-") ? "fallback" : "loaded");
      setApprovals(approvalData.approvals);
      setApprovalCount(approvalData.count);
      setEvidenceArchive(evidenceData);
      setEvidenceManifest(evidenceData.reportExports.latest);
      setEvidenceStatus(evidenceData.auditChain.valid ? "chain verified" : "chain unavailable");
      if (evidenceData.reportExports.latest?.id) {
        loadReportExportManifest(evidenceData.reportExports.latest.id)
          .then(manifest => {
            if (!cancelled) setEvidenceManifest(manifest);
          })
          .catch(() => {});
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // simulate live updates
  useEffect(() => {
    const t = setInterval(()=>{
      setLiveTs(new Date());
      if (Math.random()<0.15) setNewAlertId(Math.floor(Math.random()*7)+1);
    }, 3000);
    return ()=>clearInterval(t);
  },[]);

  const TABS = [
    { id:"executive", label:"Executive" },
    { id:"network",   label:"Network Map" },
    { id:"inventory", label:"Asset Inventory" },
    { id:"threats",   label:"Threats & Alerts" },
    { id:"risk",      label:"Risk Workbench" },
    { id:"approvals", label:"Approvals" },
    { id:"evidence",  label:"Evidence Archive" },
    { id:"compliance",label:"Compliance" },
    { id:"reports",   label:"Reports" },
  ];

  const totalAssets = ASSETS.length;
  const criticalCount = ASSETS.filter(a=>a.prio==="CRITICAL").length;
  const shorCount = ASSETS.filter(a=>a.cls==="SHOR-CRITICAL").length;
  const safeCount = ASSETS.filter(a=>a.cls==="QUANTUM-SAFE"||a.cls==="HYBRID").length;
  const overallRisk = Math.round(ASSETS.reduce((s,a)=>s+a.risk,0)/ASSETS.length);

  // filtered & sorted assets
  const displayedAssets = ASSETS
    .filter(a=> filterCls==="ALL"||a.cls===filterCls)
    .filter(a=> filterSeg==="ALL"||a.segment===filterSeg)
    .sort((a,b)=> sortAsc ? a[sortCol]-b[sortCol] : b[sortCol]-a[sortCol]);

  const segments = ["ALL",...new Set(ASSETS.map(a=>a.segment))];
  const classes  = ["ALL","SHOR-CRITICAL","HYBRID","QUANTUM-SAFE","DEPRECATED"];

  function thClick(col) {
    if (sortCol===col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(false); }
  }

  async function runAssetProbe(asset) {
    setProbeStatus(`Probing ${asset.hostname}...`);
    try {
      const job = await createProbeJob({ assetId: asset.id, mode: "simulate" });
      const [jobs, driftData] = await Promise.all([loadProbeJobs(), loadDrift()]);
      setProbeJobs(mergeCreatedProbeJob(jobs, job));
      setDrift(driftData);
      setProbeStatus(`Probe ${job.id} completed for ${asset.hostname}`);
    } catch (error) {
      setProbeStatus(`Probe failed: ${error.message}`);
    }
  }

  async function runTlsScan() {
    const assetId = String(tlsAssetId || "").trim();
    const asset = ASSETS.find(item => String(item.id) === assetId);
    const host = String(tlsHost || "").trim();
    const numericPort = Number(tlsPort);
    const port = Number.isInteger(numericPort) ? numericPort : NaN;
    const timeoutMs = clampTlsTimeout(tlsTimeoutMs);

    setTlsTimeoutMs(timeoutMs);

    if (!asset) {
      setTlsStatus("TLS failed: select an asset");
      return;
    }
    if (!host) {
      setTlsStatus("TLS failed: host required");
      return;
    }
    if (!Number.isInteger(port) || port < TLS_PORT_MIN || port > TLS_PORT_MAX) {
      setTlsStatus("TLS failed: invalid port");
      return;
    }

    setTlsPort(port);
    setTlsRunning(true);
    setTlsStatus(`TLS queued: ${host}:${port}`);
    try {
      const job = await createProbeJob({ mode: "tls", assetId, host, port, timeoutMs });
      const [jobs, data, driftData, findingData, remediationData] = await Promise.all([
        loadProbeJobs(),
        loadApplianceData(),
        loadDrift(),
        loadFindings(),
        loadRemediationSummary(),
      ]);
      setProbeJobs(mergeCreatedProbeJob(jobs, job));
      setApplianceData(data);
      setDrift(driftData);
      setFindings(findingData);
      setRemediationSummary(remediationData);
      setTlsStatus(`TLS ${job.id}: ${host}:${port}`);
    } catch (error) {
      setTlsStatus(`TLS failed: ${error.message}`);
    } finally {
      setTlsRunning(false);
    }
  }

  async function runDiscoveryProbe() {
    const limit = clampDiscoveryLimit(discoveryLimit);
    const hosts = parseDiscoveryHosts(discoveryHosts, limit);
    const timeoutMs = clampDiscoveryTimeout(discoveryTimeoutMs);

    setDiscoveryLimit(limit);
    setDiscoveryTimeoutMs(timeoutMs);

    if (hosts.length === 0) {
      setDiscoveryStatus("Discovery failed: no targets");
      return;
    }

    setDiscoveryRunning(true);
    setDiscoveryStatus(`Discovery queued: ${hosts.length} targets`);
    try {
      const job = await createProbeJob({ mode: "discovery", hosts, timeoutMs });
      const jobs = await loadProbeJobs();
      setProbeJobs(mergeCreatedProbeJob(jobs, job));
      setDiscoveryStatus(`Discovery ${job.id}: ${hosts.length} targets`);
    } catch (error) {
      setDiscoveryStatus(`Discovery failed: ${error.message}`);
    } finally {
      setDiscoveryRunning(false);
    }
  }

  async function createDiscoveryMonitor() {
    const limit = clampDiscoveryLimit(discoveryLimit);
    const hosts = parseDiscoveryHosts(discoveryHosts, limit);
    const timeoutMs = clampDiscoveryTimeout(discoveryTimeoutMs);
    const intervalSeconds = clampMonitorInterval(monitorIntervalSeconds);
    const name = String(monitorName || "").trim() || "Discovery Monitor";

    setDiscoveryLimit(limit);
    setDiscoveryTimeoutMs(timeoutMs);
    setMonitorIntervalSeconds(intervalSeconds);
    setMonitorName(name);

    if (hosts.length === 0) {
      setMonitorStatus("Monitor failed: no targets");
      return;
    }

    setMonitorCreating(true);
    setMonitorStatus(`Monitor queued: ${hosts.length} targets`);
    try {
      const policy = await createMonitorPolicy({
        name,
        enabled: true,
        intervalSeconds,
        probeRequest: { mode: "discovery", hosts, timeoutMs },
      });
      const [policies, health] = await Promise.all([loadMonitorPolicies(), loadMonitorHealth()]);
      setMonitorPolicies(mergeCreatedMonitorPolicy(policies, policy));
      setMonitorHealth(health);
      setMonitorStatus(`Monitor ${policy.id}: ${formatInterval(policy.intervalSeconds)} interval`);
    } catch (error) {
      setMonitorStatus(`Monitor failed: ${error.message}`);
    } finally {
      setMonitorCreating(false);
    }
  }

  async function createTlsMonitor() {
    const assetId = String(tlsAssetId || "").trim();
    const asset = ASSETS.find(item => String(item.id) === assetId);
    const host = String(tlsHost || "").trim();
    const numericPort = Number(tlsPort);
    const port = Number.isInteger(numericPort) ? numericPort : NaN;
    const timeoutMs = clampTlsTimeout(tlsTimeoutMs);
    const intervalSeconds = clampMonitorInterval(monitorIntervalSeconds);
    const fallbackName = host ? `TLS Monitor ${host}:${Number.isInteger(port) ? port : 443}` : "TLS Monitor";
    const name = String(monitorName || "").trim() || fallbackName;

    setTlsTimeoutMs(timeoutMs);
    setMonitorIntervalSeconds(intervalSeconds);
    setMonitorName(name);

    if (!asset) {
      setMonitorStatus("Monitor failed: select an asset");
      return;
    }
    if (!host) {
      setMonitorStatus("Monitor failed: host required");
      return;
    }
    if (!Number.isInteger(port) || port < TLS_PORT_MIN || port > TLS_PORT_MAX) {
      setMonitorStatus("Monitor failed: invalid TLS port");
      return;
    }

    setTlsPort(port);
    setMonitorCreating(true);
    setMonitorStatus(`TLS monitor queued: ${host}:${port}`);
    try {
      const policy = await createMonitorPolicy({
        name,
        enabled: true,
        intervalSeconds,
        probeRequest: { mode: "tls", assetId, host, port, timeoutMs },
      });
      const [policies, health] = await Promise.all([loadMonitorPolicies(), loadMonitorHealth()]);
      setMonitorPolicies(mergeCreatedMonitorPolicy(policies, policy));
      setMonitorHealth(health);
      setMonitorStatus(`TLS monitor ${policy.id}: ${host}:${port} every ${formatInterval(policy.intervalSeconds)}`);
    } catch (error) {
      setMonitorStatus(`Monitor failed: ${error.message}`);
    } finally {
      setMonitorCreating(false);
    }
  }

  function readSchedulerConfig() {
    const tickIntervalSeconds = clampSchedulerInterval(schedulerIntervalSeconds);
    const maxRunsPerTick = clampSchedulerMaxRuns(schedulerMaxRuns);
    setSchedulerIntervalSeconds(tickIntervalSeconds);
    setSchedulerMaxRuns(maxRunsPerTick);
    return { tickIntervalSeconds, maxRunsPerTick };
  }

  function applySchedulerStatus(status, config) {
    const tickIntervalSeconds = config?.tickIntervalSeconds ?? status.tickIntervalSeconds;
    const maxRunsPerTick = config?.maxRunsPerTick ?? status.maxRunsPerTick;
    const nextStatus = { ...status, tickIntervalSeconds, maxRunsPerTick };
    setSchedulerStatus(nextStatus);
    setSchedulerIntervalSeconds(tickIntervalSeconds);
    setSchedulerMaxRuns(maxRunsPerTick);
    return nextStatus;
  }

  async function commitSchedulerConfig({ announce = true } = {}) {
    const config = readSchedulerConfig();
    if (announce) setSchedulerMessage("Scheduler config applying");
    const status = await updateSchedulerConfig(config);
    const nextStatus = applySchedulerStatus(status, config);
    if (announce) setSchedulerMessage(`Scheduler config: ${formatInterval(config.tickIntervalSeconds)} / ${config.maxRunsPerTick} max`);
    return nextStatus;
  }

  async function handleSchedulerConfig() {
    setSchedulerBusy("config");
    try {
      await commitSchedulerConfig();
    } catch (error) {
      setSchedulerMessage(`Scheduler config failed: ${error.message}`);
    } finally {
      setSchedulerBusy("");
    }
  }

  async function handleSchedulerStart() {
    setSchedulerBusy("start");
    setSchedulerMessage("Scheduler start queued");
    try {
      const configured = await commitSchedulerConfig({ announce: false });
      const status = await startScheduler();
      applySchedulerStatus({ ...configured, ...status, running: status.running, enabled: status.enabled }, configured);
      setSchedulerMessage("Scheduler running");
    } catch (error) {
      setSchedulerMessage(`Scheduler start failed: ${error.message}`);
    } finally {
      setSchedulerBusy("");
    }
  }

  async function handleSchedulerStop() {
    setSchedulerBusy("stop");
    setSchedulerMessage("Scheduler stop queued");
    try {
      const status = await stopScheduler();
      applySchedulerStatus(status, {
        tickIntervalSeconds: schedulerStatus.tickIntervalSeconds,
        maxRunsPerTick: schedulerStatus.maxRunsPerTick,
      });
      setSchedulerMessage("Scheduler stopped");
    } catch (error) {
      setSchedulerMessage(`Scheduler stop failed: ${error.message}`);
    } finally {
      setSchedulerBusy("");
    }
  }

  async function handleSchedulerTick() {
    setSchedulerBusy("tick");
    setSchedulerMessage("Scheduler tick queued");
    try {
      const configured = await commitSchedulerConfig({ announce: false });
      const tick = await tickSchedulerNow();
      applySchedulerStatus({ ...configured, ...tick.status }, configured);
      setSchedulerTickMessage(tick.summary);

      if (tick.runs.length) {
        setMonitorRuns(runs => mergeMonitorRuns(runs, tick.runs));
        setMonitorHealth(health => patchMonitorHealthWithRuns(health, tick.runs));
        loadMonitorHealth().then(health => setMonitorHealth(health)).catch(() => {});
      } else {
        Promise.all([loadMonitorRuns(), loadMonitorHealth()])
          .then(([runs, health]) => {
            setMonitorRuns(runs);
            setMonitorHealth(health);
          })
          .catch(() => {});
      }

      setSchedulerMessage(`Scheduler tick: ${tick.runs.length} runs`);
    } catch (error) {
      setSchedulerMessage(`Scheduler tick failed: ${error.message}`);
    } finally {
      setSchedulerBusy("");
    }
  }

  async function runMonitorNow(policy) {
    if (!policy?.id) return;
    setMonitorRunningIds(previous => new Set(previous).add(policy.id));
    setMonitorStatus(`Monitor run queued: ${policy.name}`);
    try {
      const result = await runMonitorPolicyNow(policy.id);
      if (result.job) {
        setProbeJobs(jobs => mergeCreatedProbeJob(jobs, result.job));
      }
      if (result.run) {
        setMonitorRuns(runs => mergeMonitorRun(runs, result.run));
        setMonitorHealth(health => ({
          ...health,
          runningRuns: ["RUNNING", "QUEUED", "IN_PROGRESS"].includes(result.run.status)
            ? Math.max(Number(health.runningRuns) || 0, 1)
            : Number(health.runningRuns) || 0,
          failedRecentRuns: result.run.status === "FAILED"
            ? Math.max(Number(health.failedRecentRuns) || 0, 1)
            : Number(health.failedRecentRuns) || 0,
          lastRunAt: latestRunTimestamp(result.run) ?? health.lastRunAt,
        }));
      } else {
        loadMonitorRuns().then(runs => setMonitorRuns(runs)).catch(() => {});
      }
      setMonitorPolicies(policies => applyMonitorRunResult(policies, policy.id, result));
      const jobId = result.job?.id ?? "job";
      setMonitorStatus(`Monitor ${policy.id} run: ${jobId}`);
    } catch (error) {
      setMonitorStatus(`Monitor failed: ${error.message}`);
    } finally {
      setMonitorRunningIds(previous => {
        const next = new Set(previous);
        next.delete(policy.id);
        return next;
      });
    }
  }

  function updateFindingCollection(updatedFinding, requested = {}) {
    setFindings(previous => {
      const next = previous.map(finding => (
        finding.id === updatedFinding.id ? mergeFindingRecord(finding, updatedFinding, requested) : finding
      ));
      setRemediationSummary(deriveRemediationSummary(next));
      return next;
    });
  }

  async function refreshApprovals() {
    const data = await loadApprovals();
    setApprovals(data.approvals);
    setApprovalCount(data.count);
    return data.approvals;
  }

  async function refreshEvidenceArchive({ selectLatest = false } = {}) {
    setEvidenceBusy(true);
    setEvidenceStatus("refreshing archive");
    try {
      const archive = await loadEvidenceArchive(activeEvidenceFilters);
      setEvidenceArchive(archive);
      const latestId = archive.reportExports.latest?.id;
      if (selectLatest && latestId) {
        const manifest = await loadReportExportManifest(latestId);
        setEvidenceManifest(manifest);
      } else if (selectLatest || !evidenceManifest) {
        setEvidenceManifest(archive.reportExports.latest);
      }
      setEvidenceStatus(archive.auditChain.valid ? "audit chain verified" : "audit chain unavailable");
      return archive;
    } catch (error) {
      setEvidenceStatus(`evidence refresh failed: ${error.message}`);
      return null;
    } finally {
      setEvidenceBusy(false);
    }
  }

  function updateEvidenceFilter(field, value) {
    setEvidenceFilters(filters => ({ ...filters, [field]: value }));
  }

  async function clearEvidenceFilters() {
    const emptyFilters = { reportType: "", action: "", entityType: "" };
    setEvidenceFilters(emptyFilters);
    setEvidenceBusy(true);
    setEvidenceStatus("clearing archive filters");
    try {
      const archive = await loadEvidenceArchive();
      setEvidenceArchive(archive);
      setEvidenceBundle(null);
      setEvidenceStatus(archive.auditChain.valid ? "audit chain verified" : "audit chain unavailable");
    } catch (error) {
      setEvidenceStatus(`evidence refresh failed: ${error.message}`);
    } finally {
      setEvidenceBusy(false);
    }
  }

  async function selectEvidenceManifest(exportId) {
    if (!exportId) return;
    setEvidenceBusy(true);
    setEvidenceStatus(`loading manifest ${exportId}`);
    try {
      const manifest = await loadReportExportManifest(exportId);
      setEvidenceManifest(manifest);
      setEvidenceStatus(manifest.auditChain.valid ? `manifest verified ${exportId}` : `manifest loaded ${exportId}`);
    } catch (error) {
      setEvidenceStatus(`manifest failed: ${error.message}`);
    } finally {
      setEvidenceBusy(false);
    }
  }

  async function downloadEvidenceBundle() {
    setEvidenceBusy(true);
    setEvidenceStatus("building evidence bundle");
    try {
      const bundle = await loadEvidenceBundle(activeEvidenceFilters);
      setEvidenceBundle(bundle);
      const filename = `${bundle.bundleId || "evidence-bundle"}.json`;
      downloadJsonFile(filename, bundle.raw || bundle);
      setEvidenceStatus(`${filename} ready`);
    } catch (error) {
      setEvidenceStatus(`bundle failed: ${error.message}`);
    } finally {
      setEvidenceBusy(false);
    }
  }

  function approvedFindingApproval(finding, status) {
    const normalizedStatus = String(status || "").toLowerCase();
    return approvedApprovals.find(approval => (
      approval.entityType === "finding"
      && approval.entityId === finding.id
      && (approval.action === `finding.transition.${normalizedStatus}` || approval.action === "finding.terminal_status")
    ));
  }

  async function requestFindingApproval(finding, status) {
    const normalizedStatus = String(status || "").toLowerCase();
    const approval = await createApprovalRequest({
      entityType: "finding",
      entityId: finding.id,
      action: `finding.transition.${normalizedStatus}`,
      requestedBy: approvalActor,
      justification: `${status} requested for ${finding.assetName}`,
      metadata: {
        findingTitle: finding.title,
        assetName: finding.assetName,
        severity: finding.severity,
      },
    }, { actor: approvalActor, role: approvalRole });
    await refreshApprovals();
    setApprovalStatus(`requested ${approval.id}`);
    return approval;
  }

  async function applyFindingUpdate(finding, updates, message) {
    if (!finding?.id) return;
    setFindingBusyIds(previous => new Set(previous).add(finding.id));
    setFindingMessage(`${message}: ${finding.assetName}`);
    try {
      const requestedStatus = updates.status ? String(updates.status).toUpperCase() : "";
      const approval = terminalFindingStatuses.has(requestedStatus)
        ? approvedFindingApproval(finding, requestedStatus)
        : null;

      if (terminalFindingStatuses.has(requestedStatus) && !approval) {
        await requestFindingApproval(finding, requestedStatus);
        setFindingMessage(`Approval requested for ${requestedStatus}: ${finding.assetName}`);
        return;
      }

      const request = {
        ...updates,
        ...(updates.status ? { status: String(updates.status).toLowerCase() } : {}),
        ...(approval ? { approvalId: approval.id } : {}),
        updatedAt: new Date().toISOString(),
      };
      const updated = await updateFinding(finding.id, request);
      updateFindingCollection(updated, request);
      setFindingMessage(`${message}: ${finding.assetName}`);
    } catch (error) {
      setFindingMessage(`Finding update failed: ${error.message}`);
    } finally {
      setFindingBusyIds(previous => {
        const next = new Set(previous);
        next.delete(finding.id);
        return next;
      });
    }
  }

  async function requestReportApproval() {
    setApprovalStatus(`Requesting ${selectedReportType} export approval`);
    try {
      const approval = await createApprovalRequest({
        entityType: "report",
        entityId: selectedReportType,
        action: "report.export",
        requestedBy: approvalActor,
        assignedTo: "risk-board",
        justification: `${selectedReportType} evidence package export`,
        metadata: {
          reportId: currentReport?.reportId ?? null,
          evidenceRefs: currentReportEvidenceRefs.length,
        },
      }, { actor: approvalActor, role: approvalRole });
      await refreshApprovals();
      setApprovalStatus(`requested ${approval.id}`);
    } catch (error) {
      setApprovalStatus(`approval request failed: ${error.message}`);
    }
  }

  async function decideApproval(approval, decision) {
    setApprovalBusyId(`${approval.id}:${decision}`);
    setApprovalStatus(`${decision} queued: ${approval.id}`);
    try {
      const updated = await decideApprovalRequest(approval.id, decision, {
        actor: approvalActor,
        note: `${decision} by ${approvalActor}`,
      }, { actor: approvalActor, role: approvalRole });
      setApprovals(previous => previous.map(item => item.id === updated.id ? updated : item));
      setApprovalStatus(`${decision}d ${updated.id}`);
    } catch (error) {
      setApprovalStatus(`${decision} failed: ${error.message}`);
    } finally {
      setApprovalBusyId("");
    }
  }

  async function exportReportPackage() {
    setReportBusy(true);
    setReportStatus(`exporting ${selectedReportType}`);
    try {
      const exported = await createReportExport(selectedReportType, {
        createdBy: approvalActor,
        approvalId: reportExportApproval?.id ?? null,
        metadata: {
          reportId: currentReport?.reportId ?? null,
          requestedFrom: "dashboard",
        },
      }, { actor: approvalActor, role: approvalRole });
      const [, , manifest] = await Promise.all([
        refreshApprovals(),
        refreshEvidenceArchive(),
        loadReportExportManifest(exported.id),
        loadReports().then(data => {
          setReportList(data.reports);
          setReportCount(data.count);
        }),
      ]);
      setEvidenceManifest(manifest);
      setReportStatus(`exported ${exported.id}`);
      setApprovalStatus(`report export ${exported.id}`);
    } catch (error) {
      setReportStatus(`export failed: ${error.message}`);
      setApprovalStatus(`export failed: ${error.message}`);
    } finally {
      setReportBusy(false);
    }
  }

  function assignFindingOwner(finding) {
    const owner = String(findingOwnerDrafts[finding.id] ?? finding.owner ?? "").trim();
    if (!owner) return;
    applyFindingUpdate(finding, { owner }, "Owner assigned");
  }

  async function addFindingNote(finding) {
    const note = String(findingNoteDrafts[finding.id] ?? "").trim();
    if (!note) return;
    setFindingBusyIds(previous => new Set(previous).add(finding.id));
    setFindingMessage(`Note queued: ${finding.assetName}`);
    try {
      const updated = await appendFindingNote(finding.id, note, { author: "analyst" });
      const nextNote = { text: note, author: "analyst", createdAt: new Date().toISOString() };
      updateFindingCollection({
        ...updated,
        id: finding.id,
        notes: updated.notes?.length ? updated.notes : [...(finding.notes ?? []), nextNote],
      });
      setFindingNoteDrafts(previous => ({ ...previous, [finding.id]: "" }));
      setFindingMessage(`Note added: ${finding.assetName}`);
    } catch (error) {
      setFindingMessage(`Note failed: ${error.message}`);
    } finally {
      setFindingBusyIds(previous => {
        const next = new Set(previous);
        next.delete(finding.id);
        return next;
      });
    }
  }

  async function selectReportType(type) {
    setSelectedReportType(type);
    setReportBusy(true);
    setReportStatus(`loading ${type}`);
    try {
      const report = await loadReport(type);
      setCurrentReport(report);
      setReportStatus(report.reportId.startsWith("fallback-") ? "fallback" : `loaded ${report.reportId}`);
    } catch (error) {
      setReportStatus(`report failed: ${error.message}`);
    } finally {
      setReportBusy(false);
    }
  }

  function selectRiskAssetId(assetId) {
    setRiskAssetId(assetId);
    const asset = ASSETS.find(item => String(item.id) === String(assetId));
    if (asset) setSelAsset(asset);
    setAssetRisk(current => (
      current?.asset?.id && String(current.asset.id) === String(assetId) ? current : null
    ));
    setRiskStatus("Scope changed. Load risk analysis to refresh this asset.");
  }

  async function refreshRiskAnalysis(assetId = riskScopedAssetId, { quiet = false } = {}) {
    if (!assetId) {
      setRiskStatus("Risk analysis failed: no asset selected");
      return null;
    }

    setRiskBusy(true);
    if (!quiet) setRiskStatus(`Loading risk analysis for asset ${assetId}`);
    try {
      const risk = await loadAssetRisk(assetId);
      if (!risk) throw new Error("Asset risk analysis unavailable");
      setAssetRisk(risk);
      setRiskStatus(`${risk.source === "fallback" ? "Fallback" : "API"} risk analysis loaded: ${risk.asset.hostname}`);
      return risk;
    } catch (error) {
      setRiskStatus(`Risk analysis failed: ${error.message}`);
      return null;
    } finally {
      setRiskBusy(false);
    }
  }

  async function refreshRiskWorkbenchData(assetId = riskScopedAssetId) {
    const reportType = selectedReportType;
    const [data, risk, driftData, findingData, remediationData, reportData, report] = await Promise.all([
      loadApplianceData(),
      assetId ? loadAssetRisk(assetId) : Promise.resolve(null),
      loadDrift(),
      loadFindings(),
      loadRemediationSummary(),
      loadReports(),
      loadReport(reportType),
    ]);

    setApplianceData(data);
    if (risk) setAssetRisk(risk);
    setDrift(driftData);
    setFindings(findingData);
    setRemediationSummary(remediationData);
    setReportList(reportData.reports);
    setReportCount(reportData.count);
    setCurrentReport(report);
    setReportStatus(report.reportId.startsWith("fallback-") ? "fallback" : `loaded ${report.reportId}`);
  }

  async function runRiskRecompute(scope = "asset") {
    const assetId = scope === "asset" ? riskScopedAssetId : null;
    if (scope === "asset" && !assetId) {
      setRiskStatus("Recompute failed: no asset selected");
      return;
    }

    setRiskRecomputeBusy(true);
    setRiskStatus(scope === "asset" ? `Recompute queued: ${riskScopedAsset?.hostname}` : "Portfolio recompute queued");
    try {
      const request = scope === "asset"
        ? { assetId, persist: riskPersistFindings }
        : { persist: riskPersistFindings };
      const result = await recomputeRisk(request);
      await refreshRiskWorkbenchData(riskScopedAssetId);
      const createdCount = result.createdFindings?.length ?? 0;
      setRiskStatus(`Recompute complete: ${result.count} analyses · ${createdCount} persisted findings`);
    } catch (error) {
      setRiskStatus(`Recompute failed: ${error.message}`);
    } finally {
      setRiskRecomputeBusy(false);
    }
  }

  async function copyReportJson() {
    const payload = JSON.stringify(currentReport, null, 2);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
        setReportStatus(`copied ${currentReport.reportId}`);
        return;
      }

      if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = payload;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        setReportStatus(copied ? `copied ${currentReport.reportId}` : "copy unavailable");
        return;
      }

      setReportStatus("copy unavailable");
    } catch (error) {
      setReportStatus(`copy failed: ${error.message}`);
    }
  }

  function downloadReportJson() {
    try {
      if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
        setReportStatus("download unavailable");
        return;
      }

      const payload = JSON.stringify(currentReport, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${currentReport.reportId || selectedReportType}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setReportStatus(`downloaded ${currentReport.reportId}`);
    } catch (error) {
      setReportStatus(`download failed: ${error.message}`);
    }
  }

  const schedulerRunning = Boolean(schedulerStatus.running);
  const schedulerStatusColor = schedulerRunning ? C.green : C.muted;
  const schedulerBusyActive = Boolean(schedulerBusy);
  const schedulerLastTick = schedulerTickSummary(schedulerStatus, schedulerTickMessage);

  useEffect(() => {
    localStorage.setItem("quantumsentinel-theme", themeMode);
  }, [themeMode]);

  return (
    <div style={{ fontFamily:"'IBM Plex Mono', 'Courier New', monospace",
      background:C.bg, color:C.text, minHeight:"100vh", fontSize:13 }}>

      {/* ── Header ── */}
      <div style={{ background:C.panel, borderBottom:`1px solid ${C.border}`,
        padding:"0 24px", display:"flex", alignItems:"center", gap:0, height:52 }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginRight:32 }}>
          <svg width={28} height={28} viewBox="0 0 28 28">
            <polygon points="14,2 26,8 26,20 14,26 2,20 2,8"
              fill="none" stroke={C.accent} strokeWidth={1.5}
              style={{ filter:`drop-shadow(0 0 4px ${C.accent})` }} />
            <polygon points="14,7 21,11 21,17 14,21 7,17 7,11"
              fill={`${C.accent}22`} stroke={C.accent} strokeWidth={1} />
            <circle cx={14} cy={14} r={3} fill={C.accent}
              style={{ filter:`drop-shadow(0 0 4px ${C.accent})` }} />
          </svg>
          <div>
            <div style={{ fontSize:14, fontWeight:900, letterSpacing:"0.12em", color:C.accent,
              textShadow:`0 0 8px ${C.accent}66` }}>QUANTUM<span style={{color:C.text}}>SENTINEL</span></div>
            <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.2em", marginTop:-2 }}>PQC ASSESSMENT AGENT v1.0</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:2, flex:1 }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              background:tab===t.id?`${C.accent}18`:"transparent",
              border:"none", borderBottom:tab===t.id?`2px solid ${C.accent}`:"2px solid transparent",
              color:tab===t.id?C.accent:C.muted, padding:"0 16px", height:52, cursor:"pointer",
              fontSize:11, fontWeight:700, letterSpacing:"0.08em", fontFamily:"inherit",
              transition:"all 0.2s"
            }}>{t.label.toUpperCase()}</button>
          ))}
        </div>

        {/* Live indicator */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ display:"flex", border:`1px solid ${C.border2}`, borderRadius:5,
            overflow:"hidden", background:C.bg }}>
            {["dark","light"].map(mode=>(
              <button key={mode} onClick={()=>setThemeMode(mode)}
                aria-pressed={themeMode===mode}
                style={{ border:"none", borderRight:mode==="dark"?`1px solid ${C.border2}`:"none",
                  background:themeMode===mode?`${C.accent}18`:"transparent",
                  color:themeMode===mode?C.accent:C.muted, padding:"4px 8px",
                  cursor:"pointer", fontSize:9, fontWeight:800, letterSpacing:"0.08em",
                  fontFamily:"inherit" }}>
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
          <span style={{ fontSize:10, color:applianceData.isFallback?C.amber:C.green, letterSpacing:"0.1em" }}>
            {applianceData.isFallback ? "FALLBACK" : "API"}
          </span>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:C.green,
              boxShadow:`0 0 6px ${C.green}`, animation:"pulse 2s infinite" }} />
            <span style={{ fontSize:10, color:C.green, letterSpacing:"0.1em" }}>LIVE</span>
          </div>
          <span style={{ fontSize:10, color:C.muted }}>
            {liveTs.toLocaleTimeString()}
          </span>
          <div style={{ marginLeft:8, padding:"4px 10px", background:`${C.redDim}`,
            border:`1px solid ${C.red}44`, borderRadius:4 }}>
            <span style={{ fontSize:10, color:C.red, fontWeight:700 }}>
              {criticalCount} CRITICAL
            </span>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding:20, maxHeight:"calc(100vh - 52px)", overflowY:"auto" }}>

        {/* ─── EXECUTIVE TAB ─── */}
        {tab==="executive" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gridTemplateRows:"auto auto auto", gap:16 }}>

            {/* Q-Day Countdown */}
            <Panel title="Q-Day Countdown — IonQ 2029 Scenario" style={{ gridColumn:"1/2" }}>
              <QDayClock />
              <div style={{ padding:"0 16px 12px", fontSize:10, color:C.muted, textAlign:"center", lineHeight:1.6 }}>
                Estimated CRQC capability (IonQ roadmap).<br/>
                HNDL data harvested <span style={{color:C.hndl,fontWeight:700}}>today</span> may be decryptable by then.
              </div>
            </Panel>

            {/* Org Risk Score */}
            <Panel title="Organisation Quantum Risk Score" style={{ gridColumn:"2/3" }}>
              <div style={{ display:"flex", justifyContent:"center", gap:20, padding:"10px 0 6px" }}>
                <RiskGauge score={overallRisk} label="Overall" />
                <RiskGauge score={Math.round(ASSETS.reduce((s,a)=>s+a.hndl,0)/ASSETS.length)} label="HNDL" />
                <RiskGauge score={Math.round(ASSETS.reduce((s,a)=>s+a.tnfl,0)/ASSETS.length)} label="TNFL" />
              </div>
              <div style={{ padding:"0 16px 12px", display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                {[["Total Assets",totalAssets,C.text],["Critical",criticalCount,C.red],["Shor-Vuln",shorCount,C.red],["Quantum-Safe",safeCount,C.green]].map(([l,v,c])=>(
                  <div key={l} style={{ textAlign:"center", padding:"6px 12px",
                    background:`${c}11`, border:`1px solid ${c}33`, borderRadius:6 }}>
                    <div style={{ fontSize:18, fontWeight:900, color:c }}>{v}</div>
                    <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.06em" }}>{l.toUpperCase()}</div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Migration Progress */}
            <Panel title="Migration Progress" style={{ gridColumn:"3/4" }}>
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                {[
                  ["TLS Key Exchange",  8,  C.red],
                  ["Certificate Signing",4, C.hndl],
                  ["VPN / IPsec",        5,  C.amber],
                  ["Code Signing",       2,  C.tnfl],
                  ["OT Assets",          0,  C.red],
                ].map(([l,pct,c])=>(
                  <div key={l}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:10, color:C.muted }}>{l}</span>
                      <span style={{ fontSize:10, color:pct>30?C.green:C.red, fontWeight:700 }}>{pct}%</span>
                    </div>
                    <div style={{ height:6, borderRadius:3, background:`${c}22` }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:c,
                        borderRadius:3, boxShadow:`0 0 6px ${c}66`, transition:"width 0.8s" }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Risk Trend */}
            <Panel title="Risk Score Trend (6 months)" style={{ gridColumn:"1/3" }}>
              <div style={{ padding:"12px 16px 8px", display:"flex", alignItems:"flex-end",
                gap:12, height:120 }}>
                {TREND_DATA.map((d,i)=>(
                  <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", flex:1 }}>
                    <div style={{ fontSize:9, color:C.red, marginBottom:3 }}>{d.risk}</div>
                    <div style={{ width:"100%", display:"flex", flexDirection:"column",
                      height:80, justifyContent:"flex-end" }}>
                      <div style={{ background:C.red, height:`${d.risk*0.75}px`, borderRadius:"3px 3px 0 0",
                        boxShadow:`0 0 8px ${C.red}55`, transition:"height 0.8s",
                        opacity: i===TREND_DATA.length-1?1:0.6 }} />
                    </div>
                    <div style={{ fontSize:9, color:C.muted, marginTop:4 }}>{d.day}</div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Algorithm Distribution */}
            <Panel title="Algorithm Distribution" style={{ gridColumn:"3/4" }}>
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
                {ALGO_DIST.map(d=>(
                  <div key={d.label}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ fontSize:10, color:C.muted }}>{d.label}</span>
                      <span style={{ fontSize:10, color:clsColor(d.cls), fontWeight:700 }}>{d.count} ({d.pct}%)</span>
                    </div>
                    <MiniBar pct={d.pct} color={clsColor(d.cls)} />
                  </div>
                ))}
              </div>
            </Panel>

            <QDayScoreMethodology />

            {/* Top Critical Findings */}
            <Panel title="Top Critical Findings" badge="REQUIRES ACTION" style={{ gridColumn:"1/3" }}>
              <div style={{ padding:"0 0 4px" }}>
                {ASSETS.filter(a=>a.prio==="CRITICAL").slice(0,5).map(a=>(
                  <div key={a.id} onClick={()=>{ setSelAsset(a); setTab("inventory"); }}
                    style={{ padding:"10px 16px", borderBottom:`1px solid ${C.border}`,
                      cursor:"pointer", transition:"background 0.15s",
                      display:"flex", alignItems:"center", gap:12 }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${C.red}08`}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ width:3, alignSelf:"stretch", background:prioColor(a.prio),
                      borderRadius:2, flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:C.text }}>{a.hostname}</div>
                      <div style={{ fontSize:10, color:C.muted }}>{a.type} · {a.segment} · {a.algo}</div>
                    </div>
                    <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                      <ScoreBadge score={a.hndl} color={C.hndl} />
                      <ScoreBadge score={a.tnfl} color={C.tnfl} />
                      <Pill label={a.cls} color={clsColor(a.cls)} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Latest Alerts */}
            <Panel title="Recent Alerts" badge="LIVE" style={{ gridColumn:"3/4" }}>
              <div>
                {ALERTS.slice(0,5).map(a=>(
                  <div key={a.id} style={{ padding:"8px 12px", borderBottom:`1px solid ${C.border}`,
                    background: a.id===newAlertId?`${C.accent}08`:"transparent",
                    transition:"background 0.5s" }}>
                    <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:3 }}>
                      <Pill label={a.type} color={typeColor(a.type)} />
                      <Pill label={a.sev} color={sevColor(a.sev)} />
                      <span style={{ fontSize:9, color:C.muted, marginLeft:"auto" }}>{a.ts}</span>
                    </div>
                    <div style={{ fontSize:10, color:C.text, lineHeight:1.5 }}>{a.msg}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {/* ─── NETWORK MAP TAB ─── */}
        {tab==="network" && (
          <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:16, height:"calc(100vh - 110px)" }}>
            <Panel title="Network Topology — Quantum Risk Overlay" badge="INTERACTIVE">
              <div style={{ padding:16, height:"100%", display:"flex", flexDirection:"column" }}>
                <div style={{ display:"flex", gap:12, marginBottom:12, flexWrap:"wrap" }}>
                  {[["SHOR-CRITICAL","Critical HNDL/TNFL",C.red],["HYBRID","Transitional",C.accent],
                    ["QUANTUM-SAFE","Protected",C.green],["DEPRECATED","Legacy Risk",C.amber]].map(([l,d,c])=>(
                    <div key={l} style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:c }} />
                      <span style={{ fontSize:9, color:C.muted }}>{d}</span>
                    </div>
                  ))}
                </div>
                <div style={{ flex:1 }}>
                  <NetworkMap assets={ASSETS} onSelect={seg=>{
                    setFilterSeg(seg==="internet"?"ALL":
                      seg==="dmz"?"DMZ":seg==="perim"?"Perimeter":
                      seg==="internal"?"Internal":seg==="finance"?"Finance":
                      seg==="cloud"?"Cloud":seg==="ot"?"OT":"ALL");
                    setTab("inventory");
                  }} />
                </div>
                <div style={{ fontSize:10, color:C.muted, textAlign:"center", marginTop:8 }}>
                  Click a segment to view its asset inventory →
                </div>
              </div>
            </Panel>

            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <Panel title="Segment Risk Summary">
                <div style={{ padding:"8px 0" }}>
                  {["DMZ","Perimeter","Internal","Finance","Cloud","OT"].map(seg=>{
                    const segAssets = ASSETS.filter(a=>a.segment===seg);
                    const avgRisk = segAssets.length ? Math.round(segAssets.reduce((s,a)=>s+a.risk,0)/segAssets.length) : 0;
                    return (
                      <div key={seg} style={{ padding:"8px 16px", borderBottom:`1px solid ${C.border}`,
                        display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:11, fontWeight:700, color:C.text }}>{seg}</div>
                          <div style={{ fontSize:9, color:C.muted }}>{segAssets.length} assets</div>
                        </div>
                        <div style={{ width:80 }}>
                          <MiniBar pct={avgRisk} color={avgRisk>70?C.red:avgRisk>40?C.amber:C.green} />
                        </div>
                        <ScoreBadge score={avgRisk} color={avgRisk>70?C.red:C.amber} />
                      </div>
                    );
                  })}
                </div>
              </Panel>
              <Panel title="Trust Chain Risk (TNFL)">
                <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
                  <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
                    PKI trust chain vulnerabilities — a compromised CA certificate invalidates all downstream certificates.
                  </div>
                  {ASSETS.filter(a=>a.tnfl>70).sort((a,b)=>b.tnfl-a.tnfl).slice(0,4).map(a=>(
                    <div key={a.id} style={{ display:"flex", alignItems:"center", gap:8,
                      padding:"6px 8px", background:`${C.tnfl}11`, borderRadius:4,
                      border:`1px solid ${C.tnfl}33` }}>
                      <div style={{ flex:1, fontSize:10 }}>{a.hostname}</div>
                      <ScoreBadge score={a.tnfl} color={C.tnfl} />
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="Active Probe Engine" badge={`${probeJobs.length} JOBS · ${discoveryJobCount} DISC · ${monitorPolicies.length} MON`}>
                <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:8,
                    padding:"10px", border:`1px solid ${C.border}`, borderRadius:6,
                    background:`${C.purple}06` }}>
                    <div style={{ display:"grid", gridTemplateColumns:"minmax(0, 1.2fr) minmax(0, 1.3fr)", gap:8 }}>
                      <label style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>ASSET</span>
                        <select value={tlsAssetId} onChange={e=>setTlsAssetId(e.target.value)}
                          disabled={tlsRunning}
                          style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                            color:tlsRunning?C.muted:C.text, padding:"6px 7px", fontSize:10,
                            fontFamily:"inherit", width:"100%", minWidth:0 }}>
                          {ASSETS.map(asset => (
                            <option key={asset.id} value={asset.id}>{asset.hostname}</option>
                          ))}
                        </select>
                      </label>
                      <label style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>HOST</span>
                        <input type="text" value={tlsHost} placeholder="example.com"
                          onChange={e=>setTlsHost(e.target.value)}
                          disabled={tlsRunning}
                          style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                            color:tlsRunning?C.muted:C.text, padding:"6px 7px", fontSize:10,
                            fontFamily:"inherit", width:"100%", minWidth:0 }} />
                      </label>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto auto", gap:8, alignItems:"end" }}>
                      <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>PORT</span>
                        <input type="number" min={TLS_PORT_MIN} max={TLS_PORT_MAX} value={tlsPort}
                          onChange={e=>setTlsPort(e.target.value)}
                          disabled={tlsRunning}
                          style={{ background:C.bg, border:`1px solid ${tlsPortValid?C.border2:C.red}66`, borderRadius:4,
                            color:tlsRunning?C.muted:C.text, padding:"6px 7px", fontSize:10,
                            fontFamily:"inherit", width:"100%" }} />
                      </label>
                      <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>TIMEOUT MS</span>
                        <input type="number" min={TLS_TIMEOUT_MIN_MS} max={TLS_TIMEOUT_MAX_MS}
                          step={250} value={tlsTimeoutMs}
                          onChange={e=>setTlsTimeoutMs(e.target.value)}
                          disabled={tlsRunning}
                          style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                            color:tlsRunning?C.muted:C.text, padding:"6px 7px", fontSize:10,
                            fontFamily:"inherit", width:"100%" }} />
                      </label>
                      <button onClick={runTlsScan} disabled={!tlsCanRun}
                        style={{ background:!tlsCanRun?`${C.muted}22`:`${C.purple}18`,
                          border:`1px solid ${!tlsCanRun?C.border2:C.purple}66`,
                          color:!tlsCanRun?C.muted:C.purple, padding:"7px 10px",
                          borderRadius:5, cursor:!tlsCanRun?"not-allowed":"pointer",
                          fontSize:10, fontWeight:700, letterSpacing:"0.08em", fontFamily:"inherit",
                          whiteSpace:"nowrap" }}>
                        RUN TLS SCAN
                      </button>
                      <button onClick={createTlsMonitor} disabled={!tlsCanMonitor}
                        style={{ background:!tlsCanMonitor?`${C.muted}22`:`${C.green}16`,
                          border:`1px solid ${!tlsCanMonitor?C.border2:C.green}66`,
                          color:!tlsCanMonitor?C.muted:C.green, padding:"7px 10px",
                          borderRadius:5, cursor:!tlsCanMonitor?"not-allowed":"pointer",
                          fontSize:10, fontWeight:700, letterSpacing:"0.08em", fontFamily:"inherit",
                          whiteSpace:"nowrap" }}>
                        SAVE MONITOR
                      </button>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, minHeight:18 }}>
                      <Pill label={tlsRunning?"TLS RUNNING":"TLS SCAN"} color={tlsRunning?C.amber:C.purple} />
                      {tlsStatus !== "idle" && (
                        <span style={{ fontSize:9, color:tlsStatus.startsWith("TLS failed")?C.red:C.purple,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {tlsStatus}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:8,
                    padding:"10px", border:`1px solid ${C.border}`, borderRadius:6,
                    background:`${C.accent}06` }}>
                    <textarea value={discoveryHosts} onChange={e=>setDiscoveryHosts(e.target.value)}
                      rows={3} spellCheck={false} placeholder="host, ip, cidr"
                      style={{ width:"100%", resize:"vertical", minHeight:58, maxHeight:110,
                        background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                        color:C.text, padding:"7px 8px", fontSize:10, lineHeight:1.45,
                        fontFamily:"inherit", outline:"none" }} />
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr auto", gap:8, alignItems:"end" }}>
                      <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>TIMEOUT MS</span>
                        <input type="number" min={DISCOVERY_TIMEOUT_MIN_MS} max={DISCOVERY_TIMEOUT_MAX_MS}
                          step={250} value={discoveryTimeoutMs}
                          onChange={e=>setDiscoveryTimeoutMs(e.target.value)}
                          style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                            color:C.text, padding:"6px 7px", fontSize:10, fontFamily:"inherit",
                            width:"100%" }} />
                      </label>
                      <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>LIMIT</span>
                        <input type="number" min={1} max={DISCOVERY_HOST_LIMIT_MAX} value={discoveryLimit}
                          onChange={e=>setDiscoveryLimit(e.target.value)}
                          style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                            color:C.text, padding:"6px 7px", fontSize:10, fontFamily:"inherit",
                            width:"100%" }} />
                      </label>
                      <button onClick={runDiscoveryProbe} disabled={discoveryRunning || discoveryHostList.length===0}
                        style={{ background:discoveryRunning?`${C.muted}22`:`${C.accent}18`,
                          border:`1px solid ${discoveryRunning?C.border2:C.accent}66`,
                          color:discoveryRunning?C.muted:C.accent, padding:"7px 10px",
                          borderRadius:5, cursor:discoveryRunning || discoveryHostList.length===0?"not-allowed":"pointer",
                          fontSize:10, fontWeight:700, letterSpacing:"0.08em", fontFamily:"inherit",
                          whiteSpace:"nowrap" }}>
                        RUN DISCOVERY
                      </button>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:8, minHeight:18 }}>
                      <Pill label={`${discoveryHostList.length}/${boundedDiscoveryLimit} TARGETS`} color={discoveryHostList.length?C.accent:C.muted} />
                      {discoveryStatus !== "idle" && (
                        <span style={{ fontSize:9, color:discoveryStatus.startsWith("Discovery failed")?C.red:C.accent,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {discoveryStatus}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:8,
                    padding:"10px", border:`1px solid ${C.border}`, borderRadius:6,
                    background:`${C.green}05` }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                      <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em", fontWeight:700 }}>
                        SCHEDULED MONITORING
                      </span>
                      <Pill label={`${monitorPolicies.length} POLICIES`} color={monitorPolicies.length?C.green:C.muted} />
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(5, minmax(0, 1fr))", gap:5 }}>
                      {[
                        ["ENABLED", monitorSummary.enabledPolicies, C.green],
                        ["DUE", monitorSummary.duePolicies, monitorSummary.duePolicies ? C.amber : C.muted],
                        ["RUNNING", monitorSummary.runningRuns, monitorSummary.runningRuns ? C.amber : C.muted],
                        ["FAILED", monitorSummary.failedRecentRuns, monitorSummary.failedRecentRuns ? C.red : C.muted],
                        ["LAST", formatTime(monitorSummary.lastRunAt), monitorSummary.lastRunAt ? C.accent : C.muted],
                      ].map(([label, value, color]) => (
                        <div key={label} style={{ minWidth:0, padding:"6px 5px", border:`1px solid ${color}33`,
                          borderRadius:5, background:`${color}0a`, textAlign:"center" }}>
                          <div style={{ fontSize:11, color, fontWeight:900, overflow:"hidden",
                            textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {value}
                          </div>
                          <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:2 }}>
                            {label}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr", gap:7,
                      padding:"8px", border:`1px solid ${schedulerStatusColor}33`, borderRadius:5,
                      background:`${schedulerStatusColor}08` }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em", fontWeight:700 }}>
                          AUTOMATION CONTROLS
                        </span>
                        <Pill label={schedulerRunning?"RUNNING":"STOPPED"} color={schedulerStatusColor} />
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                        <label style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                          <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>INTERVAL S</span>
                          <input type="number" min={SCHEDULER_INTERVAL_MIN_SECONDS} max={SCHEDULER_INTERVAL_MAX_SECONDS}
                            step={60} value={schedulerIntervalSeconds}
                            onChange={e=>setSchedulerIntervalSeconds(e.target.value)}
                            disabled={schedulerBusyActive}
                            style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                              color:schedulerBusyActive?C.muted:C.text, padding:"6px 7px", fontSize:10,
                              fontFamily:"inherit", width:"100%" }} />
                        </label>
                        <label style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                          <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>MAX RUNS</span>
                          <input type="number" min={SCHEDULER_MAX_RUNS_MIN} max={SCHEDULER_MAX_RUNS_MAX}
                            step={1} value={schedulerMaxRuns}
                            onChange={e=>setSchedulerMaxRuns(e.target.value)}
                            disabled={schedulerBusyActive}
                            style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                              color:schedulerBusyActive?C.muted:C.text, padding:"6px 7px", fontSize:10,
                              fontFamily:"inherit", width:"100%" }} />
                        </label>
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(4, minmax(0, 1fr))", gap:6 }}>
                        {[
                          ["APPLY", "config", handleSchedulerConfig, C.accent],
                          ["START", "start", handleSchedulerStart, C.green],
                          ["STOP", "stop", handleSchedulerStop, C.amber],
                          ["TICK NOW", "tick", handleSchedulerTick, C.purple],
                        ].map(([label, key, action, color]) => {
                          const active = schedulerBusy === key;
                          const disabled = schedulerBusyActive;
                          return (
                            <button key={key} onClick={action} disabled={disabled}
                              style={{ background:disabled?`${C.muted}18`:`${color}14`,
                                border:`1px solid ${disabled?C.border2:color}55`,
                                color:active?C.text:disabled?C.muted:color, borderRadius:4,
                                padding:"6px 5px", cursor:disabled?"not-allowed":"pointer",
                                fontSize:9, fontWeight:700, letterSpacing:"0.04em",
                                fontFamily:"inherit", whiteSpace:"nowrap", overflow:"hidden",
                                textOverflow:"ellipsis" }}>
                              {active ? "..." : label}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:8, alignItems:"center",
                        minHeight:18 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>LAST TICK</span>
                        <span style={{ fontSize:9, color:schedulerStatus.lastTickAt?C.accent:C.muted,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {schedulerLastTick}
                        </span>
                      </div>
                      {schedulerMessage !== "idle" && (
                        <div style={{ fontSize:9, color:schedulerMessage.includes("failed")?C.red:schedulerStatusColor,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {schedulerMessage}
                        </div>
                      )}
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 94px auto", gap:8, alignItems:"end" }}>
                      <label style={{ display:"flex", flexDirection:"column", gap:4, minWidth:0 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>NAME</span>
                        <input type="text" value={monitorName}
                          onChange={e=>setMonitorName(e.target.value)}
                          style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                            color:C.text, padding:"6px 7px", fontSize:10, fontFamily:"inherit",
                            width:"100%", minWidth:0 }} />
                      </label>
                      <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em" }}>EVERY S</span>
                        <input type="number" min={MONITOR_INTERVAL_MIN_SECONDS} max={MONITOR_INTERVAL_MAX_SECONDS}
                          step={300} value={monitorIntervalSeconds}
                          onChange={e=>setMonitorIntervalSeconds(e.target.value)}
                          style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                            color:C.text, padding:"6px 7px", fontSize:10, fontFamily:"inherit",
                            width:"100%" }} />
                      </label>
                      <button onClick={createDiscoveryMonitor}
                        disabled={monitorCreating || discoveryHostList.length===0}
                        style={{ background:monitorCreating?`${C.muted}22`:`${C.green}16`,
                          border:`1px solid ${monitorCreating?C.border2:C.green}66`,
                          color:monitorCreating?C.muted:C.green, padding:"7px 10px",
                          borderRadius:5, cursor:monitorCreating || discoveryHostList.length===0?"not-allowed":"pointer",
                          fontSize:10, fontWeight:700, letterSpacing:"0.08em", fontFamily:"inherit",
                          whiteSpace:"nowrap" }}>
                        SAVE
                      </button>
                    </div>
                    {monitorStatus !== "idle" && (
                      <div style={{ fontSize:9, color:monitorStatus.startsWith("Monitor failed")?C.red:C.green,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {monitorStatus}
                      </div>
                    )}
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {monitorPolicies.slice(0,4).map(policy => {
                        const running = monitorRunningIds.has(policy.id);
                        const lastJob = policy.lastJob;
                        const isTlsMonitor = isTlsMonitorPolicy(policy);
                        const targetLabel = monitorPolicyTargetLabel(policy);
                        return (
                          <div key={policy.id} style={{ padding:"7px 8px", border:`1px solid ${C.border}`,
                            borderRadius:5, background:`${isTlsMonitor?C.purple:policy.enabled?C.green:C.muted}08` }}>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:6, alignItems:"center",
                              marginBottom:5 }}>
                              <span style={{ fontSize:10, color:C.text, fontWeight:700, overflow:"hidden",
                                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {policy.name}
                              </span>
                              <Pill label={isTlsMonitor?"TLS":"DISC"} color={isTlsMonitor?C.purple:C.accent} />
                              <Pill label={policy.enabled?"ENABLED":"DISABLED"} color={policy.enabled?C.green:C.muted} />
                              <button onClick={()=>runMonitorNow(policy)} disabled={running}
                                style={{ background:running?`${C.muted}22`:`${C.accent}14`,
                                  border:`1px solid ${running?C.border2:C.accent}55`,
                                  color:running?C.muted:C.accent, borderRadius:4, padding:"4px 7px",
                                  cursor:running?"not-allowed":"pointer", fontSize:9, fontWeight:700,
                                  letterSpacing:"0.06em", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                                RUN NOW
                              </button>
                            </div>
                            <div style={{ fontSize:9, color:isTlsMonitor?C.purple:C.muted, overflow:"hidden",
                              textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:5 }}>
                              TARGET {targetLabel}
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"auto auto auto", gap:8,
                              fontSize:9, color:C.muted, marginBottom:lastJob?5:0 }}>
                              <span>INT {formatInterval(policy.intervalSeconds)}</span>
                              <span>NEXT {formatTime(policy.nextRunAt)}</span>
                              <span>LAST {formatTime(policy.lastRunAt)}</span>
                            </div>
                            {lastJob && (
                              <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8, alignItems:"center",
                                fontSize:9, color:C.muted }}>
                                <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                  JOB {lastJob.id} {lastJob.target ? `· ${lastJob.target}` : ""}
                                </span>
                                <Pill label={lastJob.status} color={lastJob.status==="COMPLETED"?C.green:lastJob.status==="FAILED"?C.red:C.amber} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {monitorPolicies.length===0 && (
                        <div style={{ fontSize:10, color:C.muted }}>No monitor policies.</div>
                      )}
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                      <div style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em", fontWeight:700 }}>
                        RECENT RUNS
                      </div>
                      {monitorRuns.slice(0,5).map(run => {
                        const timestamp = latestRunTimestamp(run);
                        const policy = monitorPolicyById.get(run.policyId);
                        const isTlsRun = isTlsMonitorPolicy(policy);
                        const evidenceLabel = monitorRunEvidenceLabel(run, policy);
                        return (
                          <div key={run.id} style={{ padding:"6px 7px", border:`1px solid ${C.border}`,
                            borderRadius:5, background:`${isTlsRun?C.purple:runStatusColor(run.status)}07` }}>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto auto", gap:5,
                              alignItems:"center", marginBottom:4 }}>
                              <span style={{ fontSize:9, color:C.text, fontWeight:700, overflow:"hidden",
                                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {run.policyName}
                              </span>
                              <Pill label={isTlsRun?"TLS":"MON"} color={isTlsRun?C.purple:C.accent} />
                              <Pill label={run.trigger} color={run.trigger==="MANUAL"?C.accent:C.purple} />
                              <Pill label={run.status} color={runStatusColor(run.status)} />
                            </div>
                            {evidenceLabel && (
                              <div style={{ fontSize:9, color:isTlsRun?C.purple:C.muted, overflow:"hidden",
                                textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:4 }}>
                                {isTlsRun ? "TLS " : "TARGET "}{evidenceLabel}
                              </div>
                            )}
                            <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:6,
                              alignItems:"center", fontSize:9, color:C.muted }}>
                              <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                JOB {run.jobId || "--"} · OBS {run.observationsCount} · FIND {run.findingsCount} · EVD {run.evidenceCount ?? 0}
                              </span>
                              <span style={{ color:C.muted, whiteSpace:"nowrap" }}>{formatTimestamp(timestamp)}</span>
                            </div>
                          </div>
                        );
                      })}
                      {monitorRuns.length===0 && (
                        <div style={{ fontSize:10, color:C.muted }}>No monitor runs yet.</div>
                      )}
                    </div>
                  </div>
                  {probeStatus !== "idle" && (
                    <div style={{ fontSize:9, color:probeStatus.startsWith("Probe failed")?C.red:C.accent,
                      padding:"6px 8px", border:`1px solid ${C.border}`, borderRadius:4,
                      background:`${C.accent}06` }}>
                      {probeStatus}
                    </div>
                  )}
                  {probeJobs.slice(0,6).map(job=>{
                    const isDiscovery = isDiscoveryJob(job);
                    const isTls = !isDiscovery && isTlsProbeJob(job);
                    const observations = isDiscovery ? discoveryObservations(job.result).slice(0,4) : [];
                    const tls = isTls ? tlsEvidence(job) : null;
                    const tlsRows = tls ? [
                      ["PROTOCOL", tls.protocol],
                      ["CIPHER", tls.cipher],
                      ["PFS", tls.pfs],
                      ["CERT", tls.certificate],
                      ["SUBJECT", tls.subject],
                      ["ISSUER", tls.issuer],
                      ["FP256", tls.fingerprint],
                      ["CLASS", tls.classification],
                      ["PRIORITY", tls.priority],
                      ["Q-VULN", tls.quantumVulnerable],
                    ].filter(([, value]) => value) : [];
                    const tlsFindingRows = tls ? [
                      ...tls.findingRefs.map(ref => compactRefLabel(ref, "finding")),
                      ...tls.findings.map(finding => compactJsonValue(finding)),
                    ].filter(Boolean) : [];
                    const tlsEvidenceRows = tls ? tls.evidenceRefs.map(ref => compactRefLabel(ref, "evidence")).filter(Boolean) : [];
                    return (
                      <div key={job.id} style={{ padding:"8px 10px", background:`${isDiscovery?C.purple:C.accent}08`,
                        border:`1px solid ${C.border}`, borderRadius:5 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:4 }}>
                          <span style={{ fontSize:10, color:C.text, fontWeight:700 }}>{job.name}</span>
                          <Pill label={job.status} color={job.status==="COMPLETED"?C.green:job.status==="FAILED"?C.red:C.amber} />
                        </div>
                        <div style={{ fontSize:9, color:C.muted, marginBottom:6,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {isDiscovery ? discoverySummary(job) : probeTargetLabel(job)}
                        </div>
                        <MiniBar pct={job.progress} color={job.status==="FAILED"?C.red:(isDiscovery?C.purple:C.accent)} />
                        {isTls && (
                          <details style={{ marginTop:7, padding:"7px 8px", border:`1px solid ${C.border}`,
                            borderRadius:4, background:`${C.bg}55` }}>
                            <summary style={{ cursor:"pointer", listStyle:"none" }}>
                              <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8,
                                alignItems:"center", fontSize:9, color:C.muted }}>
                                <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                  <span style={{ color:C.text }}>{tls.protocol || "TLS PROBE"}</span>
                                  {tls.certificate ? ` · ${tls.certificate}` : ""}
                                  {!tls.certificate && job.result?.summary ? ` · ${job.result.summary}` : ""}
                                </span>
                                <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                                  {tls.classification && <Pill label={tls.classification} color={clsColor(tls.classification)} />}
                                  <span style={{ fontSize:8, color:C.accent, fontWeight:700 }}>DETAILS</span>
                                </span>
                              </div>
                            </summary>
                            <div style={{ marginTop:7, display:"flex", flexDirection:"column", gap:6,
                              fontSize:8, color:C.muted, lineHeight:1.45 }}>
                              {tlsRows.length>0 && (
                                <div style={{ display:"grid", gridTemplateColumns:"68px 1fr", columnGap:8, rowGap:3 }}>
                                  {tlsRows.map(([label, value]) => (
                                    <div key={label} style={{ display:"contents" }}>
                                      <span style={{ color:C.muted, fontWeight:700 }}>{label}</span>
                                      <span style={{ color:C.text, wordBreak:"break-word" }}>{value}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {tls.notes.length>0 && (
                                <div style={{ color:C.muted, wordBreak:"break-word" }}>
                                  <span style={{ fontWeight:700 }}>NOTES </span>{tls.notes.join("; ")}
                                </div>
                              )}
                              {(tlsFindingRows.length>0 || job.findingsCount>0) && (
                                <div style={{ color:C.muted, wordBreak:"break-word" }}>
                                  <span style={{ fontWeight:700 }}>FINDINGS </span>
                                  {tlsFindingRows.length ? tlsFindingRows.join("; ") : `${job.findingsCount} linked by probe result`}
                                </div>
                              )}
                              <div style={{ color:C.muted, wordBreak:"break-word" }}>
                                <span style={{ fontWeight:700 }}>EVIDENCE </span>
                                {tlsEvidenceRows.length ? tlsEvidenceRows.join("; ") : `probe-job · ${job.id}`}
                              </div>
                            </div>
                          </details>
                        )}
                        {observations.length>0 && (
                          <div style={{ marginTop:7, display:"flex", flexDirection:"column", gap:4 }}>
                            {observations.map((observation,index)=> {
                              const host = observationValue(observation, ["host", "hostname", "ip", "target"], `target-${index+1}`);
                              const status = observationValue(observation, ["status", "state", "result"], "OBSERVED").toUpperCase();
                              const detail = observationDetail(observation);
                              return (
                                <div key={`${host}-${index}`} style={{ display:"grid", gridTemplateColumns:"1fr auto",
                                  gap:8, alignItems:"center", fontSize:9, color:C.muted }}>
                                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                    <span style={{ color:C.text }}>{host}</span>{detail ? ` · ${detail}` : ""}
                                  </span>
                                  <Pill label={status} color={/FAIL|ERR|TIMEOUT|CLOSED/i.test(status)?C.red:C.green} />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {probeJobs.length===0 && (
                    <div style={{ fontSize:10, color:C.muted }}>No probe jobs have been created yet.</div>
                  )}
                </div>
              </Panel>
            </div>
          </div>
        )}

        {/* ─── INVENTORY TAB ─── */}
        {tab==="inventory" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {/* Filters */}
            <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
              <span style={{ fontSize:10, color:C.muted }}>FILTER:</span>
              {classes.map(c=>(
                <button key={c} onClick={()=>setFilterCls(c)} style={{
                  background:filterCls===c?`${clsColor(c)}22`:"transparent",
                  border:`1px solid ${filterCls===c?clsColor(c):C.border}`,
                  color:filterCls===c?clsColor(c):C.muted,
                  padding:"4px 10px", borderRadius:4, cursor:"pointer",
                  fontSize:10, fontWeight:700, fontFamily:"inherit" }}>
                  {c}
                </button>
              ))}
              <span style={{ marginLeft:12, fontSize:10, color:C.muted }}>SEGMENT:</span>
              <select value={filterSeg} onChange={e=>setFilterSeg(e.target.value)}
                style={{ background:C.panel, border:`1px solid ${C.border}`, color:C.text,
                  padding:"4px 8px", borderRadius:4, fontSize:10, fontFamily:"inherit" }}>
                {segments.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{ marginLeft:"auto", fontSize:10, color:C.muted }}>
                {displayedAssets.length} of {ASSETS.length} assets
              </span>
            </div>
            {probeStatus !== "idle" && (
              <div style={{ padding:"8px 12px", background:`${C.accent}0a`, border:`1px solid ${C.accent}33`,
                borderRadius:5, fontSize:10, color:C.accent }}>
                {probeStatus}
              </div>
            )}

            {/* Table */}
            <div style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:8, overflow:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                <thead>
                  <tr style={{ borderBottom:`1px solid ${C.border2}` }}>
                    {[["hostname","Asset",null],["algo","Algorithm",null],["proto","Protocol",null],
                      ["cls","Classification",null],["hndl","HNDL",null],["tnfl","TNFL",null],
                      ["risk","Risk",null],["prio","Priority",null]].map(([col,lbl])=>(
                      <th key={col} onClick={()=>thClick(col)}
                        style={{ padding:"10px 14px", textAlign:"left", fontSize:9, fontWeight:700,
                          letterSpacing:"0.1em", color:sortCol===col?C.accent:C.muted,
                          cursor:"pointer", userSelect:"none", textTransform:"uppercase",
                          whiteSpace:"nowrap" }}>
                        {lbl} {sortCol===col?(sortAsc?"↑":"↓"):""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayedAssets.map(a=>(
                    <tr key={a.id}
                      onClick={()=>setSelAsset(selAsset?.id===a.id?null:a)}
                      style={{ borderBottom:`1px solid ${C.border}`,
                        background:selAsset?.id===a.id?`${C.accent}08`:"transparent",
                        cursor:"pointer", transition:"background 0.15s" }}
                      onMouseEnter={e=>{ if(selAsset?.id!==a.id) e.currentTarget.style.background=`${C.accent}05` }}
                      onMouseLeave={e=>{ if(selAsset?.id!==a.id) e.currentTarget.style.background="transparent" }}>
                      <td style={{ padding:"9px 14px" }}>
                        <div style={{ fontWeight:700 }}>{a.hostname}</div>
                        <div style={{ fontSize:9, color:C.muted }}>{a.ip} · {a.segment} · {a.type}</div>
                      </td>
                      <td style={{ padding:"9px 14px", color:clsColor(a.cls), fontWeight:700 }}>{a.algo}</td>
                      <td style={{ padding:"9px 14px", color:C.muted }}>{a.proto}</td>
                      <td style={{ padding:"9px 14px" }}><Pill label={a.cls} color={clsColor(a.cls)} /></td>
                      <td style={{ padding:"9px 14px" }}><ScoreBadge score={a.hndl} color={C.hndl} /></td>
                      <td style={{ padding:"9px 14px" }}><ScoreBadge score={a.tnfl} color={C.tnfl} /></td>
                      <td style={{ padding:"9px 14px" }}><ScoreBadge score={a.risk} color={C.red} /></td>
                      <td style={{ padding:"9px 14px" }}><Pill label={a.prio} color={prioColor(a.prio)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Asset detail drawer */}
            {selAsset && (
              <div style={{ background:C.panel, border:`1px solid ${C.accent}44`,
                borderRadius:8, padding:20, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:4 }}>ASSET DETAIL</div>
                  <div style={{ fontSize:14, fontWeight:900, color:C.accent, marginBottom:8 }}>{selAsset.hostname}</div>
                  {[["IP",selAsset.ip],["Type",selAsset.type],["Segment",selAsset.segment],
                    ["Algorithm",selAsset.algo],["Protocol",selAsset.proto],
                    ["PFS",selAsset.pfs?"Yes":"No"],["Cert Expiry",selAsset.cert_exp]].map(([l,v])=>(
                    <div key={l} style={{ display:"flex", justifyContent:"space-between",
                      padding:"4px 0", borderBottom:`1px solid ${C.border}`, fontSize:10 }}>
                      <span style={{ color:C.muted }}>{l}</span>
                      <span style={{ color:C.text, fontWeight:700 }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:12 }}>RISK SCORES</div>
                  <div style={{ display:"flex", gap:12, marginBottom:16 }}>
                    <RiskGauge score={selAsset.hndl} label="HNDL" />
                    <RiskGauge score={selAsset.tnfl} label="TNFL" />
                  </div>
                  <Pill label={selAsset.cls} color={clsColor(selAsset.cls)} />
                  <div style={{ marginTop:8 }}><Pill label={selAsset.prio} color={prioColor(selAsset.prio)} /></div>
                  <button onClick={()=>runAssetProbe(selAsset)}
                    style={{ marginTop:14, background:`${C.accent}18`, border:`1px solid ${C.accent}66`,
                      color:C.accent, padding:"8px 12px", borderRadius:5, cursor:"pointer",
                      fontSize:10, fontWeight:700, letterSpacing:"0.08em", fontFamily:"inherit" }}>
                    RUN ACTIVE PROBE
                  </button>
                </div>
                <div>
                  <div style={{ fontSize:10, color:C.muted, marginBottom:8 }}>REMEDIATION GUIDANCE</div>
                  <div style={{ padding:"10px 12px", background:`${C.green}11`,
                    border:`1px solid ${C.green}33`, borderRadius:6, marginBottom:8 }}>
                    <div style={{ fontSize:9, color:C.green, fontWeight:700, marginBottom:4 }}>RECOMMENDED MIGRATION</div>
                    <div style={{ fontSize:11, color:C.text }}>{selAsset.migration}</div>
                  </div>
                  <div style={{ padding:"10px 12px", background:`${C.amber}11`,
                    border:`1px solid ${C.amber}33`, borderRadius:6 }}>
                    <div style={{ fontSize:9, color:C.amber, fontWeight:700, marginBottom:4 }}>COMPLEXITY</div>
                    <div style={{ fontSize:11, color:C.text }}>{selAsset.complexity}</div>
                  </div>
                  {selectedAssetFindings.length > 0 && (
                    <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:6 }}>
                      <div style={{ fontSize:10, color:C.muted }}>RELATED FINDINGS</div>
                      {selectedAssetFindings.slice(0,4).map(finding => (
                        <div key={finding.id} style={{ padding:"7px 8px", border:`1px solid ${findingStatusColor(finding.status)}33`,
                          borderRadius:5, background:`${findingStatusColor(finding.status)}08` }}>
                          <div style={{ display:"grid", gridTemplateColumns:"auto auto 1fr", gap:5, alignItems:"center",
                            marginBottom:4 }}>
                            <Pill label={finding.severity} color={sevColor(finding.severity)} />
                            <Pill label={finding.status} color={findingStatusColor(finding.status)} />
                            <span style={{ fontSize:9, color:dueColor(finding), textAlign:"right", whiteSpace:"nowrap" }}>
                              {formatTimestamp(finding.dueAt)}
                            </span>
                          </div>
                          <div style={{ fontSize:10, color:C.text, fontWeight:700, overflow:"hidden",
                            textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {finding.title}
                          </div>
                          <div style={{ fontSize:9, color:C.muted, overflow:"hidden", textOverflow:"ellipsis",
                            whiteSpace:"nowrap", marginTop:3 }}>
                            {finding.remediationTarget || "target pending"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── THREATS & ALERTS TAB ─── */}
        {tab==="threats" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            <Panel title="Remediation Console" badge={`${displayedFindings.length}/${findings.length} FINDINGS`} style={{ gridColumn:"1/3" }}>
              <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5, minmax(0, 1fr))", gap:8 }}>
                  {[
                    ["OPEN CRIT", remediationSummary.openCritical, C.red],
                    ["OVERDUE", remediationSummary.overdue, remediationSummary.overdue ? C.red : C.muted],
                    ["DUE SOON", remediationSummary.dueSoon, remediationSummary.dueSoon ? C.amber : C.muted],
                    ["IN PROG", remediationSummary.inProgress, remediationSummary.inProgress ? C.accent : C.muted],
                    ["CLOSED", remediationSummary.remediatedClosed, remediationSummary.remediatedClosed ? C.green : C.muted],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ minWidth:0, padding:"8px 9px", border:`1px solid ${color}33`,
                      borderRadius:5, background:`${color}09` }}>
                      <div style={{ fontSize:18, color, fontWeight:900, lineHeight:1 }}>{value}</div>
                      <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:5 }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"120px 120px 160px 1fr", gap:8, alignItems:"center" }}>
                  <select value={findingStatusFilter} onChange={e=>setFindingStatusFilter(e.target.value)}
                    style={{ background:C.bg, border:`1px solid ${C.border2}`, color:C.text,
                      padding:"6px 8px", borderRadius:4, fontSize:10, fontFamily:"inherit" }}>
                    {findingStatuses.map(status => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <select value={findingSeverityFilter} onChange={e=>setFindingSeverityFilter(e.target.value)}
                    style={{ background:C.bg, border:`1px solid ${C.border2}`, color:C.text,
                      padding:"6px 8px", borderRadius:4, fontSize:10, fontFamily:"inherit" }}>
                    {findingSeverities.map(severity => <option key={severity} value={severity}>{severity}</option>)}
                  </select>
                  <select value={findingOwnerFilter} onChange={e=>setFindingOwnerFilter(e.target.value)}
                    style={{ background:C.bg, border:`1px solid ${C.border2}`, color:C.text,
                      padding:"6px 8px", borderRadius:4, fontSize:10, fontFamily:"inherit" }}>
                    {findingOwners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
                  </select>
                  {findingMessage !== "idle" && (
                    <span style={{ fontSize:9, color:findingMessage.includes("failed")?C.red:C.accent,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {findingMessage}
                    </span>
                  )}
                </div>

                <div style={{ border:`1px solid ${C.border}`, borderRadius:6, overflow:"hidden" }}>
                  <div style={{ display:"grid", gridTemplateColumns:"82px 108px 110px 104px 1.2fr 1fr",
                    gap:0, borderBottom:`1px solid ${C.border2}`, background:`${C.bg}88` }}>
                    {["SEV", "STATUS", "OWNER", "DUE", "FINDING", "TARGET"].map(label => (
                      <div key={label} style={{ padding:"8px 10px", fontSize:8, color:C.muted,
                        letterSpacing:"0.1em", fontWeight:700 }}>
                        {label}
                      </div>
                    ))}
                  </div>
                  <div style={{ maxHeight:430, overflowY:"auto" }}>
                    {displayedFindings.slice(0,12).map(finding => {
                      const busy = findingBusyIds.has(finding.id);
                      const ownerDraft = findingOwnerDrafts[finding.id] ?? finding.owner;
                      const noteDraft = findingNoteDrafts[finding.id] ?? "";
                      const recurrence = findingRecurrenceSummary(finding);
                      return (
                        <div key={finding.id} style={{ borderBottom:`1px solid ${C.border}`, background:`${findingStatusColor(finding.status)}05` }}>
                          <div style={{ display:"grid", gridTemplateColumns:"82px 108px 110px 104px 1.2fr 1fr",
                            gap:0, alignItems:"center" }}>
                            <div style={{ padding:"8px 10px" }}><Pill label={finding.severity} color={sevColor(finding.severity)} /></div>
                            <div style={{ padding:"8px 10px" }}><Pill label={finding.status} color={findingStatusColor(finding.status)} /></div>
                            <div style={{ padding:"8px 10px", fontSize:10, color:C.text, overflow:"hidden",
                              textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {finding.owner}
                            </div>
                            <div style={{ padding:"8px 10px", fontSize:10, color:dueColor(finding),
                              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {formatTimestamp(finding.dueAt)}
                            </div>
                            <div style={{ padding:"8px 10px", minWidth:0 }}>
                              <div style={{ fontSize:11, color:C.text, fontWeight:700, overflow:"hidden",
                                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {finding.title}
                              </div>
                              <div style={{ fontSize:9, color:C.muted, overflow:"hidden", textOverflow:"ellipsis",
                                whiteSpace:"nowrap", marginTop:2 }}>
                                {finding.assetName} · {finding.type}
                              </div>
                              {recurrence.hasDetails && (
                                <div style={{ display:"flex", gap:5, alignItems:"center", flexWrap:"wrap",
                                  overflow:"hidden", marginTop:4 }}>
                                  {recurrence.count !== null && (
                                    <span style={{ fontSize:8, color:C.purple, background:`${C.purple}14`,
                                      border:`1px solid ${C.purple}33`, borderRadius:10, padding:"1px 6px",
                                      fontWeight:700, whiteSpace:"nowrap" }}>
                                      REC x{recurrence.count}
                                    </span>
                                  )}
                                  {recurrence.firstObservedAt && (
                                    <span style={{ fontSize:8, color:C.muted, whiteSpace:"nowrap" }}>
                                      FIRST {formatTimestamp(recurrence.firstObservedAt)}
                                    </span>
                                  )}
                                  {recurrence.lastObservedAt && (
                                    <span style={{ fontSize:8, color:C.muted, whiteSpace:"nowrap" }}>
                                      LAST {formatTimestamp(recurrence.lastObservedAt)}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div style={{ padding:"8px 10px", minWidth:0 }}>
                              <div style={{ fontSize:10, color:C.muted, overflow:"hidden",
                                textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {finding.remediationTarget || "target pending"}
                              </div>
                              {(recurrence.host || recurrence.fingerprint) && (
                                <div style={{ fontSize:8, color:C.muted, overflow:"hidden",
                                  textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:4 }}>
                                  {[
                                    recurrence.host ? `HOST ${recurrence.host}` : "",
                                    recurrence.fingerprint ? `FP ${recurrence.fingerprint}` : "",
                                  ].filter(Boolean).join(" · ")}
                                </div>
                              )}
                            </div>
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"auto auto auto auto 130px auto 1fr auto",
                            gap:6, alignItems:"center", padding:"0 10px 8px" }}>
                            {[
                              ["TRIAGE", { status: "TRIAGED" }, C.accent],
                              ["START", { status: "IN_PROGRESS" }, C.amber],
                              ["REMED", { status: "REMEDIATED", closedAt: new Date().toISOString() }, C.green],
                              ["RISK", { status: "ACCEPTED_RISK", closedAt: new Date().toISOString(), resolution: "Risk accepted" }, C.purple],
                            ].map(([label, updates, color]) => (
                              <button key={label} onClick={()=>applyFindingUpdate(finding, updates, label)}
                                disabled={busy}
                                style={{ background:busy?`${C.muted}16`:`${color}12`,
                                  border:`1px solid ${busy?C.border2:color}55`, color:busy?C.muted:color,
                                  borderRadius:4, padding:"5px 7px", cursor:busy?"not-allowed":"pointer",
                                  fontSize:9, fontWeight:700, letterSpacing:"0.04em", fontFamily:"inherit" }}>
                                {label}
                              </button>
                            ))}
                            <input type="text" value={ownerDraft}
                              onChange={e=>setFindingOwnerDrafts(previous => ({ ...previous, [finding.id]: e.target.value }))}
                              style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                                color:C.text, padding:"5px 7px", fontSize:9, fontFamily:"inherit", minWidth:0 }} />
                            <button onClick={()=>assignFindingOwner(finding)} disabled={busy || !String(ownerDraft || "").trim()}
                              style={{ background:busy?`${C.muted}16`:`${C.accent}12`,
                                border:`1px solid ${busy?C.border2:C.accent}55`, color:busy?C.muted:C.accent,
                                borderRadius:4, padding:"5px 7px", cursor:busy?"not-allowed":"pointer",
                                fontSize:9, fontWeight:700, letterSpacing:"0.04em", fontFamily:"inherit" }}>
                              ASSIGN
                            </button>
                            <input type="text" value={noteDraft}
                              onChange={e=>setFindingNoteDrafts(previous => ({ ...previous, [finding.id]: e.target.value }))}
                              placeholder="note"
                              style={{ background:C.bg, border:`1px solid ${C.border2}`, borderRadius:4,
                                color:C.text, padding:"5px 7px", fontSize:9, fontFamily:"inherit", minWidth:0 }} />
                            <button onClick={()=>addFindingNote(finding)} disabled={busy || !String(noteDraft || "").trim()}
                              style={{ background:busy?`${C.muted}16`:`${C.green}12`,
                                border:`1px solid ${busy?C.border2:C.green}55`, color:busy?C.muted:C.green,
                                borderRadius:4, padding:"5px 7px", cursor:busy?"not-allowed":"pointer",
                                fontSize:9, fontWeight:700, letterSpacing:"0.04em", fontFamily:"inherit" }}>
                              NOTE
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {displayedFindings.length === 0 && (
                      <div style={{ padding:"12px 14px", fontSize:10, color:C.muted }}>No findings match current filters.</div>
                    )}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Live Alert Feed" badge="REAL-TIME" style={{ gridRow:"2/5" }}>
              <div>
                {ALERTS.map(a=>(
                  <div key={a.id} style={{ padding:"12px 16px", borderBottom:`1px solid ${C.border}`,
                    background: a.id===newAlertId?`${C.accent}08`:"transparent",
                    transition:"background 0.8s" }}>
                    <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:6 }}>
                      <Pill label={a.sev} color={sevColor(a.sev)} />
                      <Pill label={a.type} color={typeColor(a.type)} />
                      <span style={{ marginLeft:"auto", fontSize:9, color:C.muted }}>{a.ts}</span>
                    </div>
                    <div style={{ fontSize:11, color:C.text, lineHeight:1.6, marginBottom:4 }}>{a.msg}</div>
                    <div style={{ fontSize:10, color:C.accent }}>→ {a.asset}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Behavioral Drift Detection" badge={drift.driftDetected ? `${drift.count} DRIFT` : "STABLE"}>
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
                  Drift is computed from CBOM history: algorithm regressions, PFS loss, protocol downgrades, and PQC fallback.
                </div>
                {drift.assets?.slice(0,5).map(item=>(
                  <div key={item.asset.id} style={{ padding:"8px 10px", border:`1px solid ${C.purple}33`,
                    borderRadius:5, background:`${C.purple}0a` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:5 }}>
                      <span style={{ fontSize:10, color:C.text, fontWeight:700 }}>{item.asset.hostname}</span>
                      <Pill label={`${item.events.length} EVENTS`} color={C.purple} />
                    </div>
                    {item.events.slice(0,3).map((event,index)=>(
                      <div key={`${event.type}-${index}`} style={{ fontSize:9, color:C.muted, lineHeight:1.5 }}>
                        <span style={{ color:sevColor(event.severity), fontWeight:700 }}>{event.type}</span>
                        {" "}· {event.title}
                      </div>
                    ))}
                  </div>
                ))}
                {!drift.driftDetected && (
                  <div style={{ fontSize:10, color:C.green }}>No cryptographic drift detected in current asset history.</div>
                )}
              </div>
            </Panel>

            <Panel title="HNDL Exposure Map">
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ fontSize:10, color:C.muted, lineHeight:1.6, marginBottom:4 }}>
                  Assets ranked by attractiveness as harvest targets. Adversaries prioritise high-value, high-volume encrypted flows.
                </div>
                {[...ASSETS].sort((a,b)=>b.hndl-a.hndl).slice(0,7).map((a,i)=>(
                  <div key={a.id} style={{ display:"flex", alignItems:"center", gap:10,
                    padding:"6px 10px", borderRadius:4,
                    background: i===0?`${C.hndl}11`:"transparent",
                    border:`1px solid ${i===0?C.hndl:C.border}` }}>
                    <span style={{ fontSize:10, color:C.muted, width:16, textAlign:"right" }}>#{i+1}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:700, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.hostname}</div>
                      <div style={{ fontSize:9, color:C.muted }}>{a.algo} · {a.segment}</div>
                    </div>
                    <div style={{ width:60 }}><MiniBar pct={a.hndl} color={C.hndl} /></div>
                    <ScoreBadge score={a.hndl} color={C.hndl} />
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="TNFL Trust Forge Risk">
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
                <div style={{ fontSize:10, color:C.muted, lineHeight:1.6, marginBottom:4 }}>
                  Assets ranked by risk of future signature forgery. CA servers and code signing infrastructure represent systemic trust chain risk.
                </div>
                {[...ASSETS].sort((a,b)=>b.tnfl-a.tnfl).slice(0,7).map((a,i)=>(
                  <div key={a.id} style={{ display:"flex", alignItems:"center", gap:10,
                    padding:"6px 10px", borderRadius:4,
                    background: i===0?`${C.tnfl}11`:"transparent",
                    border:`1px solid ${i===0?C.tnfl:C.border}` }}>
                    <span style={{ fontSize:10, color:C.muted, width:16, textAlign:"right" }}>#{i+1}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, fontWeight:700, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{a.hostname}</div>
                      <div style={{ fontSize:9, color:C.muted }}>{a.type} · {a.algo}</div>
                    </div>
                    <div style={{ width:60 }}><MiniBar pct={a.tnfl} color={C.tnfl} /></div>
                    <ScoreBadge score={a.tnfl} color={C.tnfl} />
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {/* ─── RISK WORKBENCH TAB ─── */}
        {tab==="risk" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
            <Panel title="Risk Scope & Recompute" badge={riskRecomputeBusy ? "RUNNING" : "READY"} style={{ gridColumn:"1/2" }}>
              <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:12 }}>
                <label style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  <span style={{ fontSize:9, color:C.muted, letterSpacing:"0.08em", fontWeight:700 }}>ASSET SCOPE</span>
                  <select value={riskScopedAssetId} onChange={e=>selectRiskAssetId(e.target.value)}
                    style={{ background:C.bg, border:`1px solid ${C.border2}`, color:C.text,
                      padding:"8px 9px", borderRadius:5, fontSize:11, fontFamily:"inherit" }}>
                    {ASSETS.map(asset => (
                      <option key={asset.id} value={String(asset.id)}>
                        {asset.hostname} · {asset.segment} · {asset.algo}
                      </option>
                    ))}
                  </select>
                </label>

                {riskScopedAsset && (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    {[
                      ["CLASS", riskScopedAsset.cls, clsColor(riskScopedAsset.cls)],
                      ["PRIORITY", riskScopedAsset.prio, prioColor(riskScopedAsset.prio)],
                      ["SEGMENT", riskScopedAsset.segment, C.accent],
                      ["FINDINGS", riskRelatedFindings.length, riskRelatedFindings.length ? C.red : C.muted],
                    ].map(([label, value, color]) => (
                      <div key={label} style={{ padding:"8px 9px", border:`1px solid ${color}33`,
                        borderRadius:5, background:`${color}08`, minWidth:0 }}>
                        <div style={{ fontSize:12, color, fontWeight:900, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {value}
                        </div>
                        <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                )}

                <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:10, color:C.muted }}>
                  <input type="checkbox" checked={riskPersistFindings}
                    onChange={e=>setRiskPersistFindings(e.target.checked)}
                    style={{ accentColor:C.accent }} />
                  Persist generated findings
                </label>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <button onClick={()=>refreshRiskAnalysis()} disabled={riskBusy || !riskScopedAsset}
                    style={{ background:riskBusy?`${C.muted}18`:`${C.accent}14`,
                      border:`1px solid ${riskBusy?C.border2:C.accent}55`,
                      color:riskBusy?C.muted:C.accent, borderRadius:5, padding:"8px 10px",
                      cursor:riskBusy || !riskScopedAsset?"not-allowed":"pointer",
                      fontSize:10, fontWeight:800, letterSpacing:"0.06em", fontFamily:"inherit" }}>
                    {riskBusy ? "LOADING" : "LOAD RISK"}
                  </button>
                  <button onClick={()=>runRiskRecompute("asset")} disabled={riskRecomputeBusy || !riskScopedAsset}
                    style={{ background:riskRecomputeBusy?`${C.muted}18`:`${C.red}12`,
                      border:`1px solid ${riskRecomputeBusy?C.border2:C.red}55`,
                      color:riskRecomputeBusy?C.muted:C.red, borderRadius:5, padding:"8px 10px",
                      cursor:riskRecomputeBusy || !riskScopedAsset?"not-allowed":"pointer",
                      fontSize:10, fontWeight:800, letterSpacing:"0.06em", fontFamily:"inherit" }}>
                    ASSET RECOMPUTE
                  </button>
                </div>
                <button onClick={()=>runRiskRecompute("portfolio")} disabled={riskRecomputeBusy}
                  style={{ background:riskRecomputeBusy?`${C.muted}18`:`${C.purple}12`,
                    border:`1px solid ${riskRecomputeBusy?C.border2:C.purple}55`,
                    color:riskRecomputeBusy?C.muted:C.purple, borderRadius:5, padding:"8px 10px",
                    cursor:riskRecomputeBusy?"not-allowed":"pointer",
                    fontSize:10, fontWeight:800, letterSpacing:"0.06em", fontFamily:"inherit" }}>
                  PORTFOLIO RECOMPUTE
                </button>

                <div style={{ padding:"8px 9px", border:`1px solid ${riskStatus.includes("failed")?C.red:C.border}`,
                  borderRadius:5, background:`${C.bg}66`, fontSize:10,
                  color:riskStatus.includes("failed")?C.red:riskStatus.includes("Fallback")?C.amber:C.accent,
                  lineHeight:1.5 }}>
                  {riskStatus}
                </div>
              </div>
            </Panel>

            <Panel title="Asset Risk Analysis" badge={assetRisk?.source === "fallback" ? "FALLBACK" : "API"} style={{ gridColumn:"2/4" }}>
              <div style={{ padding:"14px 16px", display:"grid", gridTemplateColumns:"auto 1fr", gap:16, alignItems:"center" }}>
                <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
                  <RiskGauge score={assetRisk?.scores?.risk ?? riskScopedAsset?.risk ?? 0} label="Risk" />
                  <RiskGauge score={assetRisk?.scores?.hndl ?? riskScopedAsset?.hndl ?? 0} label="HNDL" />
                  <RiskGauge score={assetRisk?.scores?.tnfl ?? riskScopedAsset?.tnfl ?? 0} label="TNFL" />
                </div>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:16, fontWeight:900, color:C.accent, marginBottom:6,
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {assetRisk?.asset?.hostname ?? riskScopedAsset?.hostname ?? "No asset selected"}
                  </div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
                    <Pill label={assetRisk?.classification?.label ?? riskScopedAsset?.cls ?? "UNKNOWN"} color={clsColor(assetRisk?.classification?.label ?? riskScopedAsset?.cls)} />
                    <Pill label={assetRisk?.priority ?? riskScopedAsset?.prio ?? "MONITOR"} color={prioColor(assetRisk?.priority ?? riskScopedAsset?.prio)} />
                    <Pill label={riskScopedAsset?.segment ?? "UNSCOPED"} color={C.accent} />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                    {[
                      ["ALGORITHM", assetRisk?.evidence?.algorithm ?? riskScopedAsset?.algo],
                      ["PROTOCOL", assetRisk?.evidence?.protocol ?? riskScopedAsset?.proto],
                      ["PFS", (assetRisk?.evidence?.perfectForwardSecrecy ?? riskScopedAsset?.pfs) ? "YES" : "NO"],
                    ].map(([label, value]) => (
                      <div key={label} style={{ padding:"8px 9px", border:`1px solid ${C.border}`,
                        borderRadius:5, background:`${C.bg}66`, minWidth:0 }}>
                        <div style={{ fontSize:11, color:C.text, fontWeight:800, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {value ?? "--"}
                        </div>
                        <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Risk Drivers" badge={`${riskDrivers.length} DRIVERS`}>
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
                {riskDrivers.slice(0,8).map(driver => {
                  const score = Number(driver.score ?? driver.weight) || 0;
                  const color = driver.kind === "hndl" ? C.hndl : driver.kind === "tnfl" ? C.tnfl : riskScoreColor(score);
                  return (
                    <div key={driver.id} style={{ padding:"8px 10px", border:`1px solid ${color}33`,
                      borderRadius:5, background:`${color}08` }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8, alignItems:"center", marginBottom:6 }}>
                        <span style={{ fontSize:10, color:C.text, fontWeight:700, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {driver.label}
                        </span>
                        <Pill label={String(driver.kind || "risk").toUpperCase()} color={color} />
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8, alignItems:"center" }}>
                        <MiniBar pct={Math.min(100, Math.max(0, score))} color={color} />
                        <span style={{ fontSize:10, color, fontWeight:900 }}>{score}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Migration Guidance">
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ padding:"10px 12px", background:`${C.green}11`,
                  border:`1px solid ${C.green}33`, borderRadius:6 }}>
                  <div style={{ fontSize:9, color:C.green, fontWeight:700, marginBottom:5 }}>TARGET</div>
                  <div style={{ fontSize:12, color:C.text, fontWeight:800 }}>
                    {assetRisk?.remediation?.target ?? riskScopedAsset?.migration ?? "Collect migration evidence"}
                  </div>
                </div>
                <div style={{ padding:"10px 12px", background:`${C.amber}11`,
                  border:`1px solid ${C.amber}33`, borderRadius:6 }}>
                  <div style={{ fontSize:9, color:C.amber, fontWeight:700, marginBottom:5 }}>ACTION</div>
                  <div style={{ fontSize:11, color:C.text, lineHeight:1.5 }}>
                    {assetRisk?.remediation?.action ?? "Migrate cryptographic control"}
                  </div>
                </div>
                <div style={{ fontSize:10, color:C.muted, lineHeight:1.6 }}>
                  {assetRisk?.remediation?.detail || "Run asset risk analysis for backend migration guidance and evidence details."}
                </div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <Pill label={`COMPLEXITY ${assetRisk?.remediation?.complexity ?? riskScopedAsset?.complexity ?? "UNKNOWN"}`} color={C.amber} />
                  <button onClick={()=>setTab("inventory")}
                    style={{ background:`${C.accent}12`, border:`1px solid ${C.accent}55`,
                      color:C.accent, borderRadius:4, padding:"5px 8px", cursor:"pointer",
                      fontSize:9, fontWeight:700, letterSpacing:"0.05em", fontFamily:"inherit" }}>
                    INVENTORY
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="Drift, Findings & Reports" badge={`${riskRelatedFindings.length} FINDINGS`}>
              <div style={{ padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ padding:"9px 10px", border:`1px solid ${(riskDriftEvents.length || assetRisk?.drift?.driftDetected)?C.purple:C.border}`,
                  borderRadius:5, background:`${(riskDriftEvents.length || assetRisk?.drift?.driftDetected)?C.purple:C.muted}08` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:8, marginBottom:6 }}>
                    <span style={{ fontSize:10, color:C.text, fontWeight:800 }}>Behavioral Drift</span>
                    <Pill label={riskDriftEvents.length ? `${riskDriftEvents.length} EVENTS` : "STABLE"} color={riskDriftEvents.length ? C.purple : C.green} />
                  </div>
                  {riskDriftEvents.slice(0,3).map((event, index) => (
                    <div key={`${event.type}-${index}`} style={{ fontSize:9, color:C.muted, lineHeight:1.5 }}>
                      <span style={{ color:sevColor(event.severity), fontWeight:700 }}>{event.type}</span>
                      {" "}· {event.title ?? event.summary ?? event.description ?? "drift event"}
                    </div>
                  ))}
                  {riskDriftEvents.length === 0 && (
                    <div style={{ fontSize:9, color:C.muted }}>No scoped drift events detected.</div>
                  )}
                </div>

                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {(assetRisk?.findings?.length ? assetRisk.findings : riskRelatedFindings).slice(0,4).map(finding => (
                    <div key={finding.id} style={{ padding:"8px 9px", border:`1px solid ${sevColor(finding.severity)}33`,
                      borderRadius:5, background:`${sevColor(finding.severity)}08` }}>
                      <div style={{ display:"flex", gap:6, alignItems:"center", marginBottom:4 }}>
                        <Pill label={finding.severity ?? "INFO"} color={sevColor(finding.severity)} />
                        <Pill label={finding.status ?? "OPEN"} color={findingStatusColor(finding.status)} />
                      </div>
                      <div style={{ fontSize:10, color:C.text, fontWeight:700, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {finding.title}
                      </div>
                    </div>
                  ))}
                  {!assetRisk?.findings?.length && riskRelatedFindings.length === 0 && (
                    <div style={{ fontSize:10, color:C.muted }}>No scoped findings loaded.</div>
                  )}
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  <button onClick={()=>{ setFindingStatusFilter("ALL"); setTab("threats"); }}
                    style={{ background:`${C.red}12`, border:`1px solid ${C.red}55`,
                      color:C.red, borderRadius:5, padding:"8px 10px", cursor:"pointer",
                      fontSize:10, fontWeight:800, letterSpacing:"0.06em", fontFamily:"inherit" }}>
                    REMEDIATION
                  </button>
                  <button onClick={()=>{ selectReportType("remediation"); setTab("reports"); }}
                    style={{ background:`${C.green}12`, border:`1px solid ${C.green}55`,
                      color:C.green, borderRadius:5, padding:"8px 10px", cursor:"pointer",
                      fontSize:10, fontWeight:800, letterSpacing:"0.06em", fontFamily:"inherit" }}>
                    REPORTS
                  </button>
                </div>
              </div>
            </Panel>
          </div>
        )}

        {/* ─── APPROVALS TAB ─── */}
        {tab==="approvals" && (
          <div style={{ display:"grid", gridTemplateColumns:"0.8fr 1.2fr", gap:16 }}>
            <Panel title="Approval Control" badge={`${approvalCount} REQUESTS`}>
              <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:12 }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 130px", gap:8 }}>
                  <input type="text" value={approvalActor}
                    onChange={e=>setApprovalActor(e.target.value)}
                    style={{ background:C.bg, border:`1px solid ${C.border2}`, color:C.text,
                      padding:"7px 9px", borderRadius:5, fontSize:10, fontFamily:"inherit", minWidth:0 }} />
                  <select value={approvalRole} onChange={e=>setApprovalRole(e.target.value)}
                    style={{ background:C.bg, border:`1px solid ${C.border2}`, color:C.text,
                      padding:"7px 9px", borderRadius:5, fontSize:10, fontFamily:"inherit" }}>
                    {["analyst", "auditor", "approver", "admin"].map(role => (
                      <option key={role} value={role}>{role.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>
                  {[
                    ["PENDING", approvalSummary.pending, approvalSummary.pending ? C.amber : C.muted],
                    ["APPROVED", approvalSummary.approved, approvalSummary.approved ? C.green : C.muted],
                    ["REJECTED", approvalSummary.rejected, approvalSummary.rejected ? C.red : C.muted],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ padding:"8px 9px", border:`1px solid ${color}33`,
                      borderRadius:5, background:`${color}08` }}>
                      <div style={{ fontSize:18, color, fontWeight:900 }}>{value}</div>
                      <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ padding:"10px 11px", border:`1px solid ${reportAccent(selectedReportType)}33`,
                  borderRadius:6, background:`${reportAccent(selectedReportType)}08`, display:"flex",
                  flexDirection:"column", gap:9 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:11, color:C.text, fontWeight:900,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {selectedReportType.toUpperCase()} REPORT EXPORT
                      </div>
                      <div style={{ fontSize:9, color:C.muted, marginTop:3,
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {reportExportApproval ? `approval ${reportExportApproval.id}` : "approval required for analyst export"}
                      </div>
                    </div>
                    <Pill label={reportExportApproval ? "APPROVED" : approvalRole.toUpperCase()} color={reportExportApproval ? C.green : reportAccent(selectedReportType)} />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <button onClick={requestReportApproval}
                      style={{ background:`${C.amber}12`, border:`1px solid ${C.amber}55`,
                        color:C.amber, borderRadius:5, padding:"8px 10px", cursor:"pointer",
                        fontSize:10, fontWeight:800, letterSpacing:"0.05em", fontFamily:"inherit" }}>
                      REQUEST EXPORT
                    </button>
                    <button onClick={exportReportPackage} disabled={reportBusy}
                      style={{ background:reportBusy?`${C.muted}18`:`${C.green}12`,
                        border:`1px solid ${reportBusy?C.border2:C.green}55`,
                        color:reportBusy?C.muted:C.green, borderRadius:5, padding:"8px 10px",
                        cursor:reportBusy?"not-allowed":"pointer", fontSize:10, fontWeight:800,
                        letterSpacing:"0.05em", fontFamily:"inherit" }}>
                      EXPORT REPORT
                    </button>
                  </div>
                </div>

                <div style={{ padding:"8px 9px", border:`1px solid ${approvalStatus.includes("failed")?C.red:C.border}`,
                  borderRadius:5, background:`${C.bg}66`, fontSize:10,
                  color:approvalStatus.includes("failed")?C.red:C.accent, lineHeight:1.5 }}>
                  {approvalStatus}
                </div>
              </div>
            </Panel>

            <Panel title="Approval Queue" badge={`${pendingApprovals.length} PENDING`}>
              <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:8, maxHeight:560, overflowY:"auto" }}>
                {approvals.slice(0,14).map(approval => {
                  const color = approval.status === "approved" ? C.green : approval.status === "rejected" ? C.red : C.amber;
                  const busy = approvalBusyId.startsWith(approval.id);
                  return (
                    <div key={approval.id} style={{ padding:"10px 11px", border:`1px solid ${color}33`,
                      borderRadius:6, background:`${color}08` }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, alignItems:"center", marginBottom:7 }}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:11, color:C.text, fontWeight:900, overflow:"hidden",
                            textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {approval.action}
                          </div>
                          <div style={{ fontSize:9, color:C.muted, marginTop:2, overflow:"hidden",
                            textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {approval.entityType}:{approval.entityId} · requested by {approval.requestedBy}
                          </div>
                        </div>
                        <Pill label={approval.status.toUpperCase()} color={color} />
                      </div>
                      {approval.justification && (
                        <div style={{ fontSize:10, color:C.muted, lineHeight:1.5, marginBottom:8 }}>
                          {approval.justification}
                        </div>
                      )}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:8, alignItems:"center" }}>
                        <div style={{ fontSize:9, color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {approval.decidedBy ? `decided by ${approval.decidedBy}` : formatTimestamp(approval.requestedAt)}
                        </div>
                        <button onClick={()=>decideApproval(approval, "approve")} disabled={busy || approval.status !== "pending"}
                          style={{ background:approval.status === "pending"?`${C.green}12`:`${C.muted}12`,
                            border:`1px solid ${approval.status === "pending"?C.green:C.border2}55`,
                            color:approval.status === "pending"?C.green:C.muted, borderRadius:4, padding:"5px 8px",
                            cursor:busy || approval.status !== "pending"?"not-allowed":"pointer",
                            fontSize:9, fontWeight:800, letterSpacing:"0.05em", fontFamily:"inherit" }}>
                          APPROVE
                        </button>
                        <button onClick={()=>decideApproval(approval, "reject")} disabled={busy || approval.status !== "pending"}
                          style={{ background:approval.status === "pending"?`${C.red}12`:`${C.muted}12`,
                            border:`1px solid ${approval.status === "pending"?C.red:C.border2}55`,
                            color:approval.status === "pending"?C.red:C.muted, borderRadius:4, padding:"5px 8px",
                            cursor:busy || approval.status !== "pending"?"not-allowed":"pointer",
                            fontSize:9, fontWeight:800, letterSpacing:"0.05em", fontFamily:"inherit" }}>
                          REJECT
                        </button>
                      </div>
                    </div>
                  );
                })}
                {approvals.length === 0 && (
                  <div style={{ fontSize:10, color:C.muted }}>No approval requests yet.</div>
                )}
              </div>
            </Panel>
          </div>
        )}

        {/* ─── EVIDENCE ARCHIVE TAB ─── */}
        {tab==="evidence" && (
          <div style={{ display:"grid", gridTemplateColumns:"0.82fr 1.18fr", gap:16 }}>
            <Panel title="Archive Integrity" badge={evidenceChain.valid ? "VERIFIED" : "UNVERIFIED"}>
              <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:12 }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>
                  {[
                    ["AUDIT EVENTS", evidenceChain.count ?? 0, evidenceChain.valid ? C.green : C.amber],
                    ["EXPORTS", evidenceArchive?.reportExports?.count ?? 0, C.accent],
                    ["APPROVALS", evidenceArchive?.approvals?.total ?? 0, C.purple],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ padding:"8px 9px", border:`1px solid ${color}33`,
                      borderRadius:5, background:`${color}08` }}>
                      <div style={{ fontSize:18, color, fontWeight:900 }}>{value}</div>
                      <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>{label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ padding:"10px 11px", border:`1px solid ${evidenceChain.valid?C.green:C.amber}33`,
                  borderRadius:6, background:`${evidenceChain.valid?C.green:C.amber}08` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center", marginBottom:8 }}>
                    <span style={{ fontSize:11, color:C.text, fontWeight:900 }}>Audit Hash Chain</span>
                    <Pill label={evidenceChain.valid ? "VALID" : "CHECK"} color={evidenceChain.valid ? C.green : C.amber} />
                  </div>
                  <div style={{ fontSize:9, color:C.muted, lineHeight:1.6, wordBreak:"break-all" }}>
                    HEAD {evidenceChain.headHash || "--"}
                  </div>
                  <div style={{ fontSize:9, color:C.muted, lineHeight:1.6, wordBreak:"break-all" }}>
                    TAIL {evidenceChain.tailHash || "--"}
                  </div>
                </div>

                <div style={{ padding:"10px 11px", border:`1px solid ${C.border}`, borderRadius:6,
                  background:`${C.bg}44`, display:"flex", flexDirection:"column", gap:8 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}>
                    <span style={{ fontSize:11, color:C.text, fontWeight:900 }}>Archive Filters</span>
                    <Pill label={evidenceFilterCount ? `${evidenceFilterCount} ACTIVE` : "ALL"} color={evidenceFilterCount ? C.accent : C.muted} />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>
                    <select value={evidenceFilters.reportType} onChange={event=>updateEvidenceFilter("reportType", event.target.value)}
                      style={{ minWidth:0, background:C.panel, color:C.text, border:`1px solid ${C.border2}`,
                        borderRadius:5, padding:"7px 8px", fontSize:10, fontFamily:"inherit" }}>
                      <option value="">Any report</option>
                      {REPORT_TYPES.map(type => (
                        <option key={type.id} value={type.id}>{type.title}</option>
                      ))}
                    </select>
                    <select value={evidenceFilters.action} onChange={event=>updateEvidenceFilter("action", event.target.value)}
                      style={{ minWidth:0, background:C.panel, color:C.text, border:`1px solid ${C.border2}`,
                        borderRadius:5, padding:"7px 8px", fontSize:10, fontFamily:"inherit" }}>
                      <option value="">Any action</option>
                      <option value="report.export">Report export</option>
                      <option value="approval.requested">Approval requested</option>
                      <option value="approval.approved">Approval approved</option>
                      <option value="approval.rejected">Approval rejected</option>
                      <option value="finding.updated">Finding updated</option>
                    </select>
                    <select value={evidenceFilters.entityType} onChange={event=>updateEvidenceFilter("entityType", event.target.value)}
                      style={{ minWidth:0, background:C.panel, color:C.text, border:`1px solid ${C.border2}`,
                        borderRadius:5, padding:"7px 8px", fontSize:10, fontFamily:"inherit" }}>
                      <option value="">Any entity</option>
                      <option value="report">Report</option>
                      <option value="approval">Approval</option>
                      <option value="report-export">Report export</option>
                      <option value="finding">Finding</option>
                      <option value="asset">Asset</option>
                    </select>
                  </div>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:8 }}>
                  <button onClick={()=>refreshEvidenceArchive({ selectLatest: true })} disabled={evidenceBusy}
                    style={{ background:evidenceBusy?`${C.muted}18`:`${C.accent}12`,
                      border:`1px solid ${evidenceBusy?C.border2:C.accent}55`,
                      color:evidenceBusy?C.muted:C.accent, borderRadius:5, padding:"8px 10px",
                      cursor:evidenceBusy?"not-allowed":"pointer", fontSize:10, fontWeight:800,
                      letterSpacing:"0.05em", fontFamily:"inherit" }}>
                    REFRESH ARCHIVE
                  </button>
                  <button onClick={clearEvidenceFilters} disabled={evidenceBusy || !evidenceFilterCount}
                    style={{ background:evidenceBusy || !evidenceFilterCount?`${C.muted}18`:`${C.purple}12`,
                      border:`1px solid ${evidenceBusy || !evidenceFilterCount?C.border2:C.purple}55`,
                      color:evidenceBusy || !evidenceFilterCount?C.muted:C.purple, borderRadius:5, padding:"8px 10px",
                      cursor:evidenceBusy || !evidenceFilterCount?"not-allowed":"pointer", fontSize:10, fontWeight:800,
                      letterSpacing:"0.05em", fontFamily:"inherit" }}>
                    CLEAR FILTERS
                  </button>
                  <button onClick={()=>evidenceLatestExport?.id && selectEvidenceManifest(evidenceLatestExport.id)}
                    disabled={evidenceBusy || !evidenceLatestExport}
                    style={{ background:evidenceBusy || !evidenceLatestExport?`${C.muted}18`:`${C.green}12`,
                      border:`1px solid ${evidenceBusy || !evidenceLatestExport?C.border2:C.green}55`,
                      color:evidenceBusy || !evidenceLatestExport?C.muted:C.green, borderRadius:5, padding:"8px 10px",
                      cursor:evidenceBusy || !evidenceLatestExport?"not-allowed":"pointer", fontSize:10, fontWeight:800,
                      letterSpacing:"0.05em", fontFamily:"inherit" }}>
                    LATEST MANIFEST
                  </button>
                  <button onClick={downloadEvidenceBundle} disabled={evidenceBusy}
                    style={{ background:evidenceBusy?`${C.muted}18`:`${C.amber}12`,
                      border:`1px solid ${evidenceBusy?C.border2:C.amber}55`,
                      color:evidenceBusy?C.muted:C.amber, borderRadius:5, padding:"8px 10px",
                      cursor:evidenceBusy?"not-allowed":"pointer", fontSize:10, fontWeight:800,
                      letterSpacing:"0.05em", fontFamily:"inherit" }}>
                    DOWNLOAD BUNDLE
                  </button>
                </div>

                <div style={{ padding:"8px 9px", border:`1px solid ${evidenceStatus.includes("failed")?C.red:C.border}`,
                  borderRadius:5, background:`${C.bg}66`, fontSize:10,
                  color:evidenceStatus.includes("failed")?C.red:(evidenceChain.valid?C.green:C.accent), lineHeight:1.5 }}>
                  {evidenceStatus}
                </div>
              </div>
            </Panel>

            <Panel title="Report Export Archive" badge={`${evidenceExports.length} EXPORTS`}>
              <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:8, maxHeight:560, overflowY:"auto" }}>
                {evidenceExports.map(item => {
                  const selected = evidenceManifest?.id === item.id;
                  const color = reportAccent(item.reportType);
                  return (
                    <button key={item.id} onClick={()=>selectEvidenceManifest(item.id)}
                      style={{ textAlign:"left", background:selected?`${color}16`:`${color}07`,
                        border:`1px solid ${selected?color:C.border}`, borderRadius:6,
                        padding:"10px 11px", cursor:"pointer", fontFamily:"inherit", minWidth:0 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, alignItems:"center", marginBottom:6 }}>
                        <span style={{ fontSize:11, color:C.text, fontWeight:900, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {item.id}
                        </span>
                        <Pill label={item.reportType.toUpperCase()} color={color} />
                      </div>
                      <div style={{ fontSize:9, color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {item.reportId} · {item.createdBy} · {formatTimestamp(item.generatedAt)}
                      </div>
                      <div style={{ fontSize:9, color:C.muted, marginTop:4, wordBreak:"break-all" }}>
                        HASH {item.payloadHash || "--"}
                      </div>
                    </button>
                  );
                })}
                {evidenceExports.length === 0 && (
                  <div style={{ fontSize:10, color:C.muted }}>No persisted report exports yet.</div>
                )}
              </div>
            </Panel>

            <Panel title="Export Manifest" badge={evidenceManifest?.reportType?.toUpperCase?.() ?? "NONE"}>
              <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
                  {[
                    ["EXPORT", evidenceManifest?.id, C.accent],
                    ["REPORT", evidenceManifest?.reportId, reportAccent(evidenceManifest?.reportType)],
                    ["AUDIT", evidenceManifest?.auditEventId, C.purple],
                    ["APPROVAL", evidenceManifest?.approvalId ?? "DIRECT", C.green],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ padding:"8px 9px", border:`1px solid ${color}33`,
                      borderRadius:5, background:`${color}08`, minWidth:0 }}>
                      <div style={{ fontSize:11, color, fontWeight:900, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {value ?? "--"}
                      </div>
                      <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>{label}</div>
                    </div>
                  ))}
                </div>

                <pre style={{ margin:0, padding:"12px 14px", maxHeight:260, overflow:"auto",
                  fontSize:9, lineHeight:1.45, color:C.muted, background:C.bg, border:`1px solid ${C.border}`,
                  borderRadius:6 }}>
{JSON.stringify(evidenceManifest ?? {}, null, 2)}
                </pre>
              </div>
            </Panel>

            <Panel title="Evidence Bundle" badge={evidenceBundle?.bundleId ? "READY" : "NOT BUILT"}>
              <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
                  {[
                    ["BUNDLE", evidenceBundle?.bundleId || "--", C.amber],
                    ["EXPORTS", evidenceBundle?.reportExports?.length ?? 0, C.accent],
                    ["APPROVALS", evidenceBundle?.approvals?.length ?? 0, C.green],
                    ["EVENTS", evidenceBundleEventCount, C.purple],
                  ].map(([label, value, color]) => (
                    <div key={label} style={{ padding:"8px 9px", border:`1px solid ${color}33`,
                      borderRadius:5, background:`${color}08`, minWidth:0 }}>
                      <div style={{ fontSize:11, color, fontWeight:900, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {value}
                      </div>
                      <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>{label}</div>
                    </div>
                  ))}
                </div>

                <pre style={{ margin:0, padding:"12px 14px", maxHeight:220, overflow:"auto",
                  fontSize:9, lineHeight:1.45, color:C.muted, background:C.bg, border:`1px solid ${C.border}`,
                  borderRadius:6 }}>
{JSON.stringify(evidenceBundle ?? { filters: activeEvidenceFilters, status: "Download a bundle to preview evidence package metadata." }, null, 2)}
                </pre>
              </div>
            </Panel>

            <Panel title="Approval Evidence" badge={`${evidenceArchive?.approvals?.approved ?? 0} APPROVED`}>
              <div style={{ padding:"12px 14px", display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
                {[
                  ["TOTAL", evidenceArchive?.approvals?.total ?? 0, C.accent],
                  ["PENDING", evidenceArchive?.approvals?.pending ?? 0, C.amber],
                  ["APPROVED", evidenceArchive?.approvals?.approved ?? 0, C.green],
                  ["REJECTED", evidenceArchive?.approvals?.rejected ?? 0, C.red],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ padding:"9px 10px", border:`1px solid ${color}33`,
                    borderRadius:5, background:`${color}08` }}>
                    <div style={{ fontSize:18, color, fontWeight:900 }}>{value}</div>
                    <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>{label}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {/* ─── COMPLIANCE TAB ─── */}
        {tab==="compliance" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            {COMPLIANCE.map(c=>(
              <Panel key={c.name} title={c.name}
                badge={<span style={{ color:compColor(c.status), fontWeight:900 }}>{c.status}</span>}>
                <div style={{ padding:"16px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                    <div style={{ fontSize:36, fontWeight:900, color:compColor(c.status),
                      textShadow:`0 0 12px ${compColor(c.status)}66` }}>{c.pct}%</div>
                    <div style={{ flex:1 }}>
                      <div style={{ marginBottom:6 }}>
                        <MiniBar pct={c.pct} color={compColor(c.status)} />
                      </div>
                      <div style={{ fontSize:9, color:C.muted }}>COMPLIANCE COVERAGE</div>
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:C.text, lineHeight:1.6,
                    padding:"10px 12px", background:`${compColor(c.status)}11`,
                    border:`1px solid ${compColor(c.status)}33`, borderRadius:5 }}>
                    {c.desc}
                  </div>
                </div>
              </Panel>
            ))}

            {/* Compliance summary */}
            <div style={{ gridColumn:"1/3", background:C.panel, border:`1px solid ${C.border}`,
              borderRadius:8, padding:20 }}>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", color:C.muted,
                textTransform:"uppercase", marginBottom:12 }}>Regulatory Action Summary</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
                {[
                  ["Immediate (0–90 days)", C.red, ["File NSM-10 inventory with ONCD","Migrate CA root to ML-DSA-87","Replace DES/RSA-1024 on OT historian"]],
                  ["Short-term (90–180 days)", C.amber, ["Complete DORA Art. 9.2 crypto register","Deploy ML-KEM on all internet TLS","Migrate VPN to ML-KEM-1024"]],
                  ["Medium-term (180–365 days)", C.green, ["Full PCI DSS 12.3.3 cipher audit","CMMC cryptographic controls documentation","OT hardware refresh planning complete"]],
                ].map(([title,c,items])=>(
                  <div key={title} style={{ padding:"12px", background:`${c}0a`,
                    border:`1px solid ${c}33`, borderRadius:6 }}>
                    <div style={{ fontSize:10, fontWeight:700, color:c, marginBottom:8 }}>{title}</div>
                    {items.map(item=>(
                      <div key={item} style={{ display:"flex", gap:6, marginBottom:5, alignItems:"flex-start" }}>
                        <span style={{ color:c, flexShrink:0 }}>▸</span>
                        <span style={{ fontSize:10, color:C.text, lineHeight:1.4 }}>{item}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ─── REPORTS TAB ─── */}
        {tab==="reports" && (
          <div style={{ display:"grid", gridTemplateColumns:"1.25fr 0.75fr", gap:16 }}>
            <Panel title="Report Workspace" badge={`${reportCount} REPORTS`} style={{ gridColumn:"1/3" }}>
              <div style={{ padding:"12px 14px", display:"grid", gridTemplateColumns:"repeat(5, minmax(0, 1fr))", gap:8 }}>
                {REPORT_TYPES.map(reportType => {
                  const metadata = reportMetadataByType.get(reportType.id);
                  const color = reportAccent(reportType.id);
                  const selected = selectedReportType === reportType.id;
                  return (
                    <button key={reportType.id} onClick={()=>selectReportType(reportType.id)}
                      disabled={reportBusy && selected}
                      style={{ textAlign:"left", background:selected?`${color}16`:`${color}08`,
                        border:`1px solid ${selected?color:C.border}`, borderRadius:6,
                        padding:"10px 11px", cursor:reportBusy && selected?"wait":"pointer",
                        fontFamily:"inherit", minWidth:0, minHeight:92 }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:8 }}>
                        <span style={{ fontSize:10, color:selected?color:C.text, fontWeight:900,
                          letterSpacing:"0.06em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {reportType.title.toUpperCase()}
                        </span>
                        <Pill label={metadata ? "READY" : "PENDING"} color={metadata ? color : C.muted} />
                      </div>
                      <div style={{ fontSize:9, color:C.muted, lineHeight:1.5, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {metadata?.reportId ?? `${reportType.id}-report`}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginTop:10 }}>
                        <div style={{ border:`1px solid ${color}22`, borderRadius:4, padding:"5px 6px" }}>
                          <div style={{ fontSize:12, color, fontWeight:900 }}>{metadata?.sections?.length ?? 0}</div>
                          <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.06em" }}>SECTIONS</div>
                        </div>
                        <div style={{ border:`1px solid ${color}22`, borderRadius:4, padding:"5px 6px" }}>
                          <div style={{ fontSize:12, color, fontWeight:900 }}>{metadata?.evidenceRefs?.length ?? 0}</div>
                          <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.06em" }}>EVIDENCE</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <Panel title={currentReport?.title ?? "Report"} badge={selectedReportType.toUpperCase()}>
                <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    {[
                      ["REPORT ID", currentReport?.reportId, reportAccent(selectedReportType)],
                      ["GENERATED", currentReportGenerated, C.accent],
                      ["SECTIONS", currentReportSections.length, C.purple],
                      ["EVIDENCE", currentReportEvidenceRefs.length, C.green],
                    ].map(([label, value, color]) => (
                      <div key={label} style={{ padding:"8px 9px", border:`1px solid ${color}33`,
                        borderRadius:5, background:`${color}08`, minWidth:0 }}>
                        <div style={{ fontSize:12, color, fontWeight:900, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {value ?? "--"}
                        </div>
                        <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                    <button onClick={copyReportJson} disabled={!currentReport}
                      style={{ background:`${C.accent}14`, border:`1px solid ${C.accent}55`,
                        color:C.accent, borderRadius:5, padding:"8px 10px", cursor:currentReport?"pointer":"not-allowed",
                        fontSize:10, fontWeight:800, letterSpacing:"0.06em", fontFamily:"inherit" }}>
                      COPY JSON
                    </button>
                    <button onClick={downloadReportJson} disabled={!currentReport}
                      style={{ background:`${C.green}14`, border:`1px solid ${C.green}55`,
                        color:C.green, borderRadius:5, padding:"8px 10px", cursor:currentReport?"pointer":"not-allowed",
                        fontSize:10, fontWeight:800, letterSpacing:"0.06em", fontFamily:"inherit" }}>
                      DOWNLOAD
                    </button>
                  </div>

                  <div style={{ padding:"8px 9px", border:`1px solid ${reportStatus.includes("failed")?C.red:C.border}`,
                    borderRadius:5, background:`${C.bg}66`, fontSize:9,
                    color:reportStatus.includes("failed")?C.red:(reportStatus==="fallback"?C.amber:C.accent),
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    SOURCE {reportStatus.toUpperCase()}
                  </div>
                </div>
              </Panel>

              <Panel title="Scope">
                <div style={{ padding:"10px 12px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {currentReportScope.map(([label, value]) => (
                    <div key={label} style={{ padding:"7px 8px", border:`1px solid ${C.border}`,
                      borderRadius:5, background:`${C.bg}66`, minWidth:0 }}>
                      <div style={{ fontSize:12, color:C.text, fontWeight:900, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {compactReportValue(value)}
                      </div>
                      <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.08em", marginTop:4 }}>
                        {humanizeKey(label)}
                      </div>
                    </div>
                  ))}
                  {currentReportScope.length === 0 && (
                    <div style={{ gridColumn:"1/3", fontSize:10, color:C.muted }}>No scope fields.</div>
                  )}
                </div>
              </Panel>
            </div>

            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              <Panel title="Summary Counters" badge={`${currentReportSummary.length} METRICS`}>
                <div style={{ padding:"10px 12px", display:"grid", gridTemplateColumns:"repeat(3, minmax(0, 1fr))", gap:8 }}>
                  {currentReportSummary.map(([label, value]) => {
                    const color = typeof value === "number" && value > 0 ? reportAccent(selectedReportType) : C.muted;
                    return (
                      <div key={label} style={{ padding:"8px 9px", border:`1px solid ${color}33`,
                        borderRadius:5, background:`${color}08`, minWidth:0 }}>
                        <div style={{ fontSize:18, color, fontWeight:900, lineHeight:1,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {compactReportValue(value)}
                        </div>
                        <div style={{ fontSize:8, color:C.muted, letterSpacing:"0.07em", marginTop:6,
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {humanizeKey(label)}
                        </div>
                      </div>
                    );
                  })}
                  {currentReportSummary.length === 0 && (
                    <div style={{ gridColumn:"1/4", fontSize:10, color:C.muted }}>No summary counters.</div>
                  )}
                </div>
              </Panel>

              <Panel title="JSON Preview">
                <pre style={{ margin:0, padding:"12px 14px", maxHeight:240, overflow:"auto",
                  fontSize:9, lineHeight:1.45, color:C.muted, background:C.bg }}>
{JSON.stringify(currentReport, null, 2)}
                </pre>
              </Panel>
            </div>

            <Panel title="Sections" badge={`${currentReportSections.length} ITEMS`}>
              <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:8, maxHeight:420, overflowY:"auto" }}>
                {currentReportSections.map(section => {
                  const items = reportSectionItems(section);
                  return (
                    <div key={section.id} style={{ padding:"10px 11px", border:`1px solid ${C.border}`,
                      borderRadius:6, background:`${reportAccent(selectedReportType)}07` }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:8, alignItems:"center", marginBottom:5 }}>
                        <span style={{ fontSize:11, color:C.text, fontWeight:900, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {section.title}
                        </span>
                        <Pill label={`${items.length} REFS`} color={items.length ? reportAccent(selectedReportType) : C.muted} />
                      </div>
                      {section.summary && (
                        <div style={{ fontSize:10, color:C.muted, lineHeight:1.5, marginBottom:7 }}>
                          {section.summary}
                        </div>
                      )}
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        {items.slice(0,5).map((item, index) => (
                          <div key={`${section.id}-${index}`} style={{ display:"grid", gridTemplateColumns:"auto 1fr",
                            gap:7, alignItems:"start", fontSize:9, color:C.muted }}>
                            <span style={{ color:reportAccent(selectedReportType), fontWeight:900 }}>{String(index + 1).padStart(2, "0")}</span>
                            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {compactReportValue(item)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {currentReportSections.length === 0 && (
                  <div style={{ fontSize:10, color:C.muted }}>No sections.</div>
                )}
              </div>
            </Panel>

            <Panel title="Evidence References" badge={`${currentReportEvidenceRefs.length} REFS`}>
              <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:7, maxHeight:420, overflowY:"auto" }}>
                {currentReportEvidenceRefs.map(ref => (
                  <div key={ref.id} style={{ display:"grid", gridTemplateColumns:"auto 1fr", gap:9,
                    alignItems:"center", padding:"8px 9px", border:`1px solid ${C.border}`,
                    borderRadius:5, background:`${reportAccent(selectedReportType)}06`, minWidth:0 }}>
                    <Pill label={ref.type.toUpperCase()} color={reportAccent(selectedReportType)} />
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontSize:10, color:C.text, fontWeight:800, overflow:"hidden",
                        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {ref.label}
                      </div>
                      <div style={{ fontSize:9, color:C.muted, overflow:"hidden", textOverflow:"ellipsis",
                        whiteSpace:"nowrap", marginTop:2 }}>
                        {ref.id}
                      </div>
                    </div>
                  </div>
                ))}
                {currentReportEvidenceRefs.length === 0 && (
                  <div style={{ fontSize:10, color:C.muted }}>No evidence refs.</div>
                )}
              </div>
            </Panel>
          </div>
        )}
      </div>

      <style>{`
        * { box-sizing: border-box; scrollbar-width: thin; scrollbar-color: #1e2a3a #06090f; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #06090f; }
        ::-webkit-scrollbar-thumb { background: #1e2a3a; border-radius: 3px; }
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px #00e5a0; }
          50% { opacity: 0.4; box-shadow: 0 0 2px #00e5a0; }
        }
      `}</style>
    </div>
  );
}
