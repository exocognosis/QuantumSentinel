import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { validateProbeRequest } from "./probeEngine.js";
import {
  isAddressInPrivateSlash24,
  LOCAL_NETWORK_CONCURRENCY,
  LOCAL_NETWORK_DISCOVERY_MODE,
  LOCAL_NETWORK_MAX_HOSTS,
  LOCAL_NETWORK_MAX_OBSERVATIONS,
  LOCAL_NETWORK_PORTS,
  LOCAL_NETWORK_TIMEOUT_MS,
  parsePrivateSlash24,
} from "./networkScanPolicy.js";

const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_MAX_ACTIVE_SESSIONS_PER_CLIENT = 2;
const MAX_RESULT_BYTES = 750_000;

function sessionError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function digestToken(token) {
  return createHash("sha256").update(String(token ?? "")).digest();
}

function tokenMatches(token, digest) {
  if (!digest || typeof token !== "string" || !token) return false;
  return timingSafeEqual(digestToken(token), digest);
}

function newDeviceCode() {
  return randomBytes(12).toString("hex").toUpperCase().match(/.{1,6}/g).join("-");
}

function bearerToken(value) {
  const match = /^Bearer\s+([A-Za-z0-9_-]+)$/i.exec(String(value ?? "").trim());
  return match?.[1] ?? "";
}

function validateSubmittedResult(job, scope) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw sessionError("network scan result must be an object");
  }
  if (job.mode !== "discovery" || job.status !== "completed") {
    throw sessionError("network scan result must be a completed discovery job");
  }
  const observations = job.result?.observations;
  if (!Array.isArray(observations)) {
    throw sessionError("network scan result is missing observations");
  }
  const serialized = JSON.stringify(job);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
    throw sessionError("network scan result is too large", 413);
  }

  if (scope.discoveryMode === LOCAL_NETWORK_DISCOVERY_MODE) {
    if (observations.length > LOCAL_NETWORK_MAX_OBSERVATIONS) {
      throw sessionError("local network scan result has too many observations");
    }
    const cidr = parsePrivateSlash24(job.result?.discovery?.cidr);
    if (!cidr) throw sessionError("local network scan result is missing a valid private network");
    const allowedPorts = new Set(LOCAL_NETWORK_PORTS);
    const targets = new Set();
    for (const observation of observations) {
      const port = Number(observation?.port);
      const target = `${observation?.host}:${port}`;
      if (!isAddressInPrivateSlash24(observation?.host, cidr) || !allowedPorts.has(port)) {
        throw sessionError("local network scan result contains a target outside the allowed network scope");
      }
      if (observation?.status !== "completed" || observation?.reachability?.tcp !== true) {
        throw sessionError("local network scan result can contain only reachable services");
      }
      if (targets.has(target)) throw sessionError("local network scan result contains duplicate observations");
      targets.add(target);
    }
    const summary = job.result?.summary;
    const hostsScanned = Number(summary?.hostsScanned);
    const portsScanned = Number(summary?.portsScanned);
    const targetsScanned = Number(summary?.targetsScanned);
    const reachableCount = Number(summary?.reachableCount);
    const completedCount = Number(summary?.completedCount);
    const failedCount = Number(summary?.failedCount);
    const observationsIncluded = Number(summary?.observationsIncluded);
    const observationsOmitted = Number(summary?.observationsOmitted);
    if (!Number.isInteger(hostsScanned) || hostsScanned < 1 || hostsScanned > LOCAL_NETWORK_MAX_HOSTS
        || portsScanned !== LOCAL_NETWORK_PORTS.length
        || targetsScanned !== hostsScanned * portsScanned
        || !Number.isInteger(reachableCount) || reachableCount < observations.length || reachableCount > targetsScanned
        || completedCount !== reachableCount
        || failedCount !== targetsScanned - reachableCount
        || observationsIncluded !== observations.length
        || observationsOmitted !== reachableCount - observations.length) {
      throw sessionError("local network scan result totals are invalid");
    }
    return structuredClone(job);
  }

  if (observations.length > scope.hosts.length * scope.ports.length) {
    throw sessionError("network scan result exceeds the approved scope");
  }
  const approvedHosts = new Set(scope.hosts);
  const approvedPorts = new Set(scope.ports);
  for (const observation of observations) {
    if (!approvedHosts.has(observation?.host) || !approvedPorts.has(Number(observation?.port))) {
      throw sessionError("network scan result contains a target outside the approved scope");
    }
  }
  return structuredClone(job);
}

export function readBearerToken(request) {
  const header = typeof request.headers?.get === "function"
    ? request.headers.get("authorization")
    : request.headers?.authorization;
  return bearerToken(header);
}

export function createPublicNetworkSessionStore({
  ttlMs = DEFAULT_TTL_MS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  maxActiveSessionsPerClient = DEFAULT_MAX_ACTIVE_SESSIONS_PER_CLIENT,
  now = () => Date.now(),
} = {}) {
  const sessions = new Map();
  const activeSessionLimit = Number.isInteger(maxActiveSessionsPerClient) && maxActiveSessionsPerClient > 0
    ? maxActiveSessionsPerClient
    : DEFAULT_MAX_ACTIVE_SESSIONS_PER_CLIENT;

  function removeExpired() {
    const timestamp = now();
    for (const [id, session] of sessions) {
      if (session.expiresAtMs <= timestamp) sessions.delete(id);
    }
  }

  function evictCompletedForCapacity() {
    removeExpired();
    if (sessions.size < maxSessions) return;
    for (const [id, session] of sessions) {
      if (session.status === "completed") sessions.delete(id);
      if (sessions.size < maxSessions) return;
    }
  }

  function requireSession(id) {
    removeExpired();
    const session = sessions.get(id);
    if (!session) throw sessionError("network scan session was not found or has expired", 404);
    return session;
  }

  function publicView(session) {
    return {
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      completedAt: session.completedAt,
      scope: structuredClone(session.scope),
      result: session.result == null ? null : structuredClone(session.result),
    };
  }

  return {
    create(input, { clientKey = "unknown" } = {}) {
      evictCompletedForCapacity();
      const clientKeyDigest = digestToken(clientKey).toString("hex");
      const activeForClient = [...sessions.values()].filter((session) => (
        session.clientKeyDigest === clientKeyDigest && session.status !== "completed"
      )).length;
      if (activeForClient >= activeSessionLimit) {
        throw sessionError("too many active network scan sessions for this client", 429);
      }
      if (sessions.size >= maxSessions) {
        throw sessionError("too many active network scan sessions", 503);
      }
      let sessionScope;
      if (input?.discoveryMode === LOCAL_NETWORK_DISCOVERY_MODE) {
        if (input?.hosts != null || input?.ports != null) {
          throw sessionError("automatic local network scans do not accept host or port entries");
        }
        sessionScope = {
          discoveryMode: LOCAL_NETWORK_DISCOVERY_MODE,
          ports: [...LOCAL_NETWORK_PORTS],
          maxHosts: LOCAL_NETWORK_MAX_HOSTS,
          maxObservations: LOCAL_NETWORK_MAX_OBSERVATIONS,
          concurrency: LOCAL_NETWORK_CONCURRENCY,
          timeoutMs: LOCAL_NETWORK_TIMEOUT_MS,
        };
      } else {
        const scope = validateProbeRequest({
          mode: "discovery",
          hosts: input?.hosts,
          ports: input?.ports,
          concurrency: Math.min(4, Number(input?.concurrency) || 4),
          timeoutMs: Math.min(5_000, Number(input?.timeoutMs) || 1_500),
        });
        sessionScope = {
          hosts: scope.hosts,
          ports: scope.ports,
          concurrency: scope.concurrency,
          timeoutMs: scope.timeoutMs,
        };
      }
      const id = randomUUID();
      const readToken = randomBytes(32).toString("base64url");
      const deviceCode = newDeviceCode();
      const createdAtMs = now();
      const expiresAtMs = createdAtMs + ttlMs;
      const session = {
        id,
        status: "waiting_for_connector",
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        createdAtMs,
        expiresAtMs,
        clientKeyDigest,
        completedAt: null,
        scope: sessionScope,
        deviceCodeDigest: digestToken(deviceCode),
        uploadTokenDigest: null,
        readTokenDigest: digestToken(readToken),
        result: null,
      };
      sessions.set(id, session);
      return { ...publicView(session), deviceCode, readToken };
    },

    connect(deviceCode) {
      removeExpired();
      const normalizedCode = String(deviceCode ?? "").trim().toUpperCase();
      let session = null;
      for (const candidate of sessions.values()) {
        if (tokenMatches(normalizedCode, candidate.deviceCodeDigest)) {
          session = candidate;
          break;
        }
      }
      if (!session) throw sessionError("network scan device code is invalid or expired", 403);
      if (session.status !== "waiting_for_connector") {
        throw sessionError("network scan device code has already been used", 409);
      }
      const uploadToken = randomBytes(32).toString("base64url");
      session.deviceCodeDigest = null;
      session.uploadTokenDigest = digestToken(uploadToken);
      session.status = "connector_connected";
      return {
        id: session.id,
        status: session.status,
        expiresAt: session.expiresAt,
        scope: structuredClone(session.scope),
        uploadToken,
      };
    },

    get(id, token) {
      const session = requireSession(id);
      if (!tokenMatches(token, session.readTokenDigest)) {
        throw sessionError("network scan session token is invalid", 403);
      }
      return publicView(session);
    },

    submit(id, token, job) {
      const session = requireSession(id);
      if (session.status !== "connector_connected" || !session.uploadTokenDigest) {
        throw sessionError("network scan session already has a result", 409);
      }
      if (!tokenMatches(token, session.uploadTokenDigest)) {
        throw sessionError("network scan upload token is invalid", 403);
      }
      session.result = validateSubmittedResult(job, session.scope);
      session.status = "completed";
      session.completedAt = new Date(now()).toISOString();
      session.uploadTokenDigest = null;
      return publicView(session);
    },
  };
}
