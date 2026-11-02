import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const workspace = process.env.GITHUB_WORKSPACE;
const source = resolve(workspace, "source");
const external = join(source, ".artifacts/openclaw-contract");
const mode = process.env.PROOF_MODE;
const phase = process.env.PROOF_PHASE;
const results = { mode, phase, measurements: [] };
let reportNumber = 0;

function command(root, program, args, options = {}) {
  const start = performance.now();
  const result = spawnSync(program, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 240000,
  });
  assert.ifError(result.error);
  if (result.status !== 0 && !options.failure) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${program} exited ${result.status}`);
  }
  return {
    ms: performance.now() - start,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function contract(root, failure = false) {
  reportNumber += 1;
  const reportPath = join(process.env.RUNNER_TEMP, `contract-proof-${reportNumber}.json`);
  assert.equal(existsSync(reportPath), false);
  const output = command(
    source,
    "bunx",
    [
      "vitest",
      "run",
      "scripts/templates-feed-openclaw-e2e.test.ts",
      "--maxWorkers=1",
      "--reporter=json",
      `--outputFile=${reportPath}`,
    ],
    {
      env: { OPENCLAW_TEMPLATES_CHECKOUT: root },
      failure,
    },
  );
  if (failure) {
    assert.notEqual(output.status, 0);
    return { rejected: true, ms: output.ms };
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.success, true);
  assert.equal(report.numFailedTests, 0);
  assert.equal(report.numPendingTests, 0);
  assert.ok(report.numPassedTests >= 10);
  const names = report.testResults.flatMap((suite) =>
    suite.assertionResults.map((test) => ({ name: test.fullName, status: test.status })),
  );
  assert.ok(names.every((test) => test.status === "passed"));
  return {
    ms: output.ms,
    passed: report.numPassedTests,
    namesSha256: createHash("sha256").update(JSON.stringify(names)).digest("hex"),
  };
}

function installAndTest(root, label) {
  const install = command(root, "corepack", ["pnpm", "install", "--frozen-lockfile"]);
  results.measurements.push({ label, installMs: install.ms, contract: contract(root) });
}

assert.equal(
  command(source, "git", ["rev-parse", "HEAD"]).stdout.trim(),
  "56e7ee8aaef8a0e180f906fd7bf194dd1b03bc45",
);
assert.equal(
  command(external, "git", ["rev-parse", "HEAD"]).stdout.trim(),
  "bad082feced849567953588d4b1bc7ffc3188839",
);
assert.equal(existsSync(join(source, "node_modules")), false);
assert.equal(existsSync(join(external, "node_modules")), false);
results.bunInstallMs = command(source, "bun", ["install", "--frozen-lockfile"]).ms;
results.versions = {
  node: process.version,
  bun: command(source, "bun", ["--version"]).stdout.trim(),
};
installAndTest(external, phase);

if (mode === "candidate" && phase === "restored") {
  const baseline = resolve(workspace, "baseline");
  assert.equal(
    command(baseline, "git", ["rev-parse", "HEAD"]).stdout.trim(),
    "bad082feced849567953588d4b1bc7ffc3188839",
  );
  results.hotBaselineInstallMs = command(baseline, "corepack", [
    "pnpm",
    "install",
    "--frozen-lockfile",
  ]).ms;
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const order = repeat % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
    for (const label of order)
      installAndTest(label === "baseline" ? baseline : external, `hot-${repeat + 1}-${label}`);
  }
  assert.equal(new Set(results.measurements.map((sample) => sample.contract.namesSha256)).size, 1);
  results.wrongContractControl = contract(source, true);
}

results.lockSha256 = createHash("sha256")
  .update(readFileSync(join(external, "pnpm-lock.yaml")))
  .digest("hex");
console.log(`PROOF_JSON=${JSON.stringify(results)}`);
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  `\n\`\`\`json\n${JSON.stringify(results, null, 2)}\n\`\`\`\n`,
);
