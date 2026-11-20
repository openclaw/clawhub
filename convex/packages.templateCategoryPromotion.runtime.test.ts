/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Every Template publish is staged as a pending release whose categories were computed when it
// was staged. A release staged before the 2026-11-18 taxonomy deployed and promoted afterwards
// carries a list computed under the old rules. These tests go through promotion itself.
async function fixture() {
  const t = convexTest({ schema, modules });
  const { userId, publisherId } = await t.run(async (ctx) => {
    const createdUserId = await ctx.db.insert("users", { handle: "template-maker" });
    const createdPublisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "template-maker",
      displayName: "Template maker",
      linkedUserId: createdUserId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId: createdUserId, publisherId: createdPublisherId };
  });
  const stage = (
    slug: string,
    version: string,
    categories: string[],
    family: "claw" | "code-plugin" = "claw",
  ) =>
    t.mutation(internal.packages.insertReleaseInternal, {
      actorUserId: userId,
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      name: "@template-maker/" + slug,
      displayName: slug,
      family,
      ...(family === "code-plugin" ? { runtimeId: slug } : {}),
      version,
      publicationStatus: "pending",
      changelog: "Staged before the Template taxonomy changed",
      tags: ["latest"],
      summary: "Fixture staged under the earlier category rules.",
      categories,
      channel: "community",
      files: [],
      integritySha256: "a".repeat(64),
      sha256hash: "a".repeat(64),
      ...(family === "claw"
        ? {
            artifactKind: "npm-pack" as const,
            clawpackSha256: "a".repeat(64),
            clawManifestSummary: {
              schemaVersion: 1,
              agent: { id: slug, name: slug },
              workspace: { bootstrapFiles: ["SOUL.md"], fileCount: 1 },
              packages: { skillCount: 0, pluginCount: 0 },
              mcpServerCount: 0,
              cronJobCount: 0,
            },
          }
        : {}),
      verification: { tier: "source-linked", scope: "artifact-only", scanStatus: "clean" },
    });
  const promote = (releaseId: Id<"packageReleases">) =>
    t.mutation(internal.packages.publishPendingReleaseInternal, { releaseId });
  const read = (packageId: Id<"packages">) =>
    t.run(async (ctx) => ({
      categories: (await ctx.db.get(packageId))?.categories,
      digestCategories: (
        await ctx.db
          .query("packageSearchDigest")
          .withIndex("by_package", (q) => q.eq("packageId", packageId))
          .unique()
      )?.categories,
    }));
  const listNames = async (category: string) => {
    const page = await t.query(internal.packages.listPageForViewerInternal, {
      family: "template",
      category,
      paginationOpts: { cursor: null, numItems: 100 },
    });
    return page.page.map((entry) => entry.name).sort();
  };
  return { t, stage, promote, read, listNames };
}

describe("promoting a Template release staged under the earlier category rules", () => {
  it.each([
    { staged: ["travel", "personal"], stored: ["travel"] },
    { staged: ["engineering", "operations", "product"], stored: ["engineering"] },
    { staged: ["health", "made-up"], stored: ["health"] },
    { staged: ["household"], stored: ["household"] },
  ])("stores only the first category of $staged when it is current", async ({ staged, stored }) => {
    const { stage, promote, read, listNames } = await fixture();
    const { packageId, releaseId } = await stage("planner", "1.0.0", staged);
    await promote(releaseId);
    expect(await read(packageId)).toEqual({ categories: stored, digestCategories: stored });
    expect(await listNames(stored[0]!)).toEqual(["@template-maker/planner"]);
    for (const dropped of staged.slice(1)) expect(await listNames(dropped), dropped).toEqual([]);
  });

  // A mutation cannot classify. Writing "other" here would also make the backfill skip a mapped
  // listing as drifted, where the untouched list still matches what the mapping expects.
  it.each([
    { staged: ["personal", "productivity"] },
    { staged: ["governance"] },
    { staged: ["made-up", "travel"] },
    { staged: ["other"] },
  ])("leaves $staged as staged when its first category is not current", async ({ staged }) => {
    const { stage, promote, read } = await fixture();
    const { packageId, releaseId } = await stage("planner", "1.0.0", staged);
    await promote(releaseId);
    expect(await read(packageId)).toEqual({ categories: staged, digestCategories: staged });
  });

  it("applies the rule when a staged release replaces a published one", async () => {
    const { stage, promote, read, listNames } = await fixture();
    const first = await stage("planner", "1.0.0", ["household"]);
    await promote(first.releaseId);
    const next = await stage("planner", "1.1.0", ["travel", "personal"]);
    // Staging alone leaves the public listing as it was.
    expect((await read(first.packageId)).categories).toEqual(["household"]);
    await promote(next.releaseId);
    expect(await read(first.packageId)).toEqual({
      categories: ["travel"],
      digestCategories: ["travel"],
    });
    expect(await listNames("household")).toEqual([]);
    expect(await listNames("travel")).toEqual(["@template-maker/planner"]);
  });

  it("keeps the latest release's category when an older staged release finalizes late", async () => {
    const { stage, promote, read } = await fixture();
    const older = await stage("planner", "1.0.0", ["travel", "personal"]);
    const newer = await stage("planner", "2.0.0", ["health"]);
    await promote(newer.releaseId);
    await promote(older.releaseId);
    expect(await read(newer.packageId)).toEqual({
      categories: ["health"],
      digestCategories: ["health"],
    });
  });

  // "productivity" and "research" are also plugin categories; the Template rule must not trim them.
  it("does not apply the Template rule to a plugin", async () => {
    const { t, stage, promote } = await fixture();
    const { packageId, releaseId } = await stage(
      "notes-plugin",
      "1.0.0",
      ["productivity", "research"],
      "code-plugin",
    );
    await promote(releaseId);
    expect((await t.run(async (ctx) => ctx.db.get(packageId)))?.categories).toEqual([
      "productivity",
      "research",
    ]);
  });
});
