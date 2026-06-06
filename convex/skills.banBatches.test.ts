import { describe, expect, it, vi } from "vitest";
import {
  applyBanToOwnedSkillsBatchInternal,
  applyPublisherDeletionToOwnedSkillsBatchInternal,
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
    { hiddenCount: number; scheduled: boolean; aborted?: boolean }
  >
)._handler;

const applyPublisherDeletionHandler = (
  applyPublisherDeletionToOwnedSkillsBatchInternal as unknown as WrappedHandler<
    { ownerPublisherId: string; actorUserId: string; deletedAt: number; cursor?: string },
    { hiddenCount: number; scheduled: boolean; stale?: boolean }
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
    if (table === "skillVersions") {
      return {
        withIndex: () => ({
          take: async () => [],
        }),
      };
    }
    if (table === "skillEmbeddings") {
      return {
        withIndex: () => ({
          collect: async () => [],
        }),
      };
    }
    if (table === "skillVersions") {
      return {
        withIndex: () => ({
          take: async () => [],
        }),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  const scheduler = { runAfter: vi.fn() };
  return {
    ctx: {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return user;
          if (id === "publishers:org") return { _id: id, kind: "org", deletedAt: 3_000 };
          return null;
        }),
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
  it("starts hard-delete cleanup for active skills owned by a deleted publisher", async () => {
    const { ctx, patch, scheduler } = makeCtx({
      user: { _id: "users:owner", deletedAt: undefined, deactivatedAt: undefined },
      skills: [
        {
          _id: "skills:org-skill",
          ownerUserId: "users:owner",
          ownerPublisherId: "publishers:org",
          softDeletedAt: undefined,
          hiddenAt: undefined,
          moderationStatus: "active",
          moderationFlags: undefined,
          stats: {
            downloads: 0,
            stars: 0,
            comments: 0,
            versions: 1,
            installsCurrent: 0,
            installsAllTime: 0,
          },
        },
      ],
    });

    await expect(
      applyPublisherDeletionHandler(ctx, {
        ownerPublisherId: "publishers:org",
        actorUserId: "users:owner",
        deletedAt: 3_000,
      }),
    ).resolves.toEqual({
      ok: true,
      hiddenCount: 1,
      scheduled: false,
    });

    expect(patch).toHaveBeenCalledWith(
      "skills:org-skill",
      expect.objectContaining({
        softDeletedAt: expect.any(Number),
        hiddenAt: expect.any(Number),
        moderationStatus: "removed",
        hiddenBy: "users:owner",
      }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({
        skillId: "skills:org-skill",
        actorUserId: "users:owner",
        phase: "fingerprints",
        source: "publisher.delete",
        ownerPublisherId: "publishers:org",
      }),
    );
  });

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

  it("retimestamps legacy ban-hidden skills so a final unban restores them after a re-ban", async () => {
    const legacySkill = {
      _id: "skills:legacy-hidden",
      ownerUserId: "users:owner",
      softDeletedAt: 1_000,
      moderationStatus: undefined,
      moderationReason: "user.banned",
      hiddenAt: 1_000,
      hiddenBy: "users:first-moderator",
      stats: {
        downloads: 0,
        stars: 0,
        comments: 0,
        versions: 1,
        installsCurrent: 0,
        installsAllTime: 0,
      },
    };
    const { ctx: banCtx, patch: banPatch } = makeCtx({
      user: { _id: "users:owner", deletedAt: 2_000 },
      skills: [legacySkill],
    });

    await expect(
      applyBanHandler(banCtx, {
        ownerUserId: "users:owner",
        bannedAt: 2_000,
        hiddenBy: "users:second-moderator",
      }),
    ).resolves.toEqual({
      ok: true,
      hiddenCount: 0,
      scheduled: false,
    });

    expect(banPatch).toHaveBeenCalledWith(
      "skills:legacy-hidden",
      expect.objectContaining({
        softDeletedAt: 2_000,
        hiddenAt: 2_000,
        hiddenBy: "users:second-moderator",
        lastReviewedAt: 2_000,
        updatedAt: 2_000,
      }),
    );

    const retimestampPatch = banPatch.mock.calls[0]?.[1] ?? {};
    const { ctx: unbanCtx, patch: unbanPatch } = makeCtx({
      user: { _id: "users:owner", deletedAt: undefined, deactivatedAt: undefined },
      skills: [{ ...legacySkill, ...retimestampPatch }],
    });

    await expect(
      restoreUnbanHandler(unbanCtx, { ownerUserId: "users:owner", bannedAt: 2_000 }),
    ).resolves.toMatchObject({
      restoredCount: 1,
      scheduled: false,
    });

    expect(unbanPatch).toHaveBeenCalledWith(
      "skills:legacy-hidden",
      expect.objectContaining({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "restored.unban",
      }),
    );
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

  it("does not roll newer ban markers back when stale ban pages run late", async () => {
    const { ctx, patch } = makeCtx({
      user: { _id: "users:owner", deletedAt: 1_000 },
      skills: [
        {
          _id: "skills:hidden",
          ownerUserId: "users:owner",
          softDeletedAt: 2_000,
          moderationStatus: "hidden",
          moderationReason: "user.banned",
          hiddenAt: 2_000,
          hiddenBy: "users:second-moderator",
        },
      ],
    });

    await expect(
      applyBanHandler(ctx, {
        ownerUserId: "users:owner",
        bannedAt: 1_000,
        hiddenBy: "users:first-moderator",
      }),
    ).resolves.toEqual({
      ok: true,
      hiddenCount: 0,
      scheduled: false,
    });

    expect(patch).not.toHaveBeenCalledWith("skills:hidden", expect.anything());
  });

  it("aborts stale scheduled ban pages after the owner is unbanned", async () => {
    const { ctx, patch, query, scheduler } = makeCtx({
      user: { _id: "users:owner", deletedAt: undefined, deactivatedAt: undefined },
      skills: [
        {
          _id: "skills:hidden",
          ownerUserId: "users:owner",
          softDeletedAt: 1_000,
          moderationStatus: "hidden",
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
        cursor: "next-page",
      }),
    ).resolves.toEqual({
      ok: true,
      hiddenCount: 0,
      scheduled: false,
      aborted: true,
    });

    expect(query).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
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

  it("restores legacy ban-hidden skills without moderationStatus", async () => {
    const { ctx, patch } = makeCtx({
      user: { _id: "users:owner", deletedAt: undefined, deactivatedAt: undefined },
      skills: [
        {
          _id: "skills:legacy-hidden",
          ownerUserId: "users:owner",
          softDeletedAt: 1_000,
          moderationStatus: undefined,
          moderationReason: "user.banned",
          stats: {
            downloads: 0,
            stars: 0,
            comments: 0,
            versions: 1,
            installsCurrent: 0,
            installsAllTime: 0,
          },
        },
      ],
    });

    await expect(
      restoreUnbanHandler(ctx, { ownerUserId: "users:owner", bannedAt: 1_000 }),
    ).resolves.toMatchObject({
      restoredCount: 1,
      scheduled: false,
    });

    expect(patch).toHaveBeenCalledWith(
      "skills:legacy-hidden",
      expect.objectContaining({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "restored.unban",
      }),
    );
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
