import assert from "node:assert/strict";
import test from "node:test";

import { normalizePublicGitHubRepositorySource, normalizeRepositorySource, runRepositoryScan } from "./repositoryScanRunner.js";

test("normalizes GitHub repository URLs for dashboard scans", () => {
  assert.deepEqual(normalizeRepositorySource("https://github.com/exocognosis/QuantumSentinel"), {
    kind: "github",
    input: "https://github.com/exocognosis/QuantumSentinel",
    cloneUrl: "https://github.com/exocognosis/QuantumSentinel.git",
    label: "exocognosis/QuantumSentinel",
  });

  assert.deepEqual(normalizeRepositorySource("git@github.com:exocognosis/QuantumSentinel.git"), {
    kind: "github",
    input: "git@github.com:exocognosis/QuantumSentinel.git",
    cloneUrl: "git@github.com:exocognosis/QuantumSentinel.git",
    label: "exocognosis/QuantumSentinel",
  });
});

test("accepts only exact public HTTPS GitHub repository URLs", () => {
  assert.deepEqual(normalizePublicGitHubRepositorySource("https://github.com/exocognosis/QuantumSentinel"), {
    kind: "github",
    input: "https://github.com/exocognosis/QuantumSentinel",
    cloneUrl: "https://github.com/exocognosis/QuantumSentinel.git",
    label: "exocognosis/QuantumSentinel",
  });
  assert.throws(() => normalizePublicGitHubRepositorySource("git@github.com:owner/repo.git"), /valid GitHub repository URL/);
  assert.throws(() => normalizePublicGitHubRepositorySource("https://github.com/owner/repo/issues"), /form https:\/\/github.com/);
  assert.throws(() => normalizePublicGitHubRepositorySource("https://example.com/owner/repo"), /form https:\/\/github.com/);
  assert.throws(() => normalizePublicGitHubRepositorySource("https://user:secret@github.com/owner/repo"), /form https:\/\/github.com/);
});

test("repository scan runner rejects missing sources with bad request errors", async () => {
  assert.throws(() => normalizeRepositorySource(""), /Repository path or GitHub URL is required/);
  await assert.rejects(
    () => runRepositoryScan("/definitely/missing/quantumsentinel/repository"),
    (error) => error.statusCode === 400 && /not found/.test(error.message),
  );
});
