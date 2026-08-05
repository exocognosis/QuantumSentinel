import { ALERTS, ASSETS, COMPLIANCE, TREND_DATA } from "../src/mockData.js";
import { buildCbomFromAssets } from "./datastore.js";

const REPORT_TYPES = [
  {
    type: "executive",
    title: "Executive Summary",
    description: "Portfolio-level quantum cryptography risk, exposure, and migration posture.",
    href: "/api/reports/executive",
    format: "json",
  },
  {
    type: "compliance",
    title: "Compliance Evidence",
    description: "Control posture, compliance status, and evidence references for audit packages.",
    href: "/api/reports/compliance",
    format: "json",
  },
  {
    type: "remediation",
    title: "Remediation Evidence",
    description: "Finding lifecycle, ownership, and remediation status evidence.",
    href: "/api/reports/remediation",
    format: "json",
  },
  {
    type: "cbom",
    title: "CBOM Evidence Package",
    description: "Cryptographic bill of materials package with component-level crypto posture.",
    href: "/api/reports/cbom",
    format: "json",
  },
  {
    type: "full",
    title: "Full Evidence Package",
    description: "Combined executive, compliance, remediation, and CBOM JSON report package.",
    href: "/api/reports/full",
    format: "json",
  },
];

const TERMINAL_FINDING_STATUSES = new Set(["remediated", "closed"]);

function isoNow() {
  return new Date().toISOString();
}

function makeReportId(type, generatedAt) {
  return `${type}-${generatedAt.replace(/\D/g, "").slice(0, 14)}`;
}

function countBy(items, field, value) {
  return items.filter((item) => item[field] === value).length;
}

function average(items, field) {
  if (!items.length) return 0;
  return Math.floor(items.reduce((sum, item) => sum + Number(item[field] || 0), 0) / items.length);
}

function deriveReportSummary({ assets, alerts, compliance, trends }) {
  const latest = trends.at(-1) ?? { risk: 0, safe: 0 };
  const first = trends[0] ?? { risk: 0, safe: 0 };

  return {
    assets: {
      total: assets.length,
      critical: countBy(assets, "prio", "CRITICAL"),
      high: countBy(assets, "prio", "HIGH"),
      medium: countBy(assets, "prio", "MEDIUM"),
      monitor: countBy(assets, "prio", "MONITOR"),
      shorCritical: countBy(assets, "cls", "SHOR-CRITICAL"),
      quantumSafe: countBy(assets, "cls", "QUANTUM-SAFE"),
      hybrid: countBy(assets, "cls", "HYBRID"),
      deprecated: countBy(assets, "cls", "DEPRECATED"),
      noPfs: assets.filter((asset) => !asset.pfs).length,
      averageRisk: average(assets, "risk"),
    },
    alerts: {
      total: alerts.length,
      critical: countBy(alerts, "sev", "CRITICAL"),
      high: countBy(alerts, "sev", "HIGH"),
      medium: countBy(alerts, "sev", "MEDIUM"),
      info: countBy(alerts, "sev", "INFO"),
    },
    compliance: {
      averagePct: average(compliance, "pct"),
      red: countBy(compliance, "status", "RED"),
      amber: countBy(compliance, "status", "AMBER"),
      green: countBy(compliance, "status", "GREEN"),
    },
    trends: {
      latestRisk: latest.risk,
      latestSafe: latest.safe,
      riskDelta: latest.risk - first.risk,
      safeDelta: latest.safe - first.safe,
    },
  };
}

function countGroup(items, field, fallback = "unassigned") {
  const counts = {};
  for (const item of items) {
    const key = item[field] ?? fallback;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sortFindingsBySeverity(left, right) {
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  return (rank[left.severity] ?? 99) - (rank[right.severity] ?? 99)
    || String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""))
    || String(left.id).localeCompare(String(right.id));
}

function summarizeRemediationFallback(findings) {
  const openFindings = findings.filter((finding) => !TERMINAL_FINDING_STATUSES.has(finding.status));

  return {
    totalFindings: findings.length,
    openFindings: openFindings.length,
    closedFindings: findings.length - openFindings.length,
    openCritical: openFindings.filter((finding) => finding.severity === "CRITICAL").length,
    overdue: 0,
    byStatus: countGroup(findings, "status", "open"),
    bySeverity: countGroup(findings, "severity", "UNKNOWN"),
    byOwner: countGroup(findings, "owner", "unassigned"),
  };
}

function normalizeRemediationSummary(summary, findings) {
  const openFindings = findings.filter((finding) => !TERMINAL_FINDING_STATUSES.has(finding.status));

  return {
    totalFindings: summary.totalFindings ?? summary.total ?? findings.length,
    openFindings: summary.openFindings ?? openFindings.length,
    closedFindings: summary.closedFindings ?? findings.length - openFindings.length,
    openCritical: summary.openCritical ?? openFindings.filter((finding) => finding.severity === "CRITICAL").length,
    overdue: summary.overdue ?? 0,
    dueSoon: summary.dueSoon ?? 0,
    byStatus: summary.byStatus ?? countGroup(findings, "status", "open"),
    bySeverity: summary.bySeverity ?? countGroup(findings, "severity", "UNKNOWN"),
    byOwner: summary.byOwner ?? countGroup(findings, "owner", "unassigned"),
  };
}

function alertSeverity(severity) {
  const value = String(severity ?? "INFO").toUpperCase();
  return ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].includes(value) ? value : "INFO";
}

function findingToAlert(finding) {
  return {
    id: `finding-alert-${finding.id}`,
    ts: finding.observedAt ?? finding.createdAt ?? finding.updatedAt ?? null,
    sev: alertSeverity(finding.severity),
    type: finding.type ?? "CRYPTO_FINDING",
    msg: finding.title ?? finding.description ?? "Cryptographic finding requires review",
    asset: finding.asset?.hostname ?? finding.assetName ?? finding.assetId ?? "portfolio",
    findingId: finding.id,
    source: finding.source ?? "finding",
  };
}

function activeAlertsFromFindings(findings) {
  return findings
    .filter((finding) => !TERMINAL_FINDING_STATUSES.has(String(finding.status ?? "").toLowerCase()))
    .filter((finding) => alertSeverity(finding.severity) !== "INFO")
    .filter((finding) => ["tls-probe", "risk-engine", "risk-recompute"].includes(finding.source ?? ""))
    .map(findingToAlert)
    .toSorted((left, right) => String(right.ts ?? "").localeCompare(String(left.ts ?? "")));
}

async function loadReportContext(datastore) {
  const assets = datastore ? await datastore.listAssets() : ASSETS;
  const findings = datastore ? await datastore.listFindings() : [];
  const alerts = datastore ? activeAlertsFromFindings(findings) : ALERTS;
  const rawRemediationSummary = datastore
    ? await datastore.getRemediationSummary()
    : summarizeRemediationFallback(findings);
  const remediationSummary = normalizeRemediationSummary(rawRemediationSummary, findings);
  const cbomSnapshots = datastore ? await datastore.listCbomSnapshots() : [];
  const monitorRuns = datastore ? await datastore.listMonitorRuns() : [];
  const cbom = buildCbomFromAssets(assets);

  return {
    source: datastore ? "datastore" : "seed",
    assets,
    alerts,
    compliance: COMPLIANCE,
    trends: TREND_DATA,
    findings,
    remediationSummary,
    cbomSnapshots,
    monitorRuns,
    cbom,
    summary: deriveReportSummary({ assets, alerts, compliance: COMPLIANCE, trends: TREND_DATA }),
  };
}

function buildScope(context) {
  return {
    source: context.source,
    assetCount: context.assets.length,
    findingCount: context.findings.length,
    cbomSnapshotCount: context.cbomSnapshots.length,
    monitorRunCount: context.monitorRuns.length,
  };
}

function createReport(type, title, context, { summary, sections, evidenceRefs }) {
  const generatedAt = isoNow();

  return {
    reportId: makeReportId(type, generatedAt),
    type,
    title,
    generatedAt,
    scope: buildScope(context),
    summary,
    sections,
    evidenceRefs,
  };
}

function assetEvidenceRefs(assets) {
  return assets.map((asset) => ({
    kind: "asset",
    id: asset.id,
    label: asset.hostname,
  }));
}

function findingEvidenceRefs(findings) {
  return findings.flatMap((finding) => {
    const refs = [{
      kind: "finding",
      id: finding.id,
      label: finding.title,
      assetId: finding.assetId ?? null,
    }];

    if (Array.isArray(finding.evidence?.evidenceRefs)) {
      refs.push(...finding.evidence.evidenceRefs.map((ref) => ({
        ...ref,
        findingId: finding.id,
        assetId: finding.assetId ?? null,
      })));
    }

    return refs;
  });
}

function cbomSnapshotEvidenceRefs(snapshots) {
  return snapshots.map((snapshot) => ({
    kind: "cbom-snapshot",
    id: snapshot.id,
    label: snapshot.name,
    createdAt: snapshot.createdAt,
  }));
}

export function listReportTypes() {
  return REPORT_TYPES.map((report) => ({ ...report }));
}

export async function buildExecutiveReport({ datastore = null } = {}) {
  const context = await loadReportContext(datastore);
  const criticalAssets = context.assets
    .filter((asset) => asset.prio === "CRITICAL")
    .toSorted((left, right) => Number(right.risk) - Number(left.risk))
    .slice(0, 10);

  return createReport("executive", "Executive Summary", context, {
    summary: {
      assets: context.summary.assets,
      alerts: context.summary.alerts,
      compliance: context.summary.compliance,
      trends: context.summary.trends,
      remediation: context.remediationSummary,
    },
    sections: [
      {
        id: "portfolio-posture",
        title: "Portfolio Posture",
        summary: context.summary.assets,
      },
      {
        id: "critical-exposure",
        title: "Critical Exposure",
        items: criticalAssets.map((asset) => ({
          assetId: asset.id,
          hostname: asset.hostname,
          algorithm: asset.algo,
          classification: asset.cls,
          risk: asset.risk,
          priority: asset.prio,
          migration: asset.migration,
        })),
      },
      {
        id: "migration-readiness",
        title: "Migration Readiness",
        summary: context.cbom.summary.migrationTargets,
      },
    ],
    evidenceRefs: [
      ...assetEvidenceRefs(criticalAssets),
      ...findingEvidenceRefs(context.findings),
    ],
  });
}

export async function buildComplianceReport({ datastore = null } = {}) {
  const context = await loadReportContext(datastore);

  return createReport("compliance", "Compliance Evidence", context, {
    summary: {
      averagePct: context.summary.compliance.averagePct,
      red: context.summary.compliance.red,
      amber: context.summary.compliance.amber,
      green: context.summary.compliance.green,
      controls: context.compliance.length,
    },
    sections: [
      {
        id: "controls",
        title: "Control Evidence",
        items: context.compliance.map((control) => ({
          name: control.name,
          status: control.status,
          percentComplete: control.pct,
          description: control.desc,
        })),
      },
      {
        id: "supporting-posture",
        title: "Supporting Crypto Posture",
        summary: {
          assetClassification: {
            shorCritical: context.summary.assets.shorCritical,
            quantumSafe: context.summary.assets.quantumSafe,
            hybrid: context.summary.assets.hybrid,
            deprecated: context.summary.assets.deprecated,
          },
          cbom: context.cbom.summary,
        },
      },
    ],
    evidenceRefs: context.compliance.map((control) => ({
      kind: "compliance-control",
      id: control.name,
      label: control.name,
      status: control.status,
    })),
  });
}

export async function buildRemediationReport({ datastore = null } = {}) {
  const context = await loadReportContext(datastore);
  const findings = context.findings.toSorted(sortFindingsBySeverity);

  return createReport("remediation", "Remediation Evidence", context, {
    summary: context.remediationSummary,
    sections: [
      {
        id: "remediation-summary",
        title: "Remediation Summary",
        summary: context.remediationSummary,
      },
      {
        id: "findings",
        title: "Findings",
        items: findings.map((finding) => ({
          id: finding.id,
          assetId: finding.assetId ?? null,
          asset: finding.asset ?? null,
          severity: finding.severity,
          priority: finding.priority,
          type: finding.type,
          title: finding.title,
          status: finding.status,
          owner: finding.owner ?? null,
          source: finding.source ?? null,
          dueAt: finding.dueAt ?? null,
          createdAt: finding.createdAt ?? null,
          closedAt: finding.closedAt ?? null,
          resolution: finding.resolution ?? null,
          notes: finding.notes ?? [],
          evidenceRefs: finding.evidence?.evidenceRefs ?? [],
        })),
      },
    ],
    evidenceRefs: findingEvidenceRefs(findings),
  });
}

export async function buildCbomReport({ datastore = null } = {}) {
  const context = await loadReportContext(datastore);

  return createReport("cbom", "CBOM Evidence Package", context, {
    summary: context.cbom.summary,
    sections: [
      {
        id: "cbom-summary",
        title: "CBOM Summary",
        summary: context.cbom.summary,
      },
      {
        id: "components",
        title: "Components",
        items: context.cbom.data,
      },
      {
        id: "snapshots",
        title: "CBOM Snapshots",
        items: context.cbomSnapshots,
      },
    ],
    evidenceRefs: [
      ...assetEvidenceRefs(context.assets),
      ...cbomSnapshotEvidenceRefs(context.cbomSnapshots),
    ],
  });
}

export async function buildFullReport({ datastore = null } = {}) {
  const [executive, compliance, remediation, cbom] = await Promise.all([
    buildExecutiveReport({ datastore }),
    buildComplianceReport({ datastore }),
    buildRemediationReport({ datastore }),
    buildCbomReport({ datastore }),
  ]);
  const context = await loadReportContext(datastore);
  const sections = [executive, compliance, remediation, cbom].map((report) => ({
    id: report.type,
    type: report.type,
    title: report.title,
    summary: report.summary,
    sections: report.sections,
    evidenceRefs: report.evidenceRefs,
  }));

  return createReport("full", "Full Evidence Package", context, {
    summary: {
      assets: context.summary.assets,
      compliance: context.summary.compliance,
      remediation: context.remediationSummary,
      cbom: context.cbom.summary,
    },
    sections,
    evidenceRefs: sections.flatMap((section) => section.evidenceRefs),
  });
}

export async function buildReport(type, options = {}) {
  switch (type) {
    case "executive":
      return buildExecutiveReport(options);
    case "compliance":
      return buildComplianceReport(options);
    case "remediation":
      return buildRemediationReport(options);
    case "cbom":
      return buildCbomReport(options);
    case "full":
      return buildFullReport(options);
    default:
      return null;
  }
}
