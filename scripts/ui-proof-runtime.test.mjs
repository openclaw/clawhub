/* @vitest-environment node */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProofContext, sanitizeStepName } from "./ui-proof-runtime.mjs";

describe("ui-proof-runtime", () => {
  it("sanitizes step names into stable screenshot filenames", () => {
    expect(sanitizeStepName("01 Skills / List")).toBe("01-skills-list");
    expect(sanitizeStepName("   ")).toBe("step");
  });

  it("captures a screenshot and manifest entry for every proof step", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-runtime-"));
    const calls = [];
    const page = {
      async screenshot(options) {
        calls.push(options);
        await fs.writeFile(options.path, "png");
      },
    };
    const proof = createProofContext({ lane: "candidate", outputDir, page });

    await proof.step("01 Skills / List", async () => {
      calls.push({ action: "visited" });
    });

    expect(proof.steps).toEqual([
      {
        lane: "candidate",
        name: "01 Skills / List",
        screenshot: "screenshots/01-skills-list.png",
        slug: "01-skills-list",
        status: "pass",
      },
    ]);
    expect(calls[0]).toEqual({ action: "visited" });
    expect(calls[1]).toMatchObject({ fullPage: true });
    await expect(
      fs.readFile(path.join(outputDir, "screenshots", "01-skills-list.png"), "utf8"),
    ).resolves.toBe("png");
  });
});
