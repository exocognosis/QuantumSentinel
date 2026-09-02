import { createProbeJob } from "./probeEngine.js";
import { createInterface } from "node:readline/promises";
import process from "node:process";

const PRODUCTION_ORIGIN = "https://dytallix.com";
const RESULT_PATH = /^\/api\/quantumsentinel\/public\/network-scans\/[0-9a-f-]+\/results$/;

export function parseNetworkConnectorArguments(argv) {
  const options = { deviceCode: null };
  const args = [...argv];
  while (args.length) {
    const option = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`${option} requires a value`);
    if (option === "--code") options.deviceCode = value.trim().toUpperCase();
    else throw new Error(`unknown option: ${option}`);
  }
  if (options.deviceCode != null) options.deviceCode = validateDeviceCode(options.deviceCode);
  return options;
}

export function validateDeviceCode(input) {
  const deviceCode = String(input ?? "").trim().toUpperCase();
  if (!/^[A-F0-9]{6}(?:-[A-F0-9]{6}){3}$/.test(deviceCode)) throw new Error("device code is invalid");
  return deviceCode;
}

export async function promptForDeviceCode({ input = process.stdin, output = process.stdout } = {}) {
  const prompt = createInterface({ input, output });
  try {
    return validateDeviceCode(await prompt.question("Device code: "));
  } finally {
    prompt.close();
  }
}

export async function confirmNetworkScope(scope, { input = process.stdin, output = process.stdout } = {}) {
  output.write("\nQuantumSentinel will scan these targets from this computer:\n");
  output.write(`Hosts: ${scope.hosts.join(", ")}\n`);
  output.write(`Ports: ${scope.ports.join(", ")}\n\n`);
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question("Type SCAN to approve this scope: ");
    return answer.trim() === "SCAN";
  } finally {
    prompt.close();
  }
}

export function validateConnectorUploadUrl(input, allowedOrigin = PRODUCTION_ORIGIN) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("--upload-url is invalid");
  }
  if (url.origin !== allowedOrigin || url.username || url.password || url.search || url.hash || !RESULT_PATH.test(url.pathname)) {
    throw new Error("--upload-url must be a Dytallix network scan result URL");
  }
  return url.toString();
}

export async function runNetworkConnector(options, {
  createJob = createProbeJob,
  fetchImpl = fetch,
  allowedOrigin = PRODUCTION_ORIGIN,
  confirmScope = confirmNetworkScope,
} = {}) {
  const connectResponse = await fetchImpl(`${allowedOrigin}/api/quantumsentinel/public/network-scans/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceCode: options.deviceCode }),
  });
  if (!connectResponse.ok) {
    let message = `connector claim failed with status ${connectResponse.status}`;
    try {
      const payload = await connectResponse.json();
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the status-based message when the server does not return JSON.
    }
    throw new Error(message);
  }
  const connection = (await connectResponse.json()).data;
  if (!connection?.id || !connection?.uploadToken || !connection?.scope) {
    throw new Error("connector claim returned an incomplete scan session");
  }
  if (await confirmScope(connection.scope) !== true) {
    throw new Error("network scan was not approved on this computer");
  }
  const uploadUrl = validateConnectorUploadUrl(
    `${allowedOrigin}/api/quantumsentinel/public/network-scans/${connection.id}/results`,
    allowedOrigin,
  );
  const job = await createJob({
    mode: "discovery",
    hosts: connection.scope.hosts,
    ports: connection.scope.ports,
    timeoutMs: connection.scope.timeoutMs,
    concurrency: connection.scope.concurrency,
  });
  if (job.status !== "completed" || !job.result) {
    throw new Error(job.error || "network scan did not complete");
  }
  const response = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${connection.uploadToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ job }),
  });
  if (!response.ok) {
    let message = `result upload failed with status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
    } catch {
      // Keep the status-based message when the server does not return JSON.
    }
    throw new Error(message);
  }
  return job;
}
