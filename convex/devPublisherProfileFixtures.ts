/** Reusable local browser fixture: one publisher that owns both plugins and templates. */
import { internalMutation } from "./functions";
import { isLocalDevAuthEnabled } from "./lib/devAuth";
import { ensurePersonalPublisherForUser } from "./lib/publishers";

const MIXED_CATALOG_FIXTURE_HANDLE = "mixed-catalog-builder";

const FIXTURE_PACKAGES = [
  {
    name: "@mixed-catalog-builder/travel-copilot",
    displayName: "Travel Copilot",
    summary: "Plans trips, tracks bookings, and keeps an itinerary current.",
    family: "claw",
    channel: "community",
    downloads: 20,
  },
  {
    name: "@mixed-catalog-builder/celebration-coordinator",
    displayName: "Celebration Coordinator",
    summary: "Coordinates guest lists, gifts, and timelines for celebrations.",
    family: "claw",
    channel: "community",
    downloads: 9,
  },
  {
    // Older templates were published without a publisher scope.
    name: "mixed-catalog-meal-planner",
    displayName: "Everyday Meal Planner",
    summary: "Builds weekly menus and shopping lists around household preferences.",
    family: "claw",
    channel: "community",
    downloads: 8,
  },
  {
    name: "@mixed-catalog-builder/unreleased-template",
    displayName: "Unreleased Template",
    summary: "Private template that public profiles must not list.",
    family: "claw",
    channel: "private",
    downloads: 30,
  },
  {
    name: "mixed-catalog-pet",
    displayName: "OpenClaw Pet",
    summary: "A desktop companion that reacts to agent activity.",
    family: "code-plugin",
    channel: "community",
    downloads: 49,
  },
  {
    name: "mixed-catalog-travel-themes",
    displayName: "Travel Themes",
    summary: "Destination-inspired color themes.",
    family: "bundle-plugin",
    channel: "community",
    downloads: 16,
  },
  {
    name: "@mixed-catalog-builder/artemis-canopy-theme",
    displayName: "Artemis Canopy",
    summary: "A forest-canopy theme.",
    family: "bundle-plugin",
    channel: "community",
    downloads: 6,
  },
] as const;

export const seedMixedCatalogPublisher = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!isLocalDevAuthEnabled()) throw new Error("Local publisher profile fixture only");
    const now = 1794513600000;
    const existingUser = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", MIXED_CATALOG_FIXTURE_HANDLE))
      .first();
    const userId =
      existingUser?._id ??
      (await ctx.db.insert("users", {
        handle: MIXED_CATALOG_FIXTURE_HANDLE,
        displayName: "Mixed Catalog Builder (local fixture)",
        bio: "Simulated local publisher with plugins and templates.",
        createdAt: now,
        updatedAt: now,
      }));
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Publisher profile fixture user was not created");
    const publisher = await ensurePersonalPublisherForUser(ctx, user);
    if (!publisher) throw new Error("Publisher profile fixture publisher was not created");

    const verification = {
      tier: "structural" as const,
      scope: "artifact-only" as const,
      scanStatus: "clean" as const,
    };
    let inserted = 0;
    for (const spec of FIXTURE_PACKAGES) {
      const normalizedName = spec.name.toLowerCase();
      const existing = await ctx.db
        .query("packages")
        .withIndex("by_name", (q) => q.eq("normalizedName", normalizedName))
        .unique();
      if (existing) continue;
      await ctx.db.insert("packages", {
        name: spec.name,
        normalizedName,
        displayName: spec.displayName,
        summary: spec.summary,
        ownerUserId: userId,
        ownerPublisherId: publisher._id,
        family: spec.family,
        channel: spec.channel,
        isOfficial: false,
        tags: {},
        verification,
        scanStatus: "clean",
        stats: { downloads: spec.downloads, installs: 1, stars: 0, versions: 1 },
        latestVersionSummary: {
          version: "1.0.0",
          createdAt: now,
          changelog: "Simulated local browser fixture",
          verification,
        },
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }
    return { handle: publisher.handle, inserted, simulated: true };
  },
});
