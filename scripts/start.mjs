#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const host = process.env.HOST || "127.0.0.1";
const requestedApiPort = Number(process.env.PORT || 8787);
const requestedWebPort = Number(process.env.WEB_PORT || 5173);
const explicitlySetApiPort = Boolean(process.env.PORT);
const explicitlySetWebPort = Boolean(process.env.WEB_PORT);

async function portIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const tester = createServer();
    tester.unref();
    tester.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    tester.listen({ host, port, exclusive: true }, () => {
      tester.close(() => resolve(true));
    });
  });
}

async function choosePort(preferred, excluded = new Set()) {
  for (let candidate = preferred; candidate < preferred + 100; candidate += 1) {
    if (!excluded.has(candidate) && await portIsAvailable(candidate)) return candidate;
  }
  throw new Error(`No available port found between ${preferred} and ${preferred + 99}.`);
}

const apiPort = await choosePort(requestedApiPort);
const webPort = await choosePort(requestedWebPort, new Set([apiPort]));
const dashboardUrl = `http://${host}:${webPort}`;
const children = new Set();

if (!explicitlySetApiPort && apiPort !== requestedApiPort) {
  console.log(`API port ${requestedApiPort} is busy; using ${apiPort}.`);
}
if (!explicitlySetWebPort && webPort !== requestedWebPort) {
  console.log(`Dashboard port ${requestedWebPort} is busy; using ${webPort}.`);
}

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

  let dashboardReady = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const [pageResponse, proxyResponse] = await Promise.all([
        fetch(dashboardUrl),
        fetch(`${dashboardUrl}/api/health`),
      ]);
      if (pageResponse.ok && proxyResponse.ok) {
        dashboardReady = true;
        break;
      }
    } catch {
      // The dashboard or its API proxy is still starting.
    }
    await delay(200);
  }

  if (!dashboardReady) {
    console.error("Quantum Sentinel dashboard did not become ready.");
    shutdown(1);
  } else {
    console.log(`\nQuantum Sentinel is ready: ${dashboardUrl}`);
    console.log("Press Ctrl+C to stop.\n");

    if (process.env.QS_NO_OPEN !== "1") {
      const opener = process.platform === "darwin" ? ["open", [dashboardUrl]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", dashboardUrl]] : ["xdg-open", [dashboardUrl]];
      const opened = spawn(opener[0], opener[1], { stdio: "ignore", detached: true });
      opened.on("error", () => {});
      opened.unref();
    }
  }
}
