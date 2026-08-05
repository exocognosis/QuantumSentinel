import test from "node:test";
import assert from "node:assert/strict";
import { findingRecurrenceSummary } from "./findingDisplay.js";

test("findingRecurrenceSummary reads recurrence metadata and TLS evidence aliases", () => {
  const summary = findingRecurrenceSummary({
    evidence: {
      recurrence: {
        count: 4,
        firstObservedAt: "2026-06-01T12:00:00Z",
        lastObservedAt: "2026-06-08T12:00:00Z",
        fingerprints: ["AA:BB:CC:DD:EE:FF:00:11:22:33"],
      },
      target: {
        host: "edge.example.com",
      },
    },
  });

  assert.deepEqual(summary, {
    count: 4,
    firstObservedAt: "2026-06-01T12:00:00Z",
    lastObservedAt: "2026-06-08T12:00:00Z",
    host: "edge.example.com",
    fingerprint: "AA:BB:CC:DD:...:22:33",
    hasDetails: true,
  });
});

test("findingRecurrenceSummary stays empty when recurrence evidence is absent", () => {
  assert.deepEqual(findingRecurrenceSummary({ title: "TLS finding" }), {
    count: null,
    firstObservedAt: "",
    lastObservedAt: "",
    host: "",
    fingerprint: "",
    hasDetails: false,
  });
});
