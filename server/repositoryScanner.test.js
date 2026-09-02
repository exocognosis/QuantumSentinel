import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanRepository, scanUploadedFile } from "./repositoryScanner.js";

test("repository scanner returns evidence-backed, distinct classifications", async () => {
  const root = await mkdtemp(join(tmpdir(), "quantumsentinel-scan-"));
  try {
    await writeFile(join(root, "crypto.js"), ['const signing = "ECDSA P-256";', 'const digest = "SHA-256";', 'const future = "ML-DSA-65";', 'const bad = "MD5";'].join("\n"));
    const result = await scanRepository(root);
    assert.equal(result.scan.filesScanned, 1);
    assert.equal(result.summary.byClassification["shor-vulnerable-public-key"], 1);
    assert.equal(result.summary.byClassification["quantum-resistant-symmetric-hash"], 1);
    assert.equal(result.summary.byClassification.pqc, 1);
    assert.equal(result.summary.byClassification.deprecated, 1);
    assert.ok(result.score.readinessScore < 100);
    assert.equal(result.findings[0].evidence.file, "crypto.js");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repository scanner excludes generated and dependency directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "quantumsentinel-scan-"));
  try {
    const dependency = join(root, "node_modules");
    await mkdir(dependency);
    await writeFile(join(dependency, "ignored.js"), 'const key = "RSA-2048";');
    await writeFile(join(root, "README.md"), "Uses RSA-2048 in a historical example.");
    const result = await scanRepository(root);
    assert.equal(result.scan.filesScanned, 1);
    assert.equal(result.findings[0].confidence, "documentation-reference");
    assert.equal(result.scan.skipped.excludedDirectories, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repository scanner enforces total-byte and finding limits", async () => {
  const root = await mkdtemp(join(tmpdir(), "quantumsentinel-scan-"));
  try {
    await writeFile(join(root, "a.js"), 'const first = "RSA-2048";\nconst second = "ECDSA P-256";');
    await writeFile(join(root, "b.js"), 'const third = "MD5";');

    const bytesLimited = await scanRepository(root, { maxTotalBytes: 50, maxFindings: 10 });
    assert.equal(bytesLimited.scan.limitReached, true);
    assert.ok(bytesLimited.scan.skipped.totalByteBudgetFiles > 0);

    const findingsLimited = await scanRepository(root, { maxTotalBytes: 1_000, maxFindings: 1 });
    assert.equal(findingsLimited.findings.length, 1);
    assert.equal(findingsLimited.scan.findingLimitReached, true);
    assert.equal(findingsLimited.scan.limitReached, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("uploaded file scanner analyzes text without a filesystem checkout", async () => {
  const result = await scanUploadedFile({
    filename: "crypto-config.json",
    content: '{"signing":"RSA-2048","future":"ML-DSA-65","api_key":"secret-value"}',
  });

  assert.equal(result.scan.kind, "uploaded-file");
  assert.equal(result.scan.filesScanned, 1);
  assert.equal(result.scan.targetName, "crypto-config.json");
  assert.equal(result.summary.byClassification["shor-vulnerable-public-key"], 1);
  assert.equal(result.summary.byClassification.pqc, 1);
  assert.match(result.findings[0].evidence.excerpt, /\[redacted\]/);
});

test("uploaded file scanner rejects paths, binary data, unsupported types, and oversized files", async () => {
  await assert.rejects(
    scanUploadedFile({ filename: "../secret.js", content: 'const key = "RSA";' }),
    /one file name without a path/,
  );
  await assert.rejects(
    scanUploadedFile({ filename: "program.exe", content: "RSA" }),
    /file type is not supported/,
  );
  await assert.rejects(
    scanUploadedFile({ filename: "crypto.js", content: "RSA\0binary" }),
    /binary files are not supported/,
  );
  await assert.rejects(
    scanUploadedFile({ filename: "crypto.js", content: "x".repeat(33) }, { maxFileBytes: 32 }),
    /upload limit/,
  );
});
