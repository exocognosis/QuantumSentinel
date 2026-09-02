#!/usr/bin/env node
import process from "node:process";

import { parseNetworkConnectorArguments, promptForDeviceCode, runNetworkConnector } from "../server/networkConnector.js";

function usage() {
  return `QuantumSentinel Network Connector

Usage:
  quantumsentinel-connect
  quantumsentinel-connect --code DEVICE-CODE

The connector prompts for the device code when --code is omitted. It shows the approved targets and requires local confirmation before it scans.
`;
}

try {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  const options = parseNetworkConnectorArguments(process.argv.slice(2));
  if (!options.deviceCode) options.deviceCode = await promptForDeviceCode();
  const job = await runNetworkConnector(options);
  const summary = job.result.summary;
  process.stdout.write(`Network scan complete. ${summary.completedCount} of ${summary.targetsScanned} host-port targets returned evidence.\n`);
  process.stdout.write("The result was sent to the active Dytallix browser session.\n");
} catch (error) {
  process.stderr.write(`QuantumSentinel connector: ${error.message}\n\n${usage()}`);
  process.exitCode = 1;
}
