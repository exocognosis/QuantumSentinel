import net from "node:net";
import tls from "node:tls";
import { execFile } from "node:child_process";

const DEFAULT_TLS_PORT = 443;
const DEFAULT_TLS_TIMEOUT_MS = 5_000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 1_000;
const MAX_DISCOVERY_TARGETS = 16;
const MAX_DISCOVERY_TIMEOUT_MS = 5_000;
const MAX_DISCOVERY_PORTS = 8;
const MAX_DISCOVERY_CONCURRENCY = 8;
const MAX_ACTIVE_LOCAL_PORTS = 32;

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

function parsePorts(ports, fallbackPort) {
  if (ports === undefined) return [parsePort(fallbackPort)];
  if (!Array.isArray(ports) || ports.length === 0 || ports.length > MAX_DISCOVERY_PORTS) {
    throw new ProbeValidationError(`ports must contain between 1 and ${MAX_DISCOVERY_PORTS} entries`);
  }
  return Array.from(new Set(ports.map(parsePort)));
}

function parseConcurrency(value) {
  const parsed = Number(value ?? 4);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_DISCOVERY_CONCURRENCY) {
    throw new ProbeValidationError(`concurrency must be between 1 and ${MAX_DISCOVERY_CONCURRENCY}`);
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
  if (input.mode == null && input.assetId != null && !input.host) {
    throw new ProbeValidationError("mode must be tls, discovery, or device");
  }
  const mode = input.mode ?? (input.host ? "tls" : "device");
  if (mode !== "tls" && mode !== "discovery" && mode !== "device") {
    throw new ProbeValidationError("mode must be tls, discovery, or device");
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

  if (mode === "discovery") {
    const ports = parsePorts(input.ports, input.port);
    return {
      mode,
      hosts: normalizeDiscoveryHosts(input.hosts),
      ports,
      port: ports[0],
      concurrency: parseConcurrency(input.concurrency),
      expandedScope: input.ports !== undefined || input.concurrency !== undefined,
      timeoutMs: parseDiscoveryTimeoutMs(input.timeoutMs),
    };
  }

  if (mode === "device") {
    const scopeName = input.scope === "localhost" ? "localhost" : input.scope === "ipv4" ? "ipv4" : "both";
    const scope = scopeName === "localhost" ? ["localhost"] : scopeName === "ipv4" ? ["127.0.0.1"] : ["127.0.0.1", "localhost"];
    return { mode, scope: scopeName, hosts: scope, ports: parsePorts(input.ports, input.port), discoverActivePorts: input.discoverActivePorts !== false, concurrency: 4, timeoutMs: parseDiscoveryTimeoutMs(input.timeoutMs) };
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

async function discoveryResult({ hosts, ports, timeoutMs, concurrency = 4 }) {
  const work = hosts.flatMap((host) => ports.map((port) => ({ host, port, timeoutMs })));
  const observations = new Array(work.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < work.length) {
      const index = cursor++;
      observations[index] = await discoveryObservation(work[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));

  const completedCount = observations.filter((observation) => observation.status === "completed").length;
  const failedCount = observations.length - completedCount;

  return {
    observedAt: isoNow(),
    source: "discovery",
    summary: {
      targetsScanned: observations.length,
      hostsScanned: hosts.length,
      portsScanned: ports.length,
      completedCount,
      failedCount,
    },
    observations,
    findings: observations.flatMap((observation) => observation.findings ?? []),
  };
}

function runPortCommand(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 1500, maxBuffer: 512_000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout || ""));
    });
  });
}

export function portsFromListenerOutput(output) {
  const ports = [];
  for (const line of String(output).split("\n")) {
    if (!/LISTEN/i.test(line)) continue;
    const matches = [...line.matchAll(/:(\d{1,5})(?=\s|$|\))/g)];
    for (const match of matches) {
      const port = Number(match[1]);
      if (port >= 1 && port <= 65_535) ports.push(port);
    }
  }
  return Array.from(new Set(ports)).sort((a, b) => a - b).slice(0, MAX_ACTIVE_LOCAL_PORTS);
}

async function discoverActiveLocalPorts() {
  const commands = process.platform === "win32"
    ? [["netstat", ["-ano", "-p", "tcp"]]]
    : [
        ["lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]],
        ["ss", ["-ltnH"]],
        ["netstat", ["-an", "-p", "tcp"]],
      ];
  for (const [command, args] of commands) {
    const ports = portsFromListenerOutput(await runPortCommand(command, args));
    if (ports.length) return ports;
  }
  return [];
}

async function deviceResult(request) {
  const discoveredPorts = request.discoverActivePorts ? await discoverActiveLocalPorts() : [];
  const ports = Array.from(new Set([...request.ports, ...discoveredPorts])).slice(0, MAX_ACTIVE_LOCAL_PORTS);
  const discovery = await discoveryResult({ ...request, ports });
  return {
    ...discovery,
    source: "device",
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      node: process.versions.node,
      openssl: process.versions.openssl ?? "unknown",
    },
    scope: { hosts: request.hosts, ports, requestedPorts: request.ports, discoveredPorts },
  };
}

function makeJob({ mode, asset, assetId, host, hosts, port, ports, concurrency, expandedScope }) {
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
      if (mode === "discovery" || mode === "device") {
        return expandedScope || mode === "device" ? { hosts, ports, port: ports[0], concurrency } : { hosts, port };
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
  job.request = {
    ...request,
    ...(request.asset ? { assetId: request.asset.id } : {}),
  };
  delete job.request.asset;
  jobs.set(job.id, job);

  try {
    const result = request.mode === "discovery"
        ? await discoveryResult(request)
        : request.mode === "device"
          ? await deviceResult(request)
        : await tlsResult(request);
    finishJob(job, result);
  } catch (error) {
    failJob(job, error);
  }

  return clone(job);
}
