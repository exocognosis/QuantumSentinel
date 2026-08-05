import net from "node:net";
import tls from "node:tls";

import { ASSETS } from "../src/mockData.js";

const DEFAULT_TLS_PORT = 443;
const DEFAULT_TLS_TIMEOUT_MS = 5_000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 1_000;
const MAX_DISCOVERY_TARGETS = 16;
const MAX_DISCOVERY_TIMEOUT_MS = 5_000;

const jobs = new Map();
let nextJobId = 1;

class ProbeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProbeValidationError";
    this.statusCode = 400;
  }
}

function clone(value) {
  return structuredClone(value);
}

function isoNow() {
  return new Date().toISOString();
}

function parseAssetId(assetId) {
  const parsed = Number(assetId);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseOptionalAssetId(assetId) {
  if (assetId === undefined || assetId === null || assetId === "") return null;

  const parsed = parseAssetId(assetId);
  if (parsed === null) {
    throw new ProbeValidationError("assetId must be an integer");
  }

  return parsed;
}

function parsePort(port) {
  if (port === undefined || port === null || port === "") return DEFAULT_TLS_PORT;

  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new ProbeValidationError("port must be an integer between 1 and 65535");
  }

  return parsed;
}

function parseTimeoutMs(timeoutMs) {
  const parsed = Number(timeoutMs);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ProbeValidationError("timeoutMs must be a positive integer");
  }

  return parsed;
}

function parseDiscoveryTimeoutMs(timeoutMs) {
  const parsed = parseTimeoutMs(timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS);
  if (parsed > MAX_DISCOVERY_TIMEOUT_MS) {
    throw new ProbeValidationError(`timeoutMs must be between 1 and ${MAX_DISCOVERY_TIMEOUT_MS}`);
  }

  return parsed;
}

function normalizeMode(input) {
  const mode = input.mode ?? (input.host ? "tls" : "simulate");
  if (mode !== "simulate" && mode !== "tls" && mode !== "discovery") {
    throw new ProbeValidationError("mode must be simulate, tls, or discovery");
  }
  return mode;
}

function isValidHostname(host) {
  if (typeof host !== "string") return false;
  const value = host.trim();
  if (!value || value.length > 253 || value.includes("/")) return false;
  if (net.isIP(value)) return true;
  if (value.includes(":")) return false;

  return value
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function normalizeDiscoveryHosts(hosts) {
  if (!Array.isArray(hosts) || hosts.length === 0) {
    throw new ProbeValidationError("hosts is required for discovery probes");
  }

  if (hosts.length > MAX_DISCOVERY_TARGETS) {
    throw new ProbeValidationError(`discovery probes are limited to ${MAX_DISCOVERY_TARGETS} hosts`);
  }

  const normalized = hosts.map((host) => (typeof host === "string" ? host.trim() : ""));
  if (normalized.some((host) => !isValidHostname(host))) {
    throw new ProbeValidationError("host entries must be valid hostnames or IP addresses");
  }

  return Array.from(new Set(normalized));
}

function validateProbeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ProbeValidationError("Probe payload must be an object");
  }

  const mode = normalizeMode(input);

  if (mode === "simulate") {
    if (input.assetId === undefined || input.assetId === null || input.assetId === "") {
      throw new ProbeValidationError("assetId is required for simulated probes");
    }

    const assetId = parseAssetId(input.assetId);
    const asset = ASSETS.find((candidate) => candidate.id === assetId);
    if (!asset) {
      throw new ProbeValidationError("Asset not found");
    }

    return { mode, asset };
  }

  if (mode === "discovery") {
    return {
      mode,
      hosts: normalizeDiscoveryHosts(input.hosts),
      port: parsePort(input.port),
      timeoutMs: parseDiscoveryTimeoutMs(input.timeoutMs),
    };
  }

  if (typeof input.host !== "string" || input.host.trim() === "") {
    throw new ProbeValidationError("host is required for TLS probes");
  }

  if (!isValidHostname(input.host)) {
    throw new ProbeValidationError("host must be a valid hostname or IP address");
  }

  return {
    mode,
    assetId: parseOptionalAssetId(input.assetId),
    host: input.host.trim(),
    port: parsePort(input.port),
    timeoutMs: parseTimeoutMs(input.timeoutMs ?? DEFAULT_TLS_TIMEOUT_MS),
  };
}

export function validateProbeRequest(input) {
  return validateProbeInput(input);
}

function classifyMetadata({ algorithm, protocolName, pfs, expired = false }) {
  const notes = [];
  let label = "UNKNOWN";
  let priority = "MONITOR";
  let quantumVulnerable = false;

  if (/DES|RC4|MD5|TLS 1\.0|TLS 1\.1/i.test(`${algorithm} ${protocolName}`)) {
    label = "DEPRECATED";
    priority = "CRITICAL";
    quantumVulnerable = true;
    notes.push("Deprecated cryptography or protocol detected");
  } else if (/ML-KEM|ML-DSA|HYBRID/i.test(algorithm)) {
    label = "HYBRID";
    priority = "MONITOR";
    notes.push("Hybrid or post-quantum material detected");
  } else if (/AES|SHA-256|SHA-384|SHA-512/i.test(algorithm)) {
    label = "QUANTUM-SAFE";
    priority = "MONITOR";
    notes.push("Symmetric/hash cryptography is not Shor-vulnerable");
  } else if (/RSA|ECDSA|ECDH|EC-|X25519|P-256|P-384|P-521/i.test(algorithm)) {
    label = "SHOR-CRITICAL";
    priority = "HIGH";
    quantumVulnerable = true;
    notes.push("Public-key cryptography is vulnerable to a future cryptographically relevant quantum computer");
  }

  if (!pfs) {
    notes.push("Perfect forward secrecy was not observed");
  }

  if (expired) {
    priority = "CRITICAL";
    notes.push("Certificate is expired");
  }

  return { label, priority, quantumVulnerable, notes };
}

function simulatedResult(asset) {
  const classification = classifyMetadata({
    algorithm: asset.algo,
    protocolName: asset.proto,
    pfs: asset.pfs,
    expired: asset.cert_exp !== "N/A" && Date.parse(asset.cert_exp) < Date.now(),
  });

  return {
    observedAt: isoNow(),
    source: "seed",
    protocol: {
      name: asset.proto,
      perfectForwardSecrecy: asset.pfs,
    },
    certificate: {
      subject: asset.hostname,
      issuer: "QuantumSentinel seed inventory",
      algorithm: asset.algo,
      expiresAt: asset.cert_exp,
    },
    classification: {
      ...classification,
      label: asset.cls,
      priority: asset.prio,
    },
    findings: classification.notes,
  };
}

function certificateName(name = {}) {
  return Object.entries(name)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function certificateAlgorithm(certificate) {
  if (certificate.asn1Curve) return `EC-${certificate.asn1Curve}`;
  if (certificate.bits) return `RSA-${certificate.bits}`;
  if (certificate.pubkey) return "Public key";
  return "Unknown";
}

function isExpired(validTo) {
  const timestamp = Date.parse(validTo);
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

function tlsResult({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const options = {
      host,
      port,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    };
    if (!net.isIP(host)) options.servername = host;

    const socket = tls.connect(options);
    socket.setTimeout(timeoutMs);

    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(false);
      const cipher = socket.getCipher();
      const protocolName = socket.getProtocol() ?? "Unknown";
      const algorithm = certificateAlgorithm(certificate);
      const perfectForwardSecrecy = protocolName === "TLSv1.3" || /DHE/i.test(cipher?.name ?? "");
      const expired = isExpired(certificate.valid_to);
      const classification = classifyMetadata({
        algorithm,
        protocolName,
        pfs: perfectForwardSecrecy,
        expired,
      });

      socket.end();
      settle(resolve, {
        observedAt: isoNow(),
        source: "tls",
        protocol: {
          name: protocolName,
          cipher: cipher?.standardName ?? cipher?.name ?? "Unknown",
          perfectForwardSecrecy,
        },
        certificate: {
          subject: certificateName(certificate.subject),
          issuer: certificateName(certificate.issuer),
          algorithm,
          expiresAt: certificate.valid_to ?? null,
          fingerprint256: certificate.fingerprint256 ?? null,
        },
        classification,
        findings: classification.notes,
      });
    });

    socket.once("timeout", () => {
      socket.destroy();
      settle(reject, new Error(`TLS probe timed out after ${timeoutMs}ms`));
    });

    socket.once("error", (error) => {
      socket.destroy();
      settle(reject, error);
    });
  });
}

function tcpReachability({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      socket.destroy();
      settle(resolve, true);
    });

    socket.once("timeout", () => {
      socket.destroy();
      settle(reject, new Error(`TCP probe timed out after ${timeoutMs}ms`));
    });

    socket.once("error", (error) => {
      socket.destroy();
      settle(reject, error);
    });
  });
}

async function discoveryObservation({ host, port, timeoutMs }) {
  try {
    const result = await tlsResult({ host, port, timeoutMs });
    return {
      ...result,
      host,
      port,
      status: "completed",
      reachability: {
        tcp: true,
        tls: true,
      },
    };
  } catch (tlsError) {
    try {
      await tcpReachability({ host, port, timeoutMs });
      const findings = ["TCP port is reachable, but TLS handshake did not complete"];

      return {
        observedAt: isoNow(),
        source: "tcp",
        host,
        port,
        status: "completed",
        reachability: {
          tcp: true,
          tls: false,
        },
        protocol: {
          name: "TCP",
          perfectForwardSecrecy: false,
        },
        certificate: null,
        classification: {
          label: "REACHABLE",
          priority: "MONITOR",
          quantumVulnerable: false,
          notes: findings,
        },
        findings,
        tlsError: tlsError.message,
      };
    } catch (tcpError) {
      const findings = ["Target did not accept TCP connections within discovery bounds"];

      return {
        observedAt: isoNow(),
        source: "tcp",
        host,
        port,
        status: "failed",
        reachability: {
          tcp: false,
          tls: false,
        },
        classification: {
          label: "UNREACHABLE",
          priority: "MONITOR",
          quantumVulnerable: false,
          notes: findings,
        },
        findings,
        error: tcpError.message,
      };
    }
  }
}

async function discoveryResult({ hosts, port, timeoutMs }) {
  const observations = [];

  for (const host of hosts) {
    observations.push(await discoveryObservation({ host, port, timeoutMs }));
  }

  const completedCount = observations.filter((observation) => observation.status === "completed").length;
  const failedCount = observations.length - completedCount;

  return {
    observedAt: isoNow(),
    source: "discovery",
    summary: {
      targetsScanned: observations.length,
      completedCount,
      failedCount,
    },
    observations,
    findings: observations.flatMap((observation) => observation.findings ?? []),
  };
}

function makeJob({ mode, asset, assetId, host, hosts, port }) {
  const now = isoNow();
  const id = `probe-${nextJobId}`;
  nextJobId += 1;

  return {
    id,
    mode,
    status: "running",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    target: (() => {
      if (mode === "simulate") {
        return {
          assetId: asset.id,
          hostname: asset.hostname,
          ip: asset.ip,
          type: asset.type,
        };
      }

      if (mode === "discovery") {
        return { hosts, port };
      }

      return {
        ...(assetId == null ? {} : { assetId }),
        host,
        port,
      };
    })(),
    result: null,
    error: null,
  };
}

function finishJob(job, result) {
  const now = isoNow();
  job.status = "completed";
  job.updatedAt = now;
  job.completedAt = now;
  job.result = result;
}

function failJob(job, error) {
  const now = isoNow();
  job.status = "failed";
  job.updatedAt = now;
  job.completedAt = now;
  job.error = error.message;
}

export function resetProbeJobs() {
  jobs.clear();
  nextJobId = 1;
}

export function listProbeJobs() {
  return Array.from(jobs.values(), clone);
}

export function getProbeJob(id) {
  const job = jobs.get(id);
  return job ? clone(job) : null;
}

export async function createProbeJob(input) {
  const request = validateProbeInput(input);
  const job = makeJob(request);
  jobs.set(job.id, job);

  try {
    const result = request.mode === "simulate"
      ? simulatedResult(request.asset)
      : request.mode === "discovery"
        ? await discoveryResult(request)
        : await tlsResult(request);
    finishJob(job, result);
  } catch (error) {
    failJob(job, error);
  }

  return clone(job);
}
