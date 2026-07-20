import {
  PUBLISHER_FEED_SCHEMA_VERSION,
  publisherFeedId,
  type PublisherFeed,
  type PublisherFeedEntry,
} from "clawhub-schema";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { isPublicSkillDoc } from "./lib/globalStats";
import { isPackageBlockedFromPublic } from "./lib/packageSecurity";
import { getPublicPublisherVisibility, normalizePublisherHandle } from "./lib/publishers";

const PUBLISHER_FEED_MAX_SOURCE_PAGES = 3;
const PUBLISHER_FEED_SNAPSHOT_MAX_ENTRIES = 400;
const PUBLISHER_FEED_SUMMARY_MAX_CHARS = 500;
type PublisherFeedReadCtx = Pick<QueryCtx | MutationCtx, "db">;

function boundedSummary(value: string | null | undefined) {
  if (value == null) return null;
  if (value.length <= PUBLISHER_FEED_SUMMARY_MAX_CHARS) return value;
  let bounded = value.slice(0, PUBLISHER_FEED_SUMMARY_MAX_CHARS);
  const finalCodeUnit = bounded.charCodeAt(bounded.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) bounded = bounded.slice(0, -1);
  return bounded;
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function safeGetPublisher(ctx: PublisherFeedReadCtx, id: string) {
  const publisherId = ctx.db.normalizeId("publishers", id);
  if (!publisherId) return null;
  try {
    return await ctx.db.get(publisherId);
  } catch {
    return null;
  }
}

async function safeResolvePublisherDetail(ctx: PublisherFeedReadCtx, reference: string) {
  const byId = await safeGetPublisher(ctx, reference);
  if (byId || reference.includes(":")) return byId;
  const handle = normalizePublisherHandle(reference);
  if (!handle || new TextEncoder().encode(handle).length > 64) return null;
  try {
    return await ctx.db
      .query("publishers")
      .withIndex("by_handle", (q) => q.eq("handle", handle))
      .unique();
  } catch {
    return null;
  }
}

function skillEntry(publisher: Doc<"publishers">, skill: Doc<"skills">): PublisherFeedEntry | null {
  if (!isPublicSkillDoc(skill)) return null;
  return {
    kind: "skill",
    id: String(skill._id),
    name: skill.slug,
    displayName: skill.displayName,
    summary: boundedSummary(skill.summary),
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

function packageEntry(
  publisher: Doc<"publishers">,
  pkg: Doc<"packages">,
): PublisherFeedEntry | null {
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
    summary: boundedSummary(pkg.summary),
    url: pluginPath(publisher, pkg.name),
    updatedAt: pkg.updatedAt,
  };
}

function buildFeed(params: {
  publisherId: string;
  feedId: string;
  handle: string | null;
  displayName: string;
  entries: PublisherFeedEntry[];
  generatedAt: string;
  sequence: number;
}): PublisherFeed {
  return {
    schemaVersion: PUBLISHER_FEED_SCHEMA_VERSION,
    feedId: params.feedId,
    publisherId: params.publisherId,
    handle: params.handle,
    displayName: params.displayName,
    generatedAt: params.generatedAt,
    sequence: params.sequence,
    entries: params.entries,
    nextCursor: null,
  };
}

type CollectedEntries = {
  entries: PublisherFeedEntry[];
  exhausted: boolean;
};

async function collectSkillEntries(
  ctx: PublisherFeedReadCtx,
  publisher: Doc<"publishers">,
  limit: number,
): Promise<CollectedEntries> {
  const entries: PublisherFeedEntry[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let pagesRead = 0;

  while (!isDone && pagesRead < PUBLISHER_FEED_MAX_SOURCE_PAGES && entries.length <= limit) {
    const page = await ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate({ cursor, numItems: limit + 1 });
    pagesRead += 1;

    for (const skill of page.page) {
      const entry = skillEntry(publisher, skill);
      if (entry) entries.push(entry);
      if (entries.length > limit) break;
    }
    isDone = page.isDone;
    cursor = page.isDone ? null : page.continueCursor;
  }

  return { entries, exhausted: isDone };
}

async function collectPackageEntries(
  ctx: PublisherFeedReadCtx,
  publisher: Doc<"publishers">,
  limit: number,
): Promise<CollectedEntries> {
  const entries: PublisherFeedEntry[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let pagesRead = 0;

  while (!isDone && pagesRead < PUBLISHER_FEED_MAX_SOURCE_PAGES && entries.length <= limit) {
    const page = await ctx.db
      .query("packages")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate({ cursor, numItems: limit + 1 });
    pagesRead += 1;

    for (const pkg of page.page) {
      const entry = packageEntry(publisher, pkg);
      if (entry) entries.push(entry);
      if (entries.length > limit) break;
    }
    isDone = page.isDone;
    cursor = page.isDone ? null : page.continueCursor;
  }

  return { entries, exhausted: isDone };
}

async function collectLegacySkillEntries(
  ctx: PublisherFeedReadCtx,
  publisher: Doc<"publishers">,
  ownerUserId: Doc<"users">["_id"],
  limit: number,
): Promise<CollectedEntries> {
  const entries: PublisherFeedEntry[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let pagesRead = 0;

  while (!isDone && pagesRead < PUBLISHER_FEED_MAX_SOURCE_PAGES && entries.length <= limit) {
    const page = await ctx.db
      .query("skills")
      .withIndex("by_owner_active_updated", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate({ cursor, numItems: limit + 1 });
    pagesRead += 1;
    for (const skill of page.page) {
      if (skill.ownerPublisherId && skill.ownerPublisherId !== publisher._id) continue;
      const entry = skillEntry(publisher, skill);
      if (entry) entries.push(entry);
      if (entries.length > limit) break;
    }
    isDone = page.isDone;
    cursor = page.isDone ? null : page.continueCursor;
  }
  return { entries, exhausted: isDone };
}

async function collectLegacyPackageEntries(
  ctx: PublisherFeedReadCtx,
  publisher: Doc<"publishers">,
  ownerUserId: Doc<"users">["_id"],
  limit: number,
): Promise<CollectedEntries> {
  const entries: PublisherFeedEntry[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let pagesRead = 0;

  while (!isDone && pagesRead < PUBLISHER_FEED_MAX_SOURCE_PAGES && entries.length <= limit) {
    const page = await ctx.db
      .query("packages")
      .withIndex("by_owner_active_updated", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate({ cursor, numItems: limit + 1 });
    pagesRead += 1;
    for (const pkg of page.page) {
      if (pkg.ownerPublisherId && pkg.ownerPublisherId !== publisher._id) continue;
      const entry = packageEntry(publisher, pkg);
      if (entry) entries.push(entry);
      if (entries.length > limit) break;
    }
    isDone = page.isDone;
    cursor = page.isDone ? null : page.continueCursor;
  }
  return { entries, exhausted: isDone };
}

async function buildPublisherFeed(
  ctx: PublisherFeedReadCtx,
  publisher: Doc<"publishers">,
  legacyOwnerUserId: Doc<"users">["_id"] | null,
  limit: number,
) {
  const [skillEntries, packageEntries, legacySkillEntries, legacyPackageEntries] =
    await Promise.all([
      collectSkillEntries(ctx, publisher, limit),
      collectPackageEntries(ctx, publisher, limit),
      legacyOwnerUserId
        ? collectLegacySkillEntries(ctx, publisher, legacyOwnerUserId, limit)
        : Promise.resolve({ entries: [], exhausted: true }),
      legacyOwnerUserId
        ? collectLegacyPackageEntries(ctx, publisher, legacyOwnerUserId, limit)
        : Promise.resolve({ entries: [], exhausted: true }),
    ]);

  const deduped = new Map<string, PublisherFeedEntry>();
  for (const entry of [
    ...skillEntries.entries,
    ...packageEntries.entries,
    ...legacySkillEntries.entries,
    ...legacyPackageEntries.entries,
  ]) {
    deduped.set(`${entry.kind}:${entry.id}`, entry);
  }
  const sortedCandidates = [...deduped.values()].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt ||
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id),
  );
  const exhausted =
    skillEntries.exhausted &&
    packageEntries.exhausted &&
    legacySkillEntries.exhausted &&
    legacyPackageEntries.exhausted;
  if (!exhausted || sortedCandidates.length > limit) {
    return { status: "capacity-exceeded" as const };
  }

  return {
    status: "complete" as const,
    publisherId: publisher._id,
    feedId: publisherFeedId(String(publisher._id)),
    handle: publisher.handle ?? null,
    displayName: publisher.displayName || publisher.handle || "",
    entries: sortedCandidates,
  };
}

export const getPublisherDetail = internalQuery({
  args: { publisherId: v.string() },
  handler: async (ctx, args) => {
    const publisher = await safeResolvePublisherDetail(ctx, args.publisherId);
    const visibility = await getPublicPublisherVisibility(ctx, publisher);
    if (!visibility) return null;
    return {
      publisher: {
        _id: visibility.publisher._id,
        kind: visibility.publisher.kind,
        handle: visibility.publisher.handle,
        displayName: visibility.publisher.displayName,
        image: visibility.publisher.image ?? null,
        bio: visibility.publisher.bio ?? null,
      },
      feedUrl: `/api/v1/publishers/${encodeURIComponent(String(visibility.publisher._id))}/feed`,
    };
  },
});

export const getPublisherFeedPublication = internalQuery({
  args: { publisherId: v.string() },
  handler: async (ctx, args) => {
    const publisher = await safeGetPublisher(ctx, args.publisherId);
    const visibility = await getPublicPublisherVisibility(ctx, publisher);
    if (!visibility) return null;
    return await ctx.db
      .query("publisherFeedPublications")
      .withIndex("by_publisher", (q) => q.eq("publisherId", visibility.publisher._id))
      .unique();
  },
});

type PublishPublisherFeedRevisionArgs = {
  publisherId: Id<"publishers">;
  feedId: string;
  handle: string | null;
  displayName: string;
  entries: PublisherFeedEntry[];
};

export async function publishPublisherFeedRevisionImpl(
  ctx: Pick<MutationCtx, "db">,
  args: PublishPublisherFeedRevisionArgs,
) {
  const publisher = await ctx.db.get(args.publisherId);
  const visibility = await getPublicPublisherVisibility(ctx, publisher);
  if (!visibility || publisherFeedId(String(args.publisherId)) !== args.feedId) return null;

  const contentKey = await sha256Hex(
    JSON.stringify({
      publisherId: String(args.publisherId),
      handle: args.handle,
      displayName: args.displayName,
      entries: args.entries,
    }),
  );
  const existing = await ctx.db
    .query("publisherFeedPublications")
    .withIndex("by_publisher", (q) => q.eq("publisherId", args.publisherId))
    .unique();
  if (existing?.contentKey === contentKey) {
    return buildFeed({
      publisherId: String(args.publisherId),
      feedId: args.feedId,
      handle: args.handle,
      displayName: args.displayName,
      entries: args.entries,
      generatedAt: existing.generatedAt,
      sequence: existing.sequence,
    });
  }

  const generatedAt = new Date().toISOString();
  const sequence = (existing?.sequence ?? 0) + 1;
  const publication = {
    publisherId: args.publisherId,
    feedId: args.feedId,
    sequence,
    generatedAt,
    handle: args.handle,
    displayName: args.displayName,
    entries: args.entries,
    contentKey,
    publishedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, publication);
  } else {
    await ctx.db.insert("publisherFeedPublications", publication);
  }
  return buildFeed({
    publisherId: String(args.publisherId),
    feedId: args.feedId,
    handle: args.handle,
    displayName: args.displayName,
    entries: args.entries,
    generatedAt,
    sequence,
  });
}

export async function refreshPublisherFeedImpl(
  ctx: Pick<MutationCtx, "db">,
  args: { publisherId: string },
) {
  const projection = await buildPublisherFeedProjectionImpl(ctx, args);
  if (!projection || projection.status !== "complete") return projection;
  return await publishPublisherFeedRevisionImpl(ctx, projection);
}

export async function buildPublisherFeedProjectionImpl(
  ctx: PublisherFeedReadCtx,
  args: { publisherId: string },
) {
  const publisher = await safeGetPublisher(ctx, args.publisherId);
  const visibility = await getPublicPublisherVisibility(ctx, publisher);
  if (!visibility) return null;
  return await buildPublisherFeed(
    ctx,
    visibility.publisher,
    visibility.linkedUser?._id ?? null,
    PUBLISHER_FEED_SNAPSHOT_MAX_ENTRIES,
  );
}

export const refreshPublisherFeed = internalMutation({
  args: { publisherId: v.string() },
  handler: refreshPublisherFeedImpl,
});
