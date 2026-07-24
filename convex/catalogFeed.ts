import {
  CATALOG_FEED_GITHUB_SOURCE_REF,
  CATALOG_FEED_ID,
  CATALOG_FEED_QUERY_MAX_ENTRIES,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SOURCE_REF,
  CATALOG_SKILLS_FEED_DESCRIPTION,
  CATALOG_SKILLS_FEED_ID,
  normalizeCatalogFeedQuery,
  parseCatalogFeed,
  PROMOTIONS_FEED_ID,
  serializeCatalogFeed,
  type CatalogFeedChange,
  type CatalogFeedEntry,
  type CatalogFeedQuery,
  type CatalogFeedSkillEntry,
} from "clawhub-schema";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { isSkillHighlighted } from "./lib/badges";
import { sha256Hex } from "./lib/clawpack";
import { isPublicSkillDoc } from "./lib/globalStats";
import { isOfficialPublisher } from "./lib/officialPublishers";
import { getPackageReleaseArtifactSha256 } from "./lib/packageArtifacts";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./lib/packageSecurity";
import { getOwnerPublisher } from "./lib/publishers";
import { isSecurityScanStatusCompletedNonBlocked } from "./lib/securityScanPolicy";
import {
  getPublicSkillVersionDownloadBlock,
  getSkillFileModerationInfoFromSkill,
  isPublicSkillVersionAvailableForSkill,
} from "./lib/skillFileAccess";

const CATALOG_FEED_DESCRIPTION = "Official OpenClaw plugins published on ClawHub.";
const CATALOG_FEED_PAGE_SIZE = 100;
const MAX_CATALOG_FEED_ENTRIES = 1000;
const CATALOG_FEED_CHANGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CATALOG_FEED_CHANGE_PAGE_SIZE = 500;
const CATALOG_FEED_QUERY_SCAN_PAGE_SIZE = 250;
const CATALOG_FEED_FAMILIES = ["code-plugin", "bundle-plugin"] as const;

type CatalogQueryCtx = Pick<QueryCtx, "db">;
type CatalogFeedPublicationResult = {
  publicationId: string;
  feedId: typeof CATALOG_FEED_ID | typeof CATALOG_SKILLS_FEED_ID;
  sequence: number;
  payloadSha256: string;
  publishedAt: number;
  entryCount: number;
};

function appendEntriesWithinFeedLimit<T>(target: T[], entries: T[]) {
  const remaining = MAX_CATALOG_FEED_ENTRIES - target.length;
  if (remaining <= 0) return false;
  target.push(...entries.slice(0, remaining));
  return entries.length <= remaining;
}

const catalogFeedEntryFields = {
  id: v.string(),
  title: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  version: v.string(),
  state: v.union(
    v.literal("available"),
    v.literal("recommended"),
    v.literal("disabled"),
    v.literal("blocked"),
    v.literal("deprecated"),
  ),
  featured: v.optional(v.boolean()),
  featuredAt: v.optional(v.number()),
  publisher: v.object({
    id: v.string(),
    trust: v.union(v.literal("official"), v.literal("community")),
  }),
  install: v.object({
    candidates: v.array(
      v.object({
        sourceRef: v.string(),
        package: v.string(),
        version: v.string(),
        integrity: v.string(),
        github: v.optional(
          v.object({
            repo: v.string(),
            path: v.string(),
            commit: v.string(),
            contentHash: v.string(),
          }),
        ),
      }),
    ),
  }),
};
const catalogFeedEntryValidator = v.union(
  v.object({ type: v.literal("plugin"), ...catalogFeedEntryFields }),
  v.object({ type: v.literal("skill"), ...catalogFeedEntryFields }),
);

function catalogFeedEntryKey(entry: Pick<CatalogFeedEntry, "type" | "id">) {
  return `${entry.type}\0${entry.id}`;
}

function catalogFeedEntrySearchText(entry: CatalogFeedEntry) {
  return [entry.id, entry.title, entry.publisher.id].join("\n").normalize("NFC").toLowerCase();
}

function catalogFeedEntryMatchesQuery(entry: CatalogFeedEntry, query: CatalogFeedQuery) {
  return (
    (!query.text ||
      catalogFeedEntrySearchText(entry).includes(query.text.normalize("NFC").toLowerCase())) &&
    (!query.types || query.types.includes(entry.type)) &&
    (!query.states || query.states.includes(entry.state)) &&
    (!query.publisherIds || query.publisherIds.includes(entry.publisher.id))
  );
}

function buildCatalogFeedChanges(args: {
  sequence: number;
  previousEntries: CatalogFeedEntry[];
  nextEntries: CatalogFeedEntry[];
  previousDescription?: string;
  nextDescription: string;
}): CatalogFeedChange[] {
  const previousByKey = new Map(
    args.previousEntries.map((entry) => [catalogFeedEntryKey(entry), entry]),
  );
  const nextByKey = new Map(args.nextEntries.map((entry) => [catalogFeedEntryKey(entry), entry]));
  const changes: CatalogFeedChange[] = [];
  for (const [key, previous] of [...previousByKey].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (nextByKey.has(key)) continue;
    changes.push({
      sequence: args.sequence,
      operation: "remove",
      entryType: previous.type,
      entryId: previous.id,
    });
  }
  for (const [key, entry] of [...nextByKey].sort(([left], [right]) => left.localeCompare(right))) {
    if (JSON.stringify(previousByKey.get(key)) === JSON.stringify(entry)) continue;
    changes.push({ sequence: args.sequence, operation: "upsert", entry });
  }
  if (args.previousDescription !== args.nextDescription || changes.length === 0) {
    changes.push({
      sequence: args.sequence,
      operation: "metadata",
      metadata: { description: args.nextDescription },
    });
  }
  return changes;
}

async function buildEntry(
  ctx: CatalogQueryCtx,
  pkg: Doc<"packages">,
): Promise<CatalogFeedEntry | null> {
  if (pkg.softDeletedAt || pkg.channel !== "official" || !pkg.latestReleaseId) return null;
  const release = await ctx.db.get(pkg.latestReleaseId);
  if (!release || release.packageId !== pkg._id || release.softDeletedAt) return null;

  // Keep ClawHub on RFC 19's canonical feed entry shape. OpenClaw's staged
  // consumer must land its legacy-catalog adapter before this URL is enabled.
  const scanStatus = resolvePackageReleaseScanStatus(release);
  if (isPackageBlockedFromPublic(scanStatus)) return null;
  const artifactSha256 = getPackageReleaseArtifactSha256(release);
  if (!artifactSha256) return null;

  const owner = await getOwnerPublisher(ctx, {
    ownerPublisherId: pkg.ownerPublisherId,
    ownerUserId: pkg.ownerUserId,
  });
  if (!(await isOfficialPublisher(ctx, owner))) return null;
  const publisherId = owner?.handle?.trim();
  if (!publisherId) return null;

  const packageName = pkg.name.trim();
  const id = pkg.normalizedName.trim();
  const title = pkg.displayName.trim() || packageName;
  const description = pkg.summary?.trim();
  const icon = pkg.icon?.trim();
  const version = release.version.trim();
  if (!packageName || !id || !title || !version) return null;
  const highlighted = await ctx.db
    .query("packageBadges")
    .withIndex("by_package_kind", (q) => q.eq("packageId", pkg._id).eq("kind", "highlighted"))
    .unique();

  return {
    type: "plugin",
    id,
    title,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    version,
    state: "available",
    featured: Boolean(highlighted),
    ...(highlighted ? { featuredAt: highlighted.at } : {}),
    publisher: {
      id: publisherId,
      trust: "official",
    },
    install: {
      candidates: [
        {
          sourceRef: CATALOG_FEED_SOURCE_REF,
          package: packageName,
          version,
          integrity: `sha256:${artifactSha256}`,
        },
      ],
    },
  };
}

async function listFamilyEntries(
  ctx: CatalogQueryCtx,
  family: (typeof CATALOG_FEED_FAMILIES)[number],
) {
  const entries: CatalogFeedEntry[] = [];
  let cursor: string | null = null;

  while (true) {
    const page = await ctx.db
      .query("packages")
      .withIndex("by_active_family_official_downloads", (q) =>
        q.eq("softDeletedAt", undefined).eq("family", family).eq("isOfficial", true),
      )
      .order("desc")
      .paginate({ cursor, numItems: CATALOG_FEED_PAGE_SIZE });

    for (const pkg of page.page) {
      const entry = await buildEntry(ctx, pkg);
      if (entry) entries.push(entry);
      if (entries.length > MAX_CATALOG_FEED_ENTRIES) {
        throw new Error(`Catalog feed exceeds ${MAX_CATALOG_FEED_ENTRIES} entries`);
      }
    }
    if (page.isDone) return entries;
    cursor = page.continueCursor;
  }
}

async function buildSkillEntry(
  ctx: CatalogQueryCtx,
  skill: Doc<"skills">,
  trustedOwner?: Doc<"publishers">,
): Promise<CatalogFeedSkillEntry | null> {
  if (
    !isPublicSkillDoc(skill) ||
    !skill.ownerPublisherId ||
    (trustedOwner && skill.ownerPublisherId !== trustedOwner._id)
  ) {
    return null;
  }

  const owner = trustedOwner ?? (await ctx.db.get(skill.ownerPublisherId));
  if (
    !owner ||
    (trustedOwner
      ? Boolean(owner.deletedAt || owner.deactivatedAt)
      : !(await isOfficialPublisher(ctx, owner)))
  ) {
    return null;
  }

  const publisherId = owner.handle?.trim();
  const slug = skill.slug.trim();
  const title = skill.displayName.trim() || slug;
  const description = skill.summary?.trim();
  const icon = skill.icon?.trim();
  const highlightedAt = skill.badges?.highlighted?.at;
  const packageName = `@${publisherId}/${slug}`;
  if (!publisherId || !slug || !title) return null;

  if (skill.installKind === "github") {
    if (
      !skill.githubSourceId ||
      !skill.githubPath ||
      !skill.githubCurrentCommit ||
      !skill.githubCurrentContentHash ||
      skill.githubCurrentStatus !== "present" ||
      !isSecurityScanStatusCompletedNonBlocked(skill.githubScanStatus) ||
      skill.githubRemovedAt
    ) {
      return null;
    }
    const source = await ctx.db.get(skill.githubSourceId);
    if (!source || source.ownerPublisherId !== skill.ownerPublisherId) return null;

    const repo = source.repo.trim();
    const path = skill.githubPath.trim();
    const commit = skill.githubCurrentCommit.trim();
    const contentHash = skill.githubCurrentContentHash.trim();
    if (!repo || !path || !commit || !contentHash) return null;

    return {
      type: "skill",
      id: packageName,
      title,
      ...(description ? { description } : {}),
      ...(icon ? { icon } : {}),
      version: commit,
      state: "available",
      featured: isSkillHighlighted(skill),
      ...(highlightedAt !== undefined ? { featuredAt: highlightedAt } : {}),
      publisher: {
        id: publisherId,
        trust: "official",
      },
      install: {
        candidates: [
          {
            sourceRef: CATALOG_FEED_GITHUB_SOURCE_REF,
            package: packageName,
            version: commit,
            integrity: `sha256:${contentHash}`,
            github: {
              repo,
              path,
              commit,
              contentHash,
            },
          },
        ],
      },
    };
  }

  if (!skill.latestVersionId) return null;
  const version = await ctx.db.get(skill.latestVersionId);
  if (
    !version ||
    !isPublicSkillVersionAvailableForSkill(version, skill._id) ||
    getPublicSkillVersionDownloadBlock(getSkillFileModerationInfoFromSkill(skill), version) ||
    !version.files.length ||
    !version.sha256hash
  ) {
    return null;
  }

  const versionName = version.version.trim();
  if (!versionName) return null;

  return {
    type: "skill",
    id: packageName,
    title,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    version: versionName,
    state: "available",
    featured: isSkillHighlighted(skill),
    ...(highlightedAt !== undefined ? { featuredAt: highlightedAt } : {}),
    publisher: {
      id: publisherId,
      trust: "official",
    },
    install: {
      candidates: [
        {
          sourceRef: CATALOG_FEED_SOURCE_REF,
          package: packageName,
          version: versionName,
          integrity: `sha256:${version.sha256hash}`,
        },
      ],
    },
  };
}

export const listOfficialPublisherPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("officialPublishers")
      .withIndex("by_created")
      .order("desc")
      .paginate({ cursor: args.cursor, numItems: CATALOG_FEED_PAGE_SIZE });
    const publishers: Doc<"publishers">[] = [];
    for (const row of page.page) {
      const publisher = await ctx.db.get(row.publisherId);
      if (publisher && !publisher.deletedAt && !publisher.deactivatedAt) {
        publishers.push(publisher);
      }
    }
    return {
      publishers,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const listOfficialEntries = internalQuery({
  args: {
    family: v.union(v.literal("code-plugin"), v.literal("bundle-plugin")),
  },
  handler: async (ctx, args) => await listFamilyEntries(ctx, args.family),
});

export const listOfficialSkillEntries = internalQuery({
  args: {
    publisherId: v.id("publishers"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const owner = await ctx.db.get(args.publisherId);
    if (
      !owner ||
      owner.deletedAt ||
      owner.deactivatedAt ||
      !(await isOfficialPublisher(ctx, owner))
    ) {
      return { entries: [], isDone: true, continueCursor: "" };
    }

    const page = await ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", args.publisherId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate({ cursor: args.cursor, numItems: CATALOG_FEED_PAGE_SIZE });
    const entries: CatalogFeedSkillEntry[] = [];
    for (const skill of page.page) {
      const entry = await buildSkillEntry(ctx, skill, owner);
      if (entry) entries.push(entry);
    }
    return {
      entries,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const storePublication = internalMutation({
  args: {
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
    description: v.string(),
    generatedAt: v.string(),
    expiresAt: v.string(),
    entries: v.array(catalogFeedEntryValidator),
  },
  handler: async (ctx, args) => {
    const expectedEntryType = args.feedId === CATALOG_SKILLS_FEED_ID ? "skill" : "plugin";
    if (args.entries.some((entry) => entry.type !== expectedEntryType)) {
      throw new Error(`Catalog ${expectedEntryType} feed received a mismatched entry type`);
    }
    const latest = await ctx.db
      .query("catalogFeedPublications")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      .unique();
    const latestRevision = await ctx.db
      .query("catalogFeedRevisions")
      .withIndex("by_feed_and_sequence", (q) => q.eq("feedId", args.feedId))
      .order("desc")
      .first();
    const sequence = (latest?.sequence ?? 0) + 1;
    const previousFeed = latest ? parseCatalogFeed(JSON.parse(latest.payload)) : null;
    const changes = buildCatalogFeedChanges({
      sequence,
      previousEntries: previousFeed?.entries ?? [],
      nextEntries: args.entries,
      previousDescription: previousFeed?.description,
      nextDescription: args.description,
    });
    const payload = serializeCatalogFeed({
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      id: args.feedId,
      generatedAt: args.generatedAt,
      sequence,
      expiresAt: args.expiresAt,
      description: args.description,
      entries: args.entries,
    });
    const payloadSha256 = await sha256Hex(new TextEncoder().encode(payload));
    const publishedAt = Date.now();
    const expirationTime = publishedAt + CATALOG_FEED_CHANGE_RETENTION_MS;
    const publication = {
      feedId: args.feedId,
      sequence,
      generatedAt: args.generatedAt,
      expiresAt: args.expiresAt,
      payload,
      payloadSha256,
      publishedAt,
    };
    const publicationId = latest
      ? (await ctx.db.patch(latest._id, publication), latest._id)
      : await ctx.db.insert("catalogFeedPublications", publication);
    await ctx.db.insert("catalogFeedRevisions", {
      feedId: args.feedId,
      sequence,
      indexedEntryCount: 0,
      changeCount: changes.length,
      cumulativeChangeCount: (latestRevision?.cumulativeChangeCount ?? 0) + changes.length,
      generatedAt: args.generatedAt,
      expiresAt: args.expiresAt,
      description: args.description,
      publishedAt,
      expirationTime,
    });
    for (const [ordinal, change] of changes.entries()) {
      const identity =
        change.operation === "upsert"
          ? { entryType: change.entry.type, entryId: change.entry.id }
          : change.operation === "remove"
            ? { entryType: change.entryType, entryId: change.entryId }
            : {};
      await ctx.db.insert("catalogFeedChanges", {
        feedId: args.feedId,
        sequence,
        ordinal,
        operation: change.operation,
        ...identity,
        payload: JSON.stringify(change),
        expirationTime,
      });
    }
    return {
      publicationId,
      feedId: args.feedId,
      sequence,
      payloadSha256,
      publishedAt,
      entryCount: args.entries.length,
    };
  },
});

export const appendCatalogFeedIndexBatch = internalMutation({
  args: {
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
    sequence: v.number(),
    startOrdinal: v.number(),
    entries: v.array(catalogFeedEntryValidator),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.sequence) ||
      args.sequence < 1 ||
      !Number.isSafeInteger(args.startOrdinal) ||
      args.startOrdinal < 0 ||
      args.entries.length < 1 ||
      args.entries.length > CATALOG_FEED_QUERY_SCAN_PAGE_SIZE
    ) {
      throw new Error("Catalog feed index batch bounds are invalid");
    }
    const expectedEntryType = args.feedId === CATALOG_SKILLS_FEED_ID ? "skill" : "plugin";
    if (args.entries.some((entry) => entry.type !== expectedEntryType)) {
      throw new Error(`Catalog ${expectedEntryType} index received a mismatched entry type`);
    }
    const revision = await ctx.db
      .query("catalogFeedRevisions")
      .withIndex("by_feed_and_sequence", (q) =>
        q.eq("feedId", args.feedId).eq("sequence", args.sequence),
      )
      .unique();
    if (
      !revision ||
      revision.entryCount !== undefined ||
      (revision.indexedEntryCount ?? 0) !== args.startOrdinal
    ) {
      throw new Error("Catalog feed index revision changed while building");
    }
    for (const [offset, entry] of args.entries.entries()) {
      await ctx.db.insert("catalogFeedIndexedEntries", {
        feedId: args.feedId,
        sequence: args.sequence,
        ordinal: args.startOrdinal + offset,
        entryType: entry.type,
        state: entry.state,
        publisherId: entry.publisher.id,
        searchText: catalogFeedEntrySearchText(entry),
        payload: JSON.stringify(entry),
        expirationTime: revision.expirationTime,
      });
    }
    const indexedEntryCount = args.startOrdinal + args.entries.length;
    await ctx.db.patch(revision._id, { indexedEntryCount });
    return { indexedEntryCount };
  },
});

export const finalizeCatalogFeedIndex = internalMutation({
  args: {
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
    sequence: v.number(),
    entryCount: v.number(),
  },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.entryCount) || args.entryCount < 0) {
      throw new Error("Catalog feed index entry count is invalid");
    }
    const revision = await ctx.db
      .query("catalogFeedRevisions")
      .withIndex("by_feed_and_sequence", (q) =>
        q.eq("feedId", args.feedId).eq("sequence", args.sequence),
      )
      .unique();
    if (
      !revision ||
      revision.entryCount !== undefined ||
      (revision.indexedEntryCount ?? 0) !== args.entryCount
    ) {
      throw new Error("Catalog feed index is incomplete");
    }
    await ctx.db.patch(revision._id, {
      entryCount: args.entryCount,
      indexedEntryCount: undefined,
    });
    return { entryCount: args.entryCount };
  },
});

export const listChanges = internalQuery({
  args: {
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
    fromSequence: v.number(),
    toSequence: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.fromSequence) ||
      !Number.isSafeInteger(args.toSequence) ||
      args.fromSequence < 0 ||
      args.toSequence < args.fromSequence
    ) {
      throw new Error("Catalog feed change range is invalid");
    }
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > CATALOG_FEED_CHANGE_PAGE_SIZE
    ) {
      throw new Error(
        `Catalog feed change page size must be between 1 and ${CATALOG_FEED_CHANGE_PAGE_SIZE}`,
      );
    }
    const state = await readCatalogFeedChangeState(ctx, args.feedId);
    const window = changeWindowFromState(state);
    if (
      args.fromSequence < window.retainedFromSequence ||
      args.toSequence > window.currentSequence
    ) {
      return { resetRequired: true as const, ...window };
    }
    const changeCount = await countCatalogFeedChanges(ctx, args.feedId, args, state);
    if (changeCount === null) {
      return { resetRequired: true as const, ...window };
    }
    const page = await ctx.db
      .query("catalogFeedChanges")
      .withIndex("by_feed_and_sequence_and_ordinal", (q) =>
        q
          .eq("feedId", args.feedId)
          .gt("sequence", args.fromSequence)
          .lte("sequence", args.toSequence),
      )
      .paginate({
        ...args.paginationOpts,
        // Convex treats numItems as an initial reactive-page target. This query
        // has no post-index filters, so bounding rows read also makes the wire
        // page-size limit a hard maximum.
        maximumRowsRead: Math.min(
          args.paginationOpts.maximumRowsRead ?? args.paginationOpts.numItems,
          args.paginationOpts.numItems,
        ),
      });
    return {
      resetRequired: false as const,
      ...window,
      changeCount,
      ...page,
      page: page.page.map(({ sequence, ordinal, payload }) => ({ sequence, ordinal, payload })),
    };
  },
});

async function readCatalogFeedChangeState(
  ctx: Pick<QueryCtx, "db">,
  feedId: typeof CATALOG_FEED_ID | typeof CATALOG_SKILLS_FEED_ID,
) {
  const [oldest, latest] = await Promise.all([
    ctx.db
      .query("catalogFeedRevisions")
      .withIndex("by_feed_and_sequence", (q) => q.eq("feedId", feedId))
      .order("asc")
      .first(),
    ctx.db
      .query("catalogFeedRevisions")
      .withIndex("by_feed_and_sequence", (q) => q.eq("feedId", feedId))
      .order("desc")
      .first(),
  ]);
  if (latest) {
    return {
      currentSequence: latest.sequence,
      retainedFromSequence: Math.max(0, (oldest?.sequence ?? latest.sequence) - 1),
      oldestRevision: oldest,
      latestRevision: latest,
    };
  }
  const publication = await ctx.db
    .query("catalogFeedPublications")
    .withIndex("by_feed", (q) => q.eq("feedId", feedId))
    .unique();
  const currentSequence = publication?.sequence ?? 0;
  return {
    currentSequence,
    retainedFromSequence: currentSequence,
    oldestRevision: null,
    latestRevision: null,
  };
}

function changeWindowFromState(state: Awaited<ReturnType<typeof readCatalogFeedChangeState>>) {
  return {
    currentSequence: state.currentSequence,
    retainedFromSequence: state.retainedFromSequence,
  };
}

async function countCatalogFeedChanges(
  ctx: Pick<QueryCtx, "db">,
  feedId: typeof CATALOG_FEED_ID | typeof CATALOG_SKILLS_FEED_ID,
  range: { fromSequence: number; toSequence: number },
  state: Awaited<ReturnType<typeof readCatalogFeedChangeState>>,
) {
  if (range.fromSequence === range.toSequence) return 0;
  if (!state.oldestRevision || !state.latestRevision) return null;

  const baseRevision =
    range.fromSequence === state.retainedFromSequence
      ? state.oldestRevision
      : range.fromSequence === state.latestRevision.sequence
        ? state.latestRevision
        : await ctx.db
            .query("catalogFeedRevisions")
            .withIndex("by_feed_and_sequence", (q) =>
              q.eq("feedId", feedId).eq("sequence", range.fromSequence),
            )
            .unique();
  const targetRevision =
    range.toSequence === state.latestRevision.sequence
      ? state.latestRevision
      : await ctx.db
          .query("catalogFeedRevisions")
          .withIndex("by_feed_and_sequence", (q) =>
            q.eq("feedId", feedId).eq("sequence", range.toSequence),
          )
          .unique();
  if (!baseRevision || !targetRevision) return null;

  const baseCount =
    range.fromSequence === state.retainedFromSequence
      ? baseRevision.cumulativeChangeCount - baseRevision.changeCount
      : baseRevision.cumulativeChangeCount;
  const changeCount = targetRevision.cumulativeChangeCount - baseCount;
  return Number.isSafeInteger(changeCount) && changeCount >= 0 ? changeCount : null;
}

export const getChangeWindow = internalQuery({
  args: {
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
  },
  handler: async (ctx, args) =>
    changeWindowFromState(await readCatalogFeedChangeState(ctx, args.feedId)),
});

export const getCatalogFeedQueryRevision = internalQuery({
  args: {
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const revision = await ctx.db
      .query("catalogFeedRevisions")
      .withIndex("by_feed_and_sequence", (q) => q.eq("feedId", args.feedId))
      .order("desc")
      .filter((q) =>
        q.and(q.neq(q.field("entryCount"), undefined), q.gt(q.field("expiresAt"), now)),
      )
      .first();
    if (!revision || revision.entryCount === undefined) return null;
    return {
      sequence: revision.sequence,
      entryCount: revision.entryCount,
      expiresAt: revision.expiresAt,
    };
  },
});

export const beginCatalogFeedQueryMaterialization = internalMutation({
  args: {
    materializationKey: v.string(),
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
    sequence: v.number(),
    query: v.string(),
    querySha256: v.string(),
    expirationTime: v.number(),
  },
  handler: async (ctx, args) => {
    const normalizedQuery = normalizeCatalogFeedQuery(JSON.parse(args.query));
    if (JSON.stringify(normalizedQuery) !== args.query) {
      throw new Error("Catalog feed materialization query must be normalized");
    }
    const now = Date.now();
    if (
      !/^[a-f0-9]{64}$/u.test(args.querySha256) ||
      !Number.isSafeInteger(args.sequence) ||
      args.sequence < 0 ||
      !Number.isFinite(args.expirationTime) ||
      args.expirationTime <= now ||
      args.expirationTime > now + 15 * 60 * 1000
    ) {
      throw new Error("Catalog feed materialization bounds are invalid");
    }
    const revision = await ctx.db
      .query("catalogFeedRevisions")
      .withIndex("by_feed_and_sequence", (q) =>
        q.eq("feedId", args.feedId).eq("sequence", args.sequence),
      )
      .unique();
    if (!revision || revision.entryCount === undefined) {
      throw new Error("Catalog feed query index is unavailable for this revision");
    }
    const revisionExpirationTime = Date.parse(revision.expiresAt);
    if (
      !Number.isFinite(revisionExpirationTime) ||
      revisionExpirationTime <= now ||
      args.expirationTime > revisionExpirationTime
    ) {
      throw new Error("Catalog feed query revision has expired");
    }
    const existing = await ctx.db
      .query("catalogFeedQueryMaterializations")
      .withIndex("by_materialization_key", (q) =>
        q.eq("materializationKey", args.materializationKey),
      )
      .unique();
    if (existing) throw new Error("Catalog feed materialization key already exists");
    const materializationId = await ctx.db.insert("catalogFeedQueryMaterializations", {
      materializationKey: args.materializationKey,
      feedId: args.feedId,
      sequence: args.sequence,
      query: args.query,
      querySha256: args.querySha256,
      status: "building",
      expectedEntryCount: revision.entryCount,
      scannedEntryCount: 0,
      resultCount: 0,
      createdAt: now,
      expirationTime: args.expirationTime,
    });
    return {
      materializationId,
      expectedEntryCount: revision.entryCount,
    };
  },
});

export const scanCatalogFeedQueryIndex = internalQuery({
  args: {
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
    sequence: v.number(),
    query: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > CATALOG_FEED_QUERY_SCAN_PAGE_SIZE
    ) {
      throw new Error("Catalog feed query scan page size is invalid");
    }
    const query = normalizeCatalogFeedQuery(JSON.parse(args.query));
    if (JSON.stringify(query) !== args.query) {
      throw new Error("Catalog feed query scan requires a normalized query");
    }
    const page = await ctx.db
      .query("catalogFeedIndexedEntries")
      .withIndex("by_feed_sequence_ordinal", (q) =>
        q.eq("feedId", args.feedId).eq("sequence", args.sequence),
      )
      .paginate(args.paginationOpts);
    return {
      scannedCount: page.page.length,
      matches: page.page.flatMap((row) => {
        const entry = JSON.parse(row.payload) as CatalogFeedEntry;
        return catalogFeedEntryMatchesQuery(entry, query) ? [row.payload] : [];
      }),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const appendCatalogFeedQueryResults = internalMutation({
  args: {
    materializationKey: v.string(),
    expectedScannedEntryCount: v.number(),
    scannedCount: v.number(),
    payloads: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.expectedScannedEntryCount) ||
      args.expectedScannedEntryCount < 0 ||
      !Number.isSafeInteger(args.scannedCount) ||
      args.scannedCount < 0 ||
      args.scannedCount > CATALOG_FEED_QUERY_SCAN_PAGE_SIZE ||
      args.payloads.length > args.scannedCount
    ) {
      throw new Error("Catalog feed query result batch is invalid");
    }
    const materialization = await ctx.db
      .query("catalogFeedQueryMaterializations")
      .withIndex("by_materialization_key", (q) =>
        q.eq("materializationKey", args.materializationKey),
      )
      .unique();
    if (
      !materialization ||
      materialization.status !== "building" ||
      materialization.scannedEntryCount !== args.expectedScannedEntryCount ||
      materialization.expirationTime <= Date.now()
    ) {
      throw new Error("Catalog feed query materialization changed while building");
    }
    for (const [offset, payload] of args.payloads.entries()) {
      await ctx.db.insert("catalogFeedQueryResults", {
        materializationId: materialization._id,
        ordinal: materialization.resultCount + offset,
        payload,
        expirationTime: materialization.expirationTime,
      });
    }
    const scannedEntryCount = materialization.scannedEntryCount + args.scannedCount;
    const resultCount = materialization.resultCount + args.payloads.length;
    if (scannedEntryCount > materialization.expectedEntryCount) {
      throw new Error("Catalog feed query scan exceeded its pinned revision");
    }
    await ctx.db.patch(materialization._id, { scannedEntryCount, resultCount });
    return { scannedEntryCount, resultCount };
  },
});

export const finalizeCatalogFeedQueryMaterialization = internalMutation({
  args: { materializationKey: v.string() },
  handler: async (ctx, args) => {
    const materialization = await ctx.db
      .query("catalogFeedQueryMaterializations")
      .withIndex("by_materialization_key", (q) =>
        q.eq("materializationKey", args.materializationKey),
      )
      .unique();
    if (
      !materialization ||
      materialization.status !== "building" ||
      materialization.scannedEntryCount !== materialization.expectedEntryCount ||
      materialization.expirationTime <= Date.now()
    ) {
      throw new Error("Catalog feed query materialization is incomplete");
    }
    await ctx.db.patch(materialization._id, { status: "ready" });
    return {
      materializationKey: materialization.materializationKey,
      feedId: materialization.feedId,
      sequence: materialization.sequence,
      query: materialization.query,
      querySha256: materialization.querySha256,
      resultCount: materialization.resultCount,
      expirationTime: materialization.expirationTime,
    };
  },
});

export const materializeCatalogFeedQuery = internalAction({
  args: {
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
    query: v.string(),
    expirationTime: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    materializationKey: string;
    feedId: string;
    sequence: number;
    query: string;
    querySha256: string;
    resultCount: number;
    expirationTime: number;
  }> => {
    const query = normalizeCatalogFeedQuery(JSON.parse(args.query));
    const queryJson = JSON.stringify(query);
    if (queryJson !== args.query) throw new Error("Catalog feed query must be normalized");
    const querySha256 = await sha256Hex(new TextEncoder().encode(queryJson));
    const revision: { sequence: number; entryCount: number; expiresAt: string } | null =
      await ctx.runQuery(internal.catalogFeed.getCatalogFeedQueryRevision, { feedId: args.feedId });
    if (!revision) throw new Error("Catalog feed query index is unavailable");
    const expirationTime = Math.min(args.expirationTime, Date.parse(revision.expiresAt));
    if (!Number.isFinite(expirationTime) || expirationTime <= Date.now()) {
      throw new Error("Catalog feed query revision has expired");
    }
    const materializationKey = await sha256Hex(
      new TextEncoder().encode(
        `${args.feedId}\0${revision.sequence}\0${queryJson}\0${crypto.randomUUID()}`,
      ),
    );
    await ctx.runMutation(internal.catalogFeed.beginCatalogFeedQueryMaterialization, {
      materializationKey,
      feedId: args.feedId,
      sequence: revision.sequence,
      query: queryJson,
      querySha256,
      expirationTime,
    });
    let cursor: string | null = null;
    let scannedEntryCount = 0;
    while (true) {
      const page: {
        scannedCount: number;
        matches: string[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.catalogFeed.scanCatalogFeedQueryIndex, {
        feedId: args.feedId,
        sequence: revision.sequence,
        query: queryJson,
        paginationOpts: { cursor, numItems: CATALOG_FEED_QUERY_SCAN_PAGE_SIZE },
      });
      const appended: { scannedEntryCount: number; resultCount: number } = await ctx.runMutation(
        internal.catalogFeed.appendCatalogFeedQueryResults,
        {
          materializationKey,
          expectedScannedEntryCount: scannedEntryCount,
          scannedCount: page.scannedCount,
          payloads: page.matches,
        },
      );
      scannedEntryCount = appended.scannedEntryCount;
      if (page.isDone) break;
      if (!page.continueCursor) throw new Error("Catalog feed query index scan did not advance");
      cursor = page.continueCursor;
    }
    return await ctx.runMutation(internal.catalogFeed.finalizeCatalogFeedQueryMaterialization, {
      materializationKey,
    });
  },
});

export const listCatalogFeedQueryResults = internalQuery({
  args: {
    materializationKey: v.string(),
    feedId: v.union(v.literal(CATALOG_FEED_ID), v.literal(CATALOG_SKILLS_FEED_ID)),
    sequence: v.number(),
    querySha256: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > CATALOG_FEED_QUERY_MAX_ENTRIES
    ) {
      throw new Error("Catalog feed query result page size is invalid");
    }
    const materialization = await ctx.db
      .query("catalogFeedQueryMaterializations")
      .withIndex("by_materialization_key", (q) =>
        q.eq("materializationKey", args.materializationKey),
      )
      .unique();
    if (
      !materialization ||
      materialization.status !== "ready" ||
      materialization.feedId !== args.feedId ||
      materialization.sequence !== args.sequence ||
      materialization.querySha256 !== args.querySha256 ||
      materialization.expirationTime <= Date.now()
    ) {
      return { unavailable: true as const };
    }
    const page = await ctx.db
      .query("catalogFeedQueryResults")
      .withIndex("by_materialization_ordinal", (q) =>
        q.eq("materializationId", materialization._id),
      )
      .paginate(args.paginationOpts);
    return {
      unavailable: false as const,
      resultCount: materialization.resultCount,
      query: materialization.query,
      expirationTime: materialization.expirationTime,
      page: page.page.map(({ ordinal, payload }) => ({ ordinal, payload })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const pruneCatalogFeedHistoryInternal = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? CATALOG_FEED_CHANGE_PAGE_SIZE;
    if (
      !Number.isSafeInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > CATALOG_FEED_CHANGE_PAGE_SIZE
    ) {
      throw new Error(
        `Catalog feed prune batch size must be between 1 and ${CATALOG_FEED_CHANGE_PAGE_SIZE}`,
      );
    }
    const now = Date.now();
    // Retire the revision marker first so readers reset instead of observing a
    // revision whose journal rows are only partially retained.
    const revisions = await ctx.db
      .query("catalogFeedRevisions")
      .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
      .take(batchSize);
    const changes =
      revisions.length < batchSize
        ? await ctx.db
            .query("catalogFeedChanges")
            .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
            .take(batchSize - revisions.length)
        : [];
    let remaining = batchSize - revisions.length - changes.length;
    const indexedEntries =
      remaining > 0
        ? await ctx.db
            .query("catalogFeedIndexedEntries")
            .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
            .take(remaining)
        : [];
    remaining -= indexedEntries.length;
    const queryResults =
      remaining > 0
        ? await ctx.db
            .query("catalogFeedQueryResults")
            .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
            .take(remaining)
        : [];
    remaining -= queryResults.length;
    const materializations =
      remaining > 0
        ? await ctx.db
            .query("catalogFeedQueryMaterializations")
            .withIndex("by_expiration_time", (q) => q.lt("expirationTime", now))
            .take(remaining)
        : [];
    const rows = [
      ...revisions,
      ...changes,
      ...indexedEntries,
      ...queryResults,
      ...materializations,
    ];
    for (const row of rows) await ctx.db.delete(row._id);
    const deleted = rows.length;
    const hasMore = deleted === batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.catalogFeed.pruneCatalogFeedHistoryInternal, {
        batchSize,
      });
    }
    return { deleted, hasMore };
  },
});

export const publish = internalAction({
  args: {
    expiresAt: v.string(),
  },
  handler: async (ctx, args): Promise<CatalogFeedPublicationResult[]> => {
    const generatedAt = new Date().toISOString();
    const familyEntries: CatalogFeedEntry[][] = await Promise.all(
      CATALOG_FEED_FAMILIES.map(async (family) => {
        const entries: CatalogFeedEntry[] = await ctx.runQuery(
          internal.catalogFeed.listOfficialEntries,
          { family },
        );
        return entries;
      }),
    );
    const entries = familyEntries.flat();
    if (entries.length > MAX_CATALOG_FEED_ENTRIES) {
      throw new Error(`Catalog feed exceeds ${MAX_CATALOG_FEED_ENTRIES} entries`);
    }
    const skillEntries: CatalogFeedSkillEntry[] = [];
    const seenPublisherIds = new Set<string>();
    let publisherCursor: string | null = null;
    // The skills feed currently ships as one bounded snapshot. Cap it instead
    // of blocking the plugin feed refresh until skills pagination/sharding lands.
    publisherLoop: while (true) {
      const publisherPage: {
        publishers: Doc<"publishers">[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.catalogFeed.listOfficialPublisherPage, {
        cursor: publisherCursor,
      });
      for (const publisher of publisherPage.publishers) {
        if (seenPublisherIds.has(publisher._id)) continue;
        seenPublisherIds.add(publisher._id);
        let skillCursor: string | null = null;
        while (true) {
          const skillPage: {
            entries: CatalogFeedSkillEntry[];
            isDone: boolean;
            continueCursor: string;
          } = await ctx.runQuery(internal.catalogFeed.listOfficialSkillEntries, {
            publisherId: publisher._id,
            cursor: skillCursor,
          });
          if (!appendEntriesWithinFeedLimit(skillEntries, skillPage.entries)) break publisherLoop;
          if (skillPage.isDone) break;
          skillCursor = skillPage.continueCursor;
        }
      }
      if (publisherPage.isDone) break;
      publisherCursor = publisherPage.continueCursor;
    }

    const pluginEntries = entries.sort((left, right) => left.id.localeCompare(right.id));
    const sortedSkillEntries = skillEntries.sort((left, right) => left.id.localeCompare(right.id));
    const pluginResult: CatalogFeedPublicationResult = await ctx.runMutation(
      internal.catalogFeed.storePublication,
      {
        feedId: CATALOG_FEED_ID,
        description: CATALOG_FEED_DESCRIPTION,
        generatedAt,
        expiresAt: args.expiresAt,
        entries: pluginEntries,
      },
    );
    const skillsResult: CatalogFeedPublicationResult = await ctx.runMutation(
      internal.catalogFeed.storePublication,
      {
        feedId: CATALOG_SKILLS_FEED_ID,
        description: CATALOG_SKILLS_FEED_DESCRIPTION,
        generatedAt,
        expiresAt: args.expiresAt,
        entries: sortedSkillEntries,
      },
    );
    for (const [result, feedEntries] of [
      [pluginResult, pluginEntries],
      [skillsResult, sortedSkillEntries],
    ] as const) {
      for (
        let startOrdinal = 0;
        startOrdinal < feedEntries.length;
        startOrdinal += CATALOG_FEED_QUERY_SCAN_PAGE_SIZE
      ) {
        await ctx.runMutation(internal.catalogFeed.appendCatalogFeedIndexBatch, {
          feedId: result.feedId,
          sequence: result.sequence,
          startOrdinal,
          entries: feedEntries.slice(
            startOrdinal,
            startOrdinal + CATALOG_FEED_QUERY_SCAN_PAGE_SIZE,
          ),
        });
      }
      await ctx.runMutation(internal.catalogFeed.finalizeCatalogFeedIndex, {
        feedId: result.feedId,
        sequence: result.sequence,
        entryCount: feedEntries.length,
      });
    }
    return [pluginResult, skillsResult];
  },
});

export const getLatestPublication = internalQuery({
  args: {
    feedId: v.union(
      v.literal(CATALOG_FEED_ID),
      v.literal(CATALOG_SKILLS_FEED_ID),
      v.literal(PROMOTIONS_FEED_ID),
    ),
  },
  handler: async (ctx, args) =>
    await ctx.db
      .query("catalogFeedPublications")
      .withIndex("by_feed", (q) => q.eq("feedId", args.feedId))
      .unique(),
});

export const __test = { buildCatalogFeedChanges };
