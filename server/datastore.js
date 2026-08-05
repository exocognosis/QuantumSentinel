import { mkdir, open as openFile, readFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

import { ASSETS } from "../src/mockData.js";

const STORE_VERSION = 1;
const DEFAULT_BACKEND = "auto";
const FINDING_PREFIX = "finding";
const CBOM_PREFIX = "cbom";
const MONITOR_PREFIX = "monitor";
const MONITOR_RUN_PREFIX = "monitor-run";
const AUDIT_PREFIX = "audit";
const REPORT_EXPORT_PREFIX = "report-export";
const APPROVAL_PREFIX = "approval";
const FINDING_STATUSES = new Set(["open", "triaged", "in_progress", "accepted_risk", "remediated", "closed"]);
const TERMINAL_FINDING_STATUSES = new Set(["remediated", "closed"]);
const APPROVAL_STATUSES = new Set(["pending", "approved", "rejected"]);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function isoNow() {
  return new Date().toISOString();
}

function parseAssetId(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error("asset id must be an integer");
  }
  return parsed;
}

function sortByAssetId(left, right) {
  return Number(left.id) - Number(right.id);
}

function sortByCreatedAt(left, right) {
  return String(left.createdAt).localeCompare(String(right.createdAt))
    || String(left.id).localeCompare(String(right.id));
}

function matchesFindingFilters(finding, filters = {}) {
  return (filters.assetId == null || finding.assetId === filters.assetId)
    && (filters.status == null || finding.status === filters.status)
    && (filters.severity == null || finding.severity === filters.severity)
    && (filters.owner == null || finding.owner === filters.owner)
    && (filters.source == null || finding.source === filters.source);
}

function matchesAuditFilters(event, filters = {}) {
  return (filters.entityType == null || event.entityType === filters.entityType)
    && (filters.entityId == null || String(event.entityId) === String(filters.entityId))
    && (filters.action == null || event.action === filters.action)
    && (filters.actor == null || event.actor === filters.actor)
    && (filters.from == null || String(event.occurredAt) >= String(filters.from))
    && (filters.to == null || String(event.occurredAt) <= String(filters.to));
}

function matchesApprovalFilters(approval, filters = {}) {
  return (filters.status == null || approval.status === filters.status)
    && (filters.entityType == null || approval.entityType === filters.entityType)
    && (filters.entityId == null || String(approval.entityId) === String(filters.entityId))
    && (filters.action == null || approval.action === filters.action)
    && (filters.requestedBy == null || approval.requestedBy === filters.requestedBy)
    && (filters.assignedTo == null || approval.assignedTo === filters.assignedTo)
    && (filters.decidedBy == null || approval.decidedBy === filters.decidedBy);
}

function countBy(items, field, value) {
  return items.filter((item) => item[field] === value).length;
}

function countGroup(items, field, fallback = null) {
  const counts = {};
  for (const item of items) {
    const key = item[field] ?? fallback;
    if (key == null) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function pickDefined(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value != null && value !== ""));
}

function normalizeEvidenceFilters(filters = {}) {
  const reportType = filters.reportType ?? undefined;
  const action = filters.action ?? undefined;
  const entityType = filters.entityType ?? undefined;

  return {
    all: pickDefined({ reportType, action, entityType }),
    audit: pickDefined({ action, entityType }),
    approvals: pickDefined({ action, entityType }),
    reportExports: pickDefined({ reportType }),
  };
}

function toCbomEntry(asset) {
  return {
    componentId: `asset-${asset.id}`,
    assetId: asset.id,
    hostname: asset.hostname,
    assetType: asset.type,
    networkSegment: asset.segment,
    cryptography: {
      algorithm: asset.algo,
      protocol: asset.proto,
      classification: asset.cls,
      perfectForwardSecrecy: asset.pfs,
      certificateExpiration: asset.cert_exp,
    },
    risk: {
      hndl: asset.hndl,
      tnfl: asset.tnfl,
      score: asset.risk,
      priority: asset.prio,
    },
    migration: {
      target: asset.migration,
      complexity: asset.complexity,
      hardwareRefreshRequired: asset.migration === "REQUIRES HW REFRESH",
    },
  };
}

export function buildCbomFromAssets(assets) {
  const sortedAssets = assets.toSorted(sortByAssetId);
  const data = sortedAssets.map(toCbomEntry);
  const migrationTargets = {};

  for (const asset of sortedAssets) {
    migrationTargets[asset.migration] = (migrationTargets[asset.migration] ?? 0) + 1;
  }

  return {
    data,
    count: data.length,
    summary: {
      totalComponents: data.length,
      vulnerableComponents: sortedAssets.filter((asset) => !["QUANTUM-SAFE", "QUANTUM-RESISTANT", "PQC", "HYBRID"].includes(asset.cls)).length,
      pfsEnabled: countBy(sortedAssets, "pfs", true),
      requiresHardwareRefresh: countBy(sortedAssets, "migration", "REQUIRES HW REFRESH"),
      migrationTargets,
    },
  };
}

function readJson(value, fallback = null) {
  return value == null ? fallback : JSON.parse(value);
}

function stringify(value) {
  return JSON.stringify(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }

  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function evidenceBundleId({ filters, auditChain, reportExports, approvals, auditEvents }) {
  return `evidence-bundle-${sha256({
    filters,
    auditChain: {
      valid: auditChain.valid,
      count: auditChain.count,
      headHash: auditChain.headHash,
      tailHash: auditChain.tailHash,
      brokenAt: auditChain.brokenAt,
    },
    reportExports: reportExports.map((record) => record.id),
    approvals: approvals.map((approval) => approval.id),
    auditEvents: auditEvents.map((event) => event.id),
  }).slice(0, 16)}`;
}

function summarizeApprovals(approvals) {
  return {
    total: approvals.length,
    pending: approvals.filter((approval) => approval.status === "pending").length,
    approved: approvals.filter((approval) => approval.status === "approved").length,
    rejected: approvals.filter((approval) => approval.status === "rejected").length,
  };
}

function projectAuditChain(auditChain, auditEvents) {
  const ordered = auditEvents.toSorted((left, right) => Number(left.sequence) - Number(right.sequence));
  return {
    ...auditChain,
    count: ordered.length,
    headHash: ordered[0]?.hash ?? null,
    tailHash: ordered.at(-1)?.hash ?? null,
    actions: ordered.map((event) => event.action),
    latestEvent: ordered.at(-1) ?? null,
  };
}

function hashAuditEvent(event) {
  const { hash, ...payload } = event;
  return sha256(payload);
}

function verifyAuditEvents(events) {
  const ordered = events.toSorted((left, right) => Number(left.sequence) - Number(right.sequence));
  let previousHash = null;
  let brokenAt = null;

  for (const event of ordered) {
    const expectedHash = hashAuditEvent(event);
    if (event.previousHash !== previousHash || event.hash !== expectedHash) {
      brokenAt = {
        id: event.id,
        sequence: event.sequence,
        expectedPreviousHash: previousHash,
        actualPreviousHash: event.previousHash,
        expectedHash,
        actualHash: event.hash,
      };
      break;
    }
    previousHash = event.hash;
  }

  return {
    valid: brokenAt == null,
    count: ordered.length,
    headHash: ordered[0]?.hash ?? null,
    tailHash: ordered.at(-1)?.hash ?? null,
    brokenAt,
    actions: ordered.map((event) => event.action),
    latestEvent: ordered.at(-1) ?? null,
  };
}

function createEmptyState() {
  return {
    version: STORE_VERSION,
    assets: {},
    assetHistory: [],
    findings: [],
    probeJobs: [],
    monitorPolicies: [],
    monitorRuns: [],
    cbomSnapshots: [],
    auditEvents: [],
    reportExports: [],
    approvals: [],
    counters: {
      [FINDING_PREFIX]: 1,
      [CBOM_PREFIX]: 1,
      [MONITOR_PREFIX]: 1,
      [MONITOR_RUN_PREFIX]: 1,
      [AUDIT_PREFIX]: 1,
      [REPORT_EXPORT_PREFIX]: 1,
      [APPROVAL_PREFIX]: 1,
    },
  };
}

async function fsyncPath(path) {
  let handle;
  try {
    handle = await openFile(path, "r");
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every platform/filesystem.
  } finally {
    await handle?.close();
  }
}

async function atomicWriteJson(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });

  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(state, null, 2)}\n`;
  let handle;

  try {
    handle = await openFile(tmpPath, "w", 0o600);
    await handle.writeFile(body, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    await rename(tmpPath, filePath);
    await fsyncPath(dirname(filePath));
  } catch (error) {
    await handle?.close();
    await rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function loadSqlite() {
  return import("node:sqlite");
}

class SqliteBackend {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.db = null;
  }

  async open() {
    const sqlite = await loadSqlite();
    await mkdir(dirname(this.filePath), { recursive: true });
    this.db = new sqlite.DatabaseSync(this.filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id INTEGER PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS asset_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        reason TEXT,
        observed_at TEXT NOT NULL,
        asset TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        asset_id INTEGER,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS probe_jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monitor_policies (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        next_run_at TEXT,
        enabled INTEGER NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS monitor_runs (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cbom_snapshots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        count INTEGER NOT NULL,
        summary TEXT NOT NULL,
        metadata TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        summary TEXT,
        previous_hash TEXT,
        hash TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS report_exports (
        id TEXT PRIMARY KEY,
        report_type TEXT NOT NULL,
        report_id TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        audit_event_id TEXT,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
    this.setMetadata("version", String(STORE_VERSION));
    this.initializeCounters();
  }

  async close() {
    this.db?.close();
    this.db = null;
  }

  initializeCounters() {
    if (this.getMetadata(FINDING_PREFIX) == null) {
      this.setMetadata(FINDING_PREFIX, "1");
    }
    if (this.getMetadata(CBOM_PREFIX) == null) {
      this.setMetadata(CBOM_PREFIX, "1");
    }
    if (this.getMetadata(MONITOR_PREFIX) == null) {
      this.setMetadata(MONITOR_PREFIX, "1");
    }
    if (this.getMetadata(MONITOR_RUN_PREFIX) == null) {
      this.setMetadata(MONITOR_RUN_PREFIX, "1");
    }
    if (this.getMetadata(AUDIT_PREFIX) == null) {
      this.setMetadata(AUDIT_PREFIX, "1");
    }
    if (this.getMetadata(REPORT_EXPORT_PREFIX) == null) {
      this.setMetadata(REPORT_EXPORT_PREFIX, "1");
    }
    if (this.getMetadata(APPROVAL_PREFIX) == null) {
      this.setMetadata(APPROVAL_PREFIX, "1");
    }
  }

  getMetadata(key) {
    return this.db.prepare("SELECT value FROM metadata WHERE key = ?").get(key)?.value ?? null;
  }

  setMetadata(key, value) {
    this.db.prepare(`
      INSERT INTO metadata (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  hasAssets() {
    return this.db.prepare("SELECT COUNT(*) AS count FROM assets").get().count > 0;
  }

  nextId(prefix) {
    return this.transaction(() => {
      const current = Number(this.getMetadata(prefix) ?? "1");
      this.setMetadata(prefix, String(current + 1));
      return `${prefix}-${current}`;
    });
  }

  listAssets() {
    return this.db.prepare("SELECT data FROM assets ORDER BY id").all().map((row) => readJson(row.data));
  }

  getAsset(id) {
    const row = this.db.prepare("SELECT data FROM assets WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  upsertAsset(asset, history) {
    return this.transaction(() => {
      this.db.prepare(`
        INSERT INTO assets (id, data, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          updated_at = excluded.updated_at
      `).run(asset.id, stringify(asset), history.observedAt);
      this.db.prepare(`
        INSERT INTO asset_history (asset_id, source, reason, observed_at, asset)
        VALUES (?, ?, ?, ?, ?)
      `).run(asset.id, history.source, history.reason ?? null, history.observedAt, stringify(asset));
      return clone(asset);
    });
  }

  listAssetHistory(assetId) {
    return this.db.prepare(`
      SELECT id, asset_id, source, reason, observed_at, asset
      FROM asset_history
      WHERE asset_id = ?
      ORDER BY id
    `).all(assetId).map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      source: row.source,
      reason: row.reason,
      observedAt: row.observed_at,
      asset: readJson(row.asset),
    }));
  }

  createFinding(finding) {
    this.db.prepare(`
      INSERT INTO findings (id, asset_id, created_at, data)
      VALUES (?, ?, ?, ?)
    `).run(finding.id, finding.assetId ?? null, finding.createdAt, stringify(finding));
    return clone(finding);
  }

  upsertFinding(finding) {
    this.db.prepare(`
      INSERT INTO findings (id, asset_id, created_at, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        asset_id = excluded.asset_id,
        created_at = excluded.created_at,
        data = excluded.data
    `).run(finding.id, finding.assetId ?? null, finding.createdAt, stringify(finding));
    return clone(finding);
  }

  getFinding(id) {
    const row = this.db.prepare("SELECT data FROM findings WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  listFindings(filters = {}) {
    const rows = filters.assetId == null
      ? this.db.prepare("SELECT data FROM findings ORDER BY created_at, id").all()
      : this.db.prepare("SELECT data FROM findings WHERE asset_id = ? ORDER BY created_at, id").all(filters.assetId);
    return rows
      .map((row) => readJson(row.data))
      .filter((finding) => matchesFindingFilters(finding, filters));
  }

  upsertProbeJob(job) {
    this.db.prepare(`
      INSERT INTO probe_jobs (id, created_at, updated_at, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        data = excluded.data
    `).run(job.id, job.createdAt, job.updatedAt, stringify(job));
    return clone(job);
  }

  getProbeJob(id) {
    const row = this.db.prepare("SELECT data FROM probe_jobs WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  listProbeJobs() {
    return this.db.prepare("SELECT data FROM probe_jobs ORDER BY created_at, id").all().map((row) => readJson(row.data));
  }

  upsertMonitorPolicy(policy) {
    this.db.prepare(`
      INSERT INTO monitor_policies (id, created_at, updated_at, next_run_at, enabled, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        next_run_at = excluded.next_run_at,
        enabled = excluded.enabled,
        data = excluded.data
    `).run(
      policy.id,
      policy.createdAt,
      policy.updatedAt,
      policy.nextRunAt,
      policy.enabled ? 1 : 0,
      stringify(policy),
    );
    return clone(policy);
  }

  listMonitorPolicies() {
    return this.db.prepare("SELECT data FROM monitor_policies ORDER BY created_at, id").all().map((row) => readJson(row.data));
  }

  getMonitorPolicy(id) {
    const row = this.db.prepare("SELECT data FROM monitor_policies WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  upsertMonitorRun(run) {
    this.db.prepare(`
      INSERT INTO monitor_runs (id, policy_id, status, started_at, completed_at, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        policy_id = excluded.policy_id,
        status = excluded.status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        data = excluded.data
    `).run(
      run.id,
      run.policyId,
      run.status,
      run.startedAt,
      run.completedAt,
      stringify(run),
    );
    return clone(run);
  }

  getMonitorRun(id) {
    const row = this.db.prepare("SELECT data FROM monitor_runs WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  listMonitorRuns(filters = {}) {
    const rows = filters.policyId == null
      ? this.db.prepare("SELECT data FROM monitor_runs ORDER BY started_at DESC, id DESC").all()
      : this.db.prepare("SELECT data FROM monitor_runs WHERE policy_id = ? ORDER BY started_at DESC, id DESC").all(filters.policyId);

    return rows
      .map((row) => readJson(row.data))
      .filter((run) => filters.status == null || run.status === filters.status);
  }

  createCbomSnapshot(snapshot) {
    this.db.prepare(`
      INSERT INTO cbom_snapshots (id, name, created_at, created_by, count, summary, metadata, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.id,
      snapshot.name,
      snapshot.createdAt,
      snapshot.createdBy,
      snapshot.cbom.count,
      stringify(snapshot.cbom.summary),
      stringify(snapshot.metadata),
      stringify(snapshot),
    );
    return clone(snapshot);
  }

  listCbomSnapshots() {
    return this.db.prepare(`
      SELECT id, name, created_at, created_by, count, summary, metadata
      FROM cbom_snapshots
      ORDER BY created_at, id
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      createdBy: row.created_by,
      count: row.count,
      summary: readJson(row.summary),
      metadata: readJson(row.metadata, {}),
    }));
  }

  getCbomSnapshot(id) {
    const row = this.db.prepare("SELECT data FROM cbom_snapshots WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  lastAuditHash() {
    return this.db.prepare("SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1").get()?.hash ?? null;
  }

  createAuditEvent(event) {
    this.db.prepare(`
      INSERT INTO audit_events (
        id, sequence, occurred_at, actor, action, entity_type, entity_id, summary, previous_hash, hash, data
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.sequence,
      event.occurredAt,
      event.actor,
      event.action,
      event.entityType,
      event.entityId,
      event.summary,
      event.previousHash,
      event.hash,
      stringify(event),
    );
    return clone(event);
  }

  getAuditEvent(id) {
    const row = this.db.prepare("SELECT data FROM audit_events WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  listAuditEvents(filters = {}) {
    return this.db.prepare("SELECT data FROM audit_events ORDER BY sequence DESC").all()
      .map((row) => readJson(row.data))
      .filter((event) => matchesAuditFilters(event, filters))
      .slice(0, filters.limit);
  }

  createReportExport(record) {
    this.db.prepare(`
      INSERT INTO report_exports (
        id, report_type, report_id, generated_at, created_by, payload_hash, audit_event_id, data
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.reportType,
      record.reportId,
      record.generatedAt,
      record.createdBy,
      record.payloadHash,
      record.auditEventId,
      stringify(record),
    );
    return clone(record);
  }

  getReportExport(id) {
    const row = this.db.prepare("SELECT data FROM report_exports WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  listReportExports(filters = {}) {
    return this.db.prepare("SELECT data FROM report_exports ORDER BY generated_at DESC, id DESC").all()
      .map((row) => readJson(row.data))
      .filter((record) => filters.reportType == null || record.reportType === filters.reportType)
      .slice(0, filters.limit);
  }

  upsertApprovalRequest(approval) {
    this.db.prepare(`
      INSERT INTO approvals (id, status, entity_type, entity_id, action, requested_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        entity_type = excluded.entity_type,
        entity_id = excluded.entity_id,
        action = excluded.action,
        requested_at = excluded.requested_at,
        updated_at = excluded.updated_at,
        data = excluded.data
    `).run(
      approval.id,
      approval.status,
      approval.entityType,
      approval.entityId,
      approval.action,
      approval.requestedAt,
      approval.updatedAt,
      stringify(approval),
    );
    return clone(approval);
  }

  getApprovalRequest(id) {
    const row = this.db.prepare("SELECT data FROM approvals WHERE id = ?").get(id);
    return readJson(row?.data);
  }

  listApprovalRequests(filters = {}) {
    return this.db.prepare("SELECT data FROM approvals ORDER BY requested_at DESC, id DESC").all()
      .map((row) => readJson(row.data))
      .filter((approval) => matchesApprovalFilters(approval, filters))
      .slice(0, filters.limit);
  }
}

class JsonBackend {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = null;
  }

  async open() {
    try {
      this.state = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.state = createEmptyState();
      await this.persist();
    }
    this.state.version = STORE_VERSION;
    this.state.assets ??= {};
    this.state.assetHistory ??= [];
    this.state.findings ??= [];
    this.state.probeJobs ??= [];
    this.state.monitorPolicies ??= [];
    this.state.monitorRuns ??= [];
    this.state.cbomSnapshots ??= [];
    this.state.auditEvents ??= [];
    this.state.reportExports ??= [];
    this.state.approvals ??= [];
    this.state.counters ??= {};
    this.state.counters[FINDING_PREFIX] ??= 1;
    this.state.counters[CBOM_PREFIX] ??= 1;
    this.state.counters[MONITOR_PREFIX] ??= 1;
    this.state.counters[MONITOR_RUN_PREFIX] ??= 1;
    this.state.counters[AUDIT_PREFIX] ??= 1;
    this.state.counters[REPORT_EXPORT_PREFIX] ??= 1;
    this.state.counters[APPROVAL_PREFIX] ??= 1;
  }

  async close() {
    this.state = null;
  }

  async persist() {
    await atomicWriteJson(this.filePath, this.state);
  }

  hasAssets() {
    return Object.keys(this.state.assets).length > 0;
  }

  nextId(prefix) {
    const current = Number(this.state.counters[prefix] ?? 1);
    this.state.counters[prefix] = current + 1;
    return `${prefix}-${current}`;
  }

  listAssets() {
    return Object.values(this.state.assets).map(clone).toSorted(sortByAssetId);
  }

  getAsset(id) {
    return clone(this.state.assets[String(id)] ?? null);
  }

  async upsertAsset(asset, history) {
    this.state.assets[String(asset.id)] = clone(asset);
    this.state.assetHistory.push({
      id: this.state.assetHistory.length + 1,
      assetId: asset.id,
      source: history.source,
      reason: history.reason ?? null,
      observedAt: history.observedAt,
      asset: clone(asset),
    });
    await this.persist();
    return clone(asset);
  }

  listAssetHistory(assetId) {
    return this.state.assetHistory
      .filter((entry) => entry.assetId === assetId)
      .map(clone);
  }

  async createFinding(finding) {
    this.state.findings.push(clone(finding));
    await this.persist();
    return clone(finding);
  }

  async upsertFinding(finding) {
    const index = this.state.findings.findIndex((candidate) => candidate.id === finding.id);
    if (index === -1) {
      this.state.findings.push(clone(finding));
    } else {
      this.state.findings[index] = clone(finding);
    }
    await this.persist();
    return clone(finding);
  }

  getFinding(id) {
    return clone(this.state.findings.find((finding) => finding.id === id) ?? null);
  }

  listFindings(filters = {}) {
    return this.state.findings
      .filter((finding) => matchesFindingFilters(finding, filters))
      .toSorted(sortByCreatedAt)
      .map(clone);
  }

  async upsertProbeJob(job) {
    const index = this.state.probeJobs.findIndex((candidate) => candidate.id === job.id);
    if (index === -1) {
      this.state.probeJobs.push(clone(job));
    } else {
      this.state.probeJobs[index] = clone(job);
    }
    await this.persist();
    return clone(job);
  }

  getProbeJob(id) {
    return clone(this.state.probeJobs.find((job) => job.id === id) ?? null);
  }

  listProbeJobs() {
    return this.state.probeJobs.toSorted(sortByCreatedAt).map(clone);
  }

  async upsertMonitorPolicy(policy) {
    const index = this.state.monitorPolicies.findIndex((candidate) => candidate.id === policy.id);
    if (index === -1) {
      this.state.monitorPolicies.push(clone(policy));
    } else {
      this.state.monitorPolicies[index] = clone(policy);
    }
    await this.persist();
    return clone(policy);
  }

  listMonitorPolicies() {
    return this.state.monitorPolicies.toSorted(sortByCreatedAt).map(clone);
  }

  getMonitorPolicy(id) {
    return clone(this.state.monitorPolicies.find((policy) => policy.id === id) ?? null);
  }

  async upsertMonitorRun(run) {
    const index = this.state.monitorRuns.findIndex((candidate) => candidate.id === run.id);
    if (index === -1) {
      this.state.monitorRuns.push(clone(run));
    } else {
      this.state.monitorRuns[index] = clone(run);
    }
    await this.persist();
    return clone(run);
  }

  getMonitorRun(id) {
    return clone(this.state.monitorRuns.find((run) => run.id === id) ?? null);
  }

  listMonitorRuns(filters = {}) {
    return this.state.monitorRuns
      .filter((run) => filters.policyId == null || run.policyId === filters.policyId)
      .filter((run) => filters.status == null || run.status === filters.status)
      .toSorted((left, right) => (
        String(right.startedAt).localeCompare(String(left.startedAt))
        || String(right.id).localeCompare(String(left.id))
      ))
      .map(clone);
  }

  async createCbomSnapshot(snapshot) {
    this.state.cbomSnapshots.push(clone(snapshot));
    await this.persist();
    return clone(snapshot);
  }

  listCbomSnapshots() {
    return this.state.cbomSnapshots.toSorted(sortByCreatedAt).map((snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      createdBy: snapshot.createdBy,
      count: snapshot.cbom.count,
      summary: clone(snapshot.cbom.summary),
      metadata: clone(snapshot.metadata),
    }));
  }

  getCbomSnapshot(id) {
    return clone(this.state.cbomSnapshots.find((snapshot) => snapshot.id === id) ?? null);
  }

  lastAuditHash() {
    return this.state.auditEvents.at(-1)?.hash ?? null;
  }

  async createAuditEvent(event) {
    this.state.auditEvents.push(clone(event));
    await this.persist();
    return clone(event);
  }

  getAuditEvent(id) {
    return clone(this.state.auditEvents.find((event) => event.id === id) ?? null);
  }

  listAuditEvents(filters = {}) {
    return this.state.auditEvents
      .filter((event) => matchesAuditFilters(event, filters))
      .toSorted((left, right) => Number(right.sequence) - Number(left.sequence))
      .slice(0, filters.limit)
      .map(clone);
  }

  async createReportExport(record) {
    this.state.reportExports.push(clone(record));
    await this.persist();
    return clone(record);
  }

  getReportExport(id) {
    return clone(this.state.reportExports.find((record) => record.id === id) ?? null);
  }

  listReportExports(filters = {}) {
    return this.state.reportExports
      .filter((record) => filters.reportType == null || record.reportType === filters.reportType)
      .toSorted((left, right) => (
        String(right.generatedAt).localeCompare(String(left.generatedAt))
        || String(right.id).localeCompare(String(left.id))
      ))
      .slice(0, filters.limit)
      .map(clone);
  }

  async upsertApprovalRequest(approval) {
    const index = this.state.approvals.findIndex((candidate) => candidate.id === approval.id);
    if (index === -1) {
      this.state.approvals.push(clone(approval));
    } else {
      this.state.approvals[index] = clone(approval);
    }
    await this.persist();
    return clone(approval);
  }

  getApprovalRequest(id) {
    return clone(this.state.approvals.find((approval) => approval.id === id) ?? null);
  }

  listApprovalRequests(filters = {}) {
    return this.state.approvals
      .filter((approval) => matchesApprovalFilters(approval, filters))
      .toSorted((left, right) => (
        String(right.requestedAt).localeCompare(String(left.requestedAt))
        || String(right.id).localeCompare(String(left.id))
      ))
      .slice(0, filters.limit)
      .map(clone);
  }
}

function normalizeAsset(assetLike, existing = {}) {
  const source = assetLike.result ?? assetLike;
  const probeObservation = assetLike.result != null;
  const target = assetLike.target ?? {};
  const certificate = source.certificate ?? {};
  const protocol = source.protocol ?? {};
  const classification = source.classification ?? {};
  const id = parseAssetId(assetLike.id ?? assetLike.assetId ?? target.assetId ?? existing.id);

  return {
    ...existing,
    id,
    hostname: assetLike.hostname ?? target.hostname ?? target.host ?? certificate.subject ?? existing.hostname,
    ip: assetLike.ip ?? existing.ip ?? null,
    type: assetLike.type ?? existing.type ?? "Observed Endpoint",
    algo: assetLike.algo ?? certificate.algorithm ?? existing.algo ?? "Unknown",
    proto: assetLike.proto ?? protocol.name ?? existing.proto ?? "Unknown",
    cls: assetLike.cls ?? classification.label ?? existing.cls ?? "UNKNOWN",
    hndl: assetLike.hndl ?? existing.hndl ?? (probeObservation ? null : 0),
    tnfl: assetLike.tnfl ?? existing.tnfl ?? (probeObservation ? null : 0),
    risk: assetLike.risk ?? existing.risk ?? (probeObservation ? null : 0),
    prio: assetLike.prio ?? classification.priority ?? existing.prio ?? "MONITOR",
    segment: assetLike.segment ?? existing.segment ?? "Unknown",
    pfs: assetLike.pfs ?? protocol.perfectForwardSecrecy ?? existing.pfs ?? false,
    cert_exp: assetLike.cert_exp ?? certificate.expiresAt ?? existing.cert_exp ?? "N/A",
    migration: assetLike.migration ?? existing.migration ?? "Assess migration path",
    complexity: assetLike.complexity ?? existing.complexity ?? "UNKNOWN",
  };
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function conflictError(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function normalizeFindingStatus(status) {
  const normalized = status ?? "open";
  if (!FINDING_STATUSES.has(normalized)) {
    throw validationError(`finding status must be one of: ${[...FINDING_STATUSES].join(", ")}`);
  }
  return normalized;
}

function normalizeApprovalStatus(status) {
  const normalized = status ?? "pending";
  if (!APPROVAL_STATUSES.has(normalized)) {
    throw validationError(`approval status must be one of: ${[...APPROVAL_STATUSES].join(", ")}`);
  }
  return normalized;
}

function normalizeHistoryEntry(entry, fallback = {}) {
  return {
    at: entry.at ?? fallback.at,
    author: entry.author ?? fallback.author ?? "system",
    action: entry.action ?? fallback.action,
    status: entry.status ?? fallback.status,
  };
}

function normalizeNote(note, now) {
  const text = typeof note === "string" ? note : note?.text;
  if (typeof text !== "string" || text.trim() === "") {
    throw validationError("finding note text is required");
  }

  return {
    at: note?.at ?? now,
    author: note?.author ?? "system",
    text,
  };
}

function enrichFinding(finding, asset, id, now) {
  const status = normalizeFindingStatus(finding.status);
  const createdAt = finding.createdAt ?? now;
  const updatedAt = finding.updatedAt ?? createdAt;
  const closedAt = TERMINAL_FINDING_STATUSES.has(status)
    ? (finding.closedAt ?? updatedAt)
    : null;

  return {
    id,
    assetId: finding.assetId == null ? null : parseAssetId(finding.assetId),
    severity: finding.severity ?? "INFO",
    type: finding.type ?? "GENERAL",
    title: finding.title ?? "Cryptographic finding",
    description: finding.description ?? null,
    evidence: clone(finding.evidence ?? {}),
    source: finding.source ?? "manual",
    status,
    owner: finding.owner ?? null,
    dueAt: finding.dueAt ?? null,
    priority: finding.priority ?? finding.severity ?? "INFO",
    approvalId: finding.approvalId ?? null,
    remediation: clone(finding.remediation ?? null),
    resolution: clone(finding.resolution ?? null),
    observedAt: finding.observedAt ?? now,
    createdAt,
    updatedAt,
    closedAt,
    notes: (finding.notes ?? []).map((note) => normalizeNote(note, (typeof note === "object" && note !== null ? note.at : null) ?? updatedAt)),
    history: (finding.history ?? [normalizeHistoryEntry({}, {
      at: createdAt,
      author: finding.author ?? "system",
      action: "created",
      status,
    })]).map((entry) => normalizeHistoryEntry(entry, {
      at: createdAt,
      author: "system",
      action: "updated",
      status,
    })),
    asset: asset ? {
      id: asset.id,
      hostname: asset.hostname,
      ip: asset.ip,
      type: asset.type,
    } : null,
  };
}

function updateFindingRecord(existing, patch = {}, now) {
  const updatedAt = patch.updatedAt ?? now;
  const status = patch.status == null ? existing.status : normalizeFindingStatus(patch.status);
  const next = {
    ...existing,
    severity: Object.hasOwn(patch, "severity") ? patch.severity : existing.severity,
    type: Object.hasOwn(patch, "type") ? patch.type : existing.type,
    title: Object.hasOwn(patch, "title") ? patch.title : existing.title,
    description: Object.hasOwn(patch, "description") ? patch.description : existing.description,
    evidence: Object.hasOwn(patch, "evidence") ? clone(patch.evidence) : clone(existing.evidence),
    source: Object.hasOwn(patch, "source") ? patch.source : existing.source,
    observedAt: Object.hasOwn(patch, "observedAt") ? patch.observedAt : existing.observedAt,
    status,
    owner: Object.hasOwn(patch, "owner") ? patch.owner : existing.owner,
    dueAt: Object.hasOwn(patch, "dueAt") ? patch.dueAt : existing.dueAt,
    priority: Object.hasOwn(patch, "priority") ? patch.priority : existing.priority,
    approvalId: Object.hasOwn(patch, "approvalId") ? patch.approvalId : existing.approvalId,
    remediation: Object.hasOwn(patch, "remediation") ? clone(patch.remediation) : clone(existing.remediation),
    resolution: Object.hasOwn(patch, "resolution") ? clone(patch.resolution) : clone(existing.resolution),
    updatedAt,
    closedAt: TERMINAL_FINDING_STATUSES.has(status) ? (patch.closedAt ?? existing.closedAt ?? updatedAt) : null,
    notes: (existing.notes ?? []).map(clone),
    history: (existing.history ?? []).map(clone),
  };

  if (Object.hasOwn(patch, "note")) {
    next.notes.push(normalizeNote({
      text: patch.note,
      author: patch.author,
      at: updatedAt,
    }, updatedAt));
  }

  next.history.push({
    at: updatedAt,
    author: patch.author ?? "system",
    action: "updated",
    status,
  });

  return next;
}

function appendFindingNoteRecord(existing, note = {}, now) {
  const at = note.at ?? now;
  return {
    ...existing,
    updatedAt: at,
    notes: [
      ...(existing.notes ?? []).map(clone),
      normalizeNote(note, at),
    ],
    history: [
      ...(existing.history ?? []).map(clone),
      {
        at,
        author: note.author ?? "system",
        action: "note_added",
        status: existing.status,
      },
    ],
  };
}

function isDueActive(finding) {
  return !TERMINAL_FINDING_STATUSES.has(finding.status);
}

function summarizeRemediation(findings, now) {
  const currentTime = new Date(now).getTime();
  const dueSoonEnd = currentTime + (7 * 24 * 60 * 60 * 1000);
  const active = findings.filter(isDueActive);

  return {
    total: findings.length,
    byStatus: countGroup(findings, "status"),
    bySeverity: countGroup(findings, "severity"),
    byOwner: countGroup(findings, "owner", "unassigned"),
    overdue: active.filter((finding) => {
      const due = finding.dueAt == null ? Number.NaN : new Date(finding.dueAt).getTime();
      return Number.isFinite(due) && due < currentTime;
    }).length,
    dueSoon: active.filter((finding) => {
      const due = finding.dueAt == null ? Number.NaN : new Date(finding.dueAt).getTime();
      return Number.isFinite(due) && due >= currentTime && due <= dueSoonEnd;
    }).length,
    openCritical: active.filter((finding) => finding.severity === "CRITICAL").length,
  };
}

function normalizeProbeJob(job, now) {
  if (!job?.id) throw new Error("probe job id is required");

  return {
    ...clone(job),
    createdAt: job.createdAt ?? now,
    updatedAt: job.updatedAt ?? job.completedAt ?? now,
  };
}

function normalizeMonitorPolicy(policy, now, id) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("monitor policy must be an object");
  }

  if (!policy.probeRequest || typeof policy.probeRequest !== "object" || Array.isArray(policy.probeRequest)) {
    throw new Error("monitor policy probeRequest is required");
  }

  const createdAt = policy.createdAt ?? now;
  const updatedAt = policy.updatedAt ?? createdAt;

  return {
    id: id ?? policy.id,
    name: policy.name ?? "Monitor policy",
    enabled: policy.enabled === true,
    probeRequest: clone(policy.probeRequest),
    intervalSeconds: policy.intervalSeconds,
    nextRunAt: policy.nextRunAt ?? null,
    lastRunAt: policy.lastRunAt ?? null,
    lastJobId: policy.lastJobId ?? null,
    createdAt,
    updatedAt,
  };
}

function parseCount(value, field) {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeMonitorRun(run, now, id) {
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new Error("monitor run must be an object");
  }

  if (!run.policyId) {
    throw new Error("monitor run policyId is required");
  }

  const startedAt = run.startedAt ?? now;

  return {
    id: id ?? run.id,
    policyId: String(run.policyId),
    policyName: run.policyName ?? "Monitor policy",
    status: run.status ?? "running",
    trigger: run.trigger ?? "manual",
    startedAt,
    completedAt: run.completedAt ?? null,
    jobId: run.jobId ?? null,
    error: run.error ?? null,
    summary: clone(run.summary ?? {}),
    observationsCount: parseCount(run.observationsCount, "observationsCount"),
    findingsCount: parseCount(run.findingsCount, "findingsCount"),
    evidenceCount: parseCount(run.evidenceCount, "evidenceCount"),
    evidenceRefs: clone(run.evidenceRefs ?? []),
    findingIds: clone(run.findingIds ?? []),
  };
}

function normalizeAuditLimit(value) {
  const parsed = Number(value ?? 100);
  if (!Number.isInteger(parsed)) return 100;
  return Math.min(500, Math.max(1, parsed));
}

function normalizeAuditEvent(input, {
  id,
  sequence,
  occurredAt,
  previousHash,
}) {
  const event = {
    id,
    sequence,
    occurredAt,
    actor: input.actor ?? "system",
    action: input.action ?? "updated",
    entityType: input.entityType ?? "system",
    entityId: input.entityId == null ? null : String(input.entityId),
    summary: input.summary ?? null,
    before: clone(input.before ?? null),
    after: clone(input.after ?? null),
    metadata: clone(input.metadata ?? {}),
    correlationId: input.correlationId ?? null,
    previousHash,
  };
  return {
    ...event,
    hash: sha256(event),
  };
}

function normalizeReportExport(record, {
  id,
  generatedAt,
  auditEventId = null,
}) {
  const report = record.report;
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("report export requires a report object");
  }

  return {
    id,
    reportType: record.reportType ?? report.type,
    reportId: record.reportId ?? report.reportId,
    generatedAt: record.generatedAt ?? report.generatedAt ?? generatedAt,
    createdBy: record.createdBy ?? record.actor ?? "system",
    scope: clone(record.scope ?? report.scope ?? {}),
    summary: clone(record.summary ?? report.summary ?? {}),
    evidenceRefs: clone(record.evidenceRefs ?? report.evidenceRefs ?? []),
    payloadHash: record.payloadHash ?? sha256(report),
    auditEventId,
    approvalId: record.approvalId ?? null,
    metadata: clone(record.metadata ?? {}),
  };
}

function normalizeApprovalRequest(input, {
  id,
  now,
}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw validationError("approval request payload must be an object");
  }

  if (!input.entityType) throw validationError("approval entityType is required");
  if (input.entityId == null || input.entityId === "") throw validationError("approval entityId is required");
  if (!input.action) throw validationError("approval action is required");

  const requestedAt = input.requestedAt ?? now;
  const status = normalizeApprovalStatus(input.status);

  return {
    id,
    entityType: String(input.entityType),
    entityId: String(input.entityId),
    action: String(input.action),
    status,
    requestedBy: input.requestedBy ?? input.actor ?? "system",
    assignedTo: input.assignedTo ?? null,
    justification: input.justification ?? input.reason ?? null,
    requestedAt,
    updatedAt: input.updatedAt ?? requestedAt,
    decidedAt: input.decidedAt ?? null,
    decidedBy: input.decidedBy ?? null,
    decisionNote: input.decisionNote ?? null,
    metadata: clone(input.metadata ?? {}),
  };
}

function decideApprovalRequest(existing, {
  status,
  actor = "system",
  note = null,
  at,
}) {
  if (existing.status !== "pending") {
    throw conflictError("approval request has already been decided");
  }

  const normalizedStatus = normalizeApprovalStatus(status);
  if (normalizedStatus === "pending") {
    throw validationError("approval decision must be approved or rejected");
  }

  return {
    ...existing,
    status: normalizedStatus,
    updatedAt: at,
    decidedAt: at,
    decidedBy: actor,
    decisionNote: note,
  };
}

export class QuantumSentinelDatastore {
  constructor({
    backend = DEFAULT_BACKEND,
    filePath,
    seedAssets = ASSETS,
    now = isoNow,
  } = {}) {
    if (!filePath) {
      throw new Error("filePath is required");
    }

    this.backendName = backend;
    this.filePath = filePath;
    this.seedAssets = seedAssets;
    this.now = now;
    this.backend = null;
    this.opened = false;
  }

  async open() {
    if (this.opened) return this;

    this.backend = await this.createBackend();
    await this.backend.open();
    await this.seedIfEmpty();
    this.opened = true;
    return this;
  }

  async createBackend() {
    if (this.backendName === "json") {
      return new JsonBackend({ filePath: this.filePath });
    }

    if (this.backendName === "sqlite" || this.backendName === "auto") {
      try {
        await loadSqlite();
        this.backendName = "sqlite";
        return new SqliteBackend({ filePath: this.filePath });
      } catch (error) {
        if (this.backendName === "sqlite") throw error;
        this.backendName = "json";
        return new JsonBackend({ filePath: this.filePath });
      }
    }

    throw new Error(`unsupported datastore backend: ${this.backendName}`);
  }

  async close() {
    await this.backend?.close();
    this.backend = null;
    this.opened = false;
  }

  async seedIfEmpty() {
    if (this.backend.hasAssets()) return;

    for (const seedAsset of this.seedAssets) {
      const asset = normalizeAsset(seedAsset);
      await this.backend.upsertAsset(asset, {
        source: "seed",
        reason: "initialization",
        observedAt: this.now(),
      });
    }
  }

  requireOpen() {
    if (!this.backend) {
      throw new Error("datastore is not open");
    }
  }

  async listAssets() {
    this.requireOpen();
    return this.backend.listAssets();
  }

  async getAsset(id) {
    this.requireOpen();
    return this.backend.getAsset(parseAssetId(id));
  }

  async upsertAsset(assetLike, {
    source = "manual",
    reason = null,
    observedAt = this.now(),
  } = {}) {
    this.requireOpen();
    const existing = this.backend.getAsset(parseAssetId(assetLike.id ?? assetLike.assetId ?? assetLike.target?.assetId));
    const asset = normalizeAsset(assetLike, existing ?? {});
    const saved = await this.backend.upsertAsset(asset, { source, reason, observedAt });
    await this.createAuditEvent({
      action: existing ? "asset.updated" : "asset.created",
      entityType: "asset",
      entityId: saved.id,
      summary: `${saved.hostname} asset ${existing ? "updated" : "created"}`,
      before: existing,
      after: saved,
      metadata: { source, reason },
    });
    return saved;
  }

  async upsertAssetFromProbe(probeJob, options = {}) {
    return this.upsertAsset(probeJob, {
      source: "probe",
      reason: probeJob.status ?? "observation",
      observedAt: probeJob.completedAt ?? probeJob.updatedAt ?? this.now(),
      ...options,
    });
  }

  async listAssetHistory(assetId) {
    this.requireOpen();
    return this.backend.listAssetHistory(parseAssetId(assetId));
  }

  async createFinding(finding) {
    this.requireOpen();
    const now = finding.createdAt ?? finding.observedAt ?? this.now();
    const assetId = finding.assetId == null ? null : parseAssetId(finding.assetId);
    const asset = assetId == null ? null : this.backend.getAsset(assetId);
    const id = finding.id ?? this.backend.nextId(FINDING_PREFIX);
    const record = enrichFinding({ ...finding, assetId }, asset, id, now);
    const saved = await this.backend.createFinding(record);
    await this.createAuditEvent({
      actor: finding.author ?? "system",
      action: "finding.created",
      entityType: "finding",
      entityId: saved.id,
      summary: saved.title,
      after: saved,
      metadata: { assetId: saved.assetId, severity: saved.severity, source: saved.source },
    });
    return saved;
  }

  async getFinding(id) {
    this.requireOpen();
    return this.backend.getFinding(String(id));
  }

  async updateFinding(id, patch) {
    this.requireOpen();
    const existing = this.backend.getFinding(String(id));
    if (!existing) return null;
    const saved = await this.backend.upsertFinding(updateFindingRecord(existing, patch, this.now()));
    await this.createAuditEvent({
      actor: patch.author ?? "system",
      action: "finding.updated",
      entityType: "finding",
      entityId: saved.id,
      summary: saved.title,
      before: existing,
      after: saved,
      metadata: { status: saved.status, owner: saved.owner },
    });
    return saved;
  }

  async appendFindingNote(id, note) {
    this.requireOpen();
    const existing = this.backend.getFinding(String(id));
    if (!existing) return null;
    const saved = await this.backend.upsertFinding(appendFindingNoteRecord(existing, note, this.now()));
    await this.createAuditEvent({
      actor: note.author ?? "system",
      action: "finding.note_added",
      entityType: "finding",
      entityId: saved.id,
      summary: saved.title,
      before: { notes: existing.notes, updatedAt: existing.updatedAt },
      after: { notes: saved.notes, updatedAt: saved.updatedAt },
    });
    return saved;
  }

  async listFindings(filters = {}) {
    this.requireOpen();
    const normalized = {
      ...filters,
      assetId: filters.assetId == null ? undefined : parseAssetId(filters.assetId),
      status: filters.status ?? undefined,
      severity: filters.severity ?? undefined,
      owner: filters.owner ?? undefined,
      source: filters.source ?? undefined,
    };
    return this.backend.listFindings(normalized);
  }

  async getRemediationSummary({ now = this.now() } = {}) {
    this.requireOpen();
    return summarizeRemediation(await this.backend.listFindings(), now);
  }

  async createProbeJob(job) {
    this.requireOpen();
    const saved = await this.backend.upsertProbeJob(normalizeProbeJob(job, this.now()));
    await this.createAuditEvent({
      action: "probe.recorded",
      entityType: "probe-job",
      entityId: saved.id,
      summary: `${saved.mode ?? "probe"} ${saved.status ?? "recorded"}`,
      after: saved,
      metadata: { mode: saved.mode, status: saved.status, assetId: saved.target?.assetId ?? null },
    });
    return saved;
  }

  async updateProbeJob(id, patch) {
    this.requireOpen();
    const existing = this.backend.getProbeJob(id);
    if (!existing) return null;
    const now = patch.updatedAt ?? patch.completedAt ?? this.now();
    const saved = await this.backend.upsertProbeJob(normalizeProbeJob({
      ...existing,
      ...patch,
      id,
      updatedAt: now,
    }, now));
    await this.createAuditEvent({
      action: "probe.updated",
      entityType: "probe-job",
      entityId: saved.id,
      summary: `${saved.mode ?? "probe"} ${saved.status ?? "updated"}`,
      before: existing,
      after: saved,
      metadata: { mode: saved.mode, status: saved.status },
    });
    return saved;
  }

  async getProbeJob(id) {
    this.requireOpen();
    return this.backend.getProbeJob(id);
  }

  async listProbeJobs() {
    this.requireOpen();
    return this.backend.listProbeJobs();
  }

  async createMonitorPolicy(policy) {
    this.requireOpen();
    const now = policy.createdAt ?? this.now();
    const record = normalizeMonitorPolicy(policy, now, policy.id ?? this.backend.nextId(MONITOR_PREFIX));
    const saved = await this.backend.upsertMonitorPolicy(record);
    await this.createAuditEvent({
      action: "monitor.created",
      entityType: "monitor",
      entityId: saved.id,
      summary: saved.name,
      after: saved,
      metadata: { enabled: saved.enabled, intervalSeconds: saved.intervalSeconds },
    });
    return saved;
  }

  async updateMonitorPolicy(id, patch) {
    this.requireOpen();
    const existing = this.backend.getMonitorPolicy(id);
    if (!existing) return null;
    const now = patch.updatedAt ?? this.now();
    const record = normalizeMonitorPolicy({
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: now,
    }, now, id);
    const saved = await this.backend.upsertMonitorPolicy(record);
    await this.createAuditEvent({
      action: "monitor.updated",
      entityType: "monitor",
      entityId: saved.id,
      summary: saved.name,
      before: existing,
      after: saved,
      metadata: { enabled: saved.enabled, nextRunAt: saved.nextRunAt },
    });
    return saved;
  }

  async getMonitorPolicy(id) {
    this.requireOpen();
    return this.backend.getMonitorPolicy(id);
  }

  async listMonitorPolicies() {
    this.requireOpen();
    return this.backend.listMonitorPolicies();
  }

  async createMonitorRun(run) {
    this.requireOpen();
    const now = run.startedAt ?? this.now();
    const record = normalizeMonitorRun(run, now, run.id ?? this.backend.nextId(MONITOR_RUN_PREFIX));
    const saved = await this.backend.upsertMonitorRun(record);
    await this.createAuditEvent({
      action: "monitor_run.created",
      entityType: "monitor-run",
      entityId: saved.id,
      summary: `${saved.policyName} ${saved.status}`,
      after: saved,
      metadata: { policyId: saved.policyId, trigger: saved.trigger, status: saved.status },
    });
    return saved;
  }

  async updateMonitorRun(id, patch) {
    this.requireOpen();
    const existing = this.backend.getMonitorRun(id);
    if (!existing) return null;
    const now = patch.startedAt ?? existing.startedAt ?? this.now();
    const record = normalizeMonitorRun({
      ...existing,
      ...patch,
      id,
      startedAt: patch.startedAt ?? existing.startedAt,
    }, now, id);
    const saved = await this.backend.upsertMonitorRun(record);
    await this.createAuditEvent({
      action: "monitor_run.updated",
      entityType: "monitor-run",
      entityId: saved.id,
      summary: `${saved.policyName} ${saved.status}`,
      before: existing,
      after: saved,
      metadata: { policyId: saved.policyId, status: saved.status },
    });
    return saved;
  }

  async getMonitorRun(id) {
    this.requireOpen();
    return this.backend.getMonitorRun(id);
  }

  async listMonitorRuns(filters = {}) {
    this.requireOpen();
    return this.backend.listMonitorRuns(filters);
  }

  async createCbomSnapshot({
    id = null,
    name = "snapshot",
    createdBy = null,
    metadata = {},
    createdAt = this.now(),
  } = {}) {
    this.requireOpen();
    const cbom = buildCbomFromAssets(this.backend.listAssets());
    const snapshot = {
      id: id ?? this.backend.nextId(CBOM_PREFIX),
      name,
      createdAt,
      createdBy,
      metadata: clone(metadata),
      cbom,
    };
    const saved = await this.backend.createCbomSnapshot(snapshot);
    await this.createAuditEvent({
      actor: saved.createdBy ?? "system",
      action: "cbom_snapshot.created",
      entityType: "cbom-snapshot",
      entityId: saved.id,
      summary: saved.name,
      after: {
        id: saved.id,
        name: saved.name,
        createdAt: saved.createdAt,
        count: saved.cbom.count,
        summary: saved.cbom.summary,
      },
      metadata: saved.metadata,
    });
    return saved;
  }

  async listCbomSnapshots() {
    this.requireOpen();
    return this.backend.listCbomSnapshots();
  }

  async getCbomSnapshot(id) {
    this.requireOpen();
    return this.backend.getCbomSnapshot(id);
  }

  async createAuditEvent(event) {
    this.requireOpen();
    const sequence = Number(this.backend.nextId(AUDIT_PREFIX).replace(`${AUDIT_PREFIX}-`, ""));
    const id = `${AUDIT_PREFIX}-${sequence}`;
    const record = normalizeAuditEvent(event, {
      id,
      sequence,
      occurredAt: event.occurredAt ?? this.now(),
      previousHash: this.backend.lastAuditHash(),
    });
    return this.backend.createAuditEvent(record);
  }

  async getAuditEvent(id) {
    this.requireOpen();
    return this.backend.getAuditEvent(String(id));
  }

  async listAuditEvents(filters = {}) {
    this.requireOpen();
    return this.backend.listAuditEvents({
      entityType: filters.entityType ?? undefined,
      entityId: filters.entityId ?? undefined,
      action: filters.action ?? undefined,
      actor: filters.actor ?? undefined,
      from: filters.from ?? undefined,
      to: filters.to ?? undefined,
      limit: normalizeAuditLimit(filters.limit),
    });
  }

  async createReportExport(record) {
    this.requireOpen();
    const generatedAt = record.generatedAt ?? record.report?.generatedAt ?? this.now();
    const id = record.id ?? this.backend.nextId(REPORT_EXPORT_PREFIX);
    const draft = normalizeReportExport(record, { id, generatedAt });
    const auditEvent = await this.createAuditEvent({
      actor: draft.createdBy,
      action: "report.exported",
      entityType: "report-export",
      entityId: id,
      summary: `${draft.reportType} report exported`,
      after: {
        id,
        reportType: draft.reportType,
        reportId: draft.reportId,
        payloadHash: draft.payloadHash,
      },
      metadata: draft.metadata,
    });
    const saved = normalizeReportExport(record, {
      id,
      generatedAt,
      auditEventId: auditEvent.id,
    });
    return this.backend.createReportExport(saved);
  }

  async getReportExport(id) {
    this.requireOpen();
    return this.backend.getReportExport(String(id));
  }

  async listReportExports(filters = {}) {
    this.requireOpen();
    return this.backend.listReportExports({
      reportType: filters.reportType ?? undefined,
      limit: normalizeAuditLimit(filters.limit),
    });
  }

  async verifyAuditChain(filters = {}) {
    this.requireOpen();
    const events = await this.listAuditEvents({
      ...filters,
      limit: filters.limit ?? 500,
    });
    return verifyAuditEvents(events);
  }

  async getReportExportManifest(id) {
    this.requireOpen();
    const record = this.backend.getReportExport(String(id));
    if (!record) return null;
    return {
      ...record,
      auditChain: await this.verifyAuditChain(),
    };
  }

  async getEvidenceArchiveSummary(filters = {}) {
    this.requireOpen();
    const evidenceFilters = normalizeEvidenceFilters(filters);
    const [auditChain, auditEvents, reportExports, approvals] = await Promise.all([
      this.verifyAuditChain(),
      this.listAuditEvents({ ...evidenceFilters.audit, limit: 500 }),
      this.listReportExports({ ...evidenceFilters.reportExports, limit: 100 }),
      this.listApprovalRequests({ ...evidenceFilters.approvals, limit: 100 }),
    ]);
    const approvalSummary = summarizeApprovals(approvals);

    return {
      generatedAt: this.now(),
      filters: evidenceFilters.all,
      auditChain: projectAuditChain(auditChain, auditEvents),
      reportExports: {
        count: reportExports.length,
        latest: reportExports[0] ?? null,
        byType: countGroup(reportExports, "reportType"),
        items: reportExports,
      },
      approvals: {
        ...approvalSummary,
        items: approvals,
      },
    };
  }

  async getEvidenceBundle(filters = {}) {
    this.requireOpen();
    const evidenceFilters = normalizeEvidenceFilters(filters);
    const [auditChain, auditEvents, reportExports, approvals] = await Promise.all([
      this.verifyAuditChain(),
      this.listAuditEvents({ ...evidenceFilters.audit, limit: 500 }),
      this.listReportExports({ ...evidenceFilters.reportExports, limit: 500 }),
      this.listApprovalRequests({ ...evidenceFilters.approvals, limit: 500 }),
    ]);
    const approvalSummary = summarizeApprovals(approvals);

    return {
      generatedAt: this.now(),
      bundleId: evidenceBundleId({
        filters: evidenceFilters.all,
        auditChain,
        reportExports,
        approvals,
        auditEvents,
      }),
      filters: evidenceFilters.all,
      auditChain,
      reportExports: {
        count: reportExports.length,
        byType: countGroup(reportExports, "reportType"),
        items: reportExports,
      },
      approvals: {
        count: approvals.length,
        ...approvalSummary,
        items: approvals,
      },
      auditEvents: {
        count: auditEvents.length,
        actions: auditEvents
          .toSorted((left, right) => Number(left.sequence) - Number(right.sequence))
          .map((event) => event.action),
        items: auditEvents,
      },
    };
  }

  async createApprovalRequest(input = {}) {
    this.requireOpen();
    const record = normalizeApprovalRequest(input, {
      id: input.id ?? this.backend.nextId(APPROVAL_PREFIX),
      now: input.requestedAt ?? this.now(),
    });
    const saved = await this.backend.upsertApprovalRequest(record);
    await this.createAuditEvent({
      actor: saved.requestedBy,
      action: "approval.requested",
      entityType: "approval",
      entityId: saved.id,
      summary: `${saved.action} approval requested`,
      after: saved,
      metadata: { targetEntityType: saved.entityType, targetEntityId: saved.entityId },
    });
    return saved;
  }

  async getApprovalRequest(id) {
    this.requireOpen();
    return this.backend.getApprovalRequest(String(id));
  }

  async listApprovalRequests(filters = {}) {
    this.requireOpen();
    return this.backend.listApprovalRequests({
      status: filters.status ?? undefined,
      entityType: filters.entityType ?? undefined,
      entityId: filters.entityId ?? undefined,
      action: filters.action ?? undefined,
      requestedBy: filters.requestedBy ?? undefined,
      assignedTo: filters.assignedTo ?? undefined,
      decidedBy: filters.decidedBy ?? undefined,
      limit: normalizeAuditLimit(filters.limit),
    });
  }

  async decideApprovalRequest(id, decision = {}) {
    this.requireOpen();
    const existing = this.backend.getApprovalRequest(String(id));
    if (!existing) return null;
    const saved = await this.backend.upsertApprovalRequest(decideApprovalRequest(existing, {
      status: decision.status,
      actor: decision.actor ?? "system",
      note: decision.note ?? null,
      at: decision.at ?? this.now(),
    }));
    await this.createAuditEvent({
      actor: saved.decidedBy,
      action: saved.status === "approved" ? "approval.approved" : "approval.rejected",
      entityType: "approval",
      entityId: saved.id,
      summary: `${saved.action} approval ${saved.status}`,
      before: existing,
      after: saved,
      metadata: { targetEntityType: saved.entityType, targetEntityId: saved.entityId },
    });
    return saved;
  }
}

export async function createDatastore(options = {}) {
  const store = new QuantumSentinelDatastore(options);
  return store.open();
}
