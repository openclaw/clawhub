/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./functions";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import schema from "./schema";

// The fixture mutation uses the production trigger wrapper. Its only job is to
// make a field-only transition so a parent patch cannot mask missing invalidation.
const patchVersion = internalMutation({
  args: {
    versionId: v.id("skillVersions"),
    patch: v.object({
      publicationStatus: v.optional(
        v.union(v.literal("pending"), v.literal("published"), v.literal("blocked")),
      ),
      ownerDeletedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { versionId, patch }) => ctx.db.patch(versionId, patch),
});
const modules = {
  ...import.meta.glob("./**/*.ts"),
  "./publicationDigestFixture.ts": async () => ({ patchVersion }),
};
const patchVersionRef = makeFunctionReference<
  "mutation",
  {
    versionId: Id<"skillVersions">;
    patch: { publicationStatus?: "pending" | "published" | "blocked"; ownerDeletedAt?: number };
  }
>("publicationDigestFixture:patchVersion");

async function fixture(options: { pendingReview?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "digest-owner" });
    const skillId = await ctx.db.insert("skills", {
      slug: "digest-visibility",
      displayName: "Digest visibility",
      ownerUserId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      moderationReason: options.pendingReview ? "pending.scan" : undefined,
      stats: { versions: 2, downloads: 0, stars: 0, comments: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
    const common = {
      skillId,
      files: [],
      parsed: { frontmatter: {} },
      createdBy: ownerUserId,
      llmAnalysis: { status: "clean", checkedAt: 1 },
    };
    const olderId = await ctx.db.insert("skillVersions", {
      ...common,
      publicationStatus: "published",
      version: "1.0.0",
      changelog: "Approved",
      createdAt: 1,
    });
    const latestId = await ctx.db.insert("skillVersions", {
      ...common,
      publicationStatus: options.pendingReview ? "pending" : "published",
      version: "2.0.0",
      changelog: "Latest",
      createdAt: 2,
    });
    await ctx.db.patch(skillId, {
      latestVersionId: latestId,
      latestVersionSummary: { version: "2.0.0", changelog: "Latest", createdAt: 2 },
      moderationSourceVersionId: options.pendingReview ? latestId : undefined,
    });
    await syncSkillSearchDigestForSkill(ctx, await ctx.db.get(skillId));
    return { skillId, latestId, olderId };
  });
  return { t, ...ids };
}

async function listedVersion(t: Awaited<ReturnType<typeof fixture>>["t"]) {
  const page = await t.query(api.skills.listPublicApiPageV1, { sort: "newest", numItems: 10 });
  return page.items[0]?.latestVersion?.version ?? null;
}

it.each(["pending", "blocked"] as const)(
  "invalidates cached published metadata on a publication-only transition to %s",
  async (publicationStatus) => {
    const f = await fixture();
    expect(await listedVersion(f.t)).toBe("2.0.0");
    await f.t.mutation(patchVersionRef, { versionId: f.latestId, patch: { publicationStatus } });
    expect(await listedVersion(f.t)).toBeNull();
    await f.t.mutation(patchVersionRef, {
      versionId: f.latestId,
      patch: { publicationStatus: "published" },
    });
    expect(await listedVersion(f.t)).toBe("2.0.0");
  },
);

it("invalidates cached published metadata on an owner-withdrawal-only transition", async () => {
  const f = await fixture();
  expect(await listedVersion(f.t)).toBe("2.0.0");
  await f.t.mutation(patchVersionRef, { versionId: f.latestId, patch: { ownerDeletedAt: 3 } });
  expect(await listedVersion(f.t)).toBeNull();
});

it("keeps the approved fallback while a newer publication remains under review", async () => {
  const f = await fixture({ pendingReview: true });
  expect(await listedVersion(f.t)).toBe("1.0.0");
  await f.t.mutation(patchVersionRef, {
    versionId: f.latestId,
    patch: { publicationStatus: "blocked" },
  });
  expect(await listedVersion(f.t)).toBe("1.0.0");
});
