function objectValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function firstObjectValue(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (Array.isArray(value)) {
      const match = value.find(item => item && typeof item === "object" && !Array.isArray(item));
      if (match) return match;
    }
  }
  return {};
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function compactFingerprint(value) {
  const fingerprint = String(value || "").trim();
  if (!fingerprint) return "";
  const parts = fingerprint.split(":").filter(Boolean);
  if (parts.length > 6) return `${parts.slice(0, 4).join(":")}:...:${parts.slice(-2).join(":")}`;
  if (fingerprint.length > 28) return `${fingerprint.slice(0, 12)}...${fingerprint.slice(-8)}`;
  return fingerprint;
}

export function findingRecurrenceSummary(finding = {}) {
  const recurrence = objectValue(
    finding.recurrence
      ?? finding.recurrenceMetadata
      ?? finding.recurrenceInfo
      ?? finding.evidence?.recurrence,
  );
  const evidence = firstObjectValue(
    recurrence.evidence,
    recurrence.tlsEvidence,
    finding.evidence,
    finding.tlsEvidence,
  );
  const target = firstObjectValue(recurrence.target, evidence.target, finding.target);
  const certificate = firstObjectValue(recurrence.certificate, evidence.certificate, finding.certificate);
  const count = numberOrNull(firstPresent(
    recurrence.count,
    recurrence.occurrenceCount,
    recurrence.occurrences,
    recurrence.recurrenceCount,
    finding.recurrenceCount,
    finding.occurrenceCount,
    finding.occurrences,
  ));
  const firstObservedAt = String(firstPresent(
    recurrence.firstObservedAt,
    recurrence.firstObserved,
    recurrence.firstSeenAt,
    recurrence.firstSeen,
    finding.firstObservedAt,
    finding.firstObserved,
    finding.firstSeenAt,
    finding.firstSeen,
  ));
  const lastObservedAt = String(firstPresent(
    recurrence.lastObservedAt,
    recurrence.lastObserved,
    recurrence.lastSeenAt,
    recurrence.lastSeen,
    finding.lastObservedAt,
    finding.lastObserved,
    finding.lastSeenAt,
    finding.lastSeen,
  ));
  const host = String(firstPresent(
    recurrence.host,
    recurrence.hostname,
    recurrence.targetHost,
    evidence.host,
    evidence.hostname,
    evidence.targetHost,
    target.host,
    target.hostname,
    finding.host,
    finding.hostname,
    finding.tlsHost,
    finding.targetHost,
  ));
  const fingerprint = compactFingerprint(firstPresent(
    recurrence.fingerprint,
    recurrence.fingerprint256,
    Array.isArray(recurrence.fingerprints) ? recurrence.fingerprints[0] : "",
    recurrence.tlsFingerprint,
    recurrence.certificateFingerprint,
    evidence.fingerprint,
    evidence.fingerprint256,
    evidence.tlsFingerprint,
    evidence.certificateFingerprint,
    certificate.fingerprint,
    certificate.fingerprint256,
    finding.fingerprint,
    finding.fingerprint256,
    finding.tlsFingerprint,
    finding.certificateFingerprint,
  ));

  return {
    count,
    firstObservedAt,
    lastObservedAt,
    host,
    fingerprint,
    hasDetails: Boolean(count || firstObservedAt || lastObservedAt || host || fingerprint),
  };
}
