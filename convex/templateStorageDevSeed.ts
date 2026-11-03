import { TemplateManifestSummarySchema } from "clawhub-schema";
import { v } from "convex/values";
import historical from "../fixtures/templates/historical-published-v1.json";
import { internal } from "./_generated/api";
import { env } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { parseClawPack, sha256Hex } from "./lib/clawpack";
import { assertLocalDevSeedAllowed } from "./lib/devSeed";
import { TEMPLATE_FEED_STORAGE_ID } from "./lib/templateStorage";

const historicalSummary = TemplateManifestSummarySchema.assert(
  historical.entry.clawManifestSummary,
);

function assertLocalHistoricalFixture() {
  assertLocalDevSeedAllowed("historical Template storage");
  const host = new URL(env.CONVEX_SITE_URL).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error("Historical storage fixtures require an isolated localhost backend");
  }
}

/** Local-only fixture: admit original published bytes, never publish or modify a production archive. */
export const seedHistoricalArchiveInternal = internalAction({
  args: { archive: v.bytes() },
  handler: async (
    ctx,
    args,
  ): Promise<{ packageId: string; releaseId: string; publisherId: string }> => {
    assertLocalHistoricalFixture();
    const bytes = new Uint8Array(args.archive);
    const sha256 = await sha256Hex(bytes);
    const expected = historical.entry.install.candidates[0].integrity;
    if (`sha256:${sha256}` !== expected)
      throw new Error("Fixture must use the exact observed historical archive");
    const archiveId = await ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type: "application/gzip" }),
    );
    const parsed = await parseClawPack(bytes);
    const files = [];
    for (const entry of parsed.entries) {
      const storageId = await ctx.storage.store(new Blob([new Uint8Array(entry.bytes)]));
      files.push({
        path: entry.path,
        storageId,
        sha256: await sha256Hex(entry.bytes),
        size: entry.bytes.length,
      });
    }
    return await ctx.runMutation(internal.templateStorageDevSeed.insertHistoricalArchiveInternal, {
      archiveId,
      sha256,
      size: bytes.length,
      npmIntegrity: parsed.npmIntegrity,
      npmShasum: parsed.npmShasum,
      npmTarballName: parsed.npmTarballName,
      npmUnpackedSize: parsed.unpackedSize,
      npmFileCount: parsed.fileCount,
      files,
    });
  },
});

export const insertHistoricalArchiveInternal = internalMutation({
  args: {
    archiveId: v.id("_storage"),
    sha256: v.string(),
    size: v.number(),
    npmIntegrity: v.string(),
    npmShasum: v.string(),
    npmTarballName: v.string(),
    npmUnpackedSize: v.number(),
    npmFileCount: v.number(),
    files: v.array(
      v.object({
        path: v.string(),
        storageId: v.id("_storage"),
        sha256: v.string(),
        size: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    assertLocalHistoricalFixture();
    if (`sha256:${args.sha256}` !== historical.entry.install.candidates[0].integrity)
      throw new Error("Historical fixture digest mismatch");
    const ownerUserId = await ctx.db.insert("users", {
      handle: "historical-storage-fixture",
      role: "admin",
    });
    const publisher = await ctx.db
      .query("publishers")
      .withIndex("by_active_kind_handle", (q) =>
        q
          .eq("deletedAt", undefined)
          .eq("deactivatedAt", undefined)
          .eq("kind", "org")
          .eq("handle", "openclaw"),
      )
      .unique();
    const publisherId =
      publisher?._id ??
      (await ctx.db.insert("publishers", {
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        createdAt: 1,
        updatedAt: 1,
      }));
    const official = await ctx.db
      .query("officialPublishers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
      .unique();
    if (!official)
      await ctx.db.insert("officialPublishers", { publisherId, createdAt: 1, updatedAt: 1 });
    const packageId = await ctx.db.insert("packages", {
      name: historical.entry.id,
      normalizedName: historical.entry.id,
      displayName: historical.entry.title,
      family: "claw",
      clawProfilePolicyVersion: 1,
      ownerUserId,
      ownerPublisherId: publisherId,
      channel: "official",
      isOfficial: true,
      scanStatus: "clean",
      summary: historical.entry.clawManifestSummary.agent.description,
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: historical.entry.version,
      publicationStatus: "published",
      changelog: "Historical fixture",
      distTags: ["latest"],
      files: args.files,
      integritySha256: args.sha256,
      artifactKind: "npm-pack",
      clawpackStorageId: args.archiveId,
      clawpackSha256: args.sha256,
      clawpackSize: args.size,
      clawpackFormat: "tgz",
      npmIntegrity: args.npmIntegrity,
      npmShasum: args.npmShasum,
      npmTarballName: args.npmTarballName,
      npmUnpackedSize: args.npmUnpackedSize,
      npmFileCount: args.npmFileCount,
      clawManifestSummary: historicalSummary,
      verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
      createdAt: 1,
      createdBy: ownerUserId,
    });
    await ctx.db.patch(packageId, {
      latestReleaseId: releaseId,
      latestVersionSummary: {
        version: historical.entry.version,
        createdAt: 1,
        changelog: "Historical fixture",
      },
      tags: { latest: releaseId },
    });
    const payload = JSON.stringify({
      schemaVersion: 1,
      id: TEMPLATE_FEED_STORAGE_ID,
      sequence: 59,
      generatedAt: historical.source.generatedAt,
      expiresAt: "2026-10-29T00:46:01.333Z",
      entries: [historical.entry],
    });
    await ctx.db.insert("catalogFeedPublications", {
      feedId: TEMPLATE_FEED_STORAGE_ID,
      sequence: 59,
      generatedAt: historical.source.generatedAt,
      expiresAt: "2026-10-29T00:46:01.333Z",
      payload,
      payloadSha256: await sha256Hex(new TextEncoder().encode(payload)),
      publishedAt: 1,
      clawPolicyVersion: 1,
      clawEntryCount: 1,
      clawPublisherId: publisherId,
    });
    return { packageId, releaseId, publisherId };
  },
});

export const readHistoricalFixtureInternal = internalQuery({
  args: { packageId: v.id("packages"), releaseId: v.id("packageReleases") },
  handler: async (ctx, args) => {
    assertLocalHistoricalFixture();
    return {
      package: await ctx.db.get(args.packageId),
      release: await ctx.db.get(args.releaseId),
      feed: await ctx.db
        .query("catalogFeedPublications")
        .withIndex("by_feed", (q) => q.eq("feedId", TEMPLATE_FEED_STORAGE_ID))
        .unique(),
    };
  },
});
