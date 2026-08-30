import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildRescanRequest,
  createProbeJob,
  createRepositoryScan,
  getProbeJob,
  loadProbeJobs,
  normalizeProbeJob,
  normalizeRepositoryScan,
} from "./probeApi.js";

test("buildRescanRequest reconstructs real TLS and discovery requests from older jobs", () => {
  assert.deepEqual(buildRescanRequest({
    type: "tls",
    target: { host: "ecc256.badssl.com", port: 443 },
    targetLabel: "ecc256.badssl.com",
    request: {},
  }), {
    mode: "tls",
    host: "ecc256.badssl.com",
    port: 443,
    timeoutMs: 2500,
  });

  assert.deepEqual(buildRescanRequest({
    type: "discovery",
    targetLabel: "ecc256.badssl.com",
    request: {},
    result: { observations: [{ host: "ecc256.badssl.com", port: 443 }] },
  }), {
    mode: "discovery",
    hosts: ["ecc256.badssl.com"],
    ports: [443],
    concurrency: 4,
    timeoutMs: 2500,
  });
});

test("buildRescanRequest reconstructs repository scan requests", () => {
  assert.deepEqual(buildRescanRequest({
    type: "repository",
    target: { repository: "exocognosis/QuantumSentinel", url: "https://github.com/exocognosis/QuantumSentinel.git" },
    targetLabel: "exocognosis/QuantumSentinel",
    request: { target: "https://github.com/exocognosis/QuantumSentinel" },
  }), {
    mode: "repository",
    path: "https://github.com/exocognosis/QuantumSentinel",
  });
});

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

test("loadProbeJobs fetches probe jobs and normalizes API fields", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: [
        {
          job_id: "probe-1",
          probe_type: "tls-handshake",
          target: "api.example.test:443",
          state: "running",
          progress_pct: "42",
          created_at: "2026-05-31T12:00:00.000Z",
          updated_at: "2026-05-31T12:05:00.000Z",
          finished_at: null,
          findings_count: "3",
          risk_score: "77",
          error_message: "",
          request: { target: "api.example.test:443" },
          result: { cipher: "TLS_AES_256_GCM_SHA384" },
        },
      ],
      count: 1,
    });
  };

  const jobs = await loadProbeJobs({ fetcher, baseUrl: "https://sentinel.example/" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/probes");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.deepEqual(jobs, [
    {
      id: "probe-1",
      name: "TLS Handshake Probe",
      type: "tls-handshake",
      target: "api.example.test:443",
      targetLabel: "api.example.test",
      status: "RUNNING",
      progress: 42,
      createdAt: "2026-05-31T12:00:00.000Z",
      updatedAt: "2026-05-31T12:05:00.000Z",
      completedAt: null,
      findingsCount: 3,
      riskScore: 77,
      error: "",
      request: { target: "api.example.test:443" },
      result: { cipher: "TLS_AES_256_GCM_SHA384" },
    },
  ]);
});

test("createProbeJob posts a JSON request and normalizes the created job", async () => {
  const calls = [];
  const request = {
    target: "vpn.example.test",
    type: "ike",
    depth: "standard",
  };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        id: 23,
        name: "VPN IKE Probe",
        kind: "ike",
        host: "vpn.example.test",
        status: "queued",
        progress: 0,
        createdAt: "2026-05-31T13:00:00.000Z",
      },
    });
  };

  const job = await createProbeJob(request, { fetcher, baseUrl: "https://sentinel.example" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://sentinel.example/api/probes");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.equal(calls[0].options.body, JSON.stringify(request));
  assert.deepEqual(job, {
    id: "23",
    name: "VPN IKE Probe",
    type: "ike",
    target: "vpn.example.test",
    targetLabel: "vpn.example.test",
    status: "QUEUED",
    progress: 0,
    createdAt: "2026-05-31T13:00:00.000Z",
    updatedAt: null,
    completedAt: null,
    findingsCount: 0,
    riskScore: 0,
    error: "",
    request: {},
    result: null,
  });
});

test("createRepositoryScan posts a repository target and normalizes persisted scan output", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      data: {
        report: {
          scan: {
            sourceType: "github",
            sourceInput: "https://github.com/exocognosis/QuantumSentinel",
            target: "https://github.com/exocognosis/QuantumSentinel.git",
            targetName: "exocognosis/QuantumSentinel",
            startedAt: "2026-08-29T10:00:00.000Z",
            completedAt: "2026-08-29T10:00:01.000Z",
            filesScanned: 12,
          },
          score: { readinessScore: 62, grade: "C" },
          summary: { totalFindings: 3 },
          findings: [
            { severity: "HIGH", title: "RSA requires migration" },
            { severity: "INFO", title: "SHA-256 observed" },
          ],
        },
        persistence: { snapshotId: "cbom-7" },
      },
    });
  };

  const scan = await createRepositoryScan({
    path: "https://github.com/exocognosis/QuantumSentinel",
    actor: "test",
  }, { fetcher });

  assert.equal(calls[0].url, "/api/repository-scans");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(scan.id, "cbom-7");
  assert.equal(scan.type, "repository");
  assert.equal(scan.targetLabel, "exocognosis/QuantumSentinel");
  assert.equal(scan.status, "COMPLETED");
  assert.equal(scan.findingsCount, 1);
  assert.equal(scan.riskScore, 38);
  assert.equal(scan.result.summary.filesScanned, 12);
  assert.equal(scan.result.summary.actionableFindings, 1);
});

test("normalizeRepositoryScan provides a stable scan record", () => {
  const scan = normalizeRepositoryScan({
    report: {
      scan: {
        sourceType: "local",
        target: "/tmp/repo",
        targetName: "repo",
        completedAt: "2026-08-29T10:00:00.000Z",
        filesScanned: 1,
      },
      score: { readinessScore: 100 },
      summary: {},
      findings: [],
    },
  });

  assert.equal(scan.type, "repository");
  assert.equal(scan.targetLabel, "repo");
  assert.equal(scan.result.classification.priority, "MONITOR");
});

test("createProbeJob surfaces API validation details", async () => {
  await assert.rejects(
    () => createProbeJob(
      { mode: "simulate", assetId: "missing" },
      { fetcher: async () => jsonResponse({ error: "Asset not found" }, { ok: false, status: 400 }) },
    ),
    /Asset not found/,
  );
});

test("normalizeProbeJob labels discovery requests and summarizes host targets", () => {
  const job = normalizeProbeJob({
    id: "discovery-1",
    status: "queued",
    request: {
      mode: "discovery",
      hosts: ["edge-01.example.test", "10.0.4.12", "ca-root-internal"],
      timeoutMs: 2500,
    },
    result: {
      summary: "2 hosts responded",
      observations: [
        { host: "edge-01.example.test", status: "open" },
        { host: "10.0.4.12", status: "timeout" },
      ],
    },
  });

  assert.equal(job.name, "Discovery Probe");
  assert.equal(job.type, "discovery");
  assert.equal(job.target, "edge-01.example.test, 10.0.4.12, ca-root-internal");
  assert.equal(job.findingsCount, 2);
  assert.deepEqual(job.result, {
    summary: "2 hosts responded",
    observations: [
      { host: "edge-01.example.test", status: "open" },
      { host: "10.0.4.12", status: "timeout" },
    ],
  });
});

test("normalizeProbeJob hides default TLS port and keeps non-default ports", () => {
  assert.equal(normalizeProbeJob({
    id: "tls-default",
    type: "tls",
    target: { host: "WWW.CNN.COM", port: 443 },
  }).targetLabel, "www.cnn.com");

  assert.equal(normalizeProbeJob({
    id: "tls-string-default",
    type: "tls",
    target: "WWW.CNN.COM:443",
  }).targetLabel, "www.cnn.com");

  assert.equal(normalizeProbeJob({
    id: "tls-alt",
    type: "tls",
    target: { host: "www.cnn.com", port: 8443 },
  }).targetLabel, "www.cnn.com:8443");

  assert.equal(normalizeProbeJob({
    id: "tls-string-alt",
    type: "tls",
    target: "www.cnn.com:8443",
  }).targetLabel, "www.cnn.com:8443");
});

test("getProbeJob fetches an encoded job id and normalizes nested job payloads", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      job: {
        probeId: "tls/audit 7",
        title: "Certificate Audit",
        probeType: "certificate-audit",
        asset: "mail.example.test",
        phase: "completed",
        percentComplete: 100,
        completed_at: "2026-05-31T14:15:00.000Z",
        findings: [{ severity: "HIGH" }, { severity: "INFO" }],
        score: 64,
      },
    });
  };

  const job = await getProbeJob("tls/audit 7", { fetcher });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/probes/tls%2Faudit%207");
  assert.deepEqual(calls[0].options, {
    headers: { Accept: "application/json" },
  });
  assert.equal(job.id, "tls/audit 7");
  assert.equal(job.name, "Certificate Audit");
  assert.equal(job.type, "certificate-audit");
  assert.equal(job.target, "mail.example.test");
  assert.equal(job.status, "COMPLETED");
  assert.equal(job.progress, 100);
  assert.equal(job.completedAt, "2026-05-31T14:15:00.000Z");
  assert.equal(job.findingsCount, 2);
  assert.equal(job.riskScore, 64);
});

test("loadProbeJobs returns no jobs when probes are unavailable", async () => {
  const jobs = await loadProbeJobs({
    fetcher: async () => jsonResponse({ error: "Not found" }, { ok: false, status: 404 }),
  });

  assert.deepEqual(jobs, []);

  const nextJobs = await loadProbeJobs({
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.deepEqual(nextJobs, []);
});
