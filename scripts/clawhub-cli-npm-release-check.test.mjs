/* @vitest-environment node */

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("clawhub CLI npm release metadata check", () => {
  it("rejects option names used as missing flag values", () => {
    const result = spawnSync(
      "node",
      [
        "scripts/clawhub-cli-npm-release-check.mjs",
        "--tag",
        "--release-sha",
        "abc",
        "--release-main-ref",
        "main",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--tag requires a value.");
    expect(result.stderr).not.toContain('Release tag must match vX.Y.Z; found "--release-sha".');
  });
});
