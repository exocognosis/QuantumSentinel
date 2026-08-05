import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatastore } from "./datastore.js";
import { scanRepository } from "./repositoryScanner.js";
import { persistRepositoryScan } from "./repositoryScanPersistence.js";
import { buildReport } from "./reporting.js";

test("repository scans persist assets, findings, CBOM snapshots, and audit evidence without duplicate findings", async () => {
  const root = await mkdtemp(join(tmpdir(), "quantumsentinel-persist-scan-"));
  const repository = join(root, "repository");
  const storePath = join(root, "store.json");
  await mkdir(repository);
  await writeFile(join(repository, "service.js"), 'const signingAlgorithm = "ECDSA P-256";\nconst digest = "SHA-256";');
  const datastore = await createDatastore({ backend: "json", filePath: storePath, seedAssets: [] });
  try {
    const report = await scanRepository(repository);
    const first = await persistRepositoryScan(datastore, report);
    assert.equal(first.persistence.createdAssets, 1);
    assert.equal(first.persistence.createdFindings, 1);
    assert.equal((await datastore.listCbomSnapshots()).length, 1);
    assert.ok((await datastore.listAuditEvents({ action: "repository_scan.completed" })).length === 1);
    const fullReport = await buildReport("full", { datastore });
    assert.equal(fullReport.scope.findingCount, 1);
    assert.equal(fullReport.scope.cbomSnapshotCount, 1);
    assert.ok(fullReport.scope.assetCount >= 1);

    const secondReport = await scanRepository(repository);
    const second = await persistRepositoryScan(datastore, secondReport);
    assert.equal(second.persistence.updatedAssets, 1);
    assert.equal(second.persistence.createdFindings, 0);
    assert.equal(second.persistence.refreshedFindings, 1);
    const findings = await datastore.listFindings({ source: "repository-scan" });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].evidence.occurrenceCount, 2);
  } finally {
    await datastore.close();
    await rm(root, { recursive: true, force: true });
  }
});
