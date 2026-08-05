import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const syntaxTargets = [
  "eslint.config.js",
  "vite.config.ts",
  "server/app.js",
  "server/probeEngine.js",
  "server/riskEngine.js",
  "src/api.js",
  "src/App.jsx",
  "src/findingDisplay.js",
  "src/main.tsx",
];

const scriptKindByExtension = new Map([
  [".js", ts.ScriptKind.JS],
  [".jsx", ts.ScriptKind.JSX],
  [".ts", ts.ScriptKind.TS],
  [".tsx", ts.ScriptKind.TSX],
]);

function readTarget(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function parseSyntaxTarget(relativePath) {
  const source = readTarget(relativePath);
  const extension = path.extname(relativePath);
  const scriptKind = scriptKindByExtension.get(extension);

  if (!scriptKind) {
    throw new Error(`No script kind configured for ${relativePath}`);
  }

  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  if (sourceFile.parseDiagnostics.length === 0) return;

  const diagnostics = sourceFile.parseDiagnostics.map((diagnostic) => {
    const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    return `${relativePath}:${position.line + 1}:${position.character + 1} ${message}`;
  });

  throw new Error(diagnostics.join("\n"));
}

function loadFindingRecurrenceSummary() {
  const relativePath = "src/findingDisplay.js";
  const source = readTarget(relativePath);
  const transformed = source.replace(
    "export function findingRecurrenceSummary",
    "function findingRecurrenceSummary",
  );

  if (transformed === source) {
    throw new Error("Could not locate findingRecurrenceSummary export");
  }

  const sandbox = { globalThis: {} };
  vm.runInNewContext(
    `${transformed}\nglobalThis.findingRecurrenceSummary = findingRecurrenceSummary;`,
    sandbox,
    { filename: relativePath, timeout: 1_000 },
  );

  return sandbox.globalThis.findingRecurrenceSummary;
}

function checkFindingRecurrenceSummary() {
  const findingRecurrenceSummary = loadFindingRecurrenceSummary();
  const toPlainObject = (value) => JSON.parse(JSON.stringify(value));

  assert.equal(typeof findingRecurrenceSummary, "function");
  assert.deepEqual(
    toPlainObject(findingRecurrenceSummary({
      evidence: {
        recurrence: {
          count: 2,
          firstObservedAt: "2026-06-01T12:00:00Z",
          lastObservedAt: "2026-06-08T12:00:00Z",
          fingerprints: ["AA:BB:CC:DD:EE:FF:00:11:22:33"],
        },
        target: { host: "edge.example.com" },
      },
    })),
    {
      count: 2,
      firstObservedAt: "2026-06-01T12:00:00Z",
      lastObservedAt: "2026-06-08T12:00:00Z",
      host: "edge.example.com",
      fingerprint: "AA:BB:CC:DD:...:22:33",
      hasDetails: true,
    },
  );

  assert.deepEqual(toPlainObject(findingRecurrenceSummary({ title: "TLS finding" })), {
    count: null,
    firstObservedAt: "",
    lastObservedAt: "",
    host: "",
    fingerprint: "",
    hasDetails: false,
  });
}

for (const target of syntaxTargets) {
  parseSyntaxTarget(target);
}

checkFindingRecurrenceSummary();

console.log(`smoke ok: parsed ${syntaxTargets.length} targeted files and checked findingRecurrenceSummary`);
