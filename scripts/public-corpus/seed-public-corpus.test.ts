import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BATCH_BYTES,
  DEFAULT_SEED_CONCURRENCY,
  MAX_CONVEX_RUN_ARG_BYTES,
  buildSeedCorpusRow,
  chunkRowsByOwner,
  isRetryableConvexSeedBatchOutput,
  runSeedCorpusBatches,
  runConvexSeedBatchWithRetry,
  type SeedBatchRunOnce,
  type SeedCorpusRow,
  serializeConvexSeedArgs,
} from "./seed-public-corpus";

describe("public corpus seed runner", () => {
  it("uses portable owner-isolated batches", () => {
    const owner = {
      handle: "dummy-owner",
      displayName: "Dummy Owner",
      image: "https://example.invalid/avatar.png",
    };
    const rows = Array.from({ length: 4 }, (_, index) =>
      buildSeedCorpusRow(
        {
          kind: "skill",
          slug: `skill-${index}`,
          displayName: `Skill ${index}`,
          version: "1.0.0",
          skillMd: "x".repeat(50_000),
        },
        owner,
      ),
    );

    expect(DEFAULT_BATCH_BYTES).toBeGreaterThan(96_000);
    expect(DEFAULT_SEED_CONCURRENCY).toBe(24);
    expect(chunkRowsByOwner(rows, DEFAULT_BATCH_BYTES)).toEqual([rows.slice(0, 2), rows.slice(2)]);
  });

  it("rejects batch arguments above the portable process limit", () => {
    expect(() =>
      serializeConvexSeedArgs({
        rows: [{ skillMd: "x".repeat(MAX_CONVEX_RUN_ARG_BYTES) }],
      }),
    ).toThrow("Public corpus batch argument is");
  });

  it("runs different owners concurrently while serializing each owner", async () => {
    const buildRow = (ownerHandle: string, index: number) =>
      buildSeedCorpusRow(
        {
          kind: "skill",
          slug: `${ownerHandle}-${index}`,
          displayName: `${ownerHandle} ${index}`,
          version: "1.0.0",
          skillMd: "# Fixture",
        },
        {
          handle: ownerHandle,
          displayName: ownerHandle,
          image: "https://example.invalid/avatar.png",
        },
      );
    const batches = [
      [buildRow("owner-a", 1)],
      [buildRow("owner-b", 1)],
      [buildRow("owner-a", 2)],
      [buildRow("owner-c", 1)],
    ];
    const activeOwners = new Set<string>();
    let active = 0;
    let maxActive = 0;
    const runOnce = vi.fn(async (args: unknown) => {
      const rows = (args as { rows: (typeof batches)[number] }).rows;
      const ownerHandle = rows[0]!.dummyOwner.handle;
      expect(activeOwners.has(ownerHandle)).toBe(false);
      activeOwners.add(ownerHandle);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      activeOwners.delete(ownerHandle);
      return { status: 0, output: "" };
    });

    await runSeedCorpusBatches(batches, {
      concurrency: 2,
      runOnce,
      log: vi.fn(),
    });

    expect(runOnce).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(2);
  });

  it("waits for active owners and stops scheduling after a batch fails", async () => {
    const buildRow = (ownerHandle: string) =>
      buildSeedCorpusRow(
        {
          kind: "skill",
          slug: ownerHandle,
          displayName: ownerHandle,
          version: "1.0.0",
          skillMd: "# Fixture",
        },
        {
          handle: ownerHandle,
          displayName: ownerHandle,
          image: "https://example.invalid/avatar.png",
        },
      );
    const completedOwners: string[] = [];
    const runOnce = vi.fn(async (args: unknown) => {
      const rows = (args as { rows: SeedCorpusRow[] }).rows;
      const ownerHandle = rows[0]!.dummyOwner.handle;
      await new Promise((resolve) => setTimeout(resolve, ownerHandle === "owner-a" ? 5 : 20));
      completedOwners.push(ownerHandle);
      return ownerHandle === "owner-a"
        ? { status: 1, output: "failed" }
        : { status: 0, output: "" };
    });

    await expect(
      runSeedCorpusBatches([[buildRow("owner-a")], [buildRow("owner-b")], [buildRow("owner-c")]], {
        concurrency: 2,
        runOnce,
        log: vi.fn(),
      }),
    ).rejects.toThrow("Public corpus batch 1/3 failed");

    expect(completedOwners).toEqual(["owner-a", "owner-b"]);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

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
