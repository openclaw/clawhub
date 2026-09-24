import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { assertLocalDevSeedAllowed } from "./lib/devSeed";
import { attachCardAndSucceedJobInternal } from "./skillCards";

// Bounded local-auth fixtures keep the normal table triggers. Claims and
// completions run through the real worker API, including lease fencing.
export const seedExistingRows = internalMutation({
  args: { versionId: v.id("skillVersions") },
  handler: async (ctx, { versionId }) => {
    assertLocalDevSeedAllowed("Skill Card");
    const original = await ctx.db.get(versionId);
    if (!original) throw new Error("Published fixture version is missing");
    const { _id, _creationTime, skillCardGeneration: _receipt, ...version } = original;
    const ids = [_id];
    for (let index = 1; index < 4; index += 1) {
      ids.push(
        await ctx.db.insert("skillVersions", {
          ...version,
          version: `0.0.${index}-card-fixture`,
          files: version.files.filter((file) => file.path !== "skill-card.md"),
        }),
      );
    }
    for (const id of ids) {
      await ctx.runMutation(internal.skillCards.enqueueForVersionInternal, {
        versionId: id,
        source: "manual",
      });
    }
    return ids;
  },
});

export const changeInputs = internalMutation({
  args: { versionId: v.id("skillVersions"), semantic: v.boolean() },
  handler: async (ctx, args) => {
    assertLocalDevSeedAllowed("Skill Card");
    const version = await ctx.db.get(args.versionId);
    if (!version?.llmAnalysis) throw new Error("Settled fixture analysis is missing");
    await ctx.db.patch(version._id, {
      llmAnalysis: {
        ...version.llmAnalysis,
        checkedAt: Date.now(),
        ...(args.semantic
          ? { summary: `${version.llmAnalysis.summary ?? ""} Changed evidence.` }
          : {}),
      },
    });
  },
});

export const state = internalQuery({
  args: { versionIds: v.array(v.id("skillVersions")) },
  handler: async (ctx, { versionIds }) => {
    assertLocalDevSeedAllowed("Skill Card");
    if (versionIds.length > 4) throw new Error("Fixture is limited to four versions");
    return Promise.all(
      versionIds.map(async (id) => ({
        version: await ctx.db.get(id),
        jobs: await ctx.db
          .query("skillCardGenerationJobs")
          .withIndex("by_skill_version_status", (q) => q.eq("skillVersionId", id))
          .take(32),
      })),
    );
  },
});

export const storeCard = internalAction({
  args: {},
  handler: async (ctx) => {
    assertLocalDevSeedAllowed("Skill Card");
    return ctx.storage.store(new Blob(["rollback fixture"]));
  },
});

export const deleteCard = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    assertLocalDevSeedAllowed("Skill Card");
    await ctx.storage.delete(storageId);
  },
});

export const failStaleCardDeletion = internalMutation({
  args: {
    jobId: v.id("skillCardGenerationJobs"),
    leaseToken: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    assertLocalDevSeedAllowed("Skill Card");
    const attach = attachCardAndSucceedJobInternal as unknown as {
      _handler: (
        ctx: MutationCtx,
        args: {
          jobId: Id<"skillCardGenerationJobs">;
          leaseToken: string;
          cardFile: { path: string; size: number; storageId: Id<"_storage">; sha256: string };
        },
      ) => Promise<unknown>;
    };
    // Throw after a real storage delete, within the real attachment transaction.
    // Its lease and blob must both roll back; post-commit cleanup cannot prove this.
    return attach._handler(
      {
        ...ctx,
        storage: {
          ...ctx.storage,
          delete: async (id: Id<"_storage">) => {
            await ctx.storage.delete(id);
            throw new Error("fixture storage deletion failure");
          },
        },
      },
      {
        jobId: args.jobId,
        leaseToken: args.leaseToken,
        cardFile: {
          path: "skill-card.md",
          size: 16,
          storageId: args.storageId,
          sha256: "f".repeat(64),
        },
      },
    );
  },
});
