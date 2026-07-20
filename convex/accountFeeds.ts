import {
  PUBLISHER_FEED_SCHEMA_VERSION,
  PUBLISHER_FEED_CHANGE_MAX_LIMIT,
  PUBLISHER_FEED_QUERY_MAX_LIMIT,
  normalizePublisherFeedQuery,
  publisherFeedId,
  type PublisherFeed,
  type PublisherFeedChange,
  type PublisherFeedEntry,
  type PublisherFeedMetadata,
  type PublisherFeedQuery,
} from "clawhub-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { isPublicSkillDoc } from "./lib/globalStats";
import { isPackageBlockedFromPublic } from "./lib/packageSecurity";
import { getPublicPublisherVisibility, normalizePublisherHandle } from "./lib/publishers";

const PUBLISHER_FEED_MAX_SOURCE_PAGES = 3;
const PUBLISHER_FEED_SNAPSHOT_MAX_ENTRIES = 400;
const PUBLISHER_FEED_SUMMARY_MAX_CHARS = 500;
const PUBLISHER_FEED_RETAINED_REVISIONS = 256;
const PUBLISHER_FEED_HISTORY_PRUNE_BATCH_SIZE = 100;
type PublisherFeedReadCtx = Pick<QueryCtx | MutationCtx, "db">;

function publisherMetadata(params: {
  publisherId: string;
  handle: string | null;
  displayName: string;
}): PublisherFeedMetadata {
  return {
    publisherId: params.publisherId,
    handle: params.handle,
    displayName: params.displayName,
  };
}

function entryKey(entry: Pick<PublisherFeedEntry, "kind" | "id">) {
  return `${entry.kind}:${entry.id}`;
}

function entryEquals(left: PublisherFeedEntry, right: PublisherFeedEntry) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildRevisionChanges(params: {
  existing: Pick<
    Doc<"publisherFeedPublications">,
    "publisherId" | "handle" | "displayName" | "entries"
  > | null;
  publisherId: Id<"publishers">;
  handle: string | null;
  displayName: string;
  entries: PublisherFeedEntry[];
  sequence: number;
}): PublisherFeedChange[] {
  const changes: PublisherFeedChange[] = [];
  const metadata = publisherMetadata({
    publisherId: String(params.publisherId),
    handle: params.handle,
    displayName: params.displayName,
  });
  if (
    !params.existing ||
    params.existing.handle !== params.handle ||
    params.existing.displayName !== params.displayName
  ) {
    changes.push({ sequence: params.sequence, operation: "metadata", metadata });
  }

  const previous = new Map(
    (params.existing?.entries ?? []).map((entry) => [entryKey(entry), entry] as const),
  );
  const current = new Map(params.entries.map((entry) => [entryKey(entry), entry] as const));
  for (const key of [...current.keys()].sort()) {
    const entry = current.get(key)!;
    const oldEntry = previous.get(key);
    if (!oldEntry || !entryEquals(oldEntry, entry)) {
      changes.push({ sequence: params.sequence, operation: "upsert", entry });
    }
  }
  for (const key of [...previous.keys()].sort()) {
    if (current.has(key)) continue;
    const entry = previous.get(key)!;
    changes.push({
      sequence: params.sequence,
      operation: "remove",
      entryId: entry.id,
      entryKind: entry.kind,
    });
  }
  return changes;
}

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

type StoredPublisherFeed = Pick<
  Doc<"publisherFeedPublications">,
  | "publisherId"
  | "feedId"
  | "sequence"
  | "generatedAt"
  | "handle"
  | "displayName"
  | "entries"
  | "cumulativeChangeCount"
>;

function normalizedSearchText(value: string) {
  return value.normalize("NFC").toLowerCase();
}

export function queryPublisherFeedPublicationImpl(
  publication: StoredPublisherFeed,
  rawQuery: PublisherFeedQuery,
  offset: number,
  limit: number,
) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid query offset");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > PUBLISHER_FEED_QUERY_MAX_LIMIT) {
    throw new Error("Invalid query limit");
  }
  const query = normalizePublisherFeedQuery(rawQuery);
  const kinds = query.kinds ? new Set(query.kinds) : null;
  const text = query.text ? normalizedSearchText(query.text) : null;
  const matches = publication.entries.filter((entry) => {
    if (kinds && !kinds.has(entry.kind)) return false;
    if (!text) return true;
    return normalizedSearchText(
      [entry.name, entry.displayName, entry.summary ?? ""].join("\n"),
    ).includes(text);
  });
  if (offset > matches.length) throw new Error("Invalid query offset");
  const entries = matches.slice(offset, offset + limit);
  const nextOffset = offset + entries.length;
  return {
    feedId: publication.feedId,
    sequence: publication.sequence,
    query,
    startIndex: offset,
    resultCount: matches.length,
    entries,
    nextOffset: nextOffset < matches.length ? nextOffset : null,
  };
}

export const queryPublisherFeed = internalQuery({
  args: {
    publisherId: v.string(),
    query: v.object({
      text: v.optional(v.string()),
      kinds: v.optional(v.array(v.union(v.literal("skill"), v.literal("plugin")))),
    }),
    offset: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const publisher = await safeGetPublisher(ctx, args.publisherId);
    const visibility = await getPublicPublisherVisibility(ctx, publisher);
    if (!visibility) return null;
    const publication = await ctx.db
      .query("publisherFeedPublications")
      .withIndex("by_publisher", (q) => q.eq("publisherId", visibility.publisher._id))
      .unique();
    if (!publication) return null;
    return queryPublisherFeedPublicationImpl(publication, args.query, args.offset, args.limit);
  },
});

function changeDocumentToWire(change: Doc<"publisherFeedChanges">): PublisherFeedChange {
  if (change.operation === "upsert") {
    return { sequence: change.sequence, operation: "upsert", entry: change.entry };
  }
  if (change.operation === "remove") {
    return {
      sequence: change.sequence,
      operation: "remove",
      entryId: change.entryId,
      entryKind: change.entryKind,
    };
  }
  return { sequence: change.sequence, operation: "metadata", metadata: change.metadata };
}

export const getPublisherFeedChanges = internalQuery({
  args: {
    publisherId: v.string(),
    fromSequence: v.number(),
    offset: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.fromSequence) ||
      args.fromSequence < 0 ||
      !Number.isSafeInteger(args.offset) ||
      args.offset < 0 ||
      !Number.isSafeInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > PUBLISHER_FEED_CHANGE_MAX_LIMIT
    ) {
      return { status: "invalid" as const };
    }
    const publisher = await safeGetPublisher(ctx, args.publisherId);
    const visibility = await getPublicPublisherVisibility(ctx, publisher);
    if (!visibility) return null;
    const publication = await ctx.db
      .query("publisherFeedPublications")
      .withIndex("by_publisher", (q) => q.eq("publisherId", visibility.publisher._id))
      .unique();
    if (!publication) return null;
    if (args.fromSequence > publication.sequence) return { status: "invalid" as const };
    if (args.fromSequence === publication.sequence) {
      if (args.offset !== 0) return { status: "invalid" as const };
      return {
        status: "complete" as const,
        feedId: publication.feedId,
        fromSequence: args.fromSequence,
        toSequence: publication.sequence,
        startIndex: 0,
        changeCount: 0,
        changes: [],
        nextOffset: null,
      };
    }

    const targetRevision = await ctx.db
      .query("publisherFeedRevisions")
      .withIndex("by_publisher_and_sequence", (q) =>
        q.eq("publisherId", visibility.publisher._id).eq("sequence", publication.sequence),
      )
      .unique();
    const baseRevision =
      args.fromSequence === 0
        ? null
        : await ctx.db
            .query("publisherFeedRevisions")
            .withIndex("by_publisher_and_sequence", (q) =>
              q.eq("publisherId", visibility.publisher._id).eq("sequence", args.fromSequence),
            )
            .unique();
    const firstRevision =
      args.fromSequence === 0
        ? await ctx.db
            .query("publisherFeedRevisions")
            .withIndex("by_publisher_and_sequence", (q) =>
              q.eq("publisherId", visibility.publisher._id).eq("sequence", 1),
            )
            .unique()
        : null;
    if (
      !targetRevision ||
      publication.cumulativeChangeCount === undefined ||
      (args.fromSequence === 0
        ? !firstRevision || firstRevision.cumulativeChangeCount === 0
        : !baseRevision)
    ) {
      return {
        status: "reset-required" as const,
        feedId: publication.feedId,
        fromSequence: args.fromSequence,
        currentSequence: publication.sequence,
      };
    }

    const baseChangeCount = baseRevision?.cumulativeChangeCount ?? 0;
    const changeCount = targetRevision.cumulativeChangeCount - baseChangeCount;
    if (args.offset > changeCount) return { status: "invalid" as const };
    const firstChangeNumber = baseChangeCount + args.offset + 1;
    const rows =
      args.offset === changeCount
        ? []
        : await ctx.db
            .query("publisherFeedChanges")
            .withIndex("by_publisher_and_change_number", (q) =>
              q
                .eq("publisherId", visibility.publisher._id)
                .gte("changeNumber", firstChangeNumber)
                .lte("changeNumber", targetRevision.cumulativeChangeCount),
            )
            .order("asc")
            .take(args.limit);
    const expectedRows = Math.min(args.limit, changeCount - args.offset);
    if (
      rows.length !== expectedRows ||
      rows.some((row, index) => row.changeNumber !== firstChangeNumber + index)
    ) {
      return {
        status: "reset-required" as const,
        feedId: publication.feedId,
        fromSequence: args.fromSequence,
        currentSequence: publication.sequence,
      };
    }
    const page = rows;
    const nextOffset = args.offset + page.length;
    return {
      status: "complete" as const,
      feedId: publication.feedId,
      fromSequence: args.fromSequence,
      toSequence: publication.sequence,
      startIndex: args.offset,
      changeCount,
      changes: page.map(changeDocumentToWire),
      nextOffset: nextOffset < changeCount ? nextOffset : null,
    };
  },
});

type PublishPublisherFeedRevisionArgs = {
  publisherId: Id<"publishers">;
  feedId: string;
  handle: string | null;
  displayName: string;
  entries: PublisherFeedEntry[];
};

type PublisherFeedHistoryPrunePhase = "revisions" | "changes";

export async function prunePublisherFeedHistoryImpl(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    publisherId: Id<"publishers">;
    cutoffSequence: number;
    phase: PublisherFeedHistoryPrunePhase;
  },
) {
  const rows = await ctx.db
    .query(args.phase === "revisions" ? "publisherFeedRevisions" : "publisherFeedChanges")
    .withIndex("by_publisher_and_sequence", (q) =>
      q.eq("publisherId", args.publisherId).lte("sequence", args.cutoffSequence),
    )
    .order("asc")
    .take(PUBLISHER_FEED_HISTORY_PRUNE_BATCH_SIZE);
  for (const row of rows) await ctx.db.delete(row._id);

  const nextPhase =
    rows.length === PUBLISHER_FEED_HISTORY_PRUNE_BATCH_SIZE ? args.phase : "changes";
  const complete =
    args.phase === "changes" && rows.length < PUBLISHER_FEED_HISTORY_PRUNE_BATCH_SIZE;
  if (!complete) {
    await ctx.scheduler.runAfter(0, internal.accountFeeds.prunePublisherFeedHistoryInternal, {
      ...args,
      phase: nextPhase,
    });
  }
  return { deleted: rows.length, phase: args.phase, complete };
}

export const prunePublisherFeedHistoryInternal = internalMutation({
  args: {
    publisherId: v.id("publishers"),
    cutoffSequence: v.number(),
    phase: v.union(v.literal("revisions"), v.literal("changes")),
  },
  handler: async (ctx, args) => await prunePublisherFeedHistoryImpl(ctx, args),
});

async function ensurePublisherFeedRevisionBaseline(
  ctx: Pick<MutationCtx, "db">,
  publication: Doc<"publisherFeedPublications">,
) {
  if (publication.cumulativeChangeCount !== undefined) {
    return publication.cumulativeChangeCount;
  }
  const revision = await ctx.db
    .query("publisherFeedRevisions")
    .withIndex("by_publisher_and_sequence", (q) =>
      q.eq("publisherId", publication.publisherId).eq("sequence", publication.sequence),
    )
    .unique();
  if (!revision) {
    await ctx.db.insert("publisherFeedRevisions", {
      publisherId: publication.publisherId,
      feedId: publication.feedId,
      sequence: publication.sequence,
      generatedAt: publication.generatedAt,
      metadata: publisherMetadata({
        publisherId: String(publication.publisherId),
        handle: publication.handle,
        displayName: publication.displayName,
      }),
      contentKey: publication.contentKey,
      cumulativeChangeCount: 0,
      publishedAt: publication.publishedAt,
    });
  }
  await ctx.db.patch(publication._id, { cumulativeChangeCount: 0 });
  return 0;
}

export async function publishPublisherFeedRevisionImpl(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
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
    await ensurePublisherFeedRevisionBaseline(ctx, existing);
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
  const cumulativeChangeCount = existing
    ? await ensurePublisherFeedRevisionBaseline(ctx, existing)
    : 0;
  const changes = buildRevisionChanges({
    existing,
    publisherId: args.publisherId,
    handle: args.handle,
    displayName: args.displayName,
    entries: args.entries,
    sequence,
  });
  if (changes.length === 0) {
    throw new Error("Changed publisher feed revision produced no change records");
  }
  for (const [index, change] of changes.entries()) {
    await ctx.db.insert("publisherFeedChanges", {
      publisherId: args.publisherId,
      feedId: args.feedId,
      changeNumber: cumulativeChangeCount + index + 1,
      ...change,
    });
  }
  const nextCumulativeChangeCount = cumulativeChangeCount + changes.length;
  const publication = {
    publisherId: args.publisherId,
    feedId: args.feedId,
    sequence,
    generatedAt,
    handle: args.handle,
    displayName: args.displayName,
    entries: args.entries,
    contentKey,
    cumulativeChangeCount: nextCumulativeChangeCount,
    publishedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, publication);
  } else {
    await ctx.db.insert("publisherFeedPublications", publication);
  }
  await ctx.db.insert("publisherFeedRevisions", {
    publisherId: args.publisherId,
    feedId: args.feedId,
    sequence,
    generatedAt,
    metadata: publisherMetadata({
      publisherId: String(args.publisherId),
      handle: args.handle,
      displayName: args.displayName,
    }),
    contentKey,
    cumulativeChangeCount: nextCumulativeChangeCount,
    publishedAt: publication.publishedAt,
  });
  const cutoffSequence = sequence - PUBLISHER_FEED_RETAINED_REVISIONS;
  if (cutoffSequence > 0) {
    await prunePublisherFeedHistoryImpl(ctx, {
      publisherId: args.publisherId,
      cutoffSequence,
      phase: "revisions",
    });
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
  ctx: Pick<MutationCtx, "db" | "scheduler">,
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
