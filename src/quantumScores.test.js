import assert from "node:assert/strict";
import { test } from "node:test";

import { ASSETS, COMPLIANCE } from "../test-fixtures/mockData.js";
import { deriveQuantumScores, readinessClassification } from "./quantumScores.js";

test("readiness classification is higher-is-better", () => {
  assert.equal(readinessClassification(85), "Quantum-ready");
  assert.equal(readinessClassification(15), "Unprepared");
});

test("derives one headline readiness score from the evidence", () => {
  const scores = deriveQuantumScores({ assets: ASSETS, compliance: COMPLIANCE });
  assert.equal(scores.readiness.direction, "Higher is better");
  assert.ok(scores.readiness.score >= 25 && scores.readiness.score < 70);
  assert.equal("risk" in scores, false);
  assert.equal(scores.confidence.level, "Medium");
});

test("incomplete evidence lowers confidence", () => {
  const scores = deriveQuantumScores({ assets: [{ hostname: "edge" }], compliance: [] });
  assert.equal(scores.confidence.level, "Low");
  assert.ok(scores.confidence.coverage < 50);
});

test("an empty evidence set is unassessed rather than a zero readiness score", () => {
  const scores = deriveQuantumScores({ assets: [], compliance: [] });
  assert.equal(scores.readiness.assessed, false);
  assert.equal(scores.readiness.classification, "Not yet assessed");
  assert.equal(scores.confidence.level, "Low");
});
