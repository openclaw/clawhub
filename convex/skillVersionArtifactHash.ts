import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./functions";
import { sha256Hex } from "./lib/hash";
import { sourceSkillVersionFiles } from "./lib/skillCards";
import { buildDeterministicZip } from "./lib/skillZip";

/**
 * Records the SHA-256 of a published skill version's deterministic ZIP.
 *
 * The hosted catalog feed publishes this value as install integrity, and skill
 * cards, verification and the security dataset expose it. It used to be computed
 * as a side effect of the retired VirusTotal upload, so it now has its own
 * publish-time action. The ZIP must stay byte-identical to the historical hash
 * input: source files only (generated bundles excluded) plus stable _meta.json.
 */
export const computeSkillVersionArtifactHashInternal = internalAction({
  args: {
    versionId: v.id("skillVersions"),
  },
  handler: async (ctx, args) => {
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<"skillVersions"> | null;
    if (!version) {
      console.error(`[skill-hash] Version ${args.versionId} not found`);
      return { ok: false as const, reason: "missing_version" as const };
    }

    const skill = (await ctx.runQuery(internal.skills.getSkillByIdInternal, {
      skillId: version.skillId,
    })) as Doc<"skills"> | null;
    if (!skill) {
      console.error(`[skill-hash] Skill ${version.skillId} not found`);
      return { ok: false as const, reason: "missing_skill" as const };
    }

    const fingerprintEntries = (await ctx.runQuery(
      internal.skills.listVersionFingerprintsInternal,
      { skillVersionId: version._id },
    )) as Array<{ fingerprint: string; kind?: "source" | "generated-bundle" }>;
    const generatedBundleFingerprints = fingerprintEntries
      .filter((entry) => entry.kind === "generated-bundle")
      .map((entry) => entry.fingerprint);

    const entries: Array<{ path: string; bytes: Uint8Array }> = [];
    for (const file of sourceSkillVersionFiles(version.files, { generatedBundleFingerprints })) {
      const content = await ctx.storage.get(file.storageId);
      if (content) {
        entries.push({ path: file.path, bytes: new Uint8Array(await content.arrayBuffer()) });
      }
    }
    if (entries.length === 0) {
      console.warn(`[skill-hash] No files found for version ${args.versionId}`);
      return { ok: false as const, reason: "missing_files" as const };
    }

    const zipArray = buildDeterministicZip(entries, {
      ownerId: String(skill.ownerUserId),
      slug: skill.slug,
      version: version.version,
      publishedAt: version.createdAt,
    });
    const sha256hash = await sha256Hex(zipArray);

    await ctx.runMutation(internal.skills.updateVersionSha256HashInternal, {
      versionId: args.versionId,
      sha256hash,
    });
    return { ok: true as const, sha256hash };
  },
});

const HASH_BACKFILL_MAX_BATCH = 200;
const HASH_BACKFILL_BATCH_DELAY_MS = 1_000;

/**
 * Operator repair: schedule the hash action for active published versions that
 * never received a `sha256hash` (for example, VirusTotal jobs that were still
 * queued at its retirement, or a failed hash action). `dryRun` reports one page
 * without scheduling; a real run pages through the table with a short delay.
 */
export const backfillMissingSkillVersionArtifactHashesInternal = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    scheduled: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(
      1,
      Math.min(Math.floor(args.batchSize ?? 100), HASH_BACKFILL_MAX_BATCH),
    );
    const page = await ctx.db
      .query("skillVersions")
      .withIndex("by_active_created", (q) => q.eq("softDeletedAt", undefined))
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let matched = 0;
    let scheduled = args.scheduled ?? 0;
    for (const version of page.page) {
      if (version.sha256hash) continue;
      if (version.publicationStatus === "pending") continue;
      if (version.files.length === 0) continue;
      matched += 1;
      if (args.dryRun) continue;
      await ctx.scheduler.runAfter(
        0,
        internal.skillVersionArtifactHash.computeSkillVersionArtifactHashInternal,
        { versionId: version._id },
      );
      scheduled += 1;
    }

    if (!args.dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(
        HASH_BACKFILL_BATCH_DELAY_MS,
        internal.skillVersionArtifactHash.backfillMissingSkillVersionArtifactHashesInternal,
        { cursor: page.continueCursor, batchSize, scheduled },
      );
    }

    return {
      dryRun: args.dryRun === true,
      matched,
      scheduled,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
