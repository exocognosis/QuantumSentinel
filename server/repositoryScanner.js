import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

const DEFAULT_MAX_FILES = 25_000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", ".quantumsentinel", "node_modules", "target", "dist", "build",
  "coverage", ".next", ".nuxt", "vendor", "Pods", ".venv", "venv", "__pycache__",
]);

const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".conf", ".config", ".cpp", ".cs", ".env", ".go", ".gradle", ".h",
  ".hpp", ".html", ".ini", ".java", ".js", ".json", ".jsx", ".kt", ".kts", ".md",
  ".mjs", ".pem", ".properties", ".py", ".rb", ".rs", ".sh", ".sql", ".swift",
  ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
]);

const TEXT_FILENAMES = new Set([
  "Cargo.lock", "Cargo.toml", "Dockerfile", "Gemfile", "Gemfile.lock", "go.mod", "go.sum",
  "package-lock.json", "package.json", "Pipfile", "Pipfile.lock", "pom.xml", "requirements.txt",
]);

const RULES = [
  { id: "deprecated-md5", label: "MD5", pattern: /\b(?:md5|MD5WithRSA|EVP_md5)\b/gi, classification: "deprecated", severity: "CRITICAL", migration: "Replace with an approved SHA-256 or stronger construction", rationale: "MD5 is cryptographically broken and should be removed independently of the quantum threat." },
  { id: "deprecated-sha1", label: "SHA-1", pattern: /\b(?:sha-?1|SHA1WithRSA|EVP_sha1)\b/gi, classification: "deprecated", severity: "CRITICAL", migration: "Replace with an approved SHA-256 or stronger construction", rationale: "SHA-1 collision resistance is broken and should not protect signatures or integrity." },
  { id: "deprecated-cipher", label: "DES/3DES/RC4", pattern: /\b(?:3des|des-ede3|des-cbc|rc4|arcfour)\b/gi, classification: "deprecated", severity: "CRITICAL", migration: "Replace with AES-GCM or ChaCha20-Poly1305 using an approved protocol", rationale: "The detected cipher is deprecated and unsafe for modern deployments." },
  { id: "rsa", label: "RSA", pattern: /\b(?:RSA(?:[-_ ]?(?:1024|2048|3072|4096))?|rsaEncryption|RSA-PSS|RS256|RS384|RS512)\b/g, classification: "shor-vulnerable-public-key", severity: "HIGH", migration: "Inventory the use case, then evaluate ML-KEM for key establishment or ML-DSA for signatures", rationale: "RSA public-key security would be broken by a cryptographically relevant quantum computer." },
  { id: "elliptic-curve", label: "Elliptic-curve cryptography", pattern: /\b(?:ECDSA|ECDH|ECDHE|X25519|X448|Ed25519|Ed448|secp256k1|P-?256|P-?384|P-?521|prime256v1)\b/g, classification: "shor-vulnerable-public-key", severity: "HIGH", migration: "Plan a hybrid transition to an approved post-quantum key-establishment or signature scheme", rationale: "Elliptic-curve public-key security would be broken by a cryptographically relevant quantum computer." },
  { id: "pqc", label: "Post-quantum cryptography", pattern: /\b(?:ML-KEM(?:-?(?:512|768|1024))?|ML-DSA(?:-?(?:44|65|87))?|SLH-DSA|Kyber|Dilithium|SPHINCS\+?)\b/gi, classification: "pqc", severity: "INFO", migration: "Validate implementation provenance, parameters, downgrade behavior, test vectors, and operational use", rationale: "A standardized or legacy-named post-quantum algorithm reference was detected." },
  { id: "symmetric-hash", label: "Symmetric/hash primitive", pattern: /\b(?:AES-?(?:128|192|256)|ChaCha20|Poly1305|SHA-?(?:256|384|512)|SHA3-?(?:256|384|512)|SHAKE(?:128|256)|HMAC)\b/gi, classification: "quantum-resistant-symmetric-hash", severity: "INFO", migration: "Confirm adequate parameters and protocol-level usage; this is not a Shor-vulnerable public-key primitive", rationale: "Symmetric and hash primitives require quantum-adjusted strength analysis, not public-key replacement." },
];

function normalizePath(path) { return path.split("\\").join("/"); }
function isTextCandidate(path) { return TEXT_FILENAMES.has(basename(path)) || TEXT_EXTENSIONS.has(extname(path).toLowerCase()); }
function redactEvidence(line) {
  const trimmed = line.trim().replace(/\s+/g, " ").slice(0, 240);
  if (/-----BEGIN .*PRIVATE KEY-----/i.test(trimmed)) return "[private-key header redacted]";
  return trimmed.replace(/((?:api[_-]?key|secret|password|token)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]").replace(/[A-Za-z0-9+/=_-]{80,}/g, "[long value redacted]");
}
function confidenceFor(path, line) {
  const name = basename(path);
  if (/\.(?:pem|crt|cer|key)$/i.test(name)) return "confirmed";
  if (/\b(?:createSign|createVerify|generateKey|SigningMethod|signatureAlgorithm|cipher_suites|ssl_ciphers|algorithm\s*[:=])\b/i.test(line)) return "high";
  if (/lock|package\.json|Cargo\.toml|go\.mod|pom\.xml/i.test(name)) return "dependency-reference";
  if (/\.(?:md|txt)$/i.test(name)) return "documentation-reference";
  return "candidate";
}
function contextFor(path, line) {
  const text = `${path} ${line}`.toLowerCase();
  if (/sign|jwt|token|certificate|cert|release/.test(text)) return "signature-or-trust";
  if (/tls|ssl|kem|handshake|key.?exchange|vpn/.test(text)) return "key-establishment-or-transport";
  if (/encrypt|decrypt|cipher|aead/.test(text)) return "data-protection";
  if (/hash|digest|checksum|hmac/.test(text)) return "hash-or-integrity";
  if (/lock|depend|package|cargo|pom|gradle|requirements/.test(text)) return "dependency";
  return "usage-unverified";
}
async function collectFiles(root, { maxFiles, maxFileBytes }) {
  const files = [];
  const skipped = { excludedDirectories: 0, oversizedFiles: 0, nonTextFiles: 0, unreadableFiles: 0 };
  async function visit(directory) {
    if (files.length >= maxFiles) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { skipped.unreadableFiles += 1; return; }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) skipped.excludedDirectories += 1;
        else await visit(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isTextCandidate(path)) { skipped.nonTextFiles += 1; continue; }
      try {
        const metadata = await stat(path);
        if (metadata.size > maxFileBytes) skipped.oversizedFiles += 1;
        else files.push({ path, bytes: metadata.size });
      } catch { skipped.unreadableFiles += 1; }
    }
  }
  await visit(root);
  return { files, skipped, limitReached: files.length >= maxFiles };
}
function scoreFindings(findings) {
  const penaltyBySeverity = { CRITICAL: 15, HIGH: 8, MEDIUM: 4, LOW: 2, INFO: 0 };
  const confidenceMultiplier = { confirmed: 1, high: 0.9, candidate: 0.55, "dependency-reference": 0.4, "documentation-reference": 0.1 };
  const grouped = new Map();
  for (const finding of findings.filter((item) => item.severity !== "INFO")) {
    if (!grouped.has(finding.ruleId)) grouped.set(finding.ruleId, []);
    grouped.get(finding.ruleId).push(finding);
  }
  const rawPenalty = [...grouped.values()].reduce((total, group) => {
    const strongest = Math.max(...group.map((finding) => confidenceMultiplier[finding.confidence] ?? 0.5));
    const base = penaltyBySeverity[group[0].severity] * strongest;
    const prevalence = Math.min(8, Math.log2(group.length + 1) * 1.5);
    return total + base + prevalence;
  }, 0);
  const readinessScore = Math.max(0, Math.round(100 - Math.min(100, rawPenalty)));
  return { readinessScore, grade: readinessScore >= 90 ? "A" : readinessScore >= 75 ? "B" : readinessScore >= 60 ? "C" : readinessScore >= 40 ? "D" : "F", method: "100 minus per-algorithm severity penalties adjusted by strongest evidence confidence and logarithmic prevalence; informational PQC and symmetric/hash observations do not reduce the score" };
}
function summarize(findings) {
  const counts = {};
  const severities = {};
  for (const finding of findings) {
    counts[finding.classification] = (counts[finding.classification] ?? 0) + 1;
    severities[finding.severity] = (severities[finding.severity] ?? 0) + 1;
  }
  return { totalFindings: findings.length, byClassification: counts, bySeverity: severities };
}
export async function scanRepository(inputPath, options = {}) {
  const root = resolve(inputPath);
  const rootMetadata = await stat(root);
  if (!rootMetadata.isDirectory()) throw new Error("scan target must be a directory");
  const startedAt = new Date().toISOString();
  const inventory = await collectFiles(root, { maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES, maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES });
  const findings = [];
  let bytesScanned = 0;
  for (const file of inventory.files) {
    let content;
    try { content = await readFile(file.path, "utf8"); } catch { inventory.skipped.unreadableFiles += 1; continue; }
    bytesScanned += file.bytes;
    const relativePath = normalizePath(relative(root, file.path));
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        const matches = [...line.matchAll(rule.pattern)];
        if (!matches.length) continue;
        const confidence = confidenceFor(relativePath, line);
        findings.push({
          id: createHash("sha256").update(`${relativePath}:${index + 1}:${rule.id}:${matches[0][0]}`).digest("hex").slice(0, 16),
          ruleId: rule.id, algorithm: rule.label, matchedValue: matches[0][0], classification: rule.classification,
          severity: rule.severity, confidence, usage: contextFor(relativePath, line),
          evidence: { file: relativePath, line: index + 1, excerpt: redactEvidence(line) },
          rationale: rule.rationale, recommendation: rule.migration,
        });
      }
    }
  }
  findings.sort((left, right) => left.evidence.file.localeCompare(right.evidence.file) || left.evidence.line - right.evidence.line || left.ruleId.localeCompare(right.ruleId));
  const completedAt = new Date().toISOString();
  return {
    schemaVersion: "1.0.0", scanner: { name: "QuantumSentinel Q-Day Scanner", version: "0.1.0" },
    scan: { target: root, targetName: basename(root), startedAt, completedAt, filesScanned: inventory.files.length, bytesScanned, limitReached: inventory.limitReached, skipped: inventory.skipped, exclusions: [...EXCLUDED_DIRECTORIES].sort() },
    score: scoreFindings(findings), summary: summarize(findings), findings,
    limitations: [
      "Static textual detection does not prove that every referenced algorithm is reachable or operationally deployed.",
      "Documentation and dependency references are assigned lower confidence than explicit configuration or key material.",
      "Binary artifacts, runtime negotiation, hardware, external services, and transitive behavior require separate probes or review.",
      "A high readiness score is not a certification, audit opinion, or guarantee of quantum safety.",
    ],
  };
}
export function scannerRules() { return RULES.map(({ pattern: _pattern, ...rule }) => ({ ...rule })); }
