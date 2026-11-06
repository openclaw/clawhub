/* @vitest-environment node */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import CiTestObservations from "./ci-test-observations.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ci-observations-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"));
  for (const file of [
    "package.json",
    "vitest.config.ts",
    "vitest.setup.ts",
    "bun.lock",
    "scripts/ci-test-observations.mjs",
  ]) {
    writeFileSync(join(root, file), "fixture");
  }
  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "fixture",
    ],
  ]) {
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      stdio: "ignore",
    });
  }
  const project = { name: "" };
  const spec = { moduleId: join(root, "example.test.ts"), project, pool: "forks" };
  const reporter = new CiTestObservations();
  reporter.onInit({ config: { root }, viteConfig: { cacheDir: join(root, "cache") } });
  reporter.onTestRunStart([spec]);
  const read = () =>
    JSON.parse(
      readFileSync(join(root, ".artifacts/ci-test-observations/observations.json"), "utf8"),
    );
  const module = (state, results, moduleId = spec.moduleId) => ({
    moduleId,
    project,
    state: () => state,
    children: {
      *allTests() {
        for (const result of results)
          yield {
            result: () => result,
            diagnostic: () =>
              result.unstarted || ["skipped", "pending"].includes(result.state)
                ? undefined
                : { retryCount: result.retries ?? 0 },
          };
      },
    },
    diagnostic: () => ({ duration: 10 }),
  });
  return { root, reporter, read, module, spec };
}

describe("CI test observation boundary", () => {
  it("records the initial inventory and sanitized native edges without test content", () => {
    const f = fixture();
    expect(f.read().preExecution.observations.invocations[0].files[0]).toMatchObject({
      file: "example.test.ts",
      outcome: "unknown",
      complete: false,
      dependencies: null,
    });
    mkdirSync(join(f.root, "cache"));
    writeFileSync(
      join(f.root, "cache/dependencies.json"),
      JSON.stringify({
        version: 1,
        projects: {
          "": {
            modules: ["shared.ts", "setup.ts"],
            files: { "example.test.ts": [0] },
            globalSetup: [1],
          },
        },
      }),
    );
    f.reporter.onTestRunEnd(
      [f.module("passed", [{ state: "passed", title: "private test content" }])],
      [],
    );
    const result = f.read();
    expect(result.observations.invocations[0].files[0]).toMatchObject({
      outcome: "passed",
      complete: true,
      dependencies: ["example.test.ts", "setup.ts", "shared.ts"],
    });
    expect(JSON.stringify(result)).not.toContain(f.root);
    expect(JSON.stringify(result)).not.toContain("private test content");
    expect(result.preExecution.observations.invocations[0].files[0].outcome).toBe("unknown");
  });

  it("keeps failed hooks, retries and unfinished files unknown and tolerates missing records", () => {
    const f = fixture();
    for (const [state, cases] of [
      ["failed", [{ state: "passed" }]],
      ["passed", [{ state: "passed", errors: [{}] }]],
      ["failed", [{ state: "failed", retries: 1 }]],
      ["pending", [{ state: "pending" }]],
    ]) {
      f.reporter.onTestRunEnd([f.module(state, cases)], []);
      expect(f.read().observations.invocations[0].files[0]).toMatchObject({
        complete: false,
        outcome: "unknown",
      });
    }
    f.reporter.onTestRunEnd([f.module("failed", [{ state: "failed" }])], []);
    expect(f.read().observations.invocations[0].files[0]).toMatchObject({
      complete: true,
      outcome: "failed",
      dependencies: null,
    });
    f.reporter.onTestRunEnd([], []);
    expect(f.read().observations.invocations[0].files[0].outcome).toBe("unknown");
  });

  it("retains failed per-test hooks as unknown while completed hooks allow outcomes", () => {
    const f = fixture();
    const module = f.module("failed", [{ state: "failed" }]);
    const hook = { name: "beforeEach", entity: { id: "test-1", type: "test", module } };
    f.reporter.onHookStart(hook);
    f.reporter.onTestRunEnd([module], []);
    expect(f.read().observations.invocations[0].files[0].outcome).toBe("unknown");
    f.reporter.onHookEnd(hook);
    f.reporter.onTestRunEnd([module], []);
    expect(f.read().observations.invocations[0].files[0].outcome).toBe("failed");
  });

  it("keeps skipped and unstarted files unknown without losing healthy sibling results", () => {
    const f = fixture();
    const healthyPath = join(f.root, "healthy.test.ts");
    f.reporter.onTestRunStart([f.spec, { ...f.spec, moduleId: healthyPath }]);
    for (const result of [{ state: "skipped" }, { state: "failed", unstarted: true }]) {
      f.reporter.onTestRunEnd(
        [f.module("failed", [result]), f.module("passed", [{ state: "passed" }], healthyPath)],
        [],
      );
      const files = f.read().observations.invocations[0].files;
      expect(files[0]).toMatchObject({ complete: false, outcome: "unknown" });
      expect(files[1]).toMatchObject({ complete: true, outcome: "passed" });
    }
  });
});
