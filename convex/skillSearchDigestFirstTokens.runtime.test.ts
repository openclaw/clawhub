/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { getFirstSearchToken } from "./lib/skillSearchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// What a row written before ー joined the CJK class holds for this display name.
const STALE_FIRST_TOKEN = "デ";
const DISPLAY_NAME = "データベース管理";
const SLUG = "database-kanri";
// The backfill previews unless an apply is confirmed, so the runtime cases that expect
// writes have to opt in the same way an operator does.
const APPLY = {
  dryRun: false,
  confirm: "backfill-skill-search-digest-first-tokens",
} as const;

async function insertDigestWithStaleFirstToken(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      handle: "patrick",
      displayName: "Patrick",
      createdAt: now,
      updatedAt: now,
    });
    const skillId = await ctx.db.insert("skills", {
      slug: SLUG,
      displayName: DISPLAY_NAME,
      ownerUserId: userId,
      tags: {},
      stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
      createdAt: now,
      updatedAt: now,
    });
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      changelog: "Initial",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
      createdAt: now,
    });
    const digestId = await ctx.db.insert("skillSearchDigest", {
      skillId,
      slug: SLUG,
      displayName: DISPLAY_NAME,
      normalizedSlug: SLUG,
      normalizedSlugFirstToken: "database",
      normalizedDisplayName: DISPLAY_NAME,
      normalizedDisplayNameFirstToken: STALE_FIRST_TOKEN,
      ownerUserId: userId,
      ownerHandle: "patrick",
      ownerKind: "user",
      ownerName: "patrick",
      ownerDisplayName: "Patrick",
      latestVersionId: versionId,
      latestVersionSkillId: skillId,
      publicVersion: { status: "available", versionId },
      tags: {},
      stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
      createdAt: now,
      updatedAt: now,
    });
    return { digestId, skillId };
  });
}

describe("skillSearchDigest first-token resynchronization", () => {
  it("repairs a pre-existing row the current tokenizer no longer agrees with", async () => {
    const t = convexTest(schema, modules);
    const { digestId } = await insertDigestWithStaleFirstToken(t);

    const expected = getFirstSearchToken(DISPLAY_NAME);
    expect(expected).not.toBe(STALE_FIRST_TOKEN);

    const before = await t.run(async (ctx) => await ctx.db.get(digestId));
    expect(before?.normalizedDisplayNameFirstToken).toBe(STALE_FIRST_TOKEN);

    // An unconfirmed call reports the same repair without performing it.
    const preview = await t.mutation(
      internal.maintenance.backfillSkillSearchDigestFirstTokensInternal,
      {},
    );
    expect(preview.patched).toBe(1);
    expect(preview.dryRun).toBe(true);
    const afterPreview = await t.run(async (ctx) => await ctx.db.get(digestId));
    expect(afterPreview?.normalizedDisplayNameFirstToken).toBe(STALE_FIRST_TOKEN);

    const result = await t.mutation(
      internal.maintenance.backfillSkillSearchDigestFirstTokensInternal,
      APPLY,
    );
    expect(result.patched).toBe(1);
    expect(result.missingSkills).toBe(0);

    const after = await t.run(async (ctx) => await ctx.db.get(digestId));
    expect(after?.normalizedDisplayNameFirstToken).toBe(expected);
    expect(after?.normalizedSlugFirstToken).toBe(getFirstSearchToken(SLUG));
  });

  it("makes the row reachable again through the index the search actually queries", async () => {
    const t = convexTest(schema, modules);
    await insertDigestWithStaleFirstToken(t);

    const token = getFirstSearchToken(DISPLAY_NAME) as string;
    const upperBound =
      token.slice(0, -1) + String.fromCharCode(token.charCodeAt(token.length - 1) + 1);
    const recall = async () =>
      await t.run(
        async (ctx) =>
          await ctx.db
            .query("skillSearchDigest")
            .withIndex("by_active_normalized_display_name_first_token", (q) =>
              q
                .eq("softDeletedAt", undefined)
                .gte("normalizedDisplayNameFirstToken", token)
                .lt("normalizedDisplayNameFirstToken", upperBound),
            )
            .collect(),
      );

    // The row is on disk and matches the query the user typed, but the stored token
    // predates the tokenizer, so the range bound the search computes never reaches it.
    expect(await recall()).toHaveLength(0);

    await t.mutation(internal.maintenance.backfillSkillSearchDigestFirstTokensInternal, APPLY);

    expect(await recall()).toHaveLength(1);
  });

  it("leaves an already-current row untouched", async () => {
    const t = convexTest(schema, modules);
    const { digestId } = await insertDigestWithStaleFirstToken(t);

    await t.mutation(internal.maintenance.backfillSkillSearchDigestFirstTokensInternal, APPLY);
    const second = await t.mutation(
      internal.maintenance.backfillSkillSearchDigestFirstTokensInternal,
      APPLY,
    );

    expect(second.scanned).toBe(1);
    expect(second.patched).toBe(0);

    const row = await t.run(async (ctx) => await ctx.db.get(digestId));
    expect(row?.normalizedDisplayNameFirstToken).toBe(getFirstSearchToken(DISPLAY_NAME));
  });
});
