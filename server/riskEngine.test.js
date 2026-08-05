import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeAsset,
  classifyAsset,
  detectAssetDrift,
  findingsFromAnalysis,
  recommendRemediation,
  scoreAsset,
} from "./riskEngine.js";

test("classifies core cryptographic postures from inventory assets", () => {
  assert.equal(classifyAsset({ algo: "AES-256", proto: "NTPsec", pfs: false }).label, "QUANTUM-SAFE");
  assert.equal(classifyAsset({ algo: "X25519+ML-KEM-768", proto: "TLS 1.3", pfs: true }).label, "HYBRID");
  assert.equal(classifyAsset({ algo: "RSA-2048", proto: "TLS 1.3", pfs: true }).label, "SHOR-CRITICAL");
  assert.equal(classifyAsset({ algo: "DES-56", proto: "Modbus", pfs: false }).label, "DEPRECATED");
  assert.equal(classifyAsset({ algo: "none", proto: "HTTP", pfs: false }).label, "UNENCRYPTED");
});

test("normalizes probe observations before classification and scoring", () => {
  const probeObservation = {
    target: { assetId: 42, hostname: "edge-api" },
    result: {
      protocol: { name: "TLS 1.2", perfectForwardSecrecy: false },
      certificate: { algorithm: "ECDSA-P256", expiresAt: "2027-01-01" },
      tags: ["public", "customer"],
    },
    type: "Load Balancer",
    segment: "DMZ",
  };

  const analysis = analyzeAsset(probeObservation);

  assert.equal(analysis.assetId, 42);
  assert.equal(analysis.hostname, "edge-api");
  assert.equal(analysis.classification.label, "SHOR-CRITICAL");
  assert.equal(analysis.evidence.algorithm, "ECDSA-P256");
  assert.equal(analysis.evidence.protocol, "TLS 1.2");
  assert.equal(analysis.scores.hndl, 100);
  assert.equal(analysis.priority, "CRITICAL");
});

test("derives HNDL, TNFL, aggregate risk, and priority from asset exposure", () => {
  const ca = {
    hostname: "ca-root-internal",
    type: "CA Server",
    segment: "Internal",
    algo: "RSA-4096",
    proto: "PKIX",
    pfs: false,
    tags: ["root", "trust", "critical"],
  };

  const scores = scoreAsset(ca);

  assert.equal(scores.hndl, 84);
  assert.equal(scores.tnfl, 100);
  assert.equal(scores.risk, 98);
  assert.equal(scores.priority, "CRITICAL");
  assert.equal(scores.factors.tnfl.some((factor) => factor.name === "certificate-authority"), true);
});

test("prefers explicit score fields when an inventory row already has them", () => {
  const scores = scoreAsset({
    algo: "RSA-2048",
    proto: "TLS 1.2",
    hndl: 55,
    tnfl: 50,
    risk: 60,
    prio: "MEDIUM",
  });

  assert.deepEqual({
    hndl: scores.hndl,
    tnfl: scores.tnfl,
    risk: scores.risk,
    priority: scores.priority,
  }, {
    hndl: 55,
    tnfl: 50,
    risk: 60,
    priority: "MEDIUM",
  });
});

test("reads CBOM-style nested risk fields", () => {
  const scores = scoreAsset({
    cryptography: {
      algorithm: "RSA-2048",
      protocol: "TLS 1.2",
      perfectForwardSecrecy: false,
    },
    risk: {
      hndl: 81,
      tnfl: 63,
      score: 79,
      priority: "HIGH",
    },
  });

  assert.deepEqual({
    hndl: scores.hndl,
    tnfl: scores.tnfl,
    risk: scores.risk,
    priority: scores.priority,
  }, {
    hndl: 81,
    tnfl: 63,
    risk: 79,
    priority: "HIGH",
  });
});

test("returns remediation templates by classification", () => {
  assert.equal(
    recommendRemediation({ algo: "none", proto: "HTTP" }).action,
    "Enable authenticated encryption",
  );
  assert.equal(
    recommendRemediation({ algo: "DES-56", proto: "TLS 1.1", migration: "REQUIRES HW REFRESH" }).action,
    "Replace legacy cryptographic endpoint",
  );
  assert.equal(
    recommendRemediation({ algo: "RSA-2048", proto: "TLS 1.3" }).target,
    "ML-KEM for key establishment and ML-DSA for signatures",
  );
  assert.equal(
    recommendRemediation({ algo: "X25519+ML-KEM-768", proto: "TLS 1.3" }).action,
    "Maintain hybrid deployment",
  );
});

test("creates findings from analysis for Shor exposure and PFS gaps", () => {
  const asset = {
    hostname: "db-primary-finance",
    type: "Database",
    segment: "Finance",
    algo: "RSA-2048",
    proto: "TLS 1.2",
    pfs: false,
  };
  const analysis = analyzeAsset(asset);
  const findings = findingsFromAnalysis(asset, analysis);

  assert.equal(findings.length, 2);
  assert.equal(findings[0].type, "HNDL");
  assert.equal(findings[0].severity, "CRITICAL");
  assert.equal(findings[1].type, "PFS");
  assert.equal(findings[1].evidence.algorithm, "RSA-2048");
});

test("does not create remediation findings for stable quantum-safe assets", () => {
  const asset = { hostname: "ntp-server-01", type: "NTP Server", algo: "AES-256", proto: "NTPsec" };
  const analysis = analyzeAsset(asset);

  assert.equal(analysis.classification.label, "QUANTUM-SAFE");
  assert.deepEqual(findingsFromAnalysis(asset, analysis), []);
});

test("detects algorithm, PFS, protocol, Shor, deprecated, and PQC regression drift", () => {
  const drift = detectAssetDrift([
    { asset: { algo: "X25519+ML-KEM-768", proto: "TLS 1.3", pfs: true } },
    { asset: { algo: "RSA-2048", proto: "TLS 1.2", pfs: false } },
    { asset: { algo: "RSA-1024", proto: "TLS 1.1", pfs: false } },
  ]);
  const types = drift.events.map((event) => event.type);

  assert.equal(drift.driftDetected, true);
  assert.deepEqual(types, [
    "WEAKER_ALGORITHM",
    "PFS_DISABLED",
    "PROTOCOL_DOWNGRADE",
    "NEW_SHOR_CRITICAL",
    "PQC_HYBRID_REGRESSION",
    "WEAKER_ALGORITHM",
    "PROTOCOL_DOWNGRADE",
    "DEPRECATED_PROTOCOL",
  ]);
  assert.equal(drift.latest.algorithm, "RSA-1024");
  assert.equal(drift.previous.algorithm, "RSA-2048");
});

test("reports no drift for stable or improving history", () => {
  const drift = detectAssetDrift([
    { algo: "RSA-2048", proto: "TLS 1.2", pfs: false },
    { algo: "X25519+ML-KEM-768", proto: "TLS 1.3", pfs: true },
  ]);

  assert.equal(drift.driftDetected, false);
  assert.deepEqual(drift.events, []);
});
