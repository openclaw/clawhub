import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { sha256Hex } from "./lib/clawpack";
import {
  MAX_SKILL_PRESENTATION_YAML_BYTES,
  OPENAI_SKILL_PRESENTATION_PATH,
  buildSkillPresentationIconPath,
  parseOpenAiSkillPresentation,
  validateSkillPresentationIcon,
} from "./lib/skillPresentation";
import {
  preserveHistoricalHostedIcon,
  resolveHistoricalSkillPresentation,
} from "./lib/skillPresentationBackfill";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import {
  isDecodableSkillPresentationRaster,
  storeSkillPresentationAsset,
  type SkillPresentationContentType,
} from "./skillPresentationAssets";

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 50;
const MAX_MAX_BATCHES = 500;
const APPLY_CONFIRM = "backfill-skill-presentation-metadata";
const MAX_SAMPLES = 25;

type BackfillCandidate = {
  skillId: Id<"skills">;
  slug: string;
  displayName: string;
  summary?: string;
  skillIcon?: string;
  versionId: Id<"skillVersions">;
  versionIcon?: string;
  parsed: Doc<"skillVersions">["parsed"];
  files: Doc<"skillVersions">["files"];
};

type BackfillPage = {
  candidates: BackfillCandidate[];
  cursor: string | null;
  isDone: boolean;
  stats: {
    skillsScanned: number;
    skippedDeleted: number;
    skippedGitHub: number;
    missingLatestVersion: number;
    unavailableLatestVersion: number;
  };
};

type BackfillStats = BackfillPage["stats"] & {
  metadataFilesFound: number;
  eligibleSkills: number;
  eligibleSkillsWithIcon: number;
  missingMetadataBlob: number;
  invalidMetadata: number;
  missingIconFile: number;
  invalidIcon: number;
  alreadyCurrent: number;
  wouldPatchSkills: number;
  patchedSkills: number;
  changedBeforeApply: number;
};

type BackfillSample = {
  skillId: Id<"skills">;
  versionId: Id<"skillVersions">;
  slug: string;
  displayName: string;
  nextDisplayName: string;
  hasIcon: boolean;
};

type BackfillResult = {
  ok: true;
  dryRun: boolean;
  confirmRequired?: typeof APPLY_CONFIRM;
  cursor: string | null;
  isDone: boolean;
  stats: BackfillStats;
  samples: BackfillSample[];
};

type PreparedIcon = {
  bytes: Uint8Array;
  contentType: SkillPresentationContentType;
  sha256: string;
};

export const getBackfillPageInternal = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillPage> => {
    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const page = await ctx.db
      .query("skills")
      .order("asc")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    const candidates: BackfillCandidate[] = [];
    const stats = {
      skillsScanned: page.page.length,
      skippedDeleted: 0,
      skippedGitHub: 0,
      missingLatestVersion: 0,
      unavailableLatestVersion: 0,
    };

    for (const skill of page.page) {
      if (skill.softDeletedAt !== undefined) {
        stats.skippedDeleted += 1;
        continue;
      }
      if (skill.installKind === "github") {
        stats.skippedGitHub += 1;
        continue;
      }
      if (!skill.latestVersionId) {
        stats.missingLatestVersion += 1;
        continue;
      }
      const version = await ctx.db.get(skill.latestVersionId);
      if (
        !version ||
        version.skillId !== skill._id ||
        version.softDeletedAt !== undefined ||
        version.ownerDeletedAt !== undefined ||
        version.publicationStatus === "pending" ||
        version.publicationStatus === "blocked"
      ) {
        stats.unavailableLatestVersion += 1;
        continue;
      }
      candidates.push({
        skillId: skill._id,
        slug: skill.slug,
        displayName: skill.displayName,
        summary: skill.summary,
        skillIcon: skill.icon,
        versionId: version._id,
        versionIcon: version.icon,
        parsed: version.parsed,
        files: version.files,
      });
    }

    return {
      candidates,
      cursor: page.continueCursor,
      isDone: page.isDone,
      stats,
    };
  },
});

export const applyBackfillPatchInternal = internalMutation({
  args: {
    confirm: v.string(),
    skillId: v.id("skills"),
    versionId: v.id("skillVersions"),
    displayName: v.string(),
    displayNameSource: v.union(
      v.literal("publisher"),
      v.literal("openai"),
      v.literal("skill"),
      v.literal("slug"),
    ),
    summary: v.optional(v.string()),
    summarySource: v.optional(
      v.union(
        v.literal("publisher"),
        v.literal("openai"),
        v.literal("skill"),
        v.literal("generated"),
      ),
    ),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.confirm !== APPLY_CONFIRM) {
      throw new ConvexError(`Pass confirm="${APPLY_CONFIRM}" to apply.`);
    }
    const skill = await ctx.db.get(args.skillId);
    const version = await ctx.db.get(args.versionId);
    if (
      !skill ||
      !version ||
      skill.latestVersionId !== version._id ||
      version.skillId !== skill._id ||
      skill.softDeletedAt !== undefined ||
      version.softDeletedAt !== undefined ||
      version.ownerDeletedAt !== undefined ||
      version.publicationStatus === "pending" ||
      version.publicationStatus === "blocked"
    ) {
      return { patched: false as const, reason: "changed_before_apply" as const };
    }

    const presentation = {
      displayName: args.displayName,
      displayNameSource: args.displayNameSource,
      ...(args.summary && args.summarySource
        ? { summary: args.summary, summarySource: args.summarySource }
        : {}),
      ...(args.icon ? { icon: args.icon } : {}),
    };
    await ctx.db.patch(version._id, {
      parsed: { ...version.parsed, presentation },
      // Legacy publisher icons are independent of agents/openai.yaml metadata.
      ...(args.icon ? { icon: args.icon } : {}),
    });
    await ctx.db.patch(skill._id, {
      displayName: args.displayName,
      ...(args.summary ? { summary: args.summary } : {}),
      ...(args.icon ? { icon: args.icon } : {}),
      ...(skill.latestVersionSummary && args.summary
        ? {
            latestVersionSummary: {
              ...skill.latestVersionSummary,
              description: args.summary,
            },
          }
        : {}),
    });
    await syncSkillSearchDigestForSkill(ctx, await ctx.db.get(skill._id));
    return { patched: true as const };
  },
});

export const runInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    confirm: v.optional(v.string()),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BackfillResult> => {
    // This stays action-driven instead of using @convex-dev/migrations because
    // every candidate needs storage reads and raster validation before a write.
    const dryRun = args.dryRun !== false;
    if (!dryRun && args.confirm !== APPLY_CONFIRM) {
      throw new ConvexError(`Pass confirm="${APPLY_CONFIRM}" to apply.`);
    }
    const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES);
    const stats = emptyStats();
    const samples: BackfillSample[] = [];
    let cursor: string | null = args.cursor ?? null;
    let isDone = false;

    for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
      const page = (await ctx.runQuery(internal.skillPresentationBackfill.getBackfillPageInternal, {
        cursor: cursor ?? undefined,
        batchSize: args.batchSize,
      })) as BackfillPage;
      addPageStats(stats, page.stats);
      cursor = page.cursor;
      isDone = page.isDone;

      for (const candidate of page.candidates) {
        const metadataFile = candidate.files.find(
          (file) => file.path.toLowerCase() === OPENAI_SKILL_PRESENTATION_PATH,
        );
        if (!metadataFile) continue;
        stats.metadataFilesFound += 1;
        const metadataBlob = await ctx.storage.get(metadataFile.storageId);
        if (!metadataBlob) {
          stats.missingMetadataBlob += 1;
          continue;
        }
        if (metadataBlob.size > MAX_SKILL_PRESENTATION_YAML_BYTES) {
          stats.invalidMetadata += 1;
          continue;
        }
        const openAi = parseOpenAiSkillPresentation(await metadataBlob.text());
        if (!openAi) {
          stats.invalidMetadata += 1;
          continue;
        }

        stats.eligibleSkills += 1;
        const presentation = resolveHistoricalSkillPresentation({
          slug: candidate.slug,
          currentDisplayName: candidate.displayName,
          currentSummary: candidate.summary,
          frontmatter: candidate.parsed.frontmatter,
          openAi,
        });
        const preparedIcon = await prepareIcon(ctx, candidate.files, presentation.iconPaths, stats);
        const iconPath = preparedIcon
          ? buildSkillPresentationIconPath(preparedIcon.sha256)
          : preserveHistoricalHostedIcon(
              candidate.parsed.presentation?.icon,
              candidate.versionIcon,
              candidate.skillIcon,
            );
        if (preparedIcon) stats.eligibleSkillsWithIcon += 1;
        const nextPresentation = {
          displayName: presentation.displayName,
          displayNameSource: presentation.displayNameSource,
          ...(presentation.summary && presentation.summarySource
            ? { summary: presentation.summary, summarySource: presentation.summarySource }
            : {}),
          ...(iconPath ? { icon: iconPath } : {}),
        };
        const alreadyCurrent =
          samePresentation(candidate.parsed.presentation, nextPresentation) &&
          candidate.displayName === presentation.displayName &&
          (candidate.summary ?? undefined) === (presentation.summary ?? undefined) &&
          // An absent presentation icon must not clear an unrelated publisher icon.
          (!iconPath || (candidate.versionIcon === iconPath && candidate.skillIcon === iconPath));
        if (alreadyCurrent) {
          stats.alreadyCurrent += 1;
          continue;
        }

        stats.wouldPatchSkills += 1;
        if (samples.length < MAX_SAMPLES) {
          samples.push({
            skillId: candidate.skillId,
            versionId: candidate.versionId,
            slug: candidate.slug,
            displayName: candidate.displayName,
            nextDisplayName: presentation.displayName,
            hasIcon: Boolean(preparedIcon),
          });
        }
        if (dryRun) continue;
        const storedIcon = preparedIcon
          ? await storeSkillPresentationAsset(ctx, preparedIcon)
          : iconPath;
        const result = (await ctx.runMutation(
          internal.skillPresentationBackfill.applyBackfillPatchInternal,
          {
            confirm: args.confirm as string,
            skillId: candidate.skillId,
            versionId: candidate.versionId,
            displayName: presentation.displayName,
            displayNameSource: presentation.displayNameSource,
            summary: presentation.summary,
            summarySource: presentation.summarySource,
            icon: storedIcon,
          },
        )) as { patched: boolean; reason?: "changed_before_apply" };
        if (result.patched) stats.patchedSkills += 1;
        else stats.changedBeforeApply += 1;
      }

      if (isDone) break;
    }

    return {
      ok: true,
      dryRun,
      ...(dryRun ? { confirmRequired: APPLY_CONFIRM } : {}),
      cursor,
      isDone,
      stats,
      samples,
    };
  },
});

async function prepareIcon(
  ctx: ActionCtx,
  files: Doc<"skillVersions">["files"],
  iconPaths: string[] | undefined,
  stats: BackfillStats,
): Promise<PreparedIcon | undefined> {
  for (const iconPath of iconPaths ?? []) {
    const file = files.find((candidate) => candidate.path === iconPath);
    if (!file) {
      stats.missingIconFile += 1;
      continue;
    }
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) {
      stats.missingIconFile += 1;
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try {
      const validated = validateSkillPresentationIcon({
        path: iconPath,
        bytes,
        contentType: file.contentType,
      });
      if (
        validated.contentType !== "image/svg+xml" &&
        !(await isDecodableSkillPresentationRaster(ctx, {
          bytes,
          contentType: validated.contentType,
        }))
      ) {
        stats.invalidIcon += 1;
        continue;
      }
      return {
        bytes,
        contentType: validated.contentType,
        sha256: await sha256Hex(bytes),
      };
    } catch {
      stats.invalidIcon += 1;
    }
  }
  return undefined;
}

function emptyStats(): BackfillStats {
  return {
    skillsScanned: 0,
    skippedDeleted: 0,
    skippedGitHub: 0,
    missingLatestVersion: 0,
    unavailableLatestVersion: 0,
    metadataFilesFound: 0,
    eligibleSkills: 0,
    eligibleSkillsWithIcon: 0,
    missingMetadataBlob: 0,
    invalidMetadata: 0,
    missingIconFile: 0,
    invalidIcon: 0,
    alreadyCurrent: 0,
    wouldPatchSkills: 0,
    patchedSkills: 0,
    changedBeforeApply: 0,
  };
}

function addPageStats(target: BackfillStats, page: BackfillPage["stats"]) {
  target.skillsScanned += page.skillsScanned;
  target.skippedDeleted += page.skippedDeleted;
  target.skippedGitHub += page.skippedGitHub;
  target.missingLatestVersion += page.missingLatestVersion;
  target.unavailableLatestVersion += page.unavailableLatestVersion;
}

function samePresentation(
  current: Doc<"skillVersions">["parsed"]["presentation"],
  next: NonNullable<Doc<"skillVersions">["parsed"]["presentation"]>,
) {
  return (
    current?.displayName === next.displayName &&
    current.displayNameSource === next.displayNameSource &&
    (current.summary ?? undefined) === (next.summary ?? undefined) &&
    (current.summarySource ?? undefined) === (next.summarySource ?? undefined) &&
    (current.icon ?? undefined) === (next.icon ?? undefined)
  );
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
