const CLASSIFICATIONS = {
  DEPRECATED: "DEPRECATED",
  HYBRID: "HYBRID",
  QUANTUM_SAFE: "QUANTUM-SAFE",
  SHOR_CRITICAL: "SHOR-CRITICAL",
  UNENCRYPTED: "UNENCRYPTED",
  UNKNOWN: "UNKNOWN",
};

const PRIORITIES = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  MONITOR: "MONITOR",
};

const DEPRECATED_ALGORITHM_PATTERN = /\b(DES|3DES|RC2|RC4|MD5|SHA-?1|RSA-?1024|DSA-?1024|DH-?1024)\b/i;
const DEPRECATED_PROTOCOL_PATTERN = /\b(SSL|TLS ?1[._-]?[01]|TLSV1[._-]?[01]|IKEV?1|WEP|PPTP)\b/i;
const HYBRID_PATTERN = /\b(HYBRID|X25519[+-].*(ML-KEM|KYBER)|(ML-KEM|KYBER).*[+-].*(X25519|ECDH|RSA|P-?256|P-?384|P-?521))\b/i;
const PQC_PATTERN = /\b(ML-KEM|ML-DSA|SLH-DSA|SPHINCS|DILITHIUM|KYBER|FALCON)\b/i;
const SYMMETRIC_SAFE_PATTERN = /\b(AES-?(128|192|256)|CHACHA20|POLY1305|SHA-?(256|384|512)|HMAC)\b/i;
const SHOR_CRITICAL_PATTERN = /\b(RSA|ECDSA|ECDH|ECDHE|DHE|DH|DSA|X25519|X448|ED25519|ED448|P-?256|P-?384|P-?521|EC-)/i;
const UNENCRYPTED_ALGORITHM_PATTERN = /\b(NONE|NULL|PLAINTEXT|CLEAR-?TEXT|UNENCRYPTED|NO ENCRYPTION)\b/i;
const UNENCRYPTED_PROTOCOL_PATTERN = /\b(HTTP|TELNET|FTP|RLOGIN|RSH|LDAP|SMTP|POP3|IMAP|MODBUS)\b/i;
const ENCRYPTED_PROTOCOL_PATTERN = /\b(TLS|HTTPS|SMTPS|IMAPS|POP3S|LDAPS|SSH|IKEV2|IPSEC|NTPSEC|PKIX)\b/i;

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function compactText(...values) {
  return values
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") return Object.entries(value).filter(([, enabled]) => enabled).map(([key]) => key);
      return value;
    })
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" ");
}

function includesAny(value, terms) {
  const text = String(value ?? "").toLowerCase();
  return terms.some((term) => text.includes(term));
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === "object") {
    return Object.entries(tags)
      .filter(([, enabled]) => enabled)
      .map(([tag]) => tag);
  }
  return String(tags).split(/[,\s]+/).filter(Boolean);
}

function normalizeAsset(asset = {}) {
  const source = asset.result ?? asset;
  const certificate = source.certificate ?? asset.certificate ?? {};
  const protocol = source.protocol ?? asset.protocol ?? {};
  const cryptography = source.cryptography ?? asset.cryptography ?? {};
  const target = asset.target ?? {};
  const risk = typeof asset.risk === "object" && asset.risk !== null
    ? asset.risk
    : typeof source.risk === "object" && source.risk !== null
      ? source.risk
      : {};
  let riskScore = risk.score;
  if (asset.risk !== undefined && (typeof asset.risk !== "object" || asset.risk === null)) {
    riskScore = asset.risk;
  } else if (source.risk !== undefined && (typeof source.risk !== "object" || source.risk === null)) {
    riskScore = source.risk;
  }

  return {
    id: asset.id ?? asset.assetId ?? target.assetId ?? null,
    hostname: asset.hostname ?? target.hostname ?? target.host ?? certificate.subject ?? null,
    type: asset.type ?? asset.assetType ?? target.type ?? "Observed Endpoint",
    segment: asset.segment ?? asset.networkSegment ?? "Unknown",
    algorithm: asset.algo ?? asset.algorithm ?? cryptography.algorithm ?? certificate.algorithm ?? "Unknown",
    protocol: asset.proto ?? asset.protocolName ?? cryptography.protocol ?? protocol.name ?? "Unknown",
    pfs: asset.pfs ?? asset.perfectForwardSecrecy ?? cryptography.perfectForwardSecrecy ?? protocol.perfectForwardSecrecy ?? false,
    encrypted: asset.encrypted ?? source.encrypted ?? cryptography.encrypted ?? null,
    certExpiration: asset.cert_exp ?? asset.certExpiration ?? cryptography.certificateExpiration ?? certificate.expiresAt ?? null,
    tags: normalizeTags(asset.tags ?? source.tags),
    hndl: Number(asset.hndl ?? risk.hndl),
    tnfl: Number(asset.tnfl ?? risk.tnfl),
    risk: Number(riskScore),
    priority: asset.prio ?? asset.priority ?? risk.priority ?? null,
    migration: asset.migration ?? source.migration ?? null,
    complexity: asset.complexity ?? source.complexity ?? null,
  };
}

function classifyNormalizedAsset(asset) {
  const text = compactText(asset.algorithm, asset.protocol);
  const notes = [];
  let label = CLASSIFICATIONS.UNKNOWN;
  let quantumVulnerable = false;

  if (asset.encrypted === false || UNENCRYPTED_ALGORITHM_PATTERN.test(text)) {
    label = CLASSIFICATIONS.UNENCRYPTED;
    notes.push("No cryptographic protection was observed");
  } else if (DEPRECATED_ALGORITHM_PATTERN.test(asset.algorithm) || DEPRECATED_PROTOCOL_PATTERN.test(asset.protocol)) {
    label = CLASSIFICATIONS.DEPRECATED;
    quantumVulnerable = true;
    notes.push("Deprecated cryptography or protocol detected");
  } else if (HYBRID_PATTERN.test(asset.algorithm) || HYBRID_PATTERN.test(text)) {
    label = CLASSIFICATIONS.HYBRID;
    notes.push("Hybrid classical/post-quantum cryptography detected");
  } else if (PQC_PATTERN.test(asset.algorithm) || (SYMMETRIC_SAFE_PATTERN.test(asset.algorithm) && !SHOR_CRITICAL_PATTERN.test(asset.algorithm))) {
    label = CLASSIFICATIONS.QUANTUM_SAFE;
    notes.push("Post-quantum or symmetric cryptography is not Shor-vulnerable");
  } else if (SHOR_CRITICAL_PATTERN.test(asset.algorithm)) {
    label = CLASSIFICATIONS.SHOR_CRITICAL;
    quantumVulnerable = true;
    notes.push("Classical public-key cryptography is vulnerable to Shor-class attacks");
  } else if (!ENCRYPTED_PROTOCOL_PATTERN.test(asset.protocol) && UNENCRYPTED_PROTOCOL_PATTERN.test(asset.protocol)) {
    label = CLASSIFICATIONS.UNENCRYPTED;
    notes.push("Protocol commonly operates without encryption");
  }

  if (asset.pfs === false && label !== CLASSIFICATIONS.QUANTUM_SAFE) {
    notes.push("Perfect forward secrecy was not observed");
  }

  return {
    label,
    priority: baselinePriority(label, asset.pfs),
    quantumVulnerable,
    notes,
  };
}

function baselinePriority(label, pfs) {
  if (label === CLASSIFICATIONS.DEPRECATED || label === CLASSIFICATIONS.UNENCRYPTED) return PRIORITIES.CRITICAL;
  if (label === CLASSIFICATIONS.SHOR_CRITICAL && pfs === false) return PRIORITIES.HIGH;
  if (label === CLASSIFICATIONS.SHOR_CRITICAL) return PRIORITIES.MEDIUM;
  return PRIORITIES.MONITOR;
}

function addWeightedFactor(factors, name, score) {
  if (!score) return;
  factors.push({ name, score });
}

function scoreHndl(asset, classification) {
  const factors = [];
  const type = asset.type;
  const segment = asset.segment;
  const protocol = asset.protocol;
  const tags = compactText(asset.tags);

  addWeightedFactor(factors, "classification", {
    [CLASSIFICATIONS.UNENCRYPTED]: 82,
    [CLASSIFICATIONS.DEPRECATED]: 76,
    [CLASSIFICATIONS.SHOR_CRITICAL]: 60,
    [CLASSIFICATIONS.HYBRID]: 12,
    [CLASSIFICATIONS.QUANTUM_SAFE]: 4,
  }[classification.label] ?? 30);

  if (includesAny(type, ["database", "db", "finance"])) addWeightedFactor(factors, "data-store", 18);
  if (includesAny(type, ["load balancer", "web", "api", "gateway"])) addWeightedFactor(factors, "internet-service", 14);
  if (includesAny(type, ["vpn"])) addWeightedFactor(factors, "remote-access", 16);
  if (includesAny(type, ["mail"])) addWeightedFactor(factors, "message-flow", 12);
  if (includesAny(type, ["ot", "scada", "historian", "plc"])) addWeightedFactor(factors, "operational-technology", 10);

  if (includesAny(segment, ["dmz", "perimeter"])) addWeightedFactor(factors, "exposed-segment", 14);
  if (includesAny(segment, ["finance", "payment", "card"])) addWeightedFactor(factors, "regulated-data-segment", 18);
  if (includesAny(segment, ["ot", "manufacturing"])) addWeightedFactor(factors, "ot-segment", 12);
  if (includesAny(segment, ["cloud"])) addWeightedFactor(factors, "cloud-segment", 8);

  if (includesAny(protocol, ["tls", "https", "smtps", "ike", "ipsec"])) addWeightedFactor(factors, "encrypted-flow", 7);
  if (classification.label === CLASSIFICATIONS.UNENCRYPTED) addWeightedFactor(factors, "cleartext-flow", 18);
  if (asset.pfs === false && classification.label !== CLASSIFICATIONS.QUANTUM_SAFE) addWeightedFactor(factors, "no-pfs", 12);
  if (asset.pfs === true) addWeightedFactor(factors, "pfs-enabled", -5);

  if (includesAny(tags, ["public", "internet", "external", "customer", "pii", "pci", "cardholder", "secret", "critical"])) {
    addWeightedFactor(factors, "sensitive-tags", 12);
  }

  return {
    value: clampScore(factors.reduce((sum, factor) => sum + factor.score, 0)),
    factors,
  };
}

function scoreTnfl(asset, classification) {
  const factors = [];
  const type = asset.type;
  const protocol = asset.protocol;
  const tags = compactText(asset.tags);

  addWeightedFactor(factors, "classification", {
    [CLASSIFICATIONS.UNENCRYPTED]: 55,
    [CLASSIFICATIONS.DEPRECATED]: 70,
    [CLASSIFICATIONS.SHOR_CRITICAL]: 62,
    [CLASSIFICATIONS.HYBRID]: 14,
    [CLASSIFICATIONS.QUANTUM_SAFE]: 5,
  }[classification.label] ?? 28);

  if (includesAny(type, ["ca server", "certificate authority", "root ca", "pki"])) addWeightedFactor(factors, "certificate-authority", 30);
  if (includesAny(type, ["code signing", "signing"])) addWeightedFactor(factors, "code-signing", 28);
  if (includesAny(type, ["identity", "sso", "idp"])) addWeightedFactor(factors, "identity", 20);
  if (includesAny(type, ["container orch", "k8s", "kubernetes"])) addWeightedFactor(factors, "control-plane", 18);
  if (includesAny(type, ["vpn"])) addWeightedFactor(factors, "remote-access-trust", 15);
  if (includesAny(type, ["load balancer", "web", "api", "gateway"])) addWeightedFactor(factors, "service-identity", 10);
  if (includesAny(type, ["database"])) addWeightedFactor(factors, "database-identity", 6);

  if (includesAny(protocol, ["pkix", "x.509", "code signing"])) addWeightedFactor(factors, "signature-protocol", 22);
  if (includesAny(protocol, ["tls", "https", "smtps"])) addWeightedFactor(factors, "certificate-bearing-protocol", 8);
  if (includesAny(protocol, ["ike", "ipsec"])) addWeightedFactor(factors, "vpn-trust-protocol", 10);

  if (includesAny(tags, ["ca", "root", "trust", "signing", "identity", "sso", "prod", "critical"])) {
    addWeightedFactor(factors, "trust-tags", 12);
  }

  if (asset.pfs === false && classification.label === CLASSIFICATIONS.SHOR_CRITICAL) {
    addWeightedFactor(factors, "static-key-material", 8);
  }

  return {
    value: clampScore(factors.reduce((sum, factor) => sum + factor.score, 0)),
    factors,
  };
}

function priorityFromScore({ label }, scores) {
  const risk = scores.risk;

  if (label === CLASSIFICATIONS.UNENCRYPTED || label === CLASSIFICATIONS.DEPRECATED) {
    return risk >= 65 ? PRIORITIES.CRITICAL : PRIORITIES.HIGH;
  }

  if (label === CLASSIFICATIONS.SHOR_CRITICAL) {
    if (risk >= 85 || scores.hndl >= 90 || scores.tnfl >= 90) return PRIORITIES.CRITICAL;
    if (risk >= 70) return PRIORITIES.HIGH;
    return PRIORITIES.MEDIUM;
  }

  if (risk >= 85) return PRIORITIES.CRITICAL;
  if (risk >= 70) return PRIORITIES.HIGH;
  if (risk >= 40) return PRIORITIES.MEDIUM;
  return PRIORITIES.MONITOR;
}

export function classifyAsset(asset) {
  return classifyNormalizedAsset(normalizeAsset(asset));
}

export function scoreAsset(asset) {
  const normalized = normalizeAsset(asset);
  const classification = classifyNormalizedAsset(normalized);
  const hndl = Number.isFinite(normalized.hndl)
    ? clampScore(normalized.hndl)
    : scoreHndl(normalized, classification).value;
  const tnfl = Number.isFinite(normalized.tnfl)
    ? clampScore(normalized.tnfl)
    : scoreTnfl(normalized, classification).value;
  const risk = Number.isFinite(normalized.risk)
    ? clampScore(normalized.risk)
    : clampScore((Math.max(hndl, tnfl) * 0.7) + (((hndl + tnfl) / 2) * 0.3));
  const scores = { hndl, tnfl, risk };

  return {
    ...scores,
    priority: normalized.priority ?? priorityFromScore(classification, scores),
    factors: {
      hndl: scoreHndl(normalized, classification).factors,
      tnfl: scoreTnfl(normalized, classification).factors,
    },
  };
}

export function recommendRemediation(asset) {
  const normalized = normalizeAsset(asset);
  const classification = classifyNormalizedAsset(normalized);
  const migration = normalized.migration;
  const hardwareRefreshRequired = /REQUIRES HW REFRESH/i.test(String(migration ?? ""));

  if (classification.label === CLASSIFICATIONS.UNENCRYPTED) {
    return {
      action: "Enable authenticated encryption",
      target: "TLS 1.3 or mutually authenticated tunnel",
      detail: "Remove cleartext exposure before migration planning because traffic is currently recoverable without quantum capability.",
      complexity: normalized.complexity ?? "MEDIUM",
    };
  }

  if (classification.label === CLASSIFICATIONS.DEPRECATED) {
    return {
      action: hardwareRefreshRequired ? "Replace legacy cryptographic endpoint" : "Disable deprecated cryptography",
      target: hardwareRefreshRequired ? "PQC-capable hardware or gateway" : migration ?? "TLS 1.3 with approved ciphers",
      detail: "Remove deprecated algorithms and protocols, then rotate affected keys and certificates.",
      complexity: normalized.complexity ?? (hardwareRefreshRequired ? "HIGH" : "MEDIUM"),
    };
  }

  if (classification.label === CLASSIFICATIONS.SHOR_CRITICAL) {
    return {
      action: "Migrate Shor-vulnerable public-key cryptography",
      target: migration ?? "ML-KEM for key establishment and ML-DSA for signatures",
      detail: "Prioritize high HNDL/TNFL assets, rotate classical keys, and validate hybrid or PQC negotiation before broad rollout.",
      complexity: normalized.complexity ?? "MEDIUM",
    };
  }

  if (classification.label === CLASSIFICATIONS.HYBRID) {
    return {
      action: "Maintain hybrid deployment",
      target: migration ?? "Full PQC when standards and dependencies are ready",
      detail: "Continue telemetry for negotiated groups, certificate chains, and downgrade resistance.",
      complexity: normalized.complexity ?? "LOW",
    };
  }

  if (classification.label === CLASSIFICATIONS.QUANTUM_SAFE) {
    return {
      action: "Monitor quantum-safe control",
      target: migration ?? "No migration required",
      detail: "Keep the asset in CBOM inventory and watch for probe drift or classical fallback.",
      complexity: normalized.complexity ?? "LOW",
    };
  }

  return {
    action: "Assess cryptographic posture",
    target: migration ?? "Collect algorithm, protocol, and PFS evidence",
    detail: "Insufficient cryptographic evidence was available to classify the asset confidently.",
    complexity: normalized.complexity ?? "UNKNOWN",
  };
}

export function analyzeAsset(asset) {
  const normalized = normalizeAsset(asset);
  const classification = classifyNormalizedAsset(normalized);
  const scores = scoreAsset(asset);
  const remediation = recommendRemediation(asset);

  return {
    assetId: normalized.id,
    hostname: normalized.hostname,
    classification: {
      ...classification,
      priority: scores.priority,
    },
    scores,
    priority: scores.priority,
    remediation,
    evidence: {
      algorithm: normalized.algorithm,
      protocol: normalized.protocol,
      perfectForwardSecrecy: normalized.pfs,
      type: normalized.type,
      segment: normalized.segment,
      tags: normalized.tags,
    },
  };
}

function historyAsset(entry) {
  return normalizeAsset(entry?.asset ?? entry?.snapshot ?? entry?.observation ?? entry);
}

function algorithmRank(asset, classification = classifyNormalizedAsset(asset)) {
  const algorithm = asset.algorithm;
  if (classification.label === CLASSIFICATIONS.UNENCRYPTED) return 100;
  if (classification.label === CLASSIFICATIONS.DEPRECATED) return 90;
  if (classification.label === CLASSIFICATIONS.SHOR_CRITICAL) {
    if (/RSA-?1024|DH-?1024|DSA-?1024/i.test(algorithm)) return 85;
    if (/RSA-?2048|P-?256|X25519|ED25519/i.test(algorithm)) return 70;
    return 62;
  }
  if (classification.label === CLASSIFICATIONS.HYBRID) return 25;
  if (classification.label === CLASSIFICATIONS.QUANTUM_SAFE) return 10;
  return 50;
}

function protocolRank(protocol) {
  const text = String(protocol ?? "").toUpperCase().replace(/\s+/g, "");
  if (/TLS1\.3|TLSV1\.3|HTTPS|SMTPS|IMAPS|POP3S|LDAPS|IKEV2|NTPSEC/.test(text)) return 50;
  if (/TLS1\.2|TLSV1\.2/.test(text)) return 42;
  if (/IKEV1/.test(text)) return 22;
  if (/TLS1\.1|TLSV1\.1/.test(text)) return 18;
  if (/TLS1\.0|TLSV1\.0|SSL/.test(text)) return 10;
  if (UNENCRYPTED_PROTOCOL_PATTERN.test(protocol)) return 5;
  return null;
}

function driftEvent(type, severity, title, previous, current, extra = {}) {
  return {
    type,
    severity,
    title,
    from: {
      algorithm: previous.algorithm,
      protocol: previous.protocol,
      pfs: previous.pfs,
      classification: classifyNormalizedAsset(previous).label,
    },
    to: {
      algorithm: current.algorithm,
      protocol: current.protocol,
      pfs: current.pfs,
      classification: classifyNormalizedAsset(current).label,
    },
    ...extra,
  };
}

export function detectAssetDrift(history = []) {
  const observations = history.map(historyAsset).filter(Boolean);
  const events = [];

  for (let index = 1; index < observations.length; index += 1) {
    const previous = observations[index - 1];
    const current = observations[index];
    const previousClassification = classifyNormalizedAsset(previous);
    const currentClassification = classifyNormalizedAsset(current);
    const previousAlgorithmRank = algorithmRank(previous, previousClassification);
    const currentAlgorithmRank = algorithmRank(current, currentClassification);
    const previousProtocolRank = protocolRank(previous.protocol);
    const currentProtocolRank = protocolRank(current.protocol);

    if (currentAlgorithmRank > previousAlgorithmRank) {
      events.push(driftEvent(
        "WEAKER_ALGORITHM",
        currentAlgorithmRank >= 85 ? PRIORITIES.CRITICAL : PRIORITIES.HIGH,
        "Observed algorithm is weaker than the previous observation",
        previous,
        current,
        { index },
      ));
    }

    if (previous.pfs === true && current.pfs === false) {
      events.push(driftEvent("PFS_DISABLED", PRIORITIES.HIGH, "Perfect forward secrecy was disabled", previous, current, { index }));
    }

    if (previousProtocolRank !== null && currentProtocolRank !== null && currentProtocolRank < previousProtocolRank) {
      events.push(driftEvent("PROTOCOL_DOWNGRADE", PRIORITIES.HIGH, "Observed protocol downgrade", previous, current, { index }));
    }

    if (previousClassification.label !== CLASSIFICATIONS.SHOR_CRITICAL && currentClassification.label === CLASSIFICATIONS.SHOR_CRITICAL) {
      events.push(driftEvent("NEW_SHOR_CRITICAL", PRIORITIES.CRITICAL, "Asset regressed to Shor-critical cryptography", previous, current, { index }));
    }

    if (!DEPRECATED_PROTOCOL_PATTERN.test(previous.protocol) && DEPRECATED_PROTOCOL_PATTERN.test(current.protocol)) {
      events.push(driftEvent("DEPRECATED_PROTOCOL", PRIORITIES.CRITICAL, "Deprecated protocol detected after drift", previous, current, { index }));
    }

    if (
      [CLASSIFICATIONS.HYBRID, CLASSIFICATIONS.QUANTUM_SAFE].includes(previousClassification.label)
      && ![CLASSIFICATIONS.HYBRID, CLASSIFICATIONS.QUANTUM_SAFE].includes(currentClassification.label)
    ) {
      events.push(driftEvent("PQC_HYBRID_REGRESSION", PRIORITIES.CRITICAL, "Post-quantum or hybrid protection regressed", previous, current, { index }));
    }
  }

  return {
    driftDetected: events.length > 0,
    events,
    previous: observations.at(-2) ?? null,
    latest: observations.at(-1) ?? null,
  };
}

export function findingsFromAnalysis(asset, analysis = analyzeAsset(asset)) {
  const findings = [];
  const severity = analysis.priority ?? analysis.classification?.priority ?? PRIORITIES.MONITOR;
  const evidence = analysis.evidence ?? analyzeAsset(asset).evidence;
  const label = analysis.classification?.label;

  if (label === CLASSIFICATIONS.UNENCRYPTED) {
    findings.push({
      severity: PRIORITIES.CRITICAL,
      type: "UNENCRYPTED",
      title: "Unencrypted cryptographic channel detected",
      description: `${analysis.hostname ?? "Asset"} is using a protocol or algorithm with no observed encryption.`,
      evidence,
      remediation: analysis.remediation,
    });
  } else if (label === CLASSIFICATIONS.DEPRECATED) {
    findings.push({
      severity: PRIORITIES.CRITICAL,
      type: "DEPRECATED",
      title: "Deprecated cryptography detected",
      description: `${analysis.hostname ?? "Asset"} uses deprecated cryptography or protocol support.`,
      evidence,
      remediation: analysis.remediation,
    });
  } else if (label === CLASSIFICATIONS.SHOR_CRITICAL) {
    findings.push({
      severity,
      type: analysis.scores?.hndl >= analysis.scores?.tnfl ? "HNDL" : "TNFL",
      title: "Shor-critical cryptography requires migration",
      description: `${analysis.hostname ?? "Asset"} uses classical public-key cryptography that is vulnerable to a future cryptographically relevant quantum computer.`,
      evidence,
      remediation: analysis.remediation,
    });
  }

  if (evidence.perfectForwardSecrecy === false && label !== CLASSIFICATIONS.QUANTUM_SAFE) {
    findings.push({
      severity: severity === PRIORITIES.MONITOR ? PRIORITIES.MEDIUM : severity,
      type: "PFS",
      title: "Perfect forward secrecy not observed",
      description: `${analysis.hostname ?? "Asset"} did not report PFS, increasing HNDL exposure for recorded traffic.`,
      evidence,
      remediation: analysis.remediation,
    });
  }

  return findings;
}

export { CLASSIFICATIONS, PRIORITIES };
