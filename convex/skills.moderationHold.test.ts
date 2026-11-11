import { describe, expect, it, vi } from "vitest";
import {
  applyUserModerationToOwnedSkillsBatchInternal,
  restoreOwnedSkillsForModerationLiftBatchInternal,
} from "./skills";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const applyHoldHandler = (
  applyUserModerationToOwnedSkillsBatchInternal as unknown as WrappedHandler<
    { ownerUserId: string; hiddenAt: number; cursor?: string },
    { hiddenCount: number; scheduled: boolean }
  >
)._handler;

const restoreHoldHandler = (
  restoreOwnedSkillsForModerationLiftBatchInternal as unknown as WrappedHandler<
    { ownerUserId: string; holdPlacedAt: number; cursor?: string },
    { restoredCount: number; scheduled: boolean; aborted?: boolean }
  >
)._handler;

function makeCtx({
  user = { _id: "users:owner", requiresModerationAt: 1_000 },
  skills = [],
  versions = {},
}: {
  user?: Record<string, unknown> | null;
  skills?: Array<Record<string, unknown>>;
  versions?: Record<string, Record<string, unknown> | null>;
} = {}) {
  const patch = vi.fn();
  const insert = vi.fn();
  const replace = vi.fn();
  const delete_ = vi.fn();
  const normalizeId = vi.fn();
  const get = vi.fn(async (id: string) => {
    if (id === "users:owner") return user;
    return versions[id] ?? null;
  });
  const query = vi.fn((table: string) => {
    if (table === "skills") {
      return {
        withIndex: () => ({
          order: () => ({
            paginate: async () => ({ page: skills, isDone: true, continueCursor: null }),
          }),
        }),
      };
    }
    if (table === "globalStats") {
      return { withIndex: () => ({ unique: async () => null }) };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  const scheduler = { runAfter: vi.fn() };
  return {
    ctx: {
      db: { get, insert, patch, replace, delete: delete_, query, normalizeId },
      scheduler,
    } as never,
    patch,
    scheduler,
  };
}

describe("skills moderation holds", () => {
  it("does not overwrite existing hidden moderation reasons when applying a user hold", async () => {
    const { ctx, patch } = makeCtx({
      skills: [
        {
          _id: "skills:active",
          ownerUserId: "users:owner",
          moderationStatus: "active",
          moderationReason: "scanner.vt.clean",
          moderationVerdict: "clean",
          moderationFlags: undefined,
          softDeletedAt: undefined,
        },
        {
          _id: "skills:manual",
          ownerUserId: "users:owner",
          moderationStatus: "hidden",
          moderationReason: "manual.report",
          moderationVerdict: "suspicious",
          moderationFlags: undefined,
          softDeletedAt: undefined,
        },
      ],
    });

    const result = await applyHoldHandler(ctx, {
      ownerUserId: "users:owner",
      hiddenAt: 1_000,
    });

    expect(result.hiddenCount).toBe(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      "skills:active",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "user.moderation",
      }),
    );
  });

  it("restores from current ClawScan verdicts but keeps unscanned skills pending", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    const { ctx, patch, scheduler } = makeCtx({
      user: { _id: "users:owner", requiresModerationAt: undefined },
      versions: {
        // Retired VirusTotal results no longer count as a completed scan.
        "versions:vt-only": { _id: "versions:vt-only", vtAnalysis: { status: "clean" } },
        "versions:clawscan-clean": {
          _id: "versions:clawscan-clean",
          llmAnalysis: { status: "clean" },
        },
        "versions:malicious": {
          _id: "versions:malicious",
          llmAnalysis: { status: "malicious" },
        },
        "versions:pending": { _id: "versions:pending" },
      },
      skills: [
        {
          _id: "skills:vt-only",
          ownerUserId: "users:owner",
          latestVersionId: "versions:vt-only",
          moderationStatus: "hidden",
          moderationReason: "user.moderation",
          moderationFlags: undefined,
          softDeletedAt: undefined,
          hiddenAt: 1_000,
        },
        {
          _id: "skills:clawscan-clean",
          ownerUserId: "users:owner",
          latestVersionId: "versions:clawscan-clean",
          moderationStatus: "hidden",
          moderationReason: "user.moderation",
          moderationFlags: undefined,
          softDeletedAt: undefined,
          hiddenAt: 1_000,
        },
        {
          _id: "skills:malicious",
          ownerUserId: "users:owner",
          latestVersionId: "versions:malicious",
          moderationStatus: "hidden",
          moderationReason: "user.moderation",
          moderationFlags: undefined,
          softDeletedAt: undefined,
          hiddenAt: 1_000,
        },
        {
          _id: "skills:pending",
          ownerUserId: "users:owner",
          latestVersionId: "versions:pending",
          moderationStatus: "hidden",
          moderationReason: "user.moderation",
          moderationFlags: undefined,
          softDeletedAt: undefined,
          hiddenAt: 1_000,
        },
      ],
    });

    const result = await restoreHoldHandler(ctx, {
      ownerUserId: "users:owner",
      holdPlacedAt: 1_000,
    });

    expect(result.restoredCount).toBe(4);
    expect(patch).toHaveBeenCalledWith(
      "skills:vt-only",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        hiddenAt: undefined,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skills:clawscan-clean",
      expect.objectContaining({
        moderationStatus: "active",
        moderationReason: "scanner.llm.clean",
        hiddenAt: undefined,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skills:malicious",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "scanner.llm.malicious",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skills:pending",
      expect.objectContaining({
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        hiddenAt: undefined,
      }),
    );
    // Versions without a completed ClawScan result get a scan so they can resolve.
    const enqueuedVersionIds = scheduler.runAfter.mock.calls
      .filter(([, , args]) => (args as { source?: string })?.source === "backfill")
      .map(([, , args]) => (args as { versionId: string }).versionId);
    expect(enqueuedVersionIds).toEqual(["versions:vt-only", "versions:pending"]);
  });

  it("aborts restore when the user was re-held", async () => {
    const { ctx, patch } = makeCtx({
      user: { _id: "users:owner", requiresModerationAt: 2_000 },
      skills: [{ _id: "skills:one" }],
    });

    const result = await restoreHoldHandler(ctx, {
      ownerUserId: "users:owner",
      holdPlacedAt: 1_000,
    });

    expect(result).toMatchObject({ restoredCount: 0, scheduled: false, aborted: true });
    expect(patch).not.toHaveBeenCalled();
  });
});
