import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { fetchGitHubCreatedAtByProviderAccountId } from "./lib/githubAccount";
import { getGitHubProviderAccountId } from "./lib/githubIdentity";
import { getUserByHandleOrPersonalPublisher } from "./lib/publishers";

const DEFAULT_BATCH_SIZE = 25;
const MAX_ACTION_BATCH_SIZE = 50;
const MAX_LIST_BATCH_SIZE = 500;
const DEFAULT_MAX_PAGES = 1;
const MAX_MAX_PAGES = 20;

type BackfillCandidate = {
  userId: Id<"users">;
  providerAccountId: string;
  handle: string | null;
};

type BackfillStats = {
  scanned: number;
  candidates: number;
  fetched: number;
  patched: number;
  failed: number;
  missingHandles: string[];
  errors: Array<{ userId: string; handle: string | null; message: string }>;
};

type BackfillPageResult = {
  candidates: BackfillCandidate[];
  scanned: number;
  cursor: string | null;
  isDone: boolean;
};

type BackfillHandlesResult = {
  candidates: BackfillCandidate[];
  missingHandles: string[];
};

type BackfillResult =
  | { ok: true; stats: BackfillStats; cursor: string | null; isDone: boolean }
  | { ok: false; rateLimited: true; stats: BackfillStats; cursor: string | null; isDone: false };

function clampPositiveInteger(value: number | undefined, fallback: number, max: number) {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

async function candidateForUser(
  ctx: Parameters<typeof getGitHubProviderAccountId>[0],
  userId: Id<"users">,
): Promise<BackfillCandidate | null> {
  const user = await ctx.db.get(userId);
  if (!user || user.deletedAt || user.deactivatedAt || user.githubCreatedAt) return null;
  const providerAccountId = await getGitHubProviderAccountId(ctx, userId);
  if (!providerAccountId || !/^\d+$/.test(providerAccountId)) return null;
  return { userId, providerAccountId, handle: user.handle ?? null };
}

export const listGitHubCreatedAtBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampPositiveInteger(args.batchSize, DEFAULT_BATCH_SIZE, MAX_LIST_BATCH_SIZE);
    const page = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "github"))
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const candidates: BackfillCandidate[] = [];
    for (const account of page.page) {
      if (!/^\d+$/.test(account.providerAccountId)) continue;
      const user = await ctx.db.get(account.userId);
      if (!user || user.deletedAt || user.deactivatedAt || user.githubCreatedAt) continue;
      candidates.push({
        userId: account.userId,
        providerAccountId: account.providerAccountId,
        handle: user.handle ?? null,
      });
    }

    return {
      candidates,
      scanned: page.page.length,
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const listGitHubCreatedAtBackfillHandlesInternal = internalQuery({
  args: { handles: v.array(v.string()) },
  handler: async (ctx, args) => {
    const seen = new Set<string>();
    const candidates: BackfillCandidate[] = [];
    const missingHandles: string[] = [];
    for (const handle of args.handles) {
      const user = await getUserByHandleOrPersonalPublisher(ctx, handle);
      if (!user) {
        missingHandles.push(handle);
        continue;
      }
      if (seen.has(user._id)) continue;
      seen.add(user._id);
      const candidate = await candidateForUser(ctx, user._id);
      if (candidate) candidates.push(candidate);
    }
    return { candidates, missingHandles };
  },
});

export const applyGitHubCreatedAtBackfillInternal = internalMutation({
  args: {
    userId: v.id("users"),
    githubCreatedAt: v.number(),
    fetchedAt: v.number(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt || user.githubCreatedAt) {
      return { patched: false };
    }
    if (args.dryRun) return { patched: false };
    await ctx.db.patch(args.userId, {
      githubCreatedAt: args.githubCreatedAt,
      githubFetchedAt: args.fetchedAt,
      updatedAt: Date.now(),
    });
    return { patched: true };
  },
});

export const applyGitHubCreatedAtBackfillBatchInternal = internalMutation({
  args: {
    items: v.array(
      v.object({
        userId: v.id("users"),
        githubCreatedAt: v.number(),
      }),
    ),
    fetchedAt: v.number(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let patched = 0;
    let skipped = 0;
    for (const item of args.items) {
      const user = await ctx.db.get(item.userId);
      if (!user || user.deletedAt || user.deactivatedAt || user.githubCreatedAt) {
        skipped += 1;
        continue;
      }
      if (!args.dryRun) {
        await ctx.db.patch(item.userId, {
          githubCreatedAt: item.githubCreatedAt,
          githubFetchedAt: args.fetchedAt,
          updatedAt: Date.now(),
        });
      }
      patched += 1;
    }
    return { patched, skipped };
  },
});

export const backfillGitHubCreatedAtInternal = internalAction({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxPages: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    handles: v.optional(v.array(v.string())),
  },
  handler: async (ctx: ActionCtx, args): Promise<BackfillResult> => {
    const batchSize = clampPositiveInteger(
      args.batchSize,
      DEFAULT_BATCH_SIZE,
      MAX_ACTION_BATCH_SIZE,
    );
    const maxPages = clampPositiveInteger(args.maxPages, DEFAULT_MAX_PAGES, MAX_MAX_PAGES);
    const dryRun = args.dryRun ?? false;
    const fetchedAt = Date.now();
    const stats = {
      scanned: 0,
      candidates: 0,
      fetched: 0,
      patched: 0,
      failed: 0,
      missingHandles: [] as string[],
      errors: [] as Array<{ userId: string; handle: string | null; message: string }>,
    };

    let cursor = args.cursor ?? null;
    let isDone = true;
    let pages = 0;

    while (pages < maxPages) {
      pages += 1;
      const page: BackfillPageResult | BackfillHandlesResult = args.handles
        ? ((await ctx.runQuery(
            internal.githubAccountAgeBackfill.listGitHubCreatedAtBackfillHandlesInternal,
            {
              handles: args.handles,
            },
          )) as BackfillHandlesResult)
        : ((await ctx.runQuery(
            internal.githubAccountAgeBackfill.listGitHubCreatedAtBackfillPageInternal,
            {
              cursor: cursor ?? undefined,
              batchSize,
            },
          )) as BackfillPageResult);

      const candidates = page.candidates;
      stats.scanned += "scanned" in page ? page.scanned : (args.handles?.length ?? 0);
      if ("missingHandles" in page) stats.missingHandles.push(...page.missingHandles);
      stats.candidates += candidates.length;

      for (const candidate of candidates) {
        try {
          const githubCreatedAt = await fetchGitHubCreatedAtByProviderAccountId(
            candidate.providerAccountId,
          );
          stats.fetched += 1;
          const result: { patched: boolean } = await ctx.runMutation(
            internal.githubAccountAgeBackfill.applyGitHubCreatedAtBackfillInternal,
            {
              userId: candidate.userId,
              githubCreatedAt,
              fetchedAt,
              dryRun,
            },
          );
          if (result.patched) stats.patched += 1;
        } catch (error) {
          stats.failed += 1;
          const message = error instanceof ConvexError ? String(error.data) : String(error);
          if (stats.errors.length < 10) {
            stats.errors.push({
              userId: candidate.userId,
              handle: candidate.handle,
              message,
            });
          }
          if (/rate limit/i.test(message)) {
            return { ok: false as const, rateLimited: true as const, stats, cursor, isDone: false };
          }
        }
      }

      if (args.handles) return { ok: true as const, stats, cursor: null, isDone: true };
      cursor = "cursor" in page ? page.cursor : null;
      isDone = "isDone" in page ? page.isDone : true;
      if (isDone) break;
    }

    if (!dryRun && !isDone && cursor) {
      await ctx.scheduler.runAfter(
        0,
        internal.githubAccountAgeBackfill.backfillGitHubCreatedAtInternal,
        {
          cursor,
          batchSize,
          maxPages,
        },
      );
    }

    return { ok: true as const, stats, cursor, isDone };
  },
});
