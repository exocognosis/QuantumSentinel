#!/usr/bin/env node

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const host = process.env.HOST || "127.0.0.1";
const apiPort = Number(process.env.PORT || 8787);
const webPort = Number(process.env.WEB_PORT || 5173);
const dashboardUrl = `http://${host}:${webPort}`;
const children = new Set();

function run(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`Quantum Sentinel service stopped (${signal || code}).`);
      shutdown(code || 1);
    }
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 150).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run(process.execPath, ["server/index.js"], { HOST: host, PORT: String(apiPort) });

let healthy = false;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const response = await fetch(`http://${host}:${apiPort}/api/health`);
    if (response.ok) {
      healthy = true;
      break;
    }
  } catch {
    // The API is still starting.
  }
  await delay(200);
}

if (!healthy) {
  console.error("Quantum Sentinel API did not become ready.");
  shutdown(1);
} else {
  run(process.execPath, ["server/web.js"], {
    HOST: host,
    PORT: String(webPort),
    QS_API_TARGET: `http://${host}:${apiPort}`,
  });
  console.log(`\nQuantum Sentinel is ready: ${dashboardUrl}`);
  console.log("Press Ctrl+C to stop.\n");

  if (process.env.QS_NO_OPEN !== "1") {
    const opener = process.platform === "darwin" ? ["open", [dashboardUrl]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", dashboardUrl]] : ["xdg-open", [dashboardUrl]];
    const opened = spawn(opener[0], opener[1], { stdio: "ignore", detached: true });
    opened.on("error", () => {});
    opened.unref();
  }
}
