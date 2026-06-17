import { describe, expect, it, vi } from "vitest";
import {
  buildSeedCorpusRow,
  isRetryableConvexSeedBatchOutput,
  runConvexSeedBatchWithRetry,
  type SeedBatchRunOnce,
} from "./seed-public-corpus";

describe("public corpus seed runner", () => {
  it("strips retired capability metadata before sending rows to Convex", () => {
    const owner = {
      handle: "dummy-owner",
      displayName: "Dummy Owner",
      image: "https://example.invalid/avatar.png",
    };

    const skillRow = buildSeedCorpusRow(
      {
        kind: "skill",
        slug: "legacy-skill",
        displayName: "Legacy Skill",
        version: "1.0.0",
        skillMd: "# Legacy Skill",
        capabilityTags: ["requires-sensitive-credentials"],
        executesCode: false,
      } as Parameters<typeof buildSeedCorpusRow>[0] & {
        capabilityTags: string[];
        executesCode: boolean;
      },
      owner,
    );
    const pluginRow = buildSeedCorpusRow(
      {
        kind: "plugin",
        name: "@legacy/plugin",
        displayName: "Legacy Plugin",
        version: "1.0.0",
        readme: "# Legacy Plugin",
        capabilityTags: ["requires-sensitive-credentials"],
        executesCode: true,
      } as Parameters<typeof buildSeedCorpusRow>[0] & {
        capabilityTags: string[];
        executesCode: boolean;
      },
      owner,
    );

    expect(skillRow).not.toHaveProperty("capabilityTags");
    expect(skillRow).not.toHaveProperty("executesCode");
    expect(pluginRow).not.toHaveProperty("capabilityTags");
    expect(pluginRow).not.toHaveProperty("executesCode");
    expect(skillRow.dummyOwner).toBe(owner);
    expect(pluginRow.dummyOwner).toBe(owner);
  });

  it("recognizes retryable Convex write conflicts", () => {
    expect(
      isRetryableConvexSeedBatchOutput(
        "Uncaught Error: Data read or written in this mutation changed while it was being run.",
      ),
    ).toBe(true);
    expect(isRetryableConvexSeedBatchOutput("AUTH_GITHUB_ID is required")).toBe(false);
  });

  it("retries retryable batch conflicts before succeeding", async () => {
    const runOnce: SeedBatchRunOnce = vi
      .fn()
      .mockReturnValueOnce({
        status: 1,
        output:
          "Uncaught Error: Data read or written in this mutation changed while it was being run.",
      })
      .mockReturnValueOnce({ status: 0, output: '{"ok":true}' });
    const sleep = vi.fn(async () => undefined);
    const log = vi.fn();

    await expect(
      runConvexSeedBatchWithRetry(
        { rows: [] },
        { runOnce, sleep, maxAttempts: 3, retryDelayMs: () => 0, log },
      ),
    ).resolves.toBe(0);

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "Convex seed batch hit a retryable write conflict; retrying (2/3).",
    );
  });

  it("does not retry non-conflict failures", async () => {
    const runOnce: SeedBatchRunOnce = vi
      .fn()
      .mockReturnValue({ status: 1, output: "AUTH_GITHUB_ID is required" });

    await expect(
      runConvexSeedBatchWithRetry({ rows: [] }, { runOnce, maxAttempts: 3 }),
    ).resolves.toBe(1);

    expect(runOnce).toHaveBeenCalledTimes(1);
  });
});
