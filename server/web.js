import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5173;
const DEFAULT_API_TARGET = "http://127.0.0.1:8787";

const host = process.env.HOST ?? DEFAULT_HOST;
const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
const apiTarget = new URL(process.env.QS_API_TARGET ?? DEFAULT_API_TARGET);
const distRoot = resolve(process.env.QS_DIST_ROOT ?? "dist");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, headers);
  response.end(body);
}

function proxyApi(request, response) {
  const target = new URL(request.url, apiTarget);
  target.protocol = apiTarget.protocol;
  target.host = apiTarget.host;

  const proxy = http.request(target, {
    method: request.method,
    headers: request.headers,
  }, (proxied) => {
    response.writeHead(proxied.statusCode ?? 502, proxied.headers);
    proxied.pipe(response);
  });

  proxy.on("error", (error) => {
    send(response, 502, JSON.stringify({ error: error.message }), {
      "content-type": "application/json; charset=utf-8",
    });
  });

  request.pipe(proxy);
}

async function serveStatic(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  const requestedPath = decodeURIComponent(url.pathname);
  const normalized = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  let filePath = join(distRoot, normalized);

  if (!filePath.startsWith(distRoot)) {
    send(response, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    filePath = join(distRoot, "index.html");
  }

  try {
    await stat(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const body = await readFile(join(distRoot, "index.html"), "utf8");
    send(response, 200, body, { "content-type": MIME_TYPES[".html"] });
  }
}

const server = http.createServer((request, response) => {
  if (request.url?.startsWith("/api/")) {
    proxyApi(request, response);
    return;
  }

  serveStatic(request, response).catch((error) => {
    send(response, 500, error.message, { "content-type": "text/plain; charset=utf-8" });
  });
});

server.listen(port, host, () => {
  console.log(`QuantumSentinel web listening on http://${host}:${port}`);
  console.log(`QuantumSentinel web proxy target: ${apiTarget.origin}`);
});
