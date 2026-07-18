import {
  CATALOG_FEED_GITHUB_SOURCE_REF,
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SOURCE_REF,
  CATALOG_SKILLS_FEED_DESCRIPTION,
  CATALOG_SKILLS_FEED_ID,
  PROMOTIONS_FEED_ID,
  parseCatalogFeed,
  serializeCatalogFeed,
  type CatalogFeed,
  type CatalogFeedEntry,
  type CatalogFeedSkillEntry,
} from "clawhub-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
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
const CATALOG_FEED_FAMILIES = ["code-plugin", "bundle-plugin"] as const;
const NOTIFICATION_MATERIALIZATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

type CatalogNotificationReason = "updated" | "removed" | "blocked" | "security-state-changed";
type CatalogNotificationChange = { itemId: string; reason: CatalogNotificationReason };

const CATALOG_SIGNED_STATE_URLS = {
  [CATALOG_FEED_ID]: "https://clawhub.ai/v1/feeds/plugins",
  [CATALOG_SKILLS_FEED_ID]: "https://clawhub.ai/v1/feeds/skills",
} as const;

type CatalogQueryCtx = Pick<QueryCtx, "db">;
type CatalogFeedPublicationResult = {
  publicationId: string;
  feedId: string;
  sequence: number;
  payloadSha256: string;
  publishedAt: number;
  entryCount: number;
  notificationChangeCount: number;
};

function installFingerprint(entry: CatalogFeedEntry) {
  return JSON.stringify(entry.install);
}

export function buildCatalogNotificationChanges(
  previous: CatalogFeed,
  next: CatalogFeed,
): CatalogNotificationChange[] {
  const nextById = new Map(next.entries.map((entry) => [entry.id, entry]));
  const changes: CatalogNotificationChange[] = [];
  for (const prior of previous.entries) {
    const current = nextById.get(prior.id);
    if (!current) {
      changes.push({ itemId: prior.id, reason: "removed" });
      continue;
    }
    if (current.state === "blocked" && prior.state !== "blocked") {
      changes.push({ itemId: prior.id, reason: "blocked" });
      continue;
    }
    if (
      current.state !== prior.state ||
      current.publisher.id !== prior.publisher.id ||
      current.publisher.trust !== prior.publisher.trust
    ) {
      changes.push({ itemId: prior.id, reason: "security-state-changed" });
      continue;
    }
    if (
      current.version !== prior.version ||
      installFingerprint(current) !== installFingerprint(prior)
    ) {
      changes.push({ itemId: prior.id, reason: "updated" });
    }
  }
  return changes;
}

function parsePreviousCatalogFeed(payload: string) {
  try {
    return parseCatalogFeed(JSON.parse(payload));
  } catch {
    // Notification history must not prevent a fresh catalog publication.
    return null;
  }
}

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

  return {
    type: "plugin",
    id,
    title,
    version,
    state: "available",
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
    const sequence = (latest?.sequence ?? 0) + 1;
    const nextFeed: CatalogFeed = {
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      id: args.feedId,
      generatedAt: args.generatedAt,
      sequence,
      expiresAt: args.expiresAt,
      description: args.description,
      entries: args.entries,
    };
    const payload = serializeCatalogFeed(nextFeed);
    const previousFeed = latest ? parsePreviousCatalogFeed(latest.payload) : null;
    const notificationChanges = previousFeed
      ? buildCatalogNotificationChanges(previousFeed, nextFeed)
      : [];
    const payloadSha256 = await sha256Hex(new TextEncoder().encode(payload));
    const publishedAt = Date.now();
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
    if (notificationChanges.length > 0) {
      const materializationId = await ctx.db.insert("feedNotificationMaterializations", {
        feedId: args.feedId,
        sequence,
        itemKind: args.feedId === CATALOG_SKILLS_FEED_ID ? "skill" : "plugin",
        signedStateUrl: CATALOG_SIGNED_STATE_URLS[args.feedId],
        changes: notificationChanges,
        nextChangeIndex: 0,
        createdAt: publishedAt,
        updatedAt: publishedAt,
        expiresAt: publishedAt + NOTIFICATION_MATERIALIZATION_RETENTION_MS,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.feedItemNotifications.processCatalogMaterializationInternal,
        { materializationId },
      );
    }
    return {
      publicationId,
      feedId: args.feedId,
      sequence,
      payloadSha256,
      publishedAt,
      entryCount: args.entries.length,
      notificationChangeCount: notificationChanges.length,
    };
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
