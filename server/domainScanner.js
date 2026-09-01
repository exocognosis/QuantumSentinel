import { resolve4, resolve6 } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { createProbeJob } from "./probeEngine.js";

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

function scoreGrade(score) {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function factor(id, label, score, maxScore, status, observation, meaning) {
  return { id, label, score, maxScore, status, observation, meaning };
}

function publicKeyFactor(certificate = {}) {
  const algorithm = String(certificate.algorithm ?? "Unknown");
  if (/ML-KEM|ML-DSA|SLH-DSA|HYBRID/i.test(algorithm)) {
    return factor("public-key", "Website identity", 30, 30, "strong", algorithm, "The observed website identity uses post-quantum or hybrid protection.");
  }
  if (/RSA|ECDSA|ECDH|EC-|X25519|X448|P-?256|P-?384|P-?521|prime256v1/i.test(algorithm)) {
    return factor("public-key", "Website identity", 0, 30, "risk", algorithm, "The observed website identity uses classical public-key encryption that a future quantum computer could break.");
  }
  return factor("public-key", "Website identity", 0, 30, "review", algorithm, "The website identity algorithm needs confirmation before quantum readiness can be established.");
}

function keyExchangeFactor(protocol = {}) {
  const key = protocol.keyExchange ?? {};
  const observation = [key.type, key.name, key.size ? `${key.size}-bit` : null].filter(Boolean).join(" · ") || "Not reported";
  if (/ML-KEM|KYBER|HYBRID/i.test(observation)) {
    return factor("key-exchange", "Connection key exchange", 30, 30, "strong", observation, "The observed connection uses post-quantum or hybrid key exchange.");
  }
  if (/ECDH|DH|X25519|X448|EC/i.test(observation)) {
    return factor("key-exchange", "Connection key exchange", 0, 30, "risk", observation, "The observed key exchange is classical. Captured traffic could become readable after a future quantum attack.");
  }
  return factor("key-exchange", "Connection key exchange", 0, 30, "review", observation, "The connection key exchange was not identified and needs confirmation.");
}

function protocolFactor(protocol = {}) {
  const name = String(protocol.name ?? "Unknown");
  if (/TLSv?1\.3/i.test(name)) return factor("protocol", "Connection protocol", 15, 15, "strong", name, "The website uses the current TLS protocol for protection against present-day attacks.");
  if (/TLSv?1\.2/i.test(name)) return factor("protocol", "Connection protocol", 10, 15, "review", name, "The website uses an accepted protocol, but TLS 1.3 provides stronger current protection.");
  return factor("protocol", "Connection protocol", 0, 15, "risk", name, "The observed protocol is outdated or unknown and needs replacement or confirmation.");
}

function forwardSecrecyFactor(protocol = {}) {
  if (protocol.perfectForwardSecrecy === true) {
    return factor("forward-secrecy", "Forward secrecy", 10, 10, "strong", "Present", "Past traffic is better protected if a server key is stolen. This does not make classical key exchange quantum-safe.");
  }
  return factor("forward-secrecy", "Forward secrecy", 0, 10, "risk", "Not observed", "A future server-key compromise could expose previously captured traffic.");
}

function cipherFactor(protocol = {}) {
  const cipher = String(protocol.cipher ?? "Unknown");
  if (/AES[_-]?256|CHACHA20/i.test(cipher)) return factor("data-encryption", "Data encryption", 10, 10, "strong", cipher, "The observed data-encryption strength provides a stronger margin against quantum search attacks.");
  if (/AES[_-]?128/i.test(cipher)) return factor("data-encryption", "Data encryption", 8, 10, "strong", cipher, "The observed data encryption remains useful, but it has a smaller quantum-security margin than AES-256.");
  if (/3DES|DES|RC4|NULL/i.test(cipher)) return factor("data-encryption", "Data encryption", 0, 10, "risk", cipher, "The observed data encryption is outdated and creates present-day risk.");
  return factor("data-encryption", "Data encryption", 0, 10, "review", cipher, "The observed data-encryption strength needs confirmation.");
}

function certificateFactor(certificate = {}, now = Date.now()) {
  const expiresAt = certificate.expiresAt ?? null;
  const expiresTimestamp = Date.parse(expiresAt);
  if (!Number.isFinite(expiresTimestamp)) return factor("certificate", "Certificate status", 0, 5, "review", "Expiration unknown", "The certificate expiration date could not be confirmed.");
  const daysRemaining = Math.ceil((expiresTimestamp - now) / 86_400_000);
  const observation = daysRemaining < 0 ? `Expired ${Math.abs(daysRemaining)} days ago` : `${daysRemaining} days remaining`;
  if (daysRemaining < 0) return factor("certificate", "Certificate status", 0, 5, "risk", observation, "The public certificate is expired and needs immediate replacement.");
  if (daysRemaining <= 30) return factor("certificate", "Certificate status", 2, 5, "review", observation, "The certificate expires soon and needs a confirmed renewal plan.");
  return factor("certificate", "Certificate status", 5, 5, "strong", observation, "The public certificate is currently valid.");
}

function serviceReadiness(job, now) {
  const protocol = job.result?.protocol ?? {};
  const certificate = job.result?.certificate ?? {};
  const breakdown = [
    publicKeyFactor(certificate),
    keyExchangeFactor(protocol),
    protocolFactor(protocol),
    forwardSecrecyFactor(protocol),
    cipherFactor(protocol),
    certificateFactor(certificate, now),
  ];
  const readinessScore = breakdown.reduce((sum, item) => sum + item.score, 0);
  return {
    endpoint: `${job.target.host}:${job.target.port}`,
    readinessScore,
    grade: scoreGrade(readinessScore),
    breakdown,
  };
}

export function calculateWebsiteReadinessScore(jobs, { now = Date.now() } = {}) {
  const assessedServices = jobs
    .filter((job) => job.status === "completed" && job.result)
    .map((job) => serviceReadiness(job, now));
  if (!assessedServices.length) {
    return {
      readinessScore: 0,
      grade: "N/A",
      assessmentStatus: "unassessed",
      assessedEndpoint: null,
      breakdown: [],
      method: "No public TLS service completed, so QuantumSentinel could not calculate a website readiness score.",
    };
  }
  const lowest = assessedServices.toSorted((left, right) => left.readinessScore - right.readinessScore)[0];
  return {
    readinessScore: lowest.readinessScore,
    grade: lowest.grade,
    assessmentStatus: "assessed",
    assessedEndpoint: lowest.endpoint,
    breakdown: lowest.breakdown,
    serviceScores: assessedServices.map(({ endpoint, readinessScore, grade }) => ({ endpoint, readinessScore, grade })),
    method: "100 weighted points: website identity 30, connection key exchange 30, connection protocol 15, forward secrecy 10, data encryption 10, and certificate status 5. Multiple services use the lowest observed score.",
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
    score: calculateWebsiteReadinessScore(jobs),
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
