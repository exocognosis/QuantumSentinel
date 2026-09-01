import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

import { scanRepository } from "./repositoryScanner.js";

const execFileAsync = promisify(execFile);
const DEFAULT_CLONE_TIMEOUT_MS = 60_000;
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

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

export function normalizePublicGitHubRepositorySource(input) {
  const value = String(input || "").trim();
  if (!value) {
    const error = new Error("A public GitHub repository URL is required");
    error.statusCode = 400;
    throw error;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    const error = new Error("Enter a valid GitHub repository URL, such as https://github.com/owner/repository");
    error.statusCode = 400;
    throw error;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const owner = parts[0] ?? "";
  const repository = cleanRepositoryName(parts[1] ?? "");
  const valid = url.protocol === "https:"
    && url.hostname.toLowerCase() === "github.com"
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === ""
    && parts.length === 2
    && GITHUB_OWNER_PATTERN.test(owner)
    && GITHUB_REPOSITORY_PATTERN.test(repository);

  if (!valid) {
    const error = new Error("Enter a public GitHub repository URL in the form https://github.com/owner/repository");
    error.statusCode = 400;
    throw error;
  }

  return {
    kind: "github",
    input: value,
    cloneUrl: `https://github.com/${owner}/${repository}.git`,
    label: `${owner}/${repository}`,
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
    await execFileAsync("git", ["clone", "--depth", "1", "--single-branch", "--no-tags", source.cloneUrl, checkoutPath], {
      timeout: options.cloneTimeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_LFS_SKIP_SMUDGE: "1",
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -oBatchMode=yes",
      },
      maxBuffer: 1024 * 1024,
    });
    return { checkoutRoot, checkoutPath };
  } catch (error) {
    await rm(checkoutRoot, { recursive: true, force: true });
    const cloneError = new Error("GitHub repository could not be cloned. Confirm that it exists and is public.");
    cloneError.statusCode = 502;
    throw cloneError;
  }
}

async function directorySize(path, limitBytes) {
  let total = 0;
  const pending = [path];
  while (pending.length) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      if (entry.isFile()) total += (await stat(entryPath)).size;
      if (limitBytes && total > limitBytes) return total;
    }
  }
  return total;
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
      if (options.maxCheckoutBytes) {
        const checkoutBytes = await directorySize(scanPath, options.maxCheckoutBytes);
        if (checkoutBytes > options.maxCheckoutBytes) {
          const error = new Error("GitHub repository exceeds the public scan size limit");
          error.statusCode = 413;
          throw error;
        }
      }
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
      maxTotalBytes: options.maxTotalBytes,
      maxFindings: options.maxFindings,
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
