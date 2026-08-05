import { createHash } from "node:crypto";

const CLASSIFICATION_POSTURE = {
  deprecated: { cls: "DEPRECATED", priority: "CRITICAL", risk: 95, hndl: 82, tnfl: 88 },
  "shor-vulnerable-public-key": { cls: "SHOR-CRITICAL", priority: "HIGH", risk: 78, hndl: 72, tnfl: 76 },
  pqc: { cls: "PQC", priority: "MONITOR", risk: 12, hndl: 8, tnfl: 10 },
  "quantum-resistant-symmetric-hash": { cls: "QUANTUM-RESISTANT", priority: "MONITOR", risk: 8, hndl: 6, tnfl: 6 },
};

function findingFingerprint(report, finding) {
  return createHash("sha256")
    .update(`${report.scan.target}:${finding.ruleId}:${finding.evidence.fingerprintKey ?? `${finding.evidence.file}:${finding.evidence.line}`}`)
    .digest("hex");
}

function actionableRecords(report) {
  const actionable = report.findings.filter((finding) => finding.severity !== "INFO");
  const direct = actionable.filter((finding) => finding.confidence === "confirmed" || finding.confidence === "high");
  const reviewBuckets = new Map();
  for (const finding of actionable.filter((item) => item.confidence !== "confirmed" && item.confidence !== "high")) {
    if (!reviewBuckets.has(finding.ruleId)) reviewBuckets.set(finding.ruleId, []);
    reviewBuckets.get(finding.ruleId).push(finding);
  }
  const review = [...reviewBuckets.values()].map((group) => {
    const first = group[0];
    return {
      ...first,
      title: `${group.length} ${first.algorithm} references require usage triage`,
      rationale: `${group.length} lower-confidence references were detected. Confirm which references are reachable, configured, or deployed before migration planning.`,
      evidence: {
        ...first.evidence,
        fingerprintKey: `review-bucket:${first.ruleId}`,
        referenceCount: group.length,
        references: group.slice(0, 50).map((finding) => ({
          file: finding.evidence.file,
          line: finding.evidence.line,
          confidence: finding.confidence,
          excerpt: finding.evidence.excerpt,
        })),
        truncated: group.length > 50,
      },
    };
  });
  return [...direct, ...review];
}

function strongestFinding(findings) {
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  return findings.toSorted((left, right) => (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9))[0];
}

function groupByFile(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = finding.evidence.file;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  return groups;
}

function migrationTarget(findings) {
  const targets = [...new Set(findings.map((finding) => finding.recommendation))];
  return targets.length === 1 ? targets[0] : `${targets.length} migration actions`; 
}

export async function persistRepositoryScan(datastore, report, { actor = "repository-scanner" } = {}) {
  if (!datastore) throw new Error("datastore is required to persist a repository scan");

  const existingAssets = await datastore.listAssets();
  const existingByHostname = new Map(existingAssets.map((asset) => [asset.hostname, asset]));
  let nextAssetId = existingAssets.reduce((maximum, asset) => Math.max(maximum, Number(asset.id) || 0), 0) + 1;
  const assetByFile = new Map();
  let createdAssets = 0;
  let updatedAssets = 0;

  for (const [file, findings] of groupByFile(report.findings)) {
    const hostname = `${report.scan.targetName}:${file}`;
    const existing = existingByHostname.get(hostname);
    const strongest = strongestFinding(findings);
    const posture = CLASSIFICATION_POSTURE[strongest.classification] ?? CLASSIFICATION_POSTURE["shor-vulnerable-public-key"];
    const algorithms = [...new Set(findings.map((finding) => finding.matchedValue))].slice(0, 8).join(", ");
    const asset = await datastore.upsertAsset({
      id: existing?.id ?? nextAssetId++,
      hostname,
      type: "Repository cryptographic component",
      segment: `repository:${report.scan.targetName}`,
      algo: algorithms || strongest.algorithm,
      proto: strongest.usage,
      cls: posture.cls,
      hndl: posture.hndl,
      tnfl: posture.tnfl,
      risk: posture.risk,
      prio: posture.priority,
      pfs: false,
      cert_exp: "N/A",
      migration: migrationTarget(findings),
      complexity: strongest.severity === "CRITICAL" ? "HIGH" : "MEDIUM",
    }, {
      source: "repository-scan",
      reason: `Q-Day scan ${report.scan.completedAt}`,
      observedAt: report.scan.completedAt,
    });
    assetByFile.set(file, asset);
    if (existing) updatedAssets += 1;
    else createdAssets += 1;
  }

  const priorFindings = await datastore.listFindings({ source: "repository-scan" });
  const priorByFingerprint = new Map(priorFindings.map((finding) => [finding.evidence?.fingerprint, finding]));
  let createdFindings = 0;
  let refreshedFindings = 0;

  for (const finding of actionableRecords(report)) {
    const fingerprint = findingFingerprint(report, finding);
    const existing = priorByFingerprint.get(fingerprint);
    const evidence = {
      ...finding.evidence,
      fingerprint,
      confidence: finding.confidence,
      usage: finding.usage,
      repository: report.scan.targetName,
      repositoryPath: report.scan.target,
      ruleId: finding.ruleId,
      matchedValue: finding.matchedValue,
      scanCompletedAt: report.scan.completedAt,
      occurrenceCount: Number(existing?.evidence?.occurrenceCount ?? 0) + 1,
    };
    if (existing) {
      await datastore.updateFinding(existing.id, {
        observedAt: report.scan.completedAt,
        evidence,
        description: finding.rationale,
        remediation: { action: finding.recommendation, confidence: finding.confidence },
        author: actor,
      });
      refreshedFindings += 1;
    } else {
      await datastore.createFinding({
        assetId: assetByFile.get(finding.evidence.file)?.id ?? null,
        severity: finding.severity,
        priority: finding.severity,
        type: "PQC_MIGRATION",
        title: finding.title ?? `${finding.algorithm} requires review in ${finding.evidence.file}`,
        description: finding.rationale,
        evidence,
        remediation: { action: finding.recommendation, confidence: finding.confidence },
        source: "repository-scan",
        observedAt: report.scan.completedAt,
        author: actor,
      });
      createdFindings += 1;
    }
  }

  const snapshot = await datastore.createCbomSnapshot({
    name: `Q-Day scan: ${report.scan.targetName}`,
    createdBy: actor,
    createdAt: report.scan.completedAt,
    metadata: {
      source: "repository-scan",
      repository: report.scan.targetName,
      repositoryPath: report.scan.target,
      readinessScore: report.score.readinessScore,
      readinessGrade: report.score.grade,
      filesScanned: report.scan.filesScanned,
      findings: report.summary.totalFindings,
      schemaVersion: report.schemaVersion,
    },
  });
  const event = await datastore.createAuditEvent({
    actor,
    action: "repository_scan.completed",
    entityType: "repository-scan",
    entityId: snapshot.id,
    summary: `${report.scan.targetName} scored ${report.score.readinessScore}/100`,
    metadata: {
      repository: report.scan.targetName,
      filesScanned: report.scan.filesScanned,
      score: report.score,
      summary: report.summary,
      snapshotId: snapshot.id,
    },
  });

  return { report, persistence: { createdAssets, updatedAssets, createdFindings, refreshedFindings, snapshotId: snapshot.id, auditEventId: event.id } };
}
