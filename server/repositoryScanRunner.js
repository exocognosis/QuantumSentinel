import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import { scanRepository } from "./repositoryScanner.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CLONE_TIMEOUT_MS = 60_000;

function cleanRepositoryName(value) {
  return String(value || "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

function githubHttpsSource(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (!["https:", "http:"].includes(url.protocol)) return null;
  if (url.hostname.toLowerCase() !== "github.com") return null;
  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  const repoName = cleanRepositoryName(repo);
  return {
    kind: "github",
    input: value,
    cloneUrl: `https://github.com/${owner}/${repoName}.git`,
    label: `${owner}/${repoName}`,
  };
}

function githubSshSource(value) {
  const match = String(value).trim().match(/^(?:ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!match) return null;
  const [, owner, repo] = match;
  const repoName = cleanRepositoryName(repo);
  const cloneUrl = String(value).trim().startsWith("ssh://")
    ? `ssh://git@github.com/${owner}/${repoName}.git`
    : `git@github.com:${owner}/${repoName}.git`;
  return {
    kind: "github",
    input: value,
    cloneUrl,
    label: `${owner}/${repoName}`,
  };
}

export function normalizeRepositorySource(input) {
  const value = String(input || "").trim();
  if (!value) {
    const error = new Error("Repository path or GitHub URL is required");
    error.statusCode = 400;
    throw error;
  }

  const github = githubHttpsSource(value) || githubSshSource(value);
  if (github) return github;

  const path = resolve(value.replace(/^file:\/\//, ""));
  return {
    kind: "local",
    input: value,
    path,
    label: basename(path) || path,
  };
}

async function cloneGitHubRepository(source, options = {}) {
  const checkoutRoot = await mkdtemp(join(tmpdir(), "quantumsentinel-github-"));
  const checkoutPath = join(checkoutRoot, "repository");
  try {
    await execFileAsync("git", ["clone", "--depth", "1", source.cloneUrl, checkoutPath], {
      timeout: options.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -oBatchMode=yes",
      },
      maxBuffer: 1024 * 1024,
    });
    return { checkoutRoot, checkoutPath };
  } catch (error) {
    await rm(checkoutRoot, { recursive: true, force: true });
    const cloneError = new Error(`GitHub repository could not be cloned: ${error.stderr || error.message}`);
    cloneError.statusCode = 502;
    throw cloneError;
  }
}

export async function runRepositoryScan(input, options = {}) {
  const source = normalizeRepositorySource(input);
  let checkoutRoot = null;
  let scanPath = source.path;

  try {
    if (source.kind === "github") {
      const checkout = await cloneGitHubRepository(source, options);
      checkoutRoot = checkout.checkoutRoot;
      scanPath = checkout.checkoutPath;
    } else {
      let metadata;
      try {
        metadata = await stat(scanPath);
      } catch {
        const error = new Error("Repository scan target was not found");
        error.statusCode = 400;
        throw error;
      }
      if (!metadata.isDirectory()) {
        const error = new Error("Repository scan target must be a directory");
        error.statusCode = 400;
        throw error;
      }
    }

    const report = await scanRepository(scanPath, {
      maxFiles: options.maxFiles,
      maxFileBytes: options.maxFileBytes,
    });

    return {
      ...report,
      scan: {
        ...report.scan,
        sourceType: source.kind,
        sourceInput: source.input,
        target: source.kind === "github" ? source.cloneUrl : report.scan.target,
        targetName: source.label,
      },
    };
  } finally {
    if (checkoutRoot) await rm(checkoutRoot, { recursive: true, force: true });
  }
}
