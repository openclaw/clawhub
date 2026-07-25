import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { assertTestSeedAllowed } from "./lib/testSeed";

const CONFIRM = "manage-claw-583-external-catalog-test-fixture";
const EXTERNAL_ID = "patrick-erichsen/skills/html";
const REPO = "patrick-erichsen/skills";
const PATH = "skills/html";
const COMMIT = "050daba89f6b6636470add5cb300aac46a412cf8";
const CONTENT_HASH = "42d2e89358ea927441dfede45c3b0cf89a21603bc7c32246f098d24a9cbea1ff";

const confirmArgs = { confirm: v.literal(CONFIRM) };

function assertControlledDigest(digest: Doc<"skillsShMirrorDigests">) {
  if (
    digest.externalId !== EXTERNAL_ID ||
    digest.sourceType !== "github" ||
    digest.owner !== "patrick-erichsen" ||
    digest.repo !== "skills" ||
    digest.slug !== "html" ||
    digest.githubPath !== PATH ||
    digest.githubCommit !== COMMIT ||
    digest.sourceContentHash !== CONTENT_HASH ||
    digest.sourceUrl !== `https://www.skills.sh/${EXTERNAL_ID}` ||
    !digest.active ||
    digest.tombstonedAt !== undefined ||
    digest.sourceFreshnessStatus !== "observed-only" ||
    digest.detailStatus !== "available"
  ) {
    throw new Error("CLAW-583 controlled mirror digest mismatch");
  }
}

function assertControlledDetail(
  detail: Doc<"skillsShMirrorDetails"> | null,
  digest: Doc<"skillsShMirrorDigests">,
): asserts detail is Doc<"skillsShMirrorDetails"> {
  if (
    !detail ||
    detail.externalId !== EXTERNAL_ID ||
    detail.digestId !== digest._id ||
    detail.sourceContentHash !== CONTENT_HASH ||
    !detail.content.trim() ||
    detail.contentBytes <= 0 ||
    detail.contentBytes > 64 * 1024
  ) {
    throw new Error("CLAW-583 controlled mirror detail mismatch");
  }
}

async function getControlledState(ctx: Pick<QueryCtx, "db">) {
  const digest = await ctx.db
    .query("skillsShMirrorDigests")
    .withIndex("by_external_id", (q) => q.eq("externalId", EXTERNAL_ID))
    .unique();
  if (!digest) throw new Error("CLAW-583 controlled mirror digest is missing");
  assertControlledDigest(digest);
  const [detail, run] = await Promise.all([
    ctx.db
      .query("skillsShMirrorDetails")
      .withIndex("by_external_id", (q) => q.eq("externalId", EXTERNAL_ID))
      .unique(),
    ctx.db.get(digest.lastObservedRunId),
  ]);
  assertControlledDetail(detail, digest);
  if (!run || run.counts.scansPlanned !== 0 || run.counts.scansAdmitted !== 0) {
    throw new Error("CLAW-583 controlled mirror run admitted scans");
  }
  return { digest, detail, run };
}

export const readControlledExternalSkill = internalQuery({
  args: confirmArgs,
  handler: async (ctx) => {
    assertTestSeedAllowed();
    const { digest, detail, run } = await getControlledState(ctx);
    return {
      externalId: EXTERNAL_ID,
      reference: `skills-sh:${EXTERNAL_ID}`,
      repo: REPO,
      path: PATH,
      commit: COMMIT,
      contentHash: CONTENT_HASH,
      digestId: digest._id,
      detailId: detail._id,
      sourceSnapshotId: digest.sourceSnapshotId,
      active: digest.active,
      publicVisible: digest.publicVisible,
      installable: digest.installable,
      contentBytes: detail.contentBytes,
      scansPlanned: run.counts.scansPlanned,
      scansAdmitted: run.counts.scansAdmitted,
    };
  },
});

export const activateControlledExternalSkill = internalMutation({
  args: confirmArgs,
  handler: async (ctx) => {
    assertTestSeedAllowed();
    const { digest, detail, run } = await getControlledState(ctx);
    if (digest.publicVisible || digest.installable) {
      throw new Error("CLAW-583 controlled mirror digest is already activated");
    }
    await ctx.db.patch(digest._id, { publicVisible: true, installable: true });
    return {
      ok: true as const,
      digestId: digest._id,
      detailId: detail._id,
      sourceSnapshotId: digest.sourceSnapshotId,
      scansPlanned: run.counts.scansPlanned,
      scansAdmitted: run.counts.scansAdmitted,
    };
  },
});

export const deactivateControlledExternalSkill = internalMutation({
  args: {
    ...confirmArgs,
    digestId: v.optional(v.id("skillsShMirrorDigests")),
    sourceSnapshotId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertTestSeedAllowed();
    const digest = await ctx.db
      .query("skillsShMirrorDigests")
      .withIndex("by_external_id", (q) => q.eq("externalId", EXTERNAL_ID))
      .unique();
    if (!digest) throw new Error("CLAW-583 controlled mirror digest is missing during cleanup");
    const wasActivated = digest.publicVisible || digest.installable;
    await ctx.db.patch(digest._id, { publicVisible: false, installable: false });
    return {
      ok: true as const,
      deactivated: wasActivated,
      digestChanged: args.digestId !== undefined && digest._id !== args.digestId,
      sourceSnapshotChanged:
        args.sourceSnapshotId !== undefined && digest.sourceSnapshotId !== args.sourceSnapshotId,
    };
  },
});
