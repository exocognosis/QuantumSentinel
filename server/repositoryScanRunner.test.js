import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRepositorySource, runRepositoryScan } from "./repositoryScanRunner.js";

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

test("repository scan runner rejects missing sources with bad request errors", async () => {
  assert.throws(() => normalizeRepositorySource(""), /Repository path or GitHub URL is required/);
  await assert.rejects(
    () => runRepositoryScan("/definitely/missing/quantumsentinel/repository"),
    (error) => error.statusCode === 400 && /not found/.test(error.message),
  );
});
