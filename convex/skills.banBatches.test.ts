import { describe, expect, it, vi } from "vitest";
import {
  applyBanToOwnedSkillsBatchInternal,
  restoreOwnedSkillsForUnbanBatchInternal,
} from "./skills";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const restoreUnbanHandler = (
  restoreOwnedSkillsForUnbanBatchInternal as unknown as WrappedHandler<
    { ownerUserId: string; bannedAt: number; cursor?: string },
    { restoredCount: number; scheduled: boolean; aborted?: boolean }
  >
)._handler;

const applyBanHandler = (
  applyBanToOwnedSkillsBatchInternal as unknown as WrappedHandler<
    { ownerUserId: string; bannedAt: number; hiddenBy?: string; cursor?: string },
    { hiddenCount: number; scheduled: boolean }
  >
)._handler;

function makeCtx({
  user,
  skills = [],
}: {
  user: Record<string, unknown> | null;
  skills?: Array<Record<string, unknown>>;
}) {
  const patch = vi.fn();
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
    throw new Error(`Unexpected table ${table}`);
  });
  const scheduler = { runAfter: vi.fn() };
  return {
    ctx: {
      db: {
        get: vi.fn(async (id: string) => (id === "users:owner" ? user : null)),
        insert: vi.fn(),
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        query,
        normalizeId: vi.fn(),
      },
      scheduler,
    } as never,
    patch,
    query,
    scheduler,
  };
}

describe("skills ban/unban batches", () => {
  it("retimestamps earlier ban-hidden skills during a later ban", async () => {
    const { ctx, patch, scheduler } = makeCtx({
      user: { _id: "users:owner", deletedAt: 2_000 },
      skills: [
        {
          _id: "skills:hidden",
          ownerUserId: "users:owner",
          softDeletedAt: 1_000,
          moderationStatus: "hidden",
          moderationReason: "user.banned",
          hiddenAt: 1_000,
          hiddenBy: "users:first-moderator",
        },
      ],
    });

    await expect(
      applyBanHandler(ctx, {
        ownerUserId: "users:owner",
        bannedAt: 2_000,
        hiddenBy: "users:second-moderator",
      }),
    ).resolves.toEqual({
      ok: true,
      hiddenCount: 0,
      scheduled: false,
    });

    expect(patch).toHaveBeenCalledWith(
      "skills:hidden",
      expect.objectContaining({
        softDeletedAt: 2_000,
        hiddenAt: 2_000,
        hiddenBy: "users:second-moderator",
        lastReviewedAt: 2_000,
        updatedAt: 2_000,
      }),
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not retimestamp removed ban-hidden skills during a later ban", async () => {
    const { ctx, patch } = makeCtx({
      user: { _id: "users:owner", deletedAt: 2_000 },
      skills: [
        {
          _id: "skills:removed",
          ownerUserId: "users:owner",
          softDeletedAt: 1_000,
          moderationStatus: "removed",
          moderationReason: "user.banned",
          hiddenAt: 1_000,
        },
      ],
    });

    await expect(
      applyBanHandler(ctx, {
        ownerUserId: "users:owner",
        bannedAt: 2_000,
        hiddenBy: "users:second-moderator",
      }),
    ).resolves.toMatchObject({
      hiddenCount: 0,
      scheduled: false,
    });

    expect(patch).not.toHaveBeenCalledWith("skills:removed", expect.anything());
  });

  it("aborts stale unban restore pages when the owner was banned again", async () => {
    const { ctx, patch, query, scheduler } = makeCtx({
      user: { _id: "users:owner", deletedAt: 2_000 },
      skills: [
        {
          _id: "skills:hidden",
          ownerUserId: "users:owner",
          softDeletedAt: 1_000,
          moderationReason: "user.banned",
        },
      ],
    });

    await expect(
      restoreUnbanHandler(ctx, {
        ownerUserId: "users:owner",
        bannedAt: 1_000,
        cursor: "next-page",
      }),
    ).resolves.toEqual({
      ok: true,
      restoredCount: 0,
      scheduled: false,
      aborted: true,
    });

    expect(query).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("continues unban restore pages while the owner is active", async () => {
    const { ctx, query, scheduler } = makeCtx({
      user: { _id: "users:owner", deletedAt: undefined, deactivatedAt: undefined },
    });

    await expect(
      restoreUnbanHandler(ctx, { ownerUserId: "users:owner", bannedAt: 1_000 }),
    ).resolves.toEqual({
      ok: true,
      restoredCount: 0,
      scheduled: false,
    });

    expect(query).toHaveBeenCalledWith("skills");
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("does not restore removed ban-hidden skills", async () => {
    const { ctx, patch } = makeCtx({
      user: { _id: "users:owner", deletedAt: undefined, deactivatedAt: undefined },
      skills: [
        {
          _id: "skills:removed",
          ownerUserId: "users:owner",
          softDeletedAt: 1_000,
          moderationStatus: "removed",
          moderationReason: "user.banned",
        },
      ],
    });

    await expect(
      restoreUnbanHandler(ctx, { ownerUserId: "users:owner", bannedAt: 1_000 }),
    ).resolves.toMatchObject({
      restoredCount: 0,
      scheduled: false,
    });

    expect(patch).not.toHaveBeenCalledWith("skills:removed", expect.anything());
  });
});
