import {
  ACCOUNT_FEED_DEFAULT_LIMIT,
  ACCOUNT_FEED_MAX_LIMIT,
  ACCOUNT_FEED_SCHEMA_VERSION,
  accountFeedId,
  type AccountFeed,
  type AccountFeedEntry,
} from "clawhub-schema";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalQuery } from "./functions";
import { isPublicSkillDoc } from "./lib/globalStats";
import { isPackageBlockedFromPublic } from "./lib/packageSecurity";
import { toPublicPublisher, toPublicUser } from "./lib/public";

const ACCOUNT_FEED_MAX_SOURCE_PAGES = 3;

function clampLimit(limit: number | undefined) {
  const value = Number.isFinite(limit) ? Math.trunc(limit as number) : ACCOUNT_FEED_DEFAULT_LIMIT;
  return Math.min(Math.max(value, 1), ACCOUNT_FEED_MAX_LIMIT);
}

async function safeGetUser(ctx: Pick<QueryCtx, "db">, id: string) {
  const userId = ctx.db.normalizeId("users", id);
  if (!userId) return null;
  try {
    return await ctx.db.get(userId);
  } catch {
    return null;
  }
}

async function safeGetPublisher(ctx: Pick<QueryCtx, "db">, id: string) {
  const publisherId = ctx.db.normalizeId("publishers", id);
  if (!publisherId) return null;
  try {
    return await ctx.db.get(publisherId);
  } catch {
    return null;
  }
}

function isActiveUser(user: Doc<"users"> | null | undefined): user is Doc<"users"> {
  return Boolean(user && !user.deletedAt && !user.deactivatedAt);
}

function isActivePublisher(
  publisher: Doc<"publishers"> | null | undefined,
): publisher is Doc<"publishers"> {
  return Boolean(publisher && !publisher.deletedAt && !publisher.deactivatedAt);
}

function skillEntry(publisher: Doc<"publishers">, skill: Doc<"skills">): AccountFeedEntry | null {
  if (!isPublicSkillDoc(skill)) return null;
  return {
    kind: "skill",
    id: String(skill._id),
    name: skill.slug,
    displayName: skill.displayName,
    summary: skill.summary ?? null,
    url: `/${encodeURIComponent(publisher.handle)}/skills/${encodeURIComponent(skill.slug)}`,
    updatedAt: skill.updatedAt,
  };
}

function pluginPath(publisher: Doc<"publishers">, name: string) {
  const trimmed = name.trim();
  if (!trimmed.startsWith("@")) {
    return `/${encodeURIComponent(publisher.handle)}/plugins/${encodeURIComponent(trimmed)}`;
  }
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 1 || slashIndex === trimmed.length - 1) {
    return `/plugins/${encodeURIComponent(trimmed)}`;
  }
  const packageName = trimmed.slice(slashIndex + 1);
  if (packageName.includes("/")) return `/plugins/${encodeURIComponent(trimmed)}`;
  return `/${encodeURIComponent(publisher.handle)}/plugins/${encodeURIComponent(packageName)}`;
}

function packageEntry(publisher: Doc<"publishers">, pkg: Doc<"packages">): AccountFeedEntry | null {
  if (
    pkg.family === "skill" ||
    pkg.channel === "private" ||
    isPackageBlockedFromPublic(pkg.scanStatus)
  ) {
    return null;
  }
  return {
    kind: "plugin",
    id: String(pkg._id),
    name: pkg.name,
    displayName: pkg.displayName,
    summary: pkg.summary ?? null,
    url: pluginPath(publisher, pkg.name),
    updatedAt: pkg.updatedAt,
  };
}

function buildFeed(params: {
  scope: "account" | "publisher";
  stableId: string;
  user: Doc<"users"> | null;
  publisher: Doc<"publishers">;
  entries: AccountFeedEntry[];
  nextCursor: string | null;
}): AccountFeed {
  return {
    schemaVersion: ACCOUNT_FEED_SCHEMA_VERSION,
    feedId: accountFeedId(params.scope, params.stableId),
    scope: params.scope,
    accountId: params.user ? String(params.user._id) : null,
    publisherId: String(params.publisher._id),
    handle: params.publisher.handle ?? params.user?.handle ?? null,
    displayName:
      params.publisher.displayName || params.user?.displayName || params.user?.name || "",
    generatedAt: new Date().toISOString(),
    sequence: 0,
    entries: params.entries,
    nextCursor: params.nextCursor,
  };
}

async function collectSkillEntries(ctx: QueryCtx, publisher: Doc<"publishers">, limit: number) {
  const entries: AccountFeedEntry[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let pagesRead = 0;

  while (!isDone && pagesRead < ACCOUNT_FEED_MAX_SOURCE_PAGES && entries.length < limit) {
    const page = await ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate({ cursor, numItems: limit });
    pagesRead += 1;

    for (const skill of page.page) {
      const entry = skillEntry(publisher, skill);
      if (entry) entries.push(entry);
      if (entries.length >= limit) break;
    }
    isDone = page.isDone;
    cursor = page.isDone ? null : page.continueCursor;
  }

  return entries;
}

async function collectPackageEntries(ctx: QueryCtx, publisher: Doc<"publishers">, limit: number) {
  const entries: AccountFeedEntry[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let pagesRead = 0;

  while (!isDone && pagesRead < ACCOUNT_FEED_MAX_SOURCE_PAGES && entries.length < limit) {
    const page = await ctx.db
      .query("packages")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate({ cursor, numItems: limit });
    pagesRead += 1;

    for (const pkg of page.page) {
      const entry = packageEntry(publisher, pkg);
      if (entry) entries.push(entry);
      if (entries.length >= limit) break;
    }
    isDone = page.isDone;
    cursor = page.isDone ? null : page.continueCursor;
  }

  return entries;
}

async function buildPublisherFeed(
  ctx: QueryCtx,
  publisher: Doc<"publishers">,
  user: Doc<"users"> | null,
  scope: "account" | "publisher",
  stableId: string,
  limit: number,
) {
  const [skillEntries, packageEntries] = await Promise.all([
    collectSkillEntries(ctx, publisher, limit),
    collectPackageEntries(ctx, publisher, limit),
  ]);

  const sortedCandidates = [...skillEntries, ...packageEntries].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id),
  );
  const entries = sortedCandidates.slice(0, limit);

  return buildFeed({ scope, stableId, user, publisher, entries, nextCursor: null });
}

export const getAccountDetail = internalQuery({
  args: { accountId: v.string() },
  handler: async (ctx, args) => {
    const user = await safeGetUser(ctx, args.accountId);
    if (!isActiveUser(user)) return null;
    const publisher = user.personalPublisherId
      ? await safeGetPublisher(ctx, String(user.personalPublisherId))
      : null;
    return {
      account: toPublicUser(user),
      publisher: toPublicPublisher(isActivePublisher(publisher) ? publisher : null),
      feedUrl: `/api/v1/accounts/${encodeURIComponent(String(user._id))}/feed`,
    };
  },
});

export const getPublisherDetail = internalQuery({
  args: { publisherId: v.string() },
  handler: async (ctx, args) => {
    const publisher = await safeGetPublisher(ctx, args.publisherId);
    if (!isActivePublisher(publisher)) return null;
    const user = publisher.linkedUserId
      ? await safeGetUser(ctx, String(publisher.linkedUserId))
      : null;
    return {
      publisher: toPublicPublisher(publisher),
      account: toPublicUser(isActiveUser(user) ? user : null),
      feedUrl: `/api/v1/publishers/${encodeURIComponent(String(publisher._id))}/feed`,
    };
  },
});

export const getAccountFeed = internalQuery({
  args: {
    accountId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await safeGetUser(ctx, args.accountId);
    if (!isActiveUser(user) || !user.personalPublisherId) return null;
    const publisher = await safeGetPublisher(ctx, String(user.personalPublisherId));
    if (!isActivePublisher(publisher)) return null;
    return await buildPublisherFeed(
      ctx,
      publisher,
      user,
      "account",
      String(user._id),
      clampLimit(args.limit),
    );
  },
});

export const getPublisherFeed = internalQuery({
  args: {
    publisherId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const publisher = await safeGetPublisher(ctx, args.publisherId);
    if (!isActivePublisher(publisher)) return null;
    const user = publisher.linkedUserId
      ? await safeGetUser(ctx, String(publisher.linkedUserId))
      : null;
    return await buildPublisherFeed(
      ctx,
      publisher,
      isActiveUser(user) ? user : null,
      "publisher",
      String(publisher._id),
      clampLimit(args.limit),
    );
  },
});
