import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createProbeJob,
  getProbeJob,
  loadProbeJobs,
  normalizeProbeJob,
  probeFallbackJobs,
} from "./probeApi.js";

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
      targetLabel: "api.example.test:443",
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

test("loadProbeJobs falls back to cloned mock jobs when probes are unavailable", async () => {
  const jobs = await loadProbeJobs({
    fetcher: async () => jsonResponse({ error: "Not found" }, { ok: false, status: 404 }),
  });

  assert.deepEqual(jobs, probeFallbackJobs);
  assert.notEqual(jobs, probeFallbackJobs);

  jobs[0].status = "MUTATED";
  const nextJobs = await loadProbeJobs({
    fetcher: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(nextJobs[0].status, probeFallbackJobs[0].status);
});
