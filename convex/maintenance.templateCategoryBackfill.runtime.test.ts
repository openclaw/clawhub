/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { resolveDeclaredTemplateCategory } from "clawhub-schema/catalogMetadata";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  TEMPLATE_CATEGORY_BACKFILL,
  TEMPLATE_CATEGORY_BACKFILL_VERSION,
} from "./lib/templateCategoryBackfill";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const CONFIRM = "backfill-template-categories";
const AUDIT_ACTION = "package.template_categories.backfill";

type Listing = { name: string; owner: string; categories: string[]; topics?: string[] };

/** Publishes listings through the real release mutation, so the package trigger projects them. */
async function fixture(listings: Listing[]) {
  const t = convexTest({ schema, modules });
  const owners = new Map<string, { userId: Id<"users">; publisherId: Id<"publishers"> }>();
  const packageIds = new Map<string, Id<"packages">>();
  for (const listing of listings) {
    let owner = owners.get(listing.owner);
    if (!owner) {
      owner = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { handle: listing.owner });
        const publisherId = await ctx.db.insert("publishers", {
          kind: listing.owner === "openclaw" ? "org" : "user",
          handle: listing.owner,
          displayName: listing.owner,
          ...(listing.owner === "openclaw" ? {} : { linkedUserId: userId }),
          createdAt: 1,
          updatedAt: 1,
        });
        return { userId, publisherId };
      });
      owners.set(listing.owner, owner);
    }
    const slug = listing.name.split("/").at(-1) ?? listing.name;
    const { packageId } = await t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: owner.userId,
      ownerUserId: owner.userId,
      ownerPublisherId: owner.publisherId,
      name: listing.name,
      displayName: slug,
      family: "claw",
      version: "1.0.0",
      changelog: "Template category backfill fixture",
      tags: ["latest"],
      summary: "Fixture listing published before the category taxonomy changed.",
      categories: listing.categories,
      topics: listing.topics,
      channel: "community",
      files: [],
      integritySha256: "a".repeat(64),
      sha256hash: "a".repeat(64),
      artifactKind: "npm-pack",
      clawpackSha256: "a".repeat(64),
      clawManifestSummary: {
        schemaVersion: 1,
        agent: { id: slug, name: slug },
        workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
        packages: { skillCount: 0, pluginCount: 0 },
        mcpServerCount: 0,
        cronJobCount: 0,
      },
      verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
    });
    packageIds.set(listing.name, packageId);
  }
  const read = (name: string) =>
    t.run(async (ctx) => {
      const packageId = packageIds.get(name);
      if (!packageId) throw new Error("Unknown fixture listing: " + name);
      const pkg = await ctx.db.get(packageId);
      const digest = await ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", packageId))
        .unique();
      const topicFacets = await ctx.db
        .query("packageTopicSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", packageId))
        .collect();
      const audits = await ctx.db
        .query("auditLogs")
        .withIndex("by_target_action", (q) =>
          q.eq("targetType", "package").eq("targetId", packageId).eq("action", AUDIT_ACTION),
        )
        .collect();
      return {
        categories: pkg?.categories,
        updatedAt: pkg?.updatedAt,
        digestCategories: digest?.categories,
        topicFacetCategories: topicFacets.map((row) => row.categories),
        audits: audits.map(({ actorUserId, metadata }) => ({ actorUserId, metadata })),
      };
    });
  const run = (args: { dryRun?: boolean; confirm?: string } = {}) =>
    t.mutation(internal.maintenance.backfillTemplateCategoriesInternal, args);
  const listNames = async (category: string) => {
    const page = await t.query(internal.packages.listPageForViewerInternal, {
      family: "template",
      category,
      paginationOpts: { cursor: null, numItems: 100 },
    });
    return page.page.map((entry) => entry.name).sort();
  };
  return { t, read, run, listNames, packageIds };
}

const entry = (name: string) => {
  const found = TEMPLATE_CATEGORY_BACKFILL.find((candidate) => candidate.name === name);
  if (!found) throw new Error("Not in the backfill mapping: " + name);
  return found;
};
const asListed = (name: string, overrides: Partial<Listing> = {}): Listing => ({
  name,
  owner: entry(name).owner,
  categories: [...entry(name).expectedCurrent],
  ...overrides,
});
const resultFor = (
  outcome: { results: Array<{ name: string; status: string; reason?: string }> },
  name: string,
) => outcome.results.find((result) => result.name === name);

describe("Template category backfill mapping", () => {
  const current = new Set([
    "engineering",
    "operations",
    "household",
    "entertainment",
    "travel",
    "productivity",
    "research",
    "health",
    "sales",
    "product",
  ]);

  it("names 32 distinct community listings and moves each to one current category", () => {
    expect(TEMPLATE_CATEGORY_BACKFILL).toHaveLength(32);
    expect(new Set(TEMPLATE_CATEGORY_BACKFILL.map(({ name }) => name)).size).toBe(32);
    for (const { name, owner, expectedCurrent, next } of TEMPLATE_CATEGORY_BACKFILL) {
      expect(owner, name).not.toBe("openclaw");
      expect(name.startsWith("@openclaw/"), name).toBe(false);
      expect(next, name).toHaveLength(1);
      expect(current.has(next[0]), name).toBe(true);
      expect(expectedCurrent, name).not.toEqual(next);
    }
  });

  // The authors' CLAW.md files still declare the old lists. Republishing one unchanged takes
  // its first declared category, so the backfill must agree wherever that category survives.
  it("matches what republishing would assign wherever the first category is still current", () => {
    const remapped = TEMPLATE_CATEGORY_BACKFILL.filter(
      ({ expectedCurrent }) => resolveDeclaredTemplateCategory(expectedCurrent) === undefined,
    );
    const trimmed = TEMPLATE_CATEGORY_BACKFILL.filter(
      ({ expectedCurrent }) => resolveDeclaredTemplateCategory(expectedCurrent) !== undefined,
    );
    expect(trimmed).toHaveLength(21);
    for (const { name, expectedCurrent, next } of trimmed) {
      expect(next[0], name).toBe(resolveDeclaredTemplateCategory(expectedCurrent));
    }
    // These eleven led with a removed category, so a republish is classified and may differ
    // from the hand-picked target below. That is accepted.
    expect(Object.fromEntries(remapped.map(({ name, next }) => [name, next[0]]))).toEqual({
      "@ekinnee/campaign-keeper": "entertainment",
      "@ekinnee/language-conversation-partner": "entertainment",
      "@etzelm/job-application-coordinator": "productivity",
      "@jjjhenriksen/celebration-coordinator": "household",
      "@jjjhenriksen/meal-planner": "household",
      "@tssala23/cooking-companion": "household",
      "@tssala23/gaming-companion": "entertainment",
      "bernie-house-griffon": "household",
      meals: "household",
      "openclaw-music-manager": "entertainment",
      tutor: "entertainment",
    });
  });
});

describe("Template category backfill", () => {
  const listed = [
    asListed("@anmol0b/ci-failure-triager"),
    asListed("@donniefi/hopper"),
    asListed("@jjjhenriksen/meal-planner", { topics: ["Meal prep"] }),
    asListed("tutor"),
  ];

  it("reports what it would change without writing in a dry run", async () => {
    const { read, run, listNames } = await fixture(listed);
    const before = await read("tutor");
    for (const outcome of [await run(), await run({ dryRun: true })]) {
      expect(outcome).toMatchObject({
        ok: true,
        dryRun: true,
        confirmRequired: CONFIRM,
        version: TEMPLATE_CATEGORY_BACKFILL_VERSION,
        listings: 32,
        totals: { "would-change": 4, changed: 0, unchanged: 0, skipped: 28 },
      });
      expect(resultFor(outcome, "tutor")).toEqual({
        name: "tutor",
        status: "would-change",
        stored: ["personal", "research"],
        next: ["entertainment"],
      });
      expect(resultFor(outcome, "meals")).toMatchObject({ status: "skipped", reason: "not-found" });
    }
    expect(await read("tutor")).toEqual(before);
    expect(before.categories).toEqual(["personal", "research"]);
    expect(before.audits).toEqual([]);
    expect(await listNames("entertainment")).toEqual([]);
    expect(await listNames("personal")).toEqual([
      "@donniefi/hopper",
      "@jjjhenriksen/meal-planner",
      "tutor",
    ]);
  });

  it("refuses to apply without the confirmation", async () => {
    const { read, run } = await fixture(listed);
    await expect(run({ dryRun: false })).rejects.toThrow(CONFIRM);
    await expect(run({ dryRun: false, confirm: "yes" })).rejects.toThrow(CONFIRM);
    expect((await read("tutor")).categories).toEqual(["personal", "research"]);
  });

  it("rewrites the package, its digest and its topic facets, and audits each change", async () => {
    const { read, run, listNames, packageIds } = await fixture(listed);
    const before = await read("@jjjhenriksen/meal-planner");
    expect(before.topicFacetCategories).toEqual([["personal", "productivity"]]);

    const outcome = await run({ dryRun: false, confirm: CONFIRM });
    expect(outcome).toMatchObject({
      dryRun: false,
      totals: { "would-change": 0, changed: 4, unchanged: 0, skipped: 28 },
    });
    expect(outcome).not.toHaveProperty("confirmRequired");

    const mealPlanner = await read("@jjjhenriksen/meal-planner");
    expect(mealPlanner.categories).toEqual(["household"]);
    expect(mealPlanner.digestCategories).toEqual(["household"]);
    expect(mealPlanner.topicFacetCategories).toEqual([["household"]]);
    // A category rewrite is not a listing update and must not reorder "recently updated".
    expect(mealPlanner.updatedAt).toBe(before.updatedAt);
    expect(mealPlanner.audits).toEqual([
      {
        actorUserId: undefined,
        metadata: {
          repairVersion: TEMPLATE_CATEGORY_BACKFILL_VERSION,
          name: "@jjjhenriksen/meal-planner",
          previous: { categories: ["personal", "productivity"] },
          next: { categories: ["household"] },
        },
      },
    ]);
    for (const [name, next] of [
      ["@anmol0b/ci-failure-triager", "engineering"],
      ["@donniefi/hopper", "travel"],
      ["tutor", "entertainment"],
    ] as const) {
      const listing = await read(name);
      expect(listing.categories, name).toEqual([next]);
      expect(listing.digestCategories, name).toEqual([next]);
      expect(listing.audits, name).toHaveLength(1);
    }
    expect(packageIds.size).toBe(4);

    // Readers follow the projections: each listing left its old rows and joined one new row.
    expect(await listNames("household")).toEqual(["@jjjhenriksen/meal-planner"]);
    expect(await listNames("entertainment")).toEqual(["tutor"]);
    expect(await listNames("travel")).toEqual(["@donniefi/hopper"]);
    expect(await listNames("engineering")).toEqual(["@anmol0b/ci-failure-triager"]);
    for (const emptied of ["personal", "productivity", "research", "operations"]) {
      expect(await listNames(emptied), emptied).toEqual([]);
    }
  });

  it("changes nothing when it is run again", async () => {
    const { read, run } = await fixture(listed);
    await run({ dryRun: false, confirm: CONFIRM });
    const applied = await read("tutor");
    for (const again of [
      await run({ dryRun: false, confirm: CONFIRM }),
      await run({ dryRun: true }),
    ]) {
      expect(again.totals).toMatchObject({
        "would-change": 0,
        changed: 0,
        "would-resync": 0,
        resynced: 0,
        unchanged: 4,
        skipped: 28,
      });
      expect(resultFor(again, "tutor")).toMatchObject({
        status: "unchanged",
        stored: ["entertainment"],
      });
    }
    expect(await read("tutor")).toEqual(applied);
    expect(applied.audits).toHaveLength(1);
  });

  it("skips and reports a listing whose categories drifted since the mapping was reviewed", async () => {
    const { read, run } = await fixture([
      asListed("tutor", { categories: ["research"] }),
      asListed("@donniefi/hopper", { categories: ["personal", "travel"] }),
      asListed("@anmol0b/ci-failure-triager"),
    ]);
    for (const outcome of [await run(), await run({ dryRun: false, confirm: CONFIRM })]) {
      expect(resultFor(outcome, "tutor")).toEqual({
        name: "tutor",
        status: "skipped",
        reason: "categories-drifted",
        stored: ["research"],
        next: ["entertainment"],
      });
      // The same slugs in another order are a different publication, not the reviewed one.
      expect(resultFor(outcome, "@donniefi/hopper")).toMatchObject({
        status: "skipped",
        reason: "categories-drifted",
      });
    }
    expect(await read("tutor")).toMatchObject({ categories: ["research"], audits: [] });
    expect(await read("@donniefi/hopper")).toMatchObject({
      categories: ["personal", "travel"],
      digestCategories: ["personal", "travel"],
      audits: [],
    });
    // One drifted listing does not hold back the rest.
    expect((await read("@anmol0b/ci-failure-triager")).categories).toEqual(["engineering"]);
  });

  it("never rewrites a first-party listing or one that changed hands", async () => {
    const { read, run } = await fixture([
      asListed("tutor", { owner: "openclaw" }),
      asListed("meals", { owner: "someone-else" }),
      { name: "@openclaw/day-planner", owner: "openclaw", categories: ["personal", "people"] },
    ]);
    const outcome = await run({ dryRun: false, confirm: CONFIRM });
    expect(resultFor(outcome, "tutor")).toMatchObject({ status: "skipped", reason: "first-party" });
    expect(resultFor(outcome, "meals")).toMatchObject({
      status: "skipped",
      reason: "owner-changed",
    });
    expect(resultFor(outcome, "@openclaw/day-planner")).toBeUndefined();
    expect(outcome.totals).toMatchObject({ changed: 0, skipped: 32 });
    expect(await read("tutor")).toMatchObject({ categories: ["personal", "research"], audits: [] });
    expect(await read("meals")).toMatchObject({ categories: ["personal"], audits: [] });
    expect(await read("@openclaw/day-planner")).toMatchObject({
      categories: ["personal", "people"],
      digestCategories: ["personal", "people"],
      audits: [],
    });
  });

  it("repairs a projection that fell behind an already-rewritten package", async () => {
    const { t, read, run, packageIds } = await fixture([asListed("tutor")]);
    await run({ dryRun: false, confirm: CONFIRM });
    await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("packageSearchDigest")
        .withIndex("by_package", (q) => q.eq("packageId", packageIds.get("tutor")!))
        .unique();
      await ctx.db.patch(digest!._id, { categories: ["personal", "research"] });
    });
    expect((await run()).totals).toMatchObject({ "would-resync": 1, unchanged: 0 });
    expect((await read("tutor")).digestCategories).toEqual(["personal", "research"]);
    expect((await run({ dryRun: false, confirm: CONFIRM })).totals).toMatchObject({ resynced: 1 });
    const repaired = await read("tutor");
    expect(repaired.digestCategories).toEqual(["entertainment"]);
    // The package itself did not change, so there is nothing new to audit.
    expect(repaired.audits).toHaveLength(1);
    expect((await run()).totals).toMatchObject({ unchanged: 1, "would-resync": 0 });
  });
});
