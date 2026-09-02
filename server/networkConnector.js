import { createProbeJob } from "./probeEngine.js";

const PRODUCTION_ORIGIN = "https://dytallix.com";
const RESULT_PATH = /^\/api\/quantumsentinel\/public\/network-scans\/[0-9a-f-]+\/results$/;

export function parseNetworkConnectorArguments(argv) {
  const options = { hosts: null, ports: null, uploadUrl: null, token: null, timeoutMs: 1_500, concurrency: 4 };
  const args = [...argv];
  while (args.length) {
    const option = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`${option} requires a value`);
    if (option === "--hosts") options.hosts = value.split(",").map((item) => item.trim()).filter(Boolean);
    else if (option === "--ports") options.ports = value.split(",").map((item) => Number(item.trim())).filter(Number.isFinite);
    else if (option === "--upload-url") options.uploadUrl = value;
    else if (option === "--token") options.token = value;
    else if (option === "--timeout-ms") options.timeoutMs = Number(value);
    else if (option === "--concurrency") options.concurrency = Number(value);
    else throw new Error(`unknown option: ${option}`);
  }
  if (!options.hosts?.length) throw new Error("--hosts is required");
  if (!options.ports?.length) throw new Error("--ports is required");
  if (!options.uploadUrl) throw new Error("--upload-url is required");
  if (!/^[A-Za-z0-9_-]{32,}$/.test(options.token ?? "")) throw new Error("--token is invalid");
  return options;
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
} = {}) {
  const uploadUrl = validateConnectorUploadUrl(options.uploadUrl, allowedOrigin);
  const job = await createJob({
    mode: "discovery",
    hosts: options.hosts,
    ports: options.ports,
    timeoutMs: options.timeoutMs,
    concurrency: options.concurrency,
  });
  if (job.status !== "completed" || !job.result) {
    throw new Error(job.error || "network scan did not complete");
  }
  const response = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token}`,
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
