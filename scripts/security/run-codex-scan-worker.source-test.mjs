import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./run-codex-scan-worker.ts", import.meta.url), "utf8");
const functionStart = source.indexOf("async function runBundledSkillSpector(");
const functionEnd = source.indexOf("\nconst REQUIRED_CLAWHUB_RESULT_KEYS", functionStart);
const functionSource = source.slice(functionStart, functionEnd);

test("bundled SkillSpector roots share one deadline", () => {
  const deadlineIndex = functionSource.indexOf(
    "const deadlineMs = Date.now() + clawScanTimeoutMs();",
  );
  const loopIndex = functionSource.indexOf("for (const [index, scanInput]");
  assert.ok(deadlineIndex >= 0, "expected a shared deadline");
  assert.ok(loopIndex > deadlineIndex, "deadline must be captured before the per-root loop");
  assert.match(functionSource, /const remainingMs = deadlineMs - Date\.now\(\);/);
});

test("expired budgets fail before starting another root", () => {
  const expiryIndex = functionSource.indexOf("if (remainingMs <= 0)");
  const commandIndex = functionSource.indexOf('await runCommand("skillspector"');
  assert.ok(expiryIndex >= 0, "expected an exhausted-budget guard");
  assert.ok(commandIndex > expiryIndex, "budget guard must run before SkillSpector");
  assert.match(functionSource, /timeoutMs: remainingMs/);
  assert.doesNotMatch(functionSource, /timeoutMs: clawScanTimeoutMs\(\)/);
});
