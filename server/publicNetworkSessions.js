import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { validateProbeRequest } from "./probeEngine.js";

const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_SESSIONS = 100;
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
  const serialized = JSON.stringify(job);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
    throw sessionError("network scan result is too large", 413);
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
  now = () => Date.now(),
} = {}) {
  const sessions = new Map();

  function removeExpired() {
    const timestamp = now();
    for (const [id, session] of sessions) {
      if (session.expiresAtMs <= timestamp) sessions.delete(id);
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
    create(input) {
      removeExpired();
      if (sessions.size >= maxSessions) {
        throw sessionError("too many active network scan sessions", 503);
      }
      const scope = validateProbeRequest({
        mode: "discovery",
        hosts: input?.hosts,
        ports: input?.ports,
        concurrency: Math.min(4, Number(input?.concurrency) || 4),
        timeoutMs: Math.min(5_000, Number(input?.timeoutMs) || 1_500),
      });
      const id = randomUUID();
      const uploadToken = randomBytes(32).toString("base64url");
      const readToken = randomBytes(32).toString("base64url");
      const createdAtMs = now();
      const expiresAtMs = createdAtMs + ttlMs;
      const session = {
        id,
        status: "waiting_for_connector",
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        createdAtMs,
        expiresAtMs,
        completedAt: null,
        scope: {
          hosts: scope.hosts,
          ports: scope.ports,
          concurrency: scope.concurrency,
          timeoutMs: scope.timeoutMs,
        },
        uploadTokenDigest: digestToken(uploadToken),
        readTokenDigest: digestToken(readToken),
        result: null,
      };
      sessions.set(id, session);
      return { ...publicView(session), uploadToken, readToken };
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
      if (session.status !== "waiting_for_connector" || !session.uploadTokenDigest) {
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
