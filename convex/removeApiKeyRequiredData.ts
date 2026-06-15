import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./functions";

// Temporary migration exception: this is a shallow field removal across three tables.
// A bounded, resumable mutation provides the same safeguards without permanently adding
// @convex-dev/migrations solely for this one-off cleanup.
const APPLY_CONFIRMATION_TOKEN = "REMOVE_API_KEY_REQUIRED_FIELDS";
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 20;
const MAX_BATCHES = 100;
const MAX_SAMPLES = 20;
const CLEANUP_STATE_KEY = "remove-api-key-required-fields";

const cleanupPhaseValidator = v.union(
  v.literal("skillVersions"),
  v.literal("skills"),
  v.literal("skillSearchDigest"),
);

type CleanupPhase = "skillVersions" | "skills" | "skillSearchDigest";
const CLEANUP_PHASES = ["skillVersions", "skills", "skillSearchDigest"] as const;

type CleanupBatchResult = {
  phase: CleanupPhase;
  dryRun: boolean;
  scanned: number;
  matched: number;
  patched: number;
  cursor: string | null;
  isDone: boolean;
  migrationDone: boolean;
  samples: string[];
  progress?: CleanupProgress;
};

type CleanupProgress = {
  phase: CleanupPhase;
  cursor: string | null;
  isDone: boolean;
  batches: number;
  scanned: number;
  matched: number;
  patched: number;
};

const internalRefs = internal as unknown as {
  removeApiKeyRequiredData: {
    cleanupApiKeyRequiredFieldsBatchInternal: unknown;
  };
};

function effectiveBatchSize(batchSize?: number) {
  return Math.max(1, Math.min(Math.floor(batchSize ?? DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE));
}

function effectiveMaxBatches(maxBatches?: number) {
  return Math.max(1, Math.min(Math.floor(maxBatches ?? DEFAULT_MAX_BATCHES), MAX_BATCHES));
}

export const cleanupApiKeyRequiredFieldsBatchInternal = internalMutation({
  args: {
    phase: v.optional(cleanupPhaseValidator),
    dryRun: v.boolean(),
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    confirmationToken: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CleanupBatchResult> => {
    if (!args.dryRun && args.confirmationToken !== APPLY_CONFIRMATION_TOKEN) {
      throw new Error(`Apply requires confirmationToken=${APPLY_CONFIRMATION_TOKEN}`);
    }

    const existingState = args.dryRun
      ? null
      : await ctx.db
          .query("apiKeyRequiredCleanupState")
          .withIndex("by_key", (q) => q.eq("key", CLEANUP_STATE_KEY))
          .unique();
    if (existingState?.isDone) {
      return {
        phase: existingState.phase,
        dryRun: false,
        scanned: 0,
        matched: 0,
        patched: 0,
        cursor: null,
        isDone: true,
        migrationDone: true,
        samples: [],
        progress: existingState,
      };
    }

    const phase = args.dryRun
      ? (args.phase ?? CLEANUP_PHASES[0])
      : (existingState?.phase ?? CLEANUP_PHASES[0]);
    const cursor = args.dryRun ? (args.cursor ?? null) : (existingState?.cursor ?? null);
    const pagination = {
      cursor,
      numItems: effectiveBatchSize(args.batchSize),
    };
    const page =
      phase === "skillVersions"
        ? await ctx.db.query("skillVersions").order("asc").paginate(pagination)
        : phase === "skills"
          ? await ctx.db.query("skills").order("asc").paginate(pagination)
          : await ctx.db.query("skillSearchDigest").order("asc").paginate(pagination);

    let matched = 0;
    let patched = 0;
    const samples: string[] = [];

    for (const doc of page.page) {
      const candidate = doc as typeof doc & {
        apiKeyRequired?: boolean;
        latestVersionSummary?: { apiKeyRequired?: boolean; [key: string]: unknown };
      };
      const hasField =
        phase === "skillVersions"
          ? candidate.apiKeyRequired !== undefined
          : candidate.latestVersionSummary?.apiKeyRequired !== undefined;
      if (!hasField) continue;

      matched += 1;
      if (samples.length < MAX_SAMPLES) samples.push(doc._id);
      if (args.dryRun) continue;

      if (phase === "skillVersions") {
        await ctx.db.patch(doc._id, { apiKeyRequired: undefined });
      } else {
        const summary = candidate.latestVersionSummary;
        if (!summary) continue;
        const { apiKeyRequired: _apiKeyRequired, ...latestVersionSummary } = summary;
        await ctx.db.patch(doc._id, { latestVersionSummary } as never);
      }
      patched += 1;
    }

    const phaseIndex = CLEANUP_PHASES.indexOf(phase);
    const migrationDone = page.isDone && phaseIndex === CLEANUP_PHASES.length - 1;
    const nextPhase = page.isDone && !migrationDone ? CLEANUP_PHASES[phaseIndex + 1] : phase;
    const nextCursor = page.isDone ? null : page.continueCursor;
    const progress = args.dryRun
      ? undefined
      : {
          phase: nextPhase,
          cursor: nextCursor,
          isDone: migrationDone,
          batches: (existingState?.batches ?? 0) + 1,
          scanned: (existingState?.scanned ?? 0) + page.page.length,
          matched: (existingState?.matched ?? 0) + matched,
          patched: (existingState?.patched ?? 0) + patched,
          updatedAt: Date.now(),
        };
    if (progress) {
      if (existingState) {
        await ctx.db.patch(existingState._id, progress);
      } else {
        await ctx.db.insert("apiKeyRequiredCleanupState", {
          key: CLEANUP_STATE_KEY,
          ...progress,
        });
      }
    }

    return {
      phase,
      dryRun: args.dryRun,
      scanned: page.page.length,
      matched,
      patched,
      cursor: nextCursor,
      isDone: page.isDone,
      migrationDone,
      samples,
      ...(progress ? { progress } : {}),
    };
  },
});

export const cleanupApiKeyRequiredFieldsInternal = internalAction({
  args: {
    dryRun: v.boolean(),
    batchSize: v.optional(v.number()),
    resume: v.optional(
      v.object({
        phase: cleanupPhaseValidator,
        cursor: v.union(v.string(), v.null()),
      }),
    ),
    maxBatches: v.optional(v.number()),
    confirmationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.dryRun && args.confirmationToken !== APPLY_CONFIRMATION_TOKEN) {
      throw new Error(`Apply requires confirmationToken=${APPLY_CONFIRMATION_TOKEN}`);
    }

    const maxBatches = effectiveMaxBatches(args.maxBatches);
    if (!args.dryRun) {
      let batches = 0;
      let scanned = 0;
      let matched = 0;
      let patched = 0;
      let progress: CleanupProgress | undefined;
      const samples: string[] = [];

      while (!progress?.isDone && batches < maxBatches) {
        const result = (await ctx.runMutation(
          internalRefs.removeApiKeyRequiredData.cleanupApiKeyRequiredFieldsBatchInternal as never,
          {
            dryRun: false,
            batchSize: effectiveBatchSize(args.batchSize),
            confirmationToken: args.confirmationToken,
          } as never,
        )) as CleanupBatchResult;

        batches += 1;
        scanned += result.scanned;
        matched += result.matched;
        patched += result.patched;
        progress = result.progress;
        for (const sample of result.samples) {
          if (samples.length >= MAX_SAMPLES) break;
          samples.push(sample);
        }
      }

      return {
        dryRun: false,
        batches,
        scanned,
        matched,
        patched,
        progress,
        resume: progress?.isDone
          ? null
          : {
              phase: progress?.phase ?? CLEANUP_PHASES[0],
              cursor: progress?.cursor ?? null,
            },
        isDone: progress?.isDone ?? false,
        samples,
      };
    }

    let phaseIndex = args.resume ? CLEANUP_PHASES.indexOf(args.resume.phase) : 0;
    let cursor = args.resume?.cursor ?? null;
    let batches = 0;
    let scanned = 0;
    let matched = 0;
    let patched = 0;
    const samples: string[] = [];

    while (phaseIndex < CLEANUP_PHASES.length && batches < maxBatches) {
      const phase = CLEANUP_PHASES[phaseIndex];
      const result = (await ctx.runMutation(
        internalRefs.removeApiKeyRequiredData.cleanupApiKeyRequiredFieldsBatchInternal as never,
        {
          phase,
          dryRun: true,
          batchSize: effectiveBatchSize(args.batchSize),
          cursor,
        } as never,
      )) as CleanupBatchResult;

      batches += 1;
      scanned += result.scanned;
      matched += result.matched;
      patched += result.patched;
      cursor = result.cursor;
      for (const sample of result.samples) {
        if (samples.length >= MAX_SAMPLES) break;
        samples.push(sample);
      }
      if (result.isDone) {
        phaseIndex += 1;
        cursor = null;
      }
    }

    const isDone = phaseIndex >= CLEANUP_PHASES.length;
    return {
      dryRun: args.dryRun,
      batches,
      scanned,
      matched,
      patched,
      resume: isDone
        ? null
        : {
            phase: CLEANUP_PHASES[phaseIndex],
            cursor,
          },
      isDone,
      samples,
    };
  },
});
