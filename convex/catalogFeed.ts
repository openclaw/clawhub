import {
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SOURCE_REF,
  serializeCatalogFeed,
  type CatalogFeedEntry,
} from "clawhub-schema";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { sha256Hex } from "./lib/clawpack";
import { getPackageReleaseArtifactSha256 } from "./lib/packageArtifacts";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./lib/packageSecurity";
import { isOfficialPublisher } from "./lib/officialPublishers";
import { getOwnerPublisher } from "./lib/publishers";

const CATALOG_FEED_DESCRIPTION = "Official OpenClaw plugins published on ClawHub.";
const CATALOG_FEED_PAGE_SIZE = 100;
const MAX_CATALOG_FEED_ENTRIES = 500;
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

const catalogFeedEntryValidator = v.object({
  type: v.literal("plugin"),
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
      }),
    ),
  }),
});

async function buildEntry(
  ctx: CatalogQueryCtx,
  pkg: Doc<"packages">,
): Promise<CatalogFeedEntry | null> {
  if (pkg.softDeletedAt || pkg.channel !== "official" || !pkg.latestReleaseId) return null;
  const release = await ctx.db.get(pkg.latestReleaseId);
  if (!release || release.softDeletedAt) return null;

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

export const listOfficialEntries = internalQuery({
  args: {
    family: v.union(v.literal("code-plugin"), v.literal("bundle-plugin")),
  },
  handler: async (ctx, args) => await listFamilyEntries(ctx, args.family),
});

export const storePublication = internalMutation({
  args: {
    generatedAt: v.string(),
    expiresAt: v.string(),
    entries: v.array(catalogFeedEntryValidator),
  },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("catalogFeedPublications")
      .withIndex("by_feed", (q) => q.eq("feedId", CATALOG_FEED_ID))
      .unique();
    const sequence = (latest?.sequence ?? 0) + 1;
    const payload = serializeCatalogFeed({
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      id: CATALOG_FEED_ID,
      generatedAt: args.generatedAt,
      sequence,
      expiresAt: args.expiresAt,
      description: CATALOG_FEED_DESCRIPTION,
      entries: args.entries,
    });
    const payloadSha256 = await sha256Hex(new TextEncoder().encode(payload));
    const publishedAt = Date.now();
    const publication = {
      feedId: CATALOG_FEED_ID,
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
    return {
      publicationId,
      feedId: CATALOG_FEED_ID,
      sequence,
      payloadSha256,
      publishedAt,
      entryCount: args.entries.length,
    };
  },
});

export const publish = internalAction({
  args: {
    expiresAt: v.string(),
  },
  handler: async (ctx, args): Promise<CatalogFeedPublicationResult> => {
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
    const result: CatalogFeedPublicationResult = await ctx.runMutation(
      internal.catalogFeed.storePublication,
      {
        generatedAt,
        expiresAt: args.expiresAt,
        entries: entries.sort((left, right) => left.id.localeCompare(right.id)),
      },
    );
    return result;
  },
});

export const getLatestPublication = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("catalogFeedPublications")
      .withIndex("by_feed", (q) => q.eq("feedId", CATALOG_FEED_ID))
      .unique(),
});
