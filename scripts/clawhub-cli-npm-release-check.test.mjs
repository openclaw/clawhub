/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("clawhub CLI npm release metadata check", () => {
  const releaseTag = "v0.23.1";

  function runCheck(args) {
    const env = { ...process.env };
    delete env.RELEASE_TAG;
    delete env.RELEASE_SHA;
    delete env.RELEASE_MAIN_REF;
    return spawnSync("node", ["scripts/clawhub-cli-npm-release-check.mjs", ...args], {
      encoding: "utf8",
      env,
    });
  }

  it("rejects option names used as missing flag values", () => {
    const result = runCheck(["--tag", "--release-sha", "abc", "--release-main-ref", "main"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--tag requires a value.");
    expect(result.stderr).not.toContain('Release tag must match vX.Y.Z; found "--release-sha".');
  });

  it.each([
    ["--release-sha", "HEAD"],
    ["--release-main-ref", "HEAD"],
  ])("rejects %s without its matching ancestry ref", (flag, value) => {
    const result = runCheck(["--tag", releaseTag, flag, value]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Release ancestry validation requires both --release-sha and --release-main-ref.",
    );
  });

  it("validates that the release commit is an ancestor of the main ref", () => {
    const result = runCheck([
      "--tag",
      releaseTag,
      "--release-sha",
      "HEAD^",
      "--release-main-ref",
      "HEAD",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Release metadata OK");
  });

  it("rejects a release commit that is not contained in the main ref", () => {
    const result = runCheck([
      "--tag",
      releaseTag,
      "--release-sha",
      "HEAD",
      "--release-main-ref",
      "HEAD^",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Tagged commit HEAD is not contained in HEAD^.");
  });
});
