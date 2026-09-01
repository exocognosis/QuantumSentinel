import { resolve4, resolve6 } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { createProbeJob } from "./probeEngine.js";
import { calculateReadinessScore } from "./repositoryScanner.js";

export const DEFAULT_DOMAIN_PORTS = [443];
export const ALLOWED_DOMAIN_PORTS = [443, 465, 636, 853, 993, 995, 8443, 9443];
const MAX_DOMAIN_PORTS = 8;

const NON_PUBLIC_ADDRESSES = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  NON_PUBLIC_ADDRESSES.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  NON_PUBLIC_ADDRESSES.addSubnet(address, prefix, "ipv6");
}

function validHostname(hostname) {
  if (typeof hostname !== "string" || hostname.length > 253 || hostname.includes("/") || hostname.includes(":")) return false;
  return hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

export function normalizeDomainScanInput(domain, ports = DEFAULT_DOMAIN_PORTS) {
  const hostname = String(domain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!validHostname(hostname)) throw new Error("domain must be a hostname without a URL, path, or port");
  if (!Array.isArray(ports) || ports.length === 0 || ports.length > MAX_DOMAIN_PORTS) throw new Error(`domain scans require 1-${MAX_DOMAIN_PORTS} ports`);
  const normalizedPorts = [...new Set(ports.map(Number))];
  if (normalizedPorts.some((port) => !ALLOWED_DOMAIN_PORTS.includes(port))) {
    throw new Error(`ports must be selected from the bounded TLS allowlist: ${ALLOWED_DOMAIN_PORTS.join(", ")}`);
  }
  return { hostname, ports: normalizedPorts };
}

async function resolveAddresses(hostname, resolver = { resolve4, resolve6 }) {
  const [ipv4, ipv6] = await Promise.all([
    resolver.resolve4(hostname).catch(() => []),
    resolver.resolve6(hostname).catch(() => []),
  ]);
  return { ipv4: [...new Set(ipv4)], ipv6: [...new Set(ipv6)] };
}

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC_ADDRESSES.check(address, "ipv4");
  if (family === 6) {
    if (address.toLowerCase().startsWith("::ffff:")) return false;
    return !NON_PUBLIC_ADDRESSES.check(address, "ipv6");
  }
  return false;
}

function requirePublicAddresses(addresses) {
  const resolved = [...addresses.ipv4, ...addresses.ipv6];
  if (resolved.length === 0) {
    const error = new Error("domain did not resolve to an IP address");
    error.statusCode = 502;
    throw error;
  }

  if (resolved.some((address) => !isPublicAddress(address))) {
    const error = new Error("domain resolves to a private, reserved, or non-routable address");
    error.statusCode = 400;
    throw error;
  }

  return resolved;
}

function findingFromJob(domain, job) {
  if (job.status !== "completed" || !job.result) return null;
  const classification = job.result.classification ?? {};
  const certificate = job.result.certificate ?? {};
  const expired = (classification.notes ?? []).some((note) => /expired/i.test(note));
  const vulnerable = classification.quantumVulnerable === true;
  const observedAlgorithm = certificate.algorithm ?? "Unknown";
  const informational = !vulnerable && !expired;
  return {
    id: `domain-${domain}-${job.target.port}`,
    ruleId: expired ? "expired-public-certificate" : vulnerable ? "tls-classical-public-key" : "tls-posture-observation",
    algorithm: observedAlgorithm,
    matchedValue: observedAlgorithm,
    classification: expired ? "deprecated" : vulnerable ? "shor-vulnerable-public-key" : /ML-KEM|ML-DSA|HYBRID/i.test(observedAlgorithm) ? "pqc" : "externally-observed",
    severity: expired ? "CRITICAL" : vulnerable ? "HIGH" : "INFO",
    confidence: "confirmed",
    usage: "public-tls-service",
    evidence: {
      file: `${domain}:${job.target.port}`,
      line: 0,
      excerpt: `${job.result.protocol?.name ?? "TLS"} · ${job.result.protocol?.cipher ?? "unknown cipher"} · ${observedAlgorithm}`,
      endpoint: domain,
      port: job.target.port,
      certificate,
      protocol: job.result.protocol,
    },
    rationale: expired
      ? "The publicly observed certificate is expired."
      : vulnerable
        ? "The publicly observed TLS certificate relies on Shor-vulnerable public-key cryptography."
        : "A public TLS service was observed; its complete certificate chain and server-side architecture may require additional verification.",
    recommendation: informational
      ? "Retain as external evidence and validate certificate-chain, negotiation, fallback, and origin-service boundaries"
      : "Plan a standards-aligned hybrid or post-quantum migration and validate the complete certificate and service trust path",
  };
}

export async function scanDomain(domain, options = {}) {
  const { hostname, ports } = normalizeDomainScanInput(domain, options.ports);
  const startedAt = new Date().toISOString();
  const addresses = await resolveAddresses(hostname, options.resolver);
  const resolved = requirePublicAddresses(addresses);
  const connectHost = resolved[0];
  const jobs = [];
  for (const port of ports) {
    jobs.push(await (options.probe ?? createProbeJob)(
      { mode: "tls", host: hostname, port, timeoutMs: options.timeoutMs ?? 5_000 },
      { connectHost, servername: hostname },
    ));
  }
  const findings = jobs.map((job) => findingFromJob(hostname, job)).filter(Boolean);
  const completedAt = new Date().toISOString();
  const failedServices = jobs.filter((job) => job.status !== "completed").map((job) => ({ port: job.target.port, error: job.error }));
  const byClassification = {};
  const bySeverity = {};
  for (const finding of findings) {
    byClassification[finding.classification] = (byClassification[finding.classification] ?? 0) + 1;
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
  }
  return {
    schemaVersion: "1.0.0",
    scanner: { name: "QuantumSentinel External Q-Day Scanner", version: "0.1.0" },
    scan: { target: hostname, targetName: hostname, kind: "domain", startedAt, completedAt, filesScanned: jobs.length, bytesScanned: 0, ports, addresses, failedServices },
    score: calculateReadinessScore(findings),
    summary: { totalFindings: findings.length, servicesRequested: ports.length, servicesObserved: jobs.length - failedServices.length, servicesFailed: failedServices.length, byClassification, bySeverity },
    findings,
    services: jobs,
    interpretation: {
      externallyObserved: "The report describes cryptography negotiated or presented by the scanned public edge at the recorded time.",
      internalInference: "Public-edge findings do not establish the cryptographic posture of origin servers, internal networks, data stores, identity systems, software signing, backups, devices, or third parties.",
      warrantedNextStep: "Confirmed classical public-key exposure raises the priority of an authorized internal cryptographic inventory and migration assessment.",
    },
    limitations: [
      "This is an authorized, externally observable cryptographic posture assessment, not a penetration test or general web-vulnerability scan.",
      "A CDN, proxy, load balancer, or hosted edge may conceal the origin service and internal cryptographic dependencies.",
      "The scan does not prove support for every TLS group or fallback path and does not inspect application vulnerabilities.",
      "A high readiness score is not a certification, audit opinion, or guarantee of quantum safety.",
    ],
  };
}
