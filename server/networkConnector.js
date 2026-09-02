import { networkInterfaces } from "node:os";
import { createInterface } from "node:readline/promises";
import process from "node:process";

import { createProbeJob, scanLocalNetworkTargets } from "./probeEngine.js";
import {
  isRfc1918Ipv4,
  LOCAL_NETWORK_CONCURRENCY,
  LOCAL_NETWORK_DISCOVERY_MODE,
  LOCAL_NETWORK_MAX_HOSTS,
  LOCAL_NETWORK_MAX_OBSERVATIONS,
  LOCAL_NETWORK_PORTS,
  LOCAL_NETWORK_SERVICE_GROUPS,
  LOCAL_NETWORK_TIMEOUT_MS,
  privateSlash24FromAddress,
} from "./networkScanPolicy.js";

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

function isVirtualInterfaceName(name) {
  return /^(?:lo\d*|docker|br-|veth|virbr|vmnet|utun|tun|tap|tailscale|wg|zt|ham|ppp|awdl|llw|anpi|gif|stf|ipsec)/i.test(name)
    || /(?:virtual|tunnel|vpn)/i.test(name);
}

function interfacePreference(name) {
  if (/^(?:en0|eth0|wlan0)$/i.test(name)) return 0;
  if (/^(?:en\d+|eth\d+|enp\w+|ens\w+|wlan\w+|wi-?fi|ethernet)/i.test(name)) return 1;
  return 2;
}

export function discoverPrimaryPrivateNetwork(interfaces = networkInterfaces()) {
  const candidates = [];
  let order = 0;
  for (const [name, addresses] of Object.entries(interfaces ?? {})) {
    if (isVirtualInterfaceName(name)) continue;
    for (const address of addresses ?? []) {
      const family = address?.family;
      if (address?.internal || (family !== "IPv4" && family !== 4) || !isRfc1918Ipv4(address?.address)) continue;
      candidates.push({ name, address: address.address, preference: interfacePreference(name), order: order++ });
    }
  }
  candidates.sort((left, right) => left.preference - right.preference || left.order - right.order);
  const selected = candidates[0];
  if (!selected) {
    throw new Error("No private IPv4 network was found. Connect this computer to the network and try again.");
  }
  return {
    interfaceName: selected.name,
    ...privateSlash24FromAddress(selected.address),
  };
}

export async function confirmLocalNetworkDiscovery(discovery, { input = process.stdin, output = process.stdout } = {}) {
  output.write("\nQuantumSentinel found this private network:\n");
  output.write(`Network: ${discovery.cidr}\n`);
  output.write(`Possible device addresses: ${LOCAL_NETWORK_MAX_HOSTS}\n`);
  output.write("Checks:\n");
  for (const group of LOCAL_NETWORK_SERVICE_GROUPS) output.write(`- ${group.label}\n`);
  output.write("\n");
  const prompt = createInterface({ input, output });
  try {
    const answer = await prompt.question("Type SCAN to approve this network scan: ");
    return answer.trim() === "SCAN";
  } finally {
    prompt.close();
  }
}

function compactReachableObservation(observation) {
  return {
    observedAt: observation.observedAt ?? null,
    source: observation.source ?? null,
    host: observation.host,
    port: Number(observation.port),
    status: "completed",
    reachability: { tcp: true, tls: observation.reachability?.tls === true },
    protocol: observation.protocol == null ? null : {
      name: observation.protocol.name ?? null,
      cipher: observation.protocol.cipher ?? null,
      perfectForwardSecrecy: observation.protocol.perfectForwardSecrecy === true,
      keyExchange: observation.protocol.keyExchange ?? null,
    },
    certificate: observation.certificate == null ? null : {
      algorithm: observation.certificate.algorithm ?? null,
      expiresAt: observation.certificate.expiresAt ?? null,
      fingerprint256: observation.certificate.fingerprint256 ?? null,
    },
    classification: observation.classification ?? null,
    findings: Array.isArray(observation.findings) ? observation.findings.slice(0, 8) : [],
  };
}

export function buildLocalNetworkJob(discovery, scanResult) {
  const reachable = (scanResult?.observations ?? [])
    .filter((observation) => observation?.status === "completed" && observation?.reachability?.tcp === true);
  const observations = reachable
    .slice(0, LOCAL_NETWORK_MAX_OBSERVATIONS)
    .map(compactReachableObservation);
  const targetsScanned = discovery.hosts.length * LOCAL_NETWORK_PORTS.length;
  const reachableCount = reachable.length;
  return {
    id: `probe-local-network-${Date.now()}`,
    mode: "discovery",
    status: "completed",
    createdAt: scanResult?.observedAt ?? new Date().toISOString(),
    updatedAt: scanResult?.observedAt ?? new Date().toISOString(),
    completedAt: scanResult?.observedAt ?? new Date().toISOString(),
    result: {
      observedAt: scanResult?.observedAt ?? new Date().toISOString(),
      source: LOCAL_NETWORK_DISCOVERY_MODE,
      discovery: { cidr: discovery.cidr },
      scanProfile: {
        serviceGroups: LOCAL_NETWORK_SERVICE_GROUPS.map((group) => ({
          id: group.id,
          label: group.label,
          ports: [...group.ports],
        })),
      },
      summary: {
        targetsScanned,
        hostsScanned: discovery.hosts.length,
        portsScanned: LOCAL_NETWORK_PORTS.length,
        completedCount: reachableCount,
        failedCount: targetsScanned - reachableCount,
        reachableCount,
        observationsIncluded: observations.length,
        observationsOmitted: reachableCount - observations.length,
      },
      observations,
    },
  };
}

function validateAutomaticScope(scope) {
  if (scope?.discoveryMode !== LOCAL_NETWORK_DISCOVERY_MODE
      || scope.maxHosts !== LOCAL_NETWORK_MAX_HOSTS
      || scope.maxObservations !== LOCAL_NETWORK_MAX_OBSERVATIONS
      || scope.timeoutMs !== LOCAL_NETWORK_TIMEOUT_MS
      || scope.concurrency !== LOCAL_NETWORK_CONCURRENCY
      || !Array.isArray(scope.ports)
      || scope.ports.length !== LOCAL_NETWORK_PORTS.length
      || scope.ports.some((port, index) => port !== LOCAL_NETWORK_PORTS[index])) {
    throw new Error("connector claim returned invalid automatic scan limits");
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
  scanNetwork = scanLocalNetworkTargets,
  fetchImpl = fetch,
  allowedOrigin = PRODUCTION_ORIGIN,
  confirmScope = confirmNetworkScope,
  confirmLocalNetwork = confirmLocalNetworkDiscovery,
  networkInterfacesFn = networkInterfaces,
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
  const uploadUrl = validateConnectorUploadUrl(
    `${allowedOrigin}/api/quantumsentinel/public/network-scans/${connection.id}/results`,
    allowedOrigin,
  );
  let job;
  if (connection.scope.discoveryMode === LOCAL_NETWORK_DISCOVERY_MODE) {
    validateAutomaticScope(connection.scope);
    const discovery = discoverPrimaryPrivateNetwork(networkInterfacesFn());
    if (await confirmLocalNetwork(discovery) !== true) {
      throw new Error("network scan was not approved on this computer");
    }
    const result = await scanNetwork({
      hosts: discovery.hosts,
      ports: [...LOCAL_NETWORK_PORTS],
      timeoutMs: LOCAL_NETWORK_TIMEOUT_MS,
      concurrency: LOCAL_NETWORK_CONCURRENCY,
    });
    job = buildLocalNetworkJob(discovery, result);
  } else {
    if (await confirmScope(connection.scope) !== true) {
      throw new Error("network scan was not approved on this computer");
    }
    job = await createJob({
      mode: "discovery",
      hosts: connection.scope.hosts,
      ports: connection.scope.ports,
      timeoutMs: connection.scope.timeoutMs,
      concurrency: connection.scope.concurrency,
    });
  }
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
