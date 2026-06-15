import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./functions";
import { sha256Hex } from "./lib/clawpack";
import { buildDeterministicPackageZip } from "./lib/skillZip";

// Temporary migration exception: computing the compatibility hash requires storage reads and
// deterministic ZIP construction in an action, which @convex-dev/migrations mutations cannot do.
const APPLY_CONFIRMATION_TOKEN = "BACKFILL_LEGACY_PACKAGE_ZIP_HASHES";
const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 10;
const MAX_SAMPLES = 25;

const internalRefs = internal as unknown as {
  packageLegacyZipHashBackfill: {
    getLegacyPackageZipHashBackfillBatchInternal: unknown;
    applyLegacyPackageZipHashBackfillInternal: unknown;
  };
};

type BackfillTarget = {
  releaseId: Id<"packageReleases">;
  packageName: string;
  version: string;
  currentSha256hash: string | null;
  files: Array<{ path: string; storageId: Id<"_storage"> }>;
};

type BackfillBatch = {
  page: BackfillTarget[];
  scanned: number;
  continueCursor: string;
  isDone: boolean;
};

function effectiveBatchSize(batchSize?: number) {
  return Math.max(1, Math.min(Math.floor(batchSize ?? DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE));
}

export const getLegacyPackageZipHashBackfillBatchInternal = internalQuery({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<BackfillBatch> => {
    const page = await ctx.db
      .query("packageReleases")
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: effectiveBatchSize(args.batchSize),
      });

    const targets: BackfillTarget[] = [];
    for (const release of page.page) {
      if (release.artifactKind !== "npm-pack") continue;
      const pkg = await ctx.db.get(release.packageId);
      targets.push({
        releaseId: release._id,
        packageName: pkg?.name ?? `<missing:${release.packageId}>`,
        version: release.version,
        currentSha256hash: release.sha256hash ?? null,
        files: release.files.map((file) => ({
          path: file.path,
          storageId: file.storageId,
        })),
      });
    }

    return {
      page: targets,
      scanned: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const applyLegacyPackageZipHashBackfillInternal = internalMutation({
  args: {
    releaseId: v.id("packageReleases"),
    expectedCurrentSha256hash: v.optional(v.string()),
    sha256hash: v.string(),
    confirmationToken: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.confirmationToken !== APPLY_CONFIRMATION_TOKEN) {
      throw new Error(`Apply requires confirmationToken=${APPLY_CONFIRMATION_TOKEN}`);
    }

    const release = await ctx.db.get(args.releaseId);
    if (!release || release.artifactKind !== "npm-pack") {
      return { status: "skipped" as const };
    }
    if (release.sha256hash === args.sha256hash) {
      return { status: "matched" as const };
    }
    if ((release.sha256hash ?? null) !== (args.expectedCurrentSha256hash ?? null)) {
      return { status: "stale" as const };
    }

    await ctx.db.patch(args.releaseId, { sha256hash: args.sha256hash });
    return { status: "patched" as const };
  },
});

export const backfillLegacyPackageZipHashesInternal = internalAction({
  args: {
    dryRun: v.boolean(),
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    confirmationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.dryRun && args.confirmationToken !== APPLY_CONFIRMATION_TOKEN) {
      throw new Error(`Apply requires confirmationToken=${APPLY_CONFIRMATION_TOKEN}`);
    }

    const batch = (await ctx.runQuery(
      internalRefs.packageLegacyZipHashBackfill
        .getLegacyPackageZipHashBackfillBatchInternal as never,
      {
        batchSize: effectiveBatchSize(args.batchSize),
        cursor: args.cursor ?? null,
      } as never,
    )) as BackfillBatch;
    const result = {
      dryRun: args.dryRun,
      done: batch.isDone,
      cursor: batch.isDone ? null : batch.continueCursor,
      scanned: batch.scanned,
      candidates: batch.page.length,
      matched: 0,
      wouldPatch: 0,
      patched: 0,
      skipped: 0,
      errors: 0,
      samples: [] as Array<{
        releaseId: string;
        packageName: string;
        version: string;
        currentSha256hash: string | null;
        expectedSha256hash?: string;
        action: "matched" | "would-patch" | "patched" | "stale" | "skipped" | "error";
        message?: string;
      }>,
    };

    for (const target of batch.page) {
      const sampleBase = {
        releaseId: target.releaseId,
        packageName: target.packageName,
        version: target.version,
        currentSha256hash: target.currentSha256hash,
      };
      const entries: Array<{ path: string; bytes: Uint8Array }> = [];
      const missingPaths: string[] = [];
      for (const file of target.files) {
        const blob = await ctx.storage.get(file.storageId);
        if (!blob) {
          missingPaths.push(file.path);
          continue;
        }
        entries.push({
          path: file.path,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        });
      }
      if (target.files.length === 0 || missingPaths.length > 0) {
        result.errors += 1;
        if (result.samples.length < MAX_SAMPLES) {
          result.samples.push({
            ...sampleBase,
            action: "error",
            message:
              target.files.length === 0
                ? "Release has no stored files"
                : `Missing stored files: ${missingPaths.join(", ")}`,
          });
        }
        continue;
      }

      const expectedSha256hash = await sha256Hex(buildDeterministicPackageZip(entries));
      if (target.currentSha256hash === expectedSha256hash) {
        result.matched += 1;
        if (result.samples.length < MAX_SAMPLES) {
          result.samples.push({ ...sampleBase, expectedSha256hash, action: "matched" });
        }
        continue;
      }
      if (args.dryRun) {
        result.wouldPatch += 1;
        if (result.samples.length < MAX_SAMPLES) {
          result.samples.push({ ...sampleBase, expectedSha256hash, action: "would-patch" });
        }
        continue;
      }

      const mutationResult = (await ctx.runMutation(
        internalRefs.packageLegacyZipHashBackfill
          .applyLegacyPackageZipHashBackfillInternal as never,
        {
          releaseId: target.releaseId,
          ...(target.currentSha256hash
            ? { expectedCurrentSha256hash: target.currentSha256hash }
            : {}),
          sha256hash: expectedSha256hash,
          confirmationToken: APPLY_CONFIRMATION_TOKEN,
        } as never,
      )) as { status: "patched" | "matched" | "stale" | "skipped" };
      result[mutationResult.status === "stale" ? "skipped" : mutationResult.status] += 1;
      if (result.samples.length < MAX_SAMPLES) {
        result.samples.push({
          ...sampleBase,
          expectedSha256hash,
          action: mutationResult.status,
        });
      }
    }

    return result;
  },
});
