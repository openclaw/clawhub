/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  cleanupApiKeyRequiredFieldsBatchInternal,
  cleanupApiKeyRequiredFieldsInternal,
} from "./removeApiKeyRequiredData";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type CleanupPhase = "skillVersions" | "skills" | "skillSearchDigest";

type CleanupResult = {
  phase: CleanupPhase;
  dryRun: boolean;
  scanned: number;
  matched: number;
  patched: number;
  cursor: string | null;
  isDone: boolean;
  migrationDone: boolean;
  samples: string[];
};

const batchHandler = (
  cleanupApiKeyRequiredFieldsBatchInternal as unknown as WrappedHandler<
    {
      phase?: CleanupPhase;
      dryRun: boolean;
      batchSize?: number;
      cursor?: string | null;
      confirmationToken?: string;
    },
    CleanupResult
  >
)._handler;
const cleanupHandler = (
  cleanupApiKeyRequiredFieldsInternal as unknown as WrappedHandler<
    {
      dryRun: boolean;
      batchSize?: number;
      resume?: { phase: CleanupPhase; cursor: string | null };
      maxBatches?: number;
      confirmationToken?: string;
    },
    Record<string, unknown>
  >
)._handler;

function makeCtx(
  page: Array<Record<string, unknown>>,
  isDone = true,
  state: Record<string, unknown> | null = null,
) {
  const paginate = vi.fn().mockResolvedValue({
    page,
    continueCursor: "next-page",
    isDone,
  });
  const unique = vi.fn().mockResolvedValue(state);
  const withIndex = vi.fn(() => ({ unique }));
  const query = vi.fn((table: string) =>
    table === "apiKeyRequiredCleanupState" ? { withIndex } : { order: vi.fn(() => ({ paginate })) },
  );
  const patch = vi.fn();
  const insert = vi.fn();
  return {
    ctx: {
      db: {
        get: vi.fn(),
        insert,
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        query,
        normalizeId: vi.fn(() => null),
      },
    },
    query,
    paginate,
    patch,
    insert,
    unique,
  };
}

describe("API key required field cleanup", () => {
  it("cleans every table in the order that prevents digest fields from being recreated", async () => {
    const runMutation = vi.fn(async (_ref: unknown, args: { phase: CleanupPhase }) => ({
      phase: args.phase,
      dryRun: true,
      scanned: 1,
      matched: 1,
      patched: 0,
      cursor: null,
      isDone: true,
      migrationDone: args.phase === "skillSearchDigest",
      samples: [`${args.phase}:sample`],
    }));

    const result = await cleanupHandler({ runMutation }, { dryRun: true, maxBatches: 3 });

    expect(runMutation.mock.calls.map(([, args]) => args.phase)).toEqual([
      "skillVersions",
      "skills",
      "skillSearchDigest",
    ]);
    expect(result).toMatchObject({
      dryRun: true,
      batches: 3,
      scanned: 3,
      matched: 3,
      patched: 0,
      resume: null,
      isDone: true,
    });
  });

  it("returns an explicit resume point without skipping the next ordered table", async () => {
    const runMutation = vi.fn(async (_ref: unknown, args: { phase: CleanupPhase }) => ({
      phase: args.phase,
      dryRun: true,
      scanned: 1,
      matched: 0,
      patched: 0,
      cursor: null,
      isDone: true,
      migrationDone: false,
      samples: [],
    }));

    const result = await cleanupHandler({ runMutation }, { dryRun: true, maxBatches: 1 });

    expect(result).toMatchObject({
      resume: { phase: "skills", cursor: null },
      isDone: false,
    });
  });

  it("dry-runs a bounded resumable page without writing", async () => {
    const { ctx, query, paginate, patch } = makeCtx(
      [
        { _id: "skillVersions:with-field", apiKeyRequired: true },
        { _id: "skillVersions:without-field" },
      ],
      false,
    );

    const result = await batchHandler(ctx, {
      phase: "skillVersions",
      dryRun: true,
      batchSize: 999,
      cursor: "current-page",
    });

    expect(query).toHaveBeenCalledWith("skillVersions");
    expect(paginate).toHaveBeenCalledWith({ cursor: "current-page", numItems: 200 });
    expect(result).toEqual({
      phase: "skillVersions",
      dryRun: true,
      scanned: 2,
      matched: 1,
      patched: 0,
      cursor: "next-page",
      isDone: false,
      migrationDone: false,
      samples: ["skillVersions:with-field"],
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation token before applying", async () => {
    const { ctx, query, patch } = makeCtx([]);

    await expect(
      batchHandler(ctx, {
        phase: "skills",
        dryRun: false,
      }),
    ).rejects.toThrow("confirmationToken");

    expect(query).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("removes the top-level field from skill versions", async () => {
    const { ctx, patch, insert } = makeCtx([
      { _id: "skillVersions:with-field", apiKeyRequired: false },
    ]);

    const result = await batchHandler(ctx, {
      phase: "skillVersions",
      dryRun: false,
      confirmationToken: "REMOVE_API_KEY_REQUIRED_FIELDS",
    });

    expect(result).toMatchObject({ scanned: 1, matched: 1, patched: 1, isDone: true });
    expect(patch).toHaveBeenCalledWith("skillVersions:with-field", {
      apiKeyRequired: undefined,
    });
    expect(insert).toHaveBeenCalledWith(
      "apiKeyRequiredCleanupState",
      expect.objectContaining({
        phase: "skills",
        cursor: null,
        isDone: false,
        batches: 1,
        scanned: 1,
        matched: 1,
        patched: 1,
      }),
    );
  });

  it.each(["skills", "skillSearchDigest"] as const)(
    "removes the nested summary field from %s",
    async (phase) => {
      const { ctx, patch } = makeCtx(
        [
          {
            _id: `${phase}:with-field`,
            latestVersionSummary: {
              version: "1.0.0",
              createdAt: 123,
              changelog: "",
              apiKeyRequired: true,
            },
          },
        ],
        true,
        {
          _id: "apiKeyRequiredCleanupState:singleton",
          key: "remove-api-key-required-fields",
          phase,
          cursor: null,
          isDone: false,
          batches: 4,
          scanned: 400,
          matched: 20,
          patched: 20,
          updatedAt: 1,
        },
      );

      const result = await batchHandler(ctx, {
        phase,
        dryRun: false,
        confirmationToken: "REMOVE_API_KEY_REQUIRED_FIELDS",
      });

      expect(result).toMatchObject({ scanned: 1, matched: 1, patched: 1, isDone: true });
      expect(patch).toHaveBeenCalledWith(`${phase}:with-field`, {
        latestVersionSummary: {
          version: "1.0.0",
          createdAt: 123,
          changelog: "",
        },
      });
    },
  );

  it("persists the next cursor in the same mutation as each applied batch", async () => {
    const { ctx, insert } = makeCtx(
      [{ _id: "skillVersions:with-field", apiKeyRequired: true }],
      false,
    );

    const result = await batchHandler(ctx, {
      dryRun: false,
      confirmationToken: "REMOVE_API_KEY_REQUIRED_FIELDS",
    });

    expect(result).toMatchObject({
      phase: "skillVersions",
      cursor: "next-page",
      isDone: false,
      migrationDone: false,
      progress: {
        phase: "skillVersions",
        cursor: "next-page",
        isDone: false,
        batches: 1,
      },
    });
    expect(insert).toHaveBeenCalledWith(
      "apiKeyRequiredCleanupState",
      expect.objectContaining({
        phase: "skillVersions",
        cursor: "next-page",
        isDone: false,
      }),
    );
  });

  it("applies from persisted progress so reruns resume after action failures", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        phase: "skills",
        dryRun: false,
        scanned: 100,
        matched: 5,
        patched: 5,
        cursor: "next",
        isDone: false,
        migrationDone: false,
        samples: [],
        progress: {
          phase: "skills",
          cursor: "next",
          isDone: false,
          batches: 8,
          scanned: 800,
          matched: 25,
          patched: 25,
        },
      })
      .mockResolvedValueOnce({
        phase: "skills",
        dryRun: false,
        scanned: 25,
        matched: 1,
        patched: 1,
        cursor: null,
        isDone: true,
        migrationDone: true,
        samples: [],
        progress: {
          phase: "skillSearchDigest",
          cursor: null,
          isDone: true,
          batches: 9,
          scanned: 825,
          matched: 26,
          patched: 26,
        },
      });

    const result = await cleanupHandler(
      { runMutation },
      {
        dryRun: false,
        maxBatches: 2,
        confirmationToken: "REMOVE_API_KEY_REQUIRED_FIELDS",
      },
    );

    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[0]?.[1]).not.toHaveProperty("phase");
    expect(runMutation.mock.calls[0]?.[1]).not.toHaveProperty("cursor");
    expect(result).toMatchObject({
      isDone: true,
      progress: {
        batches: 9,
        scanned: 825,
        matched: 26,
        patched: 26,
      },
    });
  });
});
