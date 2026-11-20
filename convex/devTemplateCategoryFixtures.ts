/**
 * Local rehearsal state for the 2026-11-18 Template category backfill: the mapped community
 * listings as they were stored before it, first-party listings that keep removed and multiple
 * categories, and two community listings outside the mapping. Never usable against cloud
 * deployments. Remove with the backfill.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./functions";
import { isLocalDevAuthEnabled } from "./lib/devAuth";
import { getPublisherByHandle } from "./lib/publishers";
import { TEMPLATE_CATEGORY_BACKFILL } from "./lib/templateCategoryBackfill";

const FIRST_PARTY = [
  { name: "@openclaw/budget-coach", categories: ["finance"] },
  { name: "@openclaw/day-planner", categories: ["personal", "productivity"] },
  { name: "@openclaw/hiring-coordinator", categories: ["people"] },
  { name: "@openclaw/policy-reviewer", categories: ["governance", "operations"] },
  { name: "@openclaw/trip-planner", categories: ["travel"] },
];
// Community listings the mapping does not name, as if published after it was reviewed. The
// backfill never writes these; the first is in an old shape and belongs in its report.
const UNMAPPED = [
  { name: "@late-publisher/weekend-planner", categories: ["personal", "productivity"] },
  { name: "@late-publisher/standup-notes", categories: ["productivity"] },
];
const LISTINGS = [
  ...TEMPLATE_CATEGORY_BACKFILL.map(({ name, owner, expectedCurrent }) => ({
    name,
    owner,
    categories: [...expectedCurrent],
  })),
  ...FIRST_PARTY.map((listing) => ({ ...listing, owner: "openclaw" })),
  ...UNMAPPED.map((listing) => ({ ...listing, owner: "late-publisher" })),
];
const slugOf = (name: string) => name.split("/").at(-1) ?? name;
const titleOf = (name: string) =>
  slugOf(name)
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const seed = internalAction({
  args: {},
  handler: async (ctx): Promise<{ simulated: true; inserted: string[]; existing: string[] }> => {
    if (!isLocalDevAuthEnabled()) throw new Error("Local Template category fixture only");
    const listings = [];
    for (const listing of LISTINGS) {
      // The manifest keeps the list its author declared, as the published artifacts still do.
      const contents =
        `---\nschemaVersion: 1\nagent:\n  id: ${slugOf(listing.name)}\n  name: ${titleOf(listing.name)}\n` +
        `  description: Simulated local fixture for ${listing.name}.\n` +
        `categories: [${listing.categories.join(", ")}]\n---\n# ${titleOf(listing.name)}\n\n` +
        "Simulated local fixture. Not the published Template.\n";
      listings.push({
        ...listing,
        size: new TextEncoder().encode(contents).length,
        storageId: await ctx.storage.store(new Blob([contents], { type: "text/markdown" })),
      });
    }
    return ctx.runMutation(internal.devTemplateCategoryFixtures.insert, { listings });
  },
});

export const insert = internalMutation({
  args: {
    listings: v.array(
      v.object({
        name: v.string(),
        owner: v.string(),
        categories: v.array(v.string()),
        size: v.number(),
        storageId: v.id("_storage"),
      }),
    ),
  },
  handler: async (ctx, { listings }) => {
    if (!isLocalDevAuthEnabled()) throw new Error("Local Template category fixture only");
    const now = Date.now();
    const owners = new Map<string, { userId: Id<"users">; publisherId: Id<"publishers"> }>();
    const inserted: string[] = [];
    const existing: string[] = [];
    for (const [index, listing] of listings.entries()) {
      const found = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", listing.name))
        .unique();
      if (found) {
        await ctx.storage.delete(listing.storageId);
        existing.push(listing.name);
        continue;
      }
      let owner = owners.get(listing.owner);
      if (!owner) {
        const official = listing.owner === "openclaw";
        const publisher = await getPublisherByHandle(ctx, listing.owner);
        const userId =
          publisher?.linkedUserId ??
          (await ctx.db.insert("users", {
            handle: official ? "openclaw-template-fixture" : listing.owner,
            name: `${listing.owner} (local fixture)`,
            createdAt: now,
            updatedAt: now,
          }));
        const publisherId =
          publisher?._id ??
          (await ctx.db.insert("publishers", {
            kind: official ? "org" : "user",
            handle: listing.owner,
            displayName: listing.owner,
            ...(official ? {} : { linkedUserId: userId }),
            createdAt: now,
            updatedAt: now,
          }));
        owner = { userId, publisherId };
        owners.set(listing.owner, owner);
      }
      const official = listing.owner === "openclaw";
      const verification = {
        tier: "structural" as const,
        scope: "artifact-only" as const,
        scanStatus: "clean" as const,
      };
      // Spread install counts so each overview row has a stable, visible order.
      const installs = (listings.length - index) * 3;
      const packageId = await ctx.db.insert("packages", {
        name: listing.name,
        normalizedName: listing.name,
        displayName: titleOf(listing.name),
        summary: `Simulated local fixture for ${listing.name}.`,
        ownerUserId: owner.userId,
        ownerPublisherId: owner.publisherId,
        family: "claw",
        channel: official ? "official" : "community",
        isOfficial: official,
        categories: listing.categories,
        tags: {},
        verification,
        scanStatus: "clean",
        stats: { downloads: installs * 4, installs, stars: 0, versions: 1 },
        createdAt: now,
        updatedAt: now,
      });
      const latestReleaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: "0.1.0",
        publicationStatus: "published",
        changelog: "Simulated local category fixture.",
        distTags: ["latest"],
        files: [
          {
            path: "CLAW.md",
            storageId: listing.storageId,
            size: listing.size,
            sha256: "local-template-category-fixture",
            contentType: "text/markdown",
          },
        ],
        integritySha256: "local-template-category-fixture",
        verification,
        createdBy: owner.userId,
        publishActor: { kind: "user", userId: owner.userId },
        createdAt: now,
      });
      await ctx.db.patch(packageId, {
        latestReleaseId,
        tags: { latest: latestReleaseId },
        latestVersionSummary: {
          version: "0.1.0",
          createdAt: now,
          changelog: "Simulated local category fixture.",
          verification,
        },
      });
      inserted.push(listing.name);
    }
    return { simulated: true as const, inserted, existing };
  },
});
