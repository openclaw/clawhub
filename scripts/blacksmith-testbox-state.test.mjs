/* @vitest-environment node */

import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateClawHubTestboxClaim,
  evaluateLocalTestboxKey,
  parseTestboxIdArg,
  resolveBlacksmithTestboxStateDir,
  resolveClawHubTestboxClaimPath,
  resolveTestboxId,
  writeClawHubTestboxClaim,
} from "./blacksmith-testbox-state.mjs";

describe("blacksmith-testbox-state", () => {
  it("parses testbox ids from runner args", () => {
    expect(parseTestboxIdArg(["--id", "tbx_abc123"])).toBe("tbx_abc123");
    expect(parseTestboxIdArg(["--testbox-id=tbx_def456"])).toBe("tbx_def456");
    expect(parseTestboxIdArg(["--other"])).toBe("");
  });

  it("prefers CLI id over env ids", () => {
    expect(
      resolveTestboxId({
        argv: ["--id", "tbx_cli"],
        env: { CLAWHUB_TESTBOX_ID: "tbx_env", TESTBOX_ID: "tbx_fallback" },
      }),
    ).toBe("tbx_cli");
  });

  it("builds state paths from BLACKSMITH_HOME", () => {
    expect(resolveBlacksmithTestboxStateDir({ env: { BLACKSMITH_HOME: "/tmp/bs" } })).toBe(
      path.join("/tmp/bs", "testboxes"),
    );
    expect(
      resolveClawHubTestboxClaimPath({
        testboxId: "tbx_abc",
        env: { BLACKSMITH_HOME: "/tmp/bs" },
      }),
    ).toBe(path.join("/tmp/bs", "testboxes", "tbx_abc", "clawhub-runner.json"));
  });

  it("rejects ids without a local private key", () => {
    const result = evaluateLocalTestboxKey({
      testboxId: "tbx_missing",
      env: { BLACKSMITH_HOME: "/tmp/bs" },
      exists: () => false,
    });

    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("local Testbox SSH key missing");
  });

  it("validates claim repo root and freshness", () => {
    const claim = JSON.stringify({
      claimedAt: "2026-04-30T00:00:00.000Z",
      repoRoot: "/repo",
      runnerVersion: 1,
    });
    const result = evaluateClawHubTestboxClaim({
      testboxId: "tbx_claimed",
      cwd: "/repo",
      env: { BLACKSMITH_HOME: "/tmp/bs", CLAWHUB_TESTBOX_CLAIM_TTL_MINUTES: "60" },
      exists: () => true,
      readFile: () => claim,
      now: () => new Date("2026-04-30T00:30:00.000Z"),
    });

    expect(result.ok).toBe(true);
  });

  it("flags stale claims", () => {
    const claim = JSON.stringify({
      claimedAt: "2026-04-30T00:00:00.000Z",
      repoRoot: "/repo",
      runnerVersion: 1,
    });
    const result = evaluateClawHubTestboxClaim({
      testboxId: "tbx_stale",
      cwd: "/repo",
      env: { BLACKSMITH_HOME: "/tmp/bs", CLAWHUB_TESTBOX_CLAIM_TTL_MINUTES: "10" },
      exists: () => true,
      readFile: () => claim,
      now: () => new Date("2026-04-30T00:30:00.000Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("claim is stale");
  });

  it("writes a claim payload", () => {
    let writtenPath = "";
    let writtenBody = "";
    const result = writeClawHubTestboxClaim({
      testboxId: "tbx_write",
      cwd: "/repo",
      env: { BLACKSMITH_HOME: "/tmp/bs" },
      mkdir: () => {},
      writeFile: (target, body) => {
        writtenPath = target;
        writtenBody = body;
      },
      now: () => new Date("2026-04-30T00:00:00.000Z"),
    });

    expect(result.claimPath).toBe(
      path.join("/tmp/bs", "testboxes", "tbx_write", "clawhub-runner.json"),
    );
    expect(writtenPath).toBe(result.claimPath);
    expect(JSON.parse(writtenBody)).toMatchObject({
      claimedAt: "2026-04-30T00:00:00.000Z",
      repoRoot: "/repo",
      runnerVersion: 1,
    });
  });
});
