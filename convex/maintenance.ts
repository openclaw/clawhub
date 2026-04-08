import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery } from "./functions";
import { assertRole, requireUserFromAction } from "./lib/access";
import { buildSkillSummaryBackfillPatch, type ParsedSkillData } from "./lib/skillBackfill";
import { deriveSkillCapabilityTags } from "./lib/skillCapabilityTags";
import {
  computeQualitySignals,
  evaluateQuality,
  getTrustTier,
  type TrustTier,
} from "./lib/skillQuality";
import { hashSkillFiles, isTextFile } from "./lib/skills";
import { computeIsSuspicious } from "./lib/skillSafety";
import { extractDigestFields } from "./lib/skillSearchDigest";
import { generateSkillSummary } from "./lib/skillSummary";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 20;
const MAX_MAX_BATCHES = 200;
const DEFAULT_EMPTY_SKILL_MAX_README_BYTES = 8000;
const DEFAULT_EMPTY_SKILL_NOMINATION_THRESHOLD = 3;
const DEFAULT_CAPABILITY_BACKFILL_DELAY_MS = 500;
const PLATFORM_SKILL_LICENSE = "MIT-0" as const;

type BackfillStats = {
  skillsScanned: number;
  skillsPatched: number;
  aiSummariesPatched: number;
  versionsPatched: number;
  missingLatestVersion: number;
  missingReadme: number;
  missingStorageBlob: number;
};

type BackfillPageItem =
  | {
      kind: "ok";
      skillId: Id<"skills">;
      skillSlug: string;
      skillDisplayName: string;
      versionId: Id<"skillVersions">;
      skillSummary: Doc<"skills">["summary"];
      versionParsed: Doc<"skillVersions">["parsed"];
      readmeStorageId: Id<"_storage">;
    }
  | { kind: "missingLatestVersion"; skillId: Id<"skills"> }
  | { kind: "missingVersionDoc"; skillId: Id<"skills">; versionId: Id<"skillVersions"> }
  | { kind: "missingReadme"; skillId: Id<"skills">; versionId: Id<"skillVersions"> };

type BackfillPageResult = {
  items: BackfillPageItem[];
  cursor: string | null;
  isDone: boolean;
};

export const getSkillBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const items: BackfillPageItem[] = [];
    for (const skill of page) {
      if (!skill.latestVersionId) {
        items.push({ kind: "missingLatestVersion", skillId: skill._id });
        continue;
      }

      const version = await ctx.db.get(skill.latestVersionId);
      if (!version) {
        items.push({
          kind: "missingVersionDoc",
          skillId: skill._id,
          versionId: skill.latestVersionId,
        });
        continue;
      }

      const readmeFile = version.files.find(
        (file) => file.path.toLowerCase() === "skill.md" || file.path.toLowerCase() === "skills.md",
      );
      if (!readmeFile) {
        items.push({ kind: "missingReadme", skillId: skill._id, versionId: version._id });
        continue;
      }

      items.push({
        kind: "ok",
        skillId: skill._id,
        skillSlug: skill.slug,
        skillDisplayName: skill.displayName,
        versionId: version._id,
        skillSummary: skill.summary,
        versionParsed: version.parsed,
        readmeStorageId: readmeFile.storageId,
      });
    }

    return { items, cursor: continueCursor, isDone };
  },
});

export const applySkillBackfillPatchInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
    summary: v.optional(v.string()),
    parsed: v.optional(
      v.object({
        frontmatter: v.record(v.string(), v.any()),
        metadata: v.optional(v.any()),
        clawdis: v.optional(v.any()),
        license: v.optional(v.literal(PLATFORM_SKILL_LICENSE)),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (typeof args.summary === "string") {
      await ctx.db.patch(args.skillId, { summary: args.summary, updatedAt: now });
    }
    if (args.parsed) {
      await ctx.db.patch(args.versionId, { parsed: args.parsed });
    }
    return { ok: true as const };
  },
});

export type BackfillActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  useAi?: boolean;
  cursor?: string;
};

export type BackfillActionResult = {
  ok: true;
  stats: BackfillStats;
  isDone: boolean;
  cursor: string | null;
};

export async function backfillSkillSummariesInternalHandler(
  ctx: ActionCtx,
  args: BackfillActionArgs,
): Promise<BackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const useAi = Boolean(args.useAi);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const totals: BackfillStats = {
    skillsScanned: 0,
    skillsPatched: 0,
    aiSummariesPatched: 0,
    versionsPatched: 0,
    missingLatestVersion: 0,
    missingReadme: 0,
    missingStorageBlob: 0,
  };

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as BackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;
      if (item.kind === "missingLatestVersion") {
        totals.missingLatestVersion++;
        continue;
      }
      if (item.kind === "missingVersionDoc") {
        totals.missingLatestVersion++;
        continue;
      }
      if (item.kind === "missingReadme") {
        totals.missingReadme++;
        continue;
      }

      const blob = await ctx.storage.get(item.readmeStorageId);
      if (!blob) {
        totals.missingStorageBlob++;
        continue;
      }

      const readmeText = await blob.text();
      const patch = buildSkillSummaryBackfillPatch({
        readmeText,
        currentSummary: item.skillSummary ?? undefined,
        currentParsed: item.versionParsed as ParsedSkillData,
      });

      let nextSummary = patch.summary;
      const missingSummary = !item.skillSummary?.trim();
      if (!nextSummary && useAi && missingSummary) {
        nextSummary = await generateSkillSummary({
          slug: item.skillSlug,
          displayName: item.skillDisplayName,
          readmeText,
        });
      }

      const shouldPatchSummary =
        typeof nextSummary === "string" && nextSummary.trim() && nextSummary !== item.skillSummary;

      if (!shouldPatchSummary && !patch.parsed) continue;
      if (shouldPatchSummary) {
        totals.skillsPatched++;
        if (!patch.summary) totals.aiSummariesPatched++;
      }
      if (patch.parsed) totals.versionsPatched++;

      if (dryRun) continue;

      await ctx.runMutation(internal.maintenance.applySkillBackfillPatchInternal, {
        skillId: item.skillId,
        versionId: item.versionId,
        summary: shouldPatchSummary ? nextSummary : undefined,
        parsed: patch.parsed,
      });
    }

    if (isDone) break;
  }

  return { ok: true as const, stats: totals, isDone, cursor };
}

export const backfillSkillSummariesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    useAi: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
  },
  handler: backfillSkillSummariesInternalHandler,
});

export const backfillSkillSummaries: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    useAi: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillSkillSummariesInternal,
      args,
    ) as Promise<BackfillActionResult>;
  },
});

export const scheduleBackfillSkillSummaries: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()), useAi: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillSummariesInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
      useAi: Boolean(args.useAi),
    });
    return { ok: true as const };
  },
});

export const continueSkillSummaryBackfillJobInternal = internalAction({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    useAi: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BackfillActionResult> => {
    const result = await backfillSkillSummariesInternalHandler(ctx, {
      dryRun: false,
      cursor: args.cursor,
      batchSize: args.batchSize ?? DEFAULT_BATCH_SIZE,
      maxBatches: 1,
      useAi: Boolean(args.useAi),
    });

    if (!result.isDone && result.cursor) {
      await ctx.scheduler.runAfter(
        0,
        internal.maintenance.continueSkillSummaryBackfillJobInternal,
        {
          cursor: result.cursor,
          batchSize: args.batchSize ?? DEFAULT_BATCH_SIZE,
          useAi: Boolean(args.useAi),
        },
      );
    }

    return result;
  },
});

type CapabilityBackfillStats = {
  skillsScanned: number;
  skillsPatched: number;
  versionsPatched: number;
  missingVersions: number;
  missingStorageBlob: number;
};

type CapabilityBackfillResult = {
  ok: true;
  stats: CapabilityBackfillStats;
  cursor: string | null;
  isDone: boolean;
};

export const applySkillCapabilityTagsInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
    capabilityTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return { ok: false as const, reason: "missing_version" as const };
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return { ok: false as const, reason: "missing_skill" as const };

    const normalizedTags = [...new Set(args.capabilityTags)];
    let versionPatched = false;
    let skillPatched = false;

    if (JSON.stringify(version.capabilityTags ?? []) !== JSON.stringify(normalizedTags)) {
      await ctx.db.patch(version._id, {
        capabilityTags: normalizedTags.length ? normalizedTags : undefined,
      });
      versionPatched = true;
    }

    if (
      skill.latestVersionId === version._id &&
      JSON.stringify(skill.capabilityTags ?? []) !== JSON.stringify(normalizedTags)
    ) {
      await ctx.db.patch(skill._id, {
        capabilityTags: normalizedTags.length ? normalizedTags : undefined,
        updatedAt: Date.now(),
      });
      skillPatched = true;
    }

    return { ok: true as const, versionPatched, skillPatched };
  },
});

export async function backfillSkillCapabilityTagsInternalHandler(
  ctx: ActionCtx,
  args: {
    dryRun?: boolean;
    cursor?: string;
    batchSize?: number;
    maxBatches?: number;
    delayMs?: number;
  },
): Promise<CapabilityBackfillResult> {
  const dryRun = Boolean(args.dryRun);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = dryRun
    ? clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)
    : 1;

  const stats: CapabilityBackfillStats = {
    skillsScanned: 0,
    skillsPatched: 0,
    versionsPatched: 0,
    missingVersions: 0,
    missingStorageBlob: 0,
  };

  let cursor = args.cursor ?? null;
  let isDone = false;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const page = await ctx.runQuery(internal.maintenance.getSkillBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    });

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      if (item.kind !== "ok") {
        if (item.kind === "missingVersionDoc" || item.kind === "missingLatestVersion") {
          stats.missingVersions += 1;
        }
        continue;
      }

      stats.skillsScanned += 1;

      const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId: item.versionId,
      })) as Doc<"skillVersions"> | null;
      if (!version) {
        stats.missingVersions += 1;
        continue;
      }

      const readmeBlob = await ctx.storage.get(item.readmeStorageId);
      if (!readmeBlob) {
        stats.missingStorageBlob += 1;
        continue;
      }

      const readmeText = await readmeBlob.text();
      const fileContents: Array<{ path: string; content: string }> = [];
      let hasMissingTextBlob = false;
      for (const file of version.files) {
        const lower = file.path.toLowerCase();
        if (lower === "skill.md" || lower === "skills.md") continue;
        if (!isTextFile(file.path, file.contentType ?? undefined)) continue;
        const blob = await ctx.storage.get(file.storageId);
        if (!blob) {
          stats.missingStorageBlob += 1;
          hasMissingTextBlob = true;
          break;
        }
        fileContents.push({ path: file.path, content: await blob.text() });
      }

      if (hasMissingTextBlob) continue;

      const capabilityTags = deriveSkillCapabilityTags({
        slug: item.skillSlug,
        displayName: item.skillDisplayName,
        summary: item.skillSummary ?? undefined,
        frontmatter: item.versionParsed?.frontmatter,
        readmeText,
        fileContents,
      });

      if (dryRun) continue;

      const result = await ctx.runMutation(internal.maintenance.applySkillCapabilityTagsInternal, {
        skillId: item.skillId,
        versionId: item.versionId,
        capabilityTags,
      });

      if (result.ok) {
        if (result.skillPatched) stats.skillsPatched += 1;
        if (result.versionPatched) stats.versionsPatched += 1;
      }
    }

    if (isDone) break;
  }

  return { ok: true, stats, cursor, isDone };
}

export const backfillSkillCapabilityTagsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CapabilityBackfillResult> => {
    const result = await backfillSkillCapabilityTagsInternalHandler(ctx, args);

    if (!args.dryRun && !result.isDone && result.cursor) {
      const delayMs = clampInt(args.delayMs ?? DEFAULT_CAPABILITY_BACKFILL_DELAY_MS, 0, 60_000);
      await ctx.scheduler.runAfter(
        delayMs,
        internal.maintenance.backfillSkillCapabilityTagsInternal,
        {
          dryRun: false,
          cursor: result.cursor,
          batchSize: args.batchSize,
          maxBatches: 1,
          delayMs,
        },
      );
    }

    return result;
  },
});

export const backfillSkillCapabilityTags: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CapabilityBackfillResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(internal.maintenance.backfillSkillCapabilityTagsInternal, args);
  },
});

type FingerprintBackfillStats = {
  versionsScanned: number;
  versionsPatched: number;
  fingerprintsInserted: number;
  fingerprintMismatches: number;
};

type FingerprintBackfillPageItem = {
  skillId: Id<"skills">;
  versionId: Id<"skillVersions">;
  versionFingerprint?: string;
  files: Array<{ path: string; sha256: string }>;
  existingEntries: Array<{ id: Id<"skillVersionFingerprints">; fingerprint: string }>;
};

type FingerprintBackfillPageResult = {
  items: FingerprintBackfillPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type BadgeBackfillStats = {
  skillsScanned: number;
  skillsPatched: number;
  highlightsPatched: number;
};

type SkillBadgeTableBackfillStats = {
  skillsScanned: number;
  recordsInserted: number;
};

type BadgeBackfillPageItem = {
  skillId: Id<"skills">;
  ownerUserId: Id<"users">;
  createdAt?: number;
  updatedAt?: number;
  batch?: string;
  badges?: Doc<"skills">["badges"];
};

type BadgeBackfillPageResult = {
  items: BadgeBackfillPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type BadgeKind = Doc<"skillBadges">["kind"];

export const getSkillFingerprintBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FingerprintBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skillVersions")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const items: FingerprintBackfillPageItem[] = [];
    for (const version of page) {
      const existingEntries = await ctx.db
        .query("skillVersionFingerprints")
        .withIndex("by_version", (q) => q.eq("versionId", version._id))
        .take(20);

      const normalizedFiles = version.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
      }));

      const hasAnyEntry = existingEntries.length > 0;
      const entryFingerprints = new Set(existingEntries.map((entry) => entry.fingerprint));
      const hasFingerprintMismatch =
        typeof version.fingerprint === "string" &&
        hasAnyEntry &&
        (entryFingerprints.size !== 1 || !entryFingerprints.has(version.fingerprint));
      const needsFingerprintField = !version.fingerprint;
      const needsFingerprintEntry = !hasAnyEntry;

      if (!needsFingerprintField && !needsFingerprintEntry && !hasFingerprintMismatch) continue;

      items.push({
        skillId: version.skillId,
        versionId: version._id,
        versionFingerprint: version.fingerprint ?? undefined,
        files: normalizedFiles,
        existingEntries: existingEntries.map((entry) => ({
          id: entry._id,
          fingerprint: entry.fingerprint,
        })),
      });
    }

    return { items, cursor: continueCursor, isDone };
  },
});

export const applySkillFingerprintBackfillPatchInternal = internalMutation({
  args: {
    versionId: v.id("skillVersions"),
    fingerprint: v.string(),
    patchVersion: v.boolean(),
    replaceEntries: v.boolean(),
    existingEntryIds: v.optional(v.array(v.id("skillVersionFingerprints"))),
  },
  handler: async (ctx, args) => {
    const version = await ctx.db.get(args.versionId);
    if (!version) return { ok: false as const, reason: "missingVersion" as const };

    const now = Date.now();

    if (args.patchVersion) {
      await ctx.db.patch(version._id, { fingerprint: args.fingerprint });
    }

    if (args.replaceEntries) {
      const existing = args.existingEntryIds ?? [];
      for (const id of existing) {
        await ctx.db.delete(id);
      }

      await ctx.db.insert("skillVersionFingerprints", {
        skillId: version.skillId,
        versionId: version._id,
        fingerprint: args.fingerprint,
        createdAt: now,
      });
    }

    return { ok: true as const };
  },
});

export type FingerprintBackfillActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
};

export type FingerprintBackfillActionResult = { ok: true; stats: FingerprintBackfillStats };

export async function backfillSkillFingerprintsInternalHandler(
  ctx: ActionCtx,
  args: FingerprintBackfillActionArgs,
): Promise<FingerprintBackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const totals: FingerprintBackfillStats = {
    versionsScanned: 0,
    versionsPatched: 0,
    fingerprintsInserted: 0,
    fingerprintMismatches: 0,
  };

  let cursor: string | null = null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillFingerprintBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as FingerprintBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.versionsScanned++;

      const fingerprint = await hashSkillFiles(item.files);

      const existingFingerprints = new Set(item.existingEntries.map((entry) => entry.fingerprint));
      const hasAnyEntry = item.existingEntries.length > 0;
      const entryIsCorrect =
        hasAnyEntry && existingFingerprints.size === 1 && existingFingerprints.has(fingerprint);
      const versionFingerprintIsCorrect = item.versionFingerprint === fingerprint;

      if (hasAnyEntry && !entryIsCorrect) totals.fingerprintMismatches++;

      const shouldPatchVersion = !versionFingerprintIsCorrect;
      const shouldReplaceEntries = !entryIsCorrect;
      if (!shouldPatchVersion && !shouldReplaceEntries) continue;

      if (shouldPatchVersion) totals.versionsPatched++;
      if (shouldReplaceEntries) totals.fingerprintsInserted++;

      if (dryRun) continue;

      await ctx.runMutation(internal.maintenance.applySkillFingerprintBackfillPatchInternal, {
        versionId: item.versionId,
        fingerprint,
        patchVersion: shouldPatchVersion,
        replaceEntries: shouldReplaceEntries,
        existingEntryIds: shouldReplaceEntries ? item.existingEntries.map((entry) => entry.id) : [],
      });
    }

    if (isDone) break;
  }

  if (!isDone) {
    throw new ConvexError("Backfill incomplete (maxBatches reached)");
  }

  return { ok: true as const, stats: totals };
}

export const backfillSkillFingerprintsInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillFingerprintsInternalHandler,
});

export const backfillSkillFingerprints: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FingerprintBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillSkillFingerprintsInternal,
      args,
    ) as Promise<FingerprintBackfillActionResult>;
  },
});

export const scheduleBackfillSkillFingerprints: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillFingerprintsInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    });
    return { ok: true as const };
  },
});

export const getSkillBadgeBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BadgeBackfillPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const items: BadgeBackfillPageItem[] = page.map((skill) => ({
      skillId: skill._id,
      ownerUserId: skill.ownerUserId,
      createdAt: skill.createdAt ?? undefined,
      updatedAt: skill.updatedAt ?? undefined,
      batch: skill.batch ?? undefined,
      badges: skill.badges ?? undefined,
    }));

    return { items, cursor: continueCursor, isDone };
  },
});

export const applySkillBadgeBackfillPatchInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    badges: v.optional(
      v.object({
        redactionApproved: v.optional(
          v.object({
            byUserId: v.id("users"),
            at: v.number(),
          }),
        ),
        highlighted: v.optional(
          v.object({
            byUserId: v.id("users"),
            at: v.number(),
          }),
        ),
        official: v.optional(
          v.object({
            byUserId: v.id("users"),
            at: v.number(),
          }),
        ),
        deprecated: v.optional(
          v.object({
            byUserId: v.id("users"),
            at: v.number(),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.skillId, { badges: args.badges ?? undefined, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

export const upsertSkillBadgeRecordInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    kind: v.union(
      v.literal("highlighted"),
      v.literal("official"),
      v.literal("deprecated"),
      v.literal("redactionApproved"),
    ),
    byUserId: v.id("users"),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    const syncDenormalizedBadge = async () => {
      const skill = await ctx.db.get(args.skillId);
      if (!skill) return;
      await ctx.db.patch(args.skillId, {
        badges: {
          ...(skill.badges as Record<string, unknown> | undefined),
          [args.kind]: { byUserId: args.byUserId, at: args.at },
        },
      });
    };

    const existing = await ctx.db
      .query("skillBadges")
      .withIndex("by_skill_kind", (q) => q.eq("skillId", args.skillId).eq("kind", args.kind))
      .unique();
    if (existing) {
      await syncDenormalizedBadge();
      return { inserted: false as const };
    }
    await ctx.db.insert("skillBadges", {
      skillId: args.skillId,
      kind: args.kind,
      byUserId: args.byUserId,
      at: args.at,
    });
    await syncDenormalizedBadge();
    return { inserted: true as const };
  },
});

export type BadgeBackfillActionArgs = {
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
};

export type BadgeBackfillActionResult = { ok: true; stats: BadgeBackfillStats };

export async function backfillSkillBadgesInternalHandler(
  ctx: ActionCtx,
  args: BadgeBackfillActionArgs,
): Promise<BadgeBackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const totals: BadgeBackfillStats = {
    skillsScanned: 0,
    skillsPatched: 0,
    highlightsPatched: 0,
  };

  let cursor: string | null = null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillBadgeBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as BadgeBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;

      const shouldHighlight = item.batch === "highlighted" && !item.badges?.highlighted;
      if (!shouldHighlight) continue;

      totals.skillsPatched++;
      totals.highlightsPatched++;

      if (dryRun) continue;

      const at = item.updatedAt ?? item.createdAt ?? Date.now();
      await ctx.runMutation(internal.maintenance.applySkillBadgeBackfillPatchInternal, {
        skillId: item.skillId,
        badges: {
          ...item.badges,
          highlighted: {
            byUserId: item.ownerUserId,
            at,
          },
        },
      });
    }

    if (isDone) break;
  }

  if (!isDone) {
    throw new ConvexError("Backfill incomplete (maxBatches reached)");
  }

  return { ok: true as const, stats: totals };
}

export const backfillSkillBadgesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillBadgesInternalHandler,
});

export const backfillSkillBadges: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BadgeBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillSkillBadgesInternal,
      args,
    ) as Promise<BadgeBackfillActionResult>;
  },
});

export const scheduleBackfillSkillBadges: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillBadgesInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    });
    return { ok: true as const };
  },
});

export type SkillBadgeTableBackfillActionResult = {
  ok: true;
  stats: SkillBadgeTableBackfillStats;
};

export async function backfillSkillBadgeTableInternalHandler(
  ctx: ActionCtx,
  args: BadgeBackfillActionArgs,
): Promise<SkillBadgeTableBackfillActionResult> {
  const dryRun = Boolean(args.dryRun);
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);

  const totals: SkillBadgeTableBackfillStats = {
    skillsScanned: 0,
    recordsInserted: 0,
  };

  let cursor: string | null = null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getSkillBadgeBackfillPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as BadgeBackfillPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;
      const badges = item.badges ?? {};
      const entries: Array<{ kind: BadgeKind; byUserId: Id<"users">; at: number }> = [];

      if (badges.redactionApproved) {
        entries.push({
          kind: "redactionApproved",
          byUserId: badges.redactionApproved.byUserId,
          at: badges.redactionApproved.at,
        });
      }

      if (badges.official) {
        entries.push({
          kind: "official",
          byUserId: badges.official.byUserId,
          at: badges.official.at,
        });
      }

      if (badges.deprecated) {
        entries.push({
          kind: "deprecated",
          byUserId: badges.deprecated.byUserId,
          at: badges.deprecated.at,
        });
      }

      const highlighted =
        badges.highlighted ??
        (item.batch === "highlighted"
          ? {
              byUserId: item.ownerUserId,
              at: item.updatedAt ?? item.createdAt ?? Date.now(),
            }
          : undefined);

      if (highlighted) {
        entries.push({
          kind: "highlighted",
          byUserId: highlighted.byUserId,
          at: highlighted.at,
        });
      }

      if (dryRun) continue;

      for (const entry of entries) {
        const result = await ctx.runMutation(internal.maintenance.upsertSkillBadgeRecordInternal, {
          skillId: item.skillId,
          kind: entry.kind,
          byUserId: entry.byUserId,
          at: entry.at,
        });
        if (result.inserted) {
          totals.recordsInserted++;
        }
      }
    }

    if (isDone) break;
  }

  if (!isDone) {
    throw new ConvexError("Backfill incomplete (maxBatches reached)");
  }

  return { ok: true as const, stats: totals };
}

export const backfillSkillBadgeTableInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: backfillSkillBadgeTableInternalHandler,
});

export const backfillSkillBadgeTable: ReturnType<typeof action> = action({
  args: {
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SkillBadgeTableBackfillActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(
      internal.maintenance.backfillSkillBadgeTableInternal,
      args,
    ) as Promise<SkillBadgeTableBackfillActionResult>;
  },
});

export const scheduleBackfillSkillBadgeTable: ReturnType<typeof action> = action({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillBadgeTableInternal, {
      dryRun: Boolean(args.dryRun),
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
    });
    return { ok: true as const };
  },
});

type EmptySkillCleanupPageItem = {
  skillId: Id<"skills">;
  slug: string;
  ownerUserId: Id<"users">;
  latestVersionId?: Id<"skillVersions">;
  softDeletedAt?: number;
  moderationReason?: string;
  summary?: string;
};

type EmptySkillCleanupPageResult = {
  items: EmptySkillCleanupPageItem[];
  cursor: string | null;
  isDone: boolean;
};

type EmptySkillCleanupStats = {
  skillsScanned: number;
  skillsEvaluated: number;
  emptyDetected: number;
  skillsDeleted: number;
  missingLatestVersion: number;
  missingVersionDoc: number;
  missingReadme: number;
  missingStorageBlob: number;
  skippedLargeReadme: number;
};

type EmptySkillCleanupNomination = {
  userId: Id<"users">;
  handle: string | null;
  emptySkillCount: number;
  sampleSlugs: string[];
};

export type EmptySkillCleanupActionArgs = {
  cursor?: string;
  dryRun?: boolean;
  batchSize?: number;
  maxBatches?: number;
  maxReadmeBytes?: number;
  nominationThreshold?: number;
};

export type EmptySkillCleanupActionResult = {
  ok: true;
  cursor: string | null;
  isDone: boolean;
  stats: EmptySkillCleanupStats;
  nominations: EmptySkillCleanupNomination[];
};

export const getEmptySkillCleanupPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EmptySkillCleanupPageResult> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const { page, isDone, continueCursor } = await ctx.db
      .query("skills")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    return {
      items: page.map((skill) => ({
        skillId: skill._id,
        slug: skill.slug,
        ownerUserId: skill.ownerUserId,
        latestVersionId: skill.latestVersionId,
        softDeletedAt: skill.softDeletedAt,
        moderationReason: skill.moderationReason,
        summary: skill.summary,
      })),
      cursor: continueCursor,
      isDone,
    };
  },
});

export const applyEmptySkillCleanupInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    reason: v.string(),
    quality: v.object({
      score: v.number(),
      trustTier: v.union(v.literal("low"), v.literal("medium"), v.literal("trusted")),
      signals: v.object({
        bodyChars: v.number(),
        bodyWords: v.number(),
        uniqueWordRatio: v.number(),
        headingCount: v.number(),
        bulletCount: v.number(),
        templateMarkerHits: v.number(),
        genericSummary: v.boolean(),
        cjkChars: v.optional(v.number()),
      }),
    }),
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) return { deleted: false as const, reason: "missing_skill" as const };
    if (skill.softDeletedAt) return { deleted: false as const, reason: "already_deleted" as const };

    const now = Date.now();
    await ctx.db.patch(skill._id, {
      softDeletedAt: now,
      moderationStatus: "hidden",
      moderationReason: "quality.empty.backfill",
      moderationNotes: args.reason,
      quality: {
        score: args.quality.score,
        decision: "reject",
        trustTier: args.quality.trustTier,
        similarRecentCount: 0,
        reason: args.reason,
        signals: args.quality.signals,
        evaluatedAt: now,
      },
      updatedAt: now,
    });

    await ctx.db.insert("auditLogs", {
      actorUserId: skill.ownerUserId,
      action: "skill.delete.empty.backfill",
      targetType: "skill",
      targetId: skill._id,
      metadata: {
        slug: skill.slug,
        score: args.quality.score,
        trustTier: args.quality.trustTier,
        signals: args.quality.signals,
      },
      createdAt: now,
    });

    return {
      deleted: true as const,
      ownerUserId: skill.ownerUserId,
      slug: skill.slug,
    };
  },
});

export const nominateUserForEmptySkillSpamInternal = internalMutation({
  args: {
    userId: v.id("users"),
    emptySkillCount: v.number(),
    sampleSlugs: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("auditLogs")
      .withIndex("by_target", (q) => q.eq("targetType", "user").eq("targetId", args.userId))
      .filter((q) => q.eq(q.field("action"), "user.ban.nomination.empty-skill-spam"))
      .first();
    if (existing) return { created: false as const };

    const now = Date.now();
    await ctx.db.insert("auditLogs", {
      actorUserId: args.userId,
      action: "user.ban.nomination.empty-skill-spam",
      targetType: "user",
      targetId: args.userId,
      metadata: {
        emptySkillCount: args.emptySkillCount,
        sampleSlugs: args.sampleSlugs.slice(0, 10),
      },
      createdAt: now,
    });

    return { created: true as const };
  },
});

export async function cleanupEmptySkillsInternalHandler(
  ctx: ActionCtx,
  args: EmptySkillCleanupActionArgs,
): Promise<EmptySkillCleanupActionResult> {
  const dryRun = args.dryRun !== false;
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const maxReadmeBytes = clampInt(
    args.maxReadmeBytes ?? DEFAULT_EMPTY_SKILL_MAX_README_BYTES,
    256,
    65536,
  );
  const nominationThreshold = clampInt(
    args.nominationThreshold ?? DEFAULT_EMPTY_SKILL_NOMINATION_THRESHOLD,
    1,
    100,
  );

  const totals: EmptySkillCleanupStats = {
    skillsScanned: 0,
    skillsEvaluated: 0,
    emptyDetected: 0,
    skillsDeleted: 0,
    missingLatestVersion: 0,
    missingVersionDoc: 0,
    missingReadme: 0,
    missingStorageBlob: 0,
    skippedLargeReadme: 0,
  };

  const ownerTrustCache = new Map<string, { trustTier: TrustTier; handle: string | null }>();
  const emptyByOwner = new Map<string, EmptySkillCleanupNomination>();

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;
  const now = Date.now();

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getEmptySkillCleanupPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as EmptySkillCleanupPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;
      if (item.softDeletedAt) continue;

      if (!item.latestVersionId) {
        totals.missingLatestVersion++;
        continue;
      }

      const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId: item.latestVersionId,
      })) as Doc<"skillVersions"> | null;
      if (!version) {
        totals.missingVersionDoc++;
        continue;
      }

      const readmeFile = version.files.find((file) => {
        const lower = file.path.toLowerCase();
        return lower === "skill.md" || lower === "skills.md";
      });
      if (!readmeFile) {
        totals.missingReadme++;
        continue;
      }

      if (readmeFile.size > maxReadmeBytes) {
        totals.skippedLargeReadme++;
        continue;
      }

      const blob = await ctx.storage.get(readmeFile.storageId);
      if (!blob) {
        totals.missingStorageBlob++;
        continue;
      }
      const readmeText = await blob.text();
      totals.skillsEvaluated++;

      const ownerKey = String(item.ownerUserId);
      let ownerTrust = ownerTrustCache.get(ownerKey);
      if (!ownerTrust) {
        const owner = (await ctx.runQuery(internal.users.getByIdInternal, {
          userId: item.ownerUserId,
        })) as Doc<"users"> | null;
        const ownerActivity = (await ctx.runQuery(internal.skills.getOwnerSkillActivityInternal, {
          ownerUserId: item.ownerUserId,
          limit: 60,
        })) as Array<{
          slug: string;
          summary?: string;
          createdAt: number;
          latestVersionId?: Id<"skillVersions">;
        }>;

        const ownerCreatedAt = owner?.createdAt ?? owner?._creationTime ?? now;
        ownerTrust = {
          trustTier: getTrustTier(now - ownerCreatedAt, ownerActivity.length),
          handle: owner?.handle ?? null,
        };
        ownerTrustCache.set(ownerKey, ownerTrust);
      }

      const qualitySignals = computeQualitySignals({
        readmeText,
        summary: item.summary ?? undefined,
      });
      const quality = evaluateQuality({
        signals: qualitySignals,
        trustTier: ownerTrust.trustTier,
        similarRecentCount: 0,
      });
      if (quality.decision !== "reject") continue;

      totals.emptyDetected++;

      const nomination = emptyByOwner.get(ownerKey) ?? {
        userId: item.ownerUserId,
        handle: ownerTrust.handle,
        emptySkillCount: 0,
        sampleSlugs: [],
      };
      nomination.emptySkillCount += 1;
      if (nomination.sampleSlugs.length < 10 && !nomination.sampleSlugs.includes(item.slug)) {
        nomination.sampleSlugs.push(item.slug);
      }
      emptyByOwner.set(ownerKey, nomination);

      if (dryRun) continue;

      const result = await ctx.runMutation(internal.maintenance.applyEmptySkillCleanupInternal, {
        skillId: item.skillId,
        reason: quality.reason,
        quality: {
          score: quality.score,
          trustTier: quality.trustTier,
          signals: quality.signals,
        },
      });
      if (result.deleted) totals.skillsDeleted++;
    }

    if (isDone) break;
  }

  const nominations = Array.from(emptyByOwner.values())
    .filter((entry) => entry.emptySkillCount >= nominationThreshold)
    .sort((a, b) => b.emptySkillCount - a.emptySkillCount);

  return {
    ok: true as const,
    cursor,
    isDone,
    stats: totals,
    nominations: nominations.slice(0, 200),
  };
}

export const cleanupEmptySkillsInternal = internalAction({
  args: {
    cursor: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    maxReadmeBytes: v.optional(v.number()),
    nominationThreshold: v.optional(v.number()),
  },
  handler: cleanupEmptySkillsInternalHandler,
});

export const cleanupEmptySkills: ReturnType<typeof action> = action({
  args: {
    cursor: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    maxReadmeBytes: v.optional(v.number()),
    nominationThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EmptySkillCleanupActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(internal.maintenance.cleanupEmptySkillsInternal, args);
  },
});

type EmptySkillBanNominationStats = {
  skillsScanned: number;
  usersFlagged: number;
  nominationsCreated: number;
  nominationsExisting: number;
};

export type EmptySkillBanNominationActionArgs = {
  cursor?: string;
  batchSize?: number;
  maxBatches?: number;
  nominationThreshold?: number;
};

export type EmptySkillBanNominationActionResult = {
  ok: true;
  cursor: string | null;
  isDone: boolean;
  stats: EmptySkillBanNominationStats;
  nominations: EmptySkillCleanupNomination[];
};

export async function nominateEmptySkillSpammersInternalHandler(
  ctx: ActionCtx,
  args: EmptySkillBanNominationActionArgs,
): Promise<EmptySkillBanNominationActionResult> {
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
  const nominationThreshold = clampInt(
    args.nominationThreshold ?? DEFAULT_EMPTY_SKILL_NOMINATION_THRESHOLD,
    1,
    100,
  );

  const totals: EmptySkillBanNominationStats = {
    skillsScanned: 0,
    usersFlagged: 0,
    nominationsCreated: 0,
    nominationsExisting: 0,
  };

  const ownerHandleCache = new Map<string, string | null>();
  const emptyByOwner = new Map<string, EmptySkillCleanupNomination>();

  let cursor: string | null = args.cursor ?? null;
  let isDone = false;

  for (let i = 0; i < maxBatches; i++) {
    const page = (await ctx.runQuery(internal.maintenance.getEmptySkillCleanupPageInternal, {
      cursor: cursor ?? undefined,
      batchSize,
    })) as EmptySkillCleanupPageResult;

    cursor = page.cursor;
    isDone = page.isDone;

    for (const item of page.items) {
      totals.skillsScanned++;
      if (!item.softDeletedAt) continue;
      if (item.moderationReason !== "quality.empty.backfill") continue;

      const ownerKey = String(item.ownerUserId);
      let handle = ownerHandleCache.get(ownerKey);
      if (handle === undefined) {
        const owner = (await ctx.runQuery(internal.users.getByIdInternal, {
          userId: item.ownerUserId,
        })) as Doc<"users"> | null;
        handle = owner?.handle ?? null;
        ownerHandleCache.set(ownerKey, handle);
      }

      const nomination = emptyByOwner.get(ownerKey) ?? {
        userId: item.ownerUserId,
        handle,
        emptySkillCount: 0,
        sampleSlugs: [],
      };
      nomination.emptySkillCount += 1;
      if (nomination.sampleSlugs.length < 10 && !nomination.sampleSlugs.includes(item.slug)) {
        nomination.sampleSlugs.push(item.slug);
      }
      emptyByOwner.set(ownerKey, nomination);
    }

    if (isDone) break;
  }

  const nominations = Array.from(emptyByOwner.values())
    .filter((entry) => entry.emptySkillCount >= nominationThreshold)
    .sort((a, b) => b.emptySkillCount - a.emptySkillCount);
  totals.usersFlagged = nominations.length;

  if (isDone) {
    for (const nomination of nominations) {
      const result = await ctx.runMutation(
        internal.maintenance.nominateUserForEmptySkillSpamInternal,
        {
          userId: nomination.userId,
          emptySkillCount: nomination.emptySkillCount,
          sampleSlugs: nomination.sampleSlugs,
        },
      );
      if (result.created) totals.nominationsCreated++;
      else totals.nominationsExisting++;
    }
  }

  return {
    ok: true as const,
    cursor,
    isDone,
    stats: totals,
    nominations: nominations.slice(0, 200),
  };
}

export const nominateEmptySkillSpammersInternal = internalAction({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    nominationThreshold: v.optional(v.number()),
  },
  handler: nominateEmptySkillSpammersInternalHandler,
});

export const nominateEmptySkillSpammers: ReturnType<typeof action> = action({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    nominationThreshold: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EmptySkillBanNominationActionResult> => {
    const { user } = await requireUserFromAction(ctx);
    assertRole(user, ["admin"]);
    return ctx.runAction(internal.maintenance.nominateEmptySkillSpammersInternal, args);
  },
});

// Backfill embeddingSkillMap from existing skillEmbeddings.
// Run once after deploying the schema change:
//   npx convex run maintenance:backfillEmbeddingSkillMapInternal --prod
export const backfillEmbeddingSkillMapInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 200, 10, 500);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skillEmbeddings")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let inserted = 0;
    for (const embedding of page) {
      const existing = await ctx.db
        .query("embeddingSkillMap")
        .withIndex("by_embedding", (q) => q.eq("embeddingId", embedding._id))
        .unique();
      if (!existing) {
        await ctx.db.insert("embeddingSkillMap", {
          embeddingId: embedding._id,
          skillId: embedding.skillId,
        });
        inserted++;
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillEmbeddingSkillMapInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { inserted, isDone, scanned: page.length };
  },
});

// Sync skillBadges table → denormalized skill.badges field.
// Run after deploying the badge-read removal to ensure all skills
// have up-to-date badges on the skill doc itself.
export const backfillDenormalizedBadgesInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 100, 10, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const skill of page) {
      const records = await ctx.db
        .query("skillBadges")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .take(10);

      // Build canonical badge map from the table
      const canonical: Record<string, { byUserId: Id<"users">; at: number }> = {};
      for (const r of records) {
        canonical[r.kind] = { byUserId: r.byUserId, at: r.at };
      }

      // Compare with existing denormalized badges (keys + values)
      const existing = (skill.badges ?? {}) as Record<
        string,
        { byUserId?: Id<"users">; at?: number } | undefined
      >;
      const canonicalKeys = Object.keys(canonical);
      const existingKeys = Object.keys(existing).filter((k) => existing[k] !== undefined);
      const needsPatch =
        canonicalKeys.length !== existingKeys.length ||
        canonicalKeys.some((k) => {
          const current = existing[k];
          const next = canonical[k];
          return !current || current.byUserId !== next.byUserId || current.at !== next.at;
        });

      if (needsPatch) {
        await ctx.db.patch(skill._id, { badges: canonical });
        patched++;
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillDenormalizedBadgesInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { patched, isDone, scanned: page.length };
  },
});

/**
 * Backfill `latestVersionSummary` on all skills. Cursor-based paginated mutation
 * that self-schedules until done. Reads each skill's latestVersionId, extracts
 * the summary fields, and patches the skill.
 *
 * Always reconciles against the current `latestVersionId` — if the summary is
 * stale (e.g. from a tag retarget), it will be rewritten. To force a full
 * re-backfill, simply re-run the function; every row is re-evaluated.
 */
export const backfillLatestVersionSummaryInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 50, 10, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const skill of page) {
      if (!skill.latestVersionId) continue;
      const version = await ctx.db.get(skill.latestVersionId);
      if (!version) continue;

      const expected = {
        version: version.version,
        createdAt: version.createdAt,
        changelog: version.changelog,
        changelogSource: version.changelogSource,
        clawdis: version.parsed?.clawdis,
      };

      // Skip if already in sync
      const existing = skill.latestVersionSummary;
      if (
        existing &&
        existing.version === expected.version &&
        existing.createdAt === expected.createdAt &&
        existing.changelog === expected.changelog &&
        existing.changelogSource === expected.changelogSource &&
        JSON.stringify(existing.clawdis ?? null) === JSON.stringify(expected.clawdis ?? null)
      ) {
        continue;
      }

      await ctx.db.patch(skill._id, { latestVersionSummary: expected });
      patched++;
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillLatestVersionSummaryInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { patched, isDone, scanned: page.length };
  },
});

/**
 * Backfill `isSuspicious` on all skills. Cursor-based paginated mutation
 * that self-schedules until done.
 */
export const backfillIsSuspiciousInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 100, 10, 200);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const skill of page) {
      const expected = computeIsSuspicious(skill);
      if (skill.isSuspicious !== expected) {
        await ctx.db.patch(skill._id, { isSuspicious: expected });
        patched++;
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillIsSuspiciousInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { patched, isDone, scanned: page.length };
  },
});

// Backfill skillSearchDigest from existing skills.
// Run once after deploying the schema change:
//   npx convex run maintenance:backfillSkillSearchDigestInternal --prod
export const backfillSkillSearchDigestInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 200, 10, 500);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skills")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let inserted = 0;
    for (const skill of page) {
      const existing = await ctx.db
        .query("skillSearchDigest")
        .withIndex("by_skill", (q) => q.eq("skillId", skill._id))
        .unique();
      if (!existing) {
        await ctx.db.insert("skillSearchDigest", extractDigestFields(skill));
        inserted++;
      }
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillSkillSearchDigestInternal, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { inserted, isDone, scanned: page.length };
  },
});

const DIGEST_OWNER_BACKFILL_KEY = "digest-owner-backfill";

// Start/resume backfill:
//   npx convex run maintenance:backfillDigestOwnerFields '{"batchSize":50,"delayMs":5000}' --prod
// Stop:
//   npx convex run maintenance:stopBackfillDigestOwnerFields --prod
// Check status:
//   npx convex run maintenance:backfillDigestOwnerFieldsStatus --prod
export const backfillDigestOwnerFields = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Clear any previous stop flag and store config
    const existing = await ctx.db
      .query("skillStatBackfillState")
      .withIndex("by_key", (q) => q.eq("key", DIGEST_OWNER_BACKFILL_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        cursor: undefined,
        doneAt: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("skillStatBackfillState", {
        key: DIGEST_OWNER_BACKFILL_KEY,
        updatedAt: Date.now(),
      });
    }
    // Kick off first batch
    await ctx.scheduler.runAfter(0, internal.maintenance.backfillDigestOwnerFieldsInternal, {
      batchSize: args.batchSize,
      delayMs: args.delayMs,
    });
    return { started: true };
  },
});

export const stopBackfillDigestOwnerFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db
      .query("skillStatBackfillState")
      .withIndex("by_key", (q) => q.eq("key", DIGEST_OWNER_BACKFILL_KEY))
      .unique();
    if (state) {
      await ctx.db.patch(state._id, { doneAt: Date.now(), updatedAt: Date.now() });
    }
    return { stopped: true };
  },
});

export const backfillDigestOwnerFieldsStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db
      .query("skillStatBackfillState")
      .withIndex("by_key", (q) => q.eq("key", DIGEST_OWNER_BACKFILL_KEY))
      .unique();
    if (!state) return { status: "never_started" };
    if (state.doneAt) return { status: "stopped", cursor: state.cursor, stoppedAt: state.doneAt };
    return { status: "running", cursor: state.cursor };
  },
});

export const backfillDigestOwnerFieldsInternal = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Check stop flag
    const state = await ctx.db
      .query("skillStatBackfillState")
      .withIndex("by_key", (q) => q.eq("key", DIGEST_OWNER_BACKFILL_KEY))
      .unique();
    if (state?.doneAt) {
      return { patched: 0, isDone: false, scanned: 0, stopped: true };
    }

    const batchSize = clampInt(args.batchSize ?? 200, 10, 500);
    const delayMs = clampInt(args.delayMs ?? 0, 0, 60_000);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skillSearchDigest")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const digest of page) {
      if (digest.ownerHandle !== undefined) continue;
      const owner = await ctx.db.get(digest.ownerUserId);
      const isOwnerVisible = owner && !owner.deletedAt && !owner.deactivatedAt;
      await ctx.db.patch(digest._id, {
        ownerHandle: isOwnerVisible ? (owner.handle ?? "") : "",
        ownerName: isOwnerVisible ? owner.name : undefined,
        ownerDisplayName: isOwnerVisible ? owner.displayName : undefined,
        ownerImage: isOwnerVisible ? owner.image : undefined,
      });
      patched++;
    }

    // Save cursor progress
    if (state) {
      await ctx.db.patch(state._id, {
        cursor: continueCursor,
        doneAt: isDone ? Date.now() : undefined,
        updatedAt: Date.now(),
      });
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(
        delayMs,
        internal.maintenance.backfillDigestOwnerFieldsInternal,
        {
          cursor: continueCursor,
          batchSize: args.batchSize,
          delayMs: args.delayMs,
        },
      );
    }

    return { patched, isDone, scanned: page.length, stopped: false };
  },
});

// Backfill latestVersionSummary from skills into existing skillSearchDigest rows.
// Run:
//   npx convex run maintenance:backfillDigestVersionSummary '{"batchSize":100}' --prod
export const backfillDigestVersionSummary = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 200, 10, 500);
    const { page, continueCursor, isDone } = await ctx.db
      .query("skillSearchDigest")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const digest of page) {
      if (digest.latestVersionSummary !== undefined) continue;
      const skill = await ctx.db.get(digest.skillId);
      if (!skill?.latestVersionSummary) continue;
      await ctx.db.patch(digest._id, {
        latestVersionSummary: skill.latestVersionSummary,
      });
      patched++;
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(0, internal.maintenance.backfillDigestVersionSummary, {
        cursor: continueCursor,
        batchSize: args.batchSize,
      });
    }

    return { patched, isDone, scanned: page.length };
  },
});

// Backfill isSuspicious on skillSearchDigest rows where it's undefined.
// Computes from digest's own moderationFlags/moderationReason — no skills table read.
// Run: npx convex run maintenance:backfillDigestIsSuspicious --prod
export const backfillDigestIsSuspicious = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = clampInt(args.batchSize ?? 100, 10, 200);
    const delayMs = args.delayMs ?? 500;
    const { page, continueCursor, isDone } = await ctx.db
      .query("skillSearchDigest")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    let patched = 0;
    for (const digest of page) {
      if (digest.isSuspicious !== undefined) continue;
      const isSuspicious = computeIsSuspicious(digest);
      await ctx.db.patch(digest._id, { isSuspicious });
      patched++;
    }

    if (!isDone) {
      await ctx.scheduler.runAfter(delayMs, internal.maintenance.backfillDigestIsSuspicious, {
        cursor: continueCursor,
        batchSize: args.batchSize,
        delayMs: args.delayMs,
      });
    }

    return { patched, isDone, scanned: page.length };
  },
});

function clampInt(value: number, min: number, max: number) {
  const rounded = Math.trunc(value);
  if (!Number.isFinite(rounded)) return min;
  return Math.min(max, Math.max(min, rounded));
}
