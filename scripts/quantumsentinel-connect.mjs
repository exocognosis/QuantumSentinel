#!/usr/bin/env node
import process from "node:process";

import { parseNetworkConnectorArguments, runNetworkConnector } from "../server/networkConnector.js";

function usage() {
  return `QuantumSentinel Network Connector

Usage:
  quantumsentinel-connect --hosts host1,host2 --ports 443,8443 --upload-url URL --token TOKEN

The connector tests only the listed hosts and ports. It uploads the bounded scan result and then exits.
`;
}

try {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  const options = parseNetworkConnectorArguments(process.argv.slice(2));
  const job = await runNetworkConnector(options);
  const summary = job.result.summary;
  process.stdout.write(`Network scan complete. ${summary.completedCount} of ${summary.targetsScanned} host-port targets returned evidence.\n`);
  process.stdout.write("The result was sent to the active Dytallix browser session.\n");
} catch (error) {
  process.stderr.write(`QuantumSentinel connector: ${error.message}\n\n${usage()}`);
  process.exitCode = 1;
}
