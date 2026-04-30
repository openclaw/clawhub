/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  buildBlacksmithRunArgs,
  resolveTestboxSyncTimeoutMs,
  splitRunnerArgs,
} from "./blacksmith-testbox-runner.mjs";
import { evaluateTestboxSyncSanity, parseGitShortStatus } from "./testbox-sync-sanity.mjs";

describe("blacksmith-testbox-runner", () => {
  it("splits runner args from remote command args", () => {
    expect(splitRunnerArgs(["--id", "tbx_abc", "--", "bun", "run", "lint"])).toEqual({
      runnerArgs: ["--id", "tbx_abc"],
      commandArgs: ["bun", "run", "lint"],
    });
  });

  it("tolerates package-manager separators before runner args", () => {
    expect(splitRunnerArgs(["--", "--id", "tbx_abc", "--", "bun", "run", "lint"])).toEqual({
      runnerArgs: ["--id", "tbx_abc"],
      commandArgs: ["bun", "run", "lint"],
    });
    expect(splitRunnerArgs(["--claim", "--", "--id", "tbx_abc"])).toEqual({
      runnerArgs: ["--claim", "--id", "tbx_abc"],
      commandArgs: [],
    });
  });

  it("builds blacksmith run args from command args", () => {
    expect(
      buildBlacksmithRunArgs({
        commandArgs: ["bun", "run", "test", "--", "convex/lib/skills.test.ts"],
        testboxId: "tbx_abc",
      }),
    ).toEqual(["testbox", "run", "--id", "tbx_abc", "bun run test -- convex/lib/skills.test.ts"]);
  });

  it("uses a five minute sync timeout by default", () => {
    expect(resolveTestboxSyncTimeoutMs({})).toBe(300_000);
    expect(resolveTestboxSyncTimeoutMs({ CLAWHUB_TESTBOX_SYNC_TIMEOUT_MS: "0" })).toBe(0);
  });
});

describe("testbox-sync-sanity", () => {
  it("parses tracked deletions from git status", () => {
    expect(parseGitShortStatus(" D src/a.ts\n?? scratch.txt\nR  old.ts -> new.ts\n")).toEqual([
      { line: " D src/a.ts", path: "src/a.ts", status: " D", trackedDeletion: true },
      { line: "?? scratch.txt", path: "scratch.txt", status: "??", trackedDeletion: false },
      { line: "R  old.ts -> new.ts", path: "new.ts", status: "R ", trackedDeletion: false },
    ]);
  });

  it("fails when required root files are missing", () => {
    const result = evaluateTestboxSyncSanity({
      cwd: "/repo",
      statusRaw: "",
      exists: () => false,
    });

    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("missing required root files");
  });

  it("fails on mass tracked deletions", () => {
    const result = evaluateTestboxSyncSanity({
      cwd: "/repo",
      statusRaw: " D a.ts\n D b.ts\n",
      exists: () => true,
      deletionThreshold: 2,
    });

    expect(result.ok).toBe(false);
    expect(result.trackedDeletionCount).toBe(2);
  });
});
