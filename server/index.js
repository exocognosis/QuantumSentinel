import { backfillProbeAssets, createApiServer } from "./app.js";
import { createDatastore } from "./datastore.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_PORT = 8787;
const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
const host = process.env.HOST ?? "127.0.0.1";

function envFlag(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] ?? "").toLowerCase());
}

function envInteger(name) {
  const value = process.env[name];
  if (value == null || value.trim() === "") return undefined;
  return Number.parseInt(value, 10);
}

const datastoreBackend = process.env.QS_DATASTORE_BACKEND ?? "auto";
const persistentDefaultPath = "./.quantumsentinel/evidence.db";
const explicitDatastorePath = process.env.QS_DATASTORE_PATH;
const persistEvidence = envFlag("QS_PERSIST_EVIDENCE");
const temporaryDatastoreDir = !explicitDatastorePath && !persistEvidence
  ? await mkdtemp(join(tmpdir(), "quantumsentinel-api-"))
  : null;
const datastorePath = explicitDatastorePath
  ?? (persistEvidence ? persistentDefaultPath : join(temporaryDatastoreDir, "evidence.db"));

const datastore = await createDatastore({
  backend: datastoreBackend,
  filePath: datastorePath,
  seedAssets: [],
});
await backfillProbeAssets(datastore);
const server = createApiServer({
  datastore,
  schedulerOptions: {
    enabled: envFlag("QS_SCHEDULER_ENABLED"),
    tickIntervalSeconds: envInteger("QS_SCHEDULER_TICK_INTERVAL_SECONDS"),
    maxRunsPerTick: envInteger("QS_SCHEDULER_MAX_RUNS_PER_TICK"),
    scanWindowSeconds: envInteger("QS_SCHEDULER_SCAN_WINDOW_SECONDS"),
  },
});

server.listen(port, host, () => {
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  if (server.scheduler.getStatus().enabled) {
    server.scheduler.start();
  }
  console.log(`QuantumSentinel API listening on http://${host}:${resolvedPort}`);
  console.log(`QuantumSentinel datastore: ${datastorePath} (${datastore.backendName})`);
  console.log(`QuantumSentinel evidence persistence: ${explicitDatastorePath || persistEvidence ? "persistent" : "session-only"}`);
  console.log(`QuantumSentinel scheduler: ${JSON.stringify(server.scheduler.getStatus())}`);
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.scheduler.stop();
  server.close(async () => {
    await datastore.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
