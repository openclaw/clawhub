import {
  CATALOG_FEED_GITHUB_SOURCE_REF,
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SOURCE_REF,
  CATALOG_SKILLS_FEED_DESCRIPTION,
  CATALOG_SKILLS_FEED_ID,
  parseCatalogFeed,
  PROMOTIONS_FEED_ID,
  serializeCatalogFeed,
  type CatalogFeedChange,
  type CatalogFeedEntry,
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
const CATALOG_FEED_FAMILIES = ["code-plugin", "bundle-plugin"] as const;

type CatalogQueryCtx = Pick<QueryCtx, "db">;
type CatalogFeedPublicationResult = {
  publicationId: string;
  feedId: string;
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
  version: v.string(),
  state: v.union(
    v.literal("available"),
    v.literal("recommended"),
    v.literal("disabled"),
    v.literal("blocked"),
    v.literal("deprecated"),
  ),
  featured: v.optional(v.boolean()),
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
    version,
    state: "available",
    featured: Boolean(highlighted),
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
      version: commit,
      state: "available",
      featured: isSkillHighlighted(skill),
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
    version: versionName,
    state: "available",
    featured: isSkillHighlighted(skill),
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
      .paginate(args.paginationOpts);
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
    for (const row of [...revisions, ...changes]) await ctx.db.delete(row._id);
    const deleted = changes.length + revisions.length;
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

    const pluginResult: CatalogFeedPublicationResult = await ctx.runMutation(
      internal.catalogFeed.storePublication,
      {
        feedId: CATALOG_FEED_ID,
        description: CATALOG_FEED_DESCRIPTION,
        generatedAt,
        expiresAt: args.expiresAt,
        entries: entries.sort((left, right) => left.id.localeCompare(right.id)),
      },
    );
    const skillsResult: CatalogFeedPublicationResult = await ctx.runMutation(
      internal.catalogFeed.storePublication,
      {
        feedId: CATALOG_SKILLS_FEED_ID,
        description: CATALOG_SKILLS_FEED_DESCRIPTION,
        generatedAt,
        expiresAt: args.expiresAt,
        entries: skillEntries.sort((left, right) => left.id.localeCompare(right.id)),
      },
    );
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
