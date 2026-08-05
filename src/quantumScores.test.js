import assert from "node:assert/strict";
import { test } from "node:test";

import { ASSETS, COMPLIANCE } from "./mockData.js";
import { deriveQuantumScores, readinessClassification, riskClassification } from "./quantumScores.js";

test("risk and readiness classifications have independent directions", () => {
  assert.equal(riskClassification(85), "Critical");
  assert.equal(riskClassification(15), "Low");
  assert.equal(readinessClassification(85), "Quantum-ready");
  assert.equal(readinessClassification(15), "Unprepared");
});

test("derives distinct risk and readiness scores from the same evidence", () => {
  const scores = deriveQuantumScores({ assets: ASSETS, compliance: COMPLIANCE, isFallback: false });
  assert.equal(scores.risk.direction, "Higher is worse");
  assert.equal(scores.readiness.direction, "Higher is better");
  assert.ok(scores.risk.score >= 60);
  assert.ok(scores.readiness.score >= 25 && scores.readiness.score < 70);
  assert.notEqual(scores.risk.score, 100 - scores.readiness.score);
  assert.equal(scores.confidence.level, "Medium");
});

test("incomplete or fallback evidence lowers confidence", () => {
  const scores = deriveQuantumScores({ assets: [{ hostname: "edge" }], compliance: [], isFallback: true });
  assert.equal(scores.confidence.level, "Low");
  assert.ok(scores.confidence.coverage < 50);
});
