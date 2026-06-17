"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./functions";
import { assertAdmin } from "./lib/access";
import { guessContentTypeForPath } from "./lib/contentTypes";
import { isPublicSkillDoc } from "./lib/globalStats";
import {
  fetchSkillVersionBackupMeta,
  getRegistryArtifactBackupContext,
  isRegistryArtifactBackupConfigured,
  normalizeOwner,
  readRegistryArtifactBackupObject,
} from "./lib/registryArtifactBackup";
import { publishVersionForUser } from "./lib/skillPublish";
import { validateFilePath } from "./lib/skillZip";

type RestoreResult = {
  slug: string;
  status: "restored" | "slug_conflict" | "already_exists" | "no_backup" | "error";
  detail?: string;
};

type BulkRestoreResult = {
  results: RestoreResult[];
  totalRestored: number;
  totalConflicts: number;
  totalSkipped: number;
  totalErrors: number;
};

type SkillBackupMeta = NonNullable<Awaited<ReturnType<typeof fetchSkillVersionBackupMeta>>>;

type VerifiedSkillBackup = {
  meta: SkillBackupMeta;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    contentType: string;
    content: Uint8Array;
  }>;
};

/**
 * Admin-only: restore a single skill from registry artifact backup.
 * Reads backed-up objects and re-creates the skill in the database.
 */
export const restoreSkillFromBackup = internalAction({
  args: {
    actorUserId: v.id("users"),
    ownerHandle: v.string(),
    ownerUserId: v.id("users"),
    slug: v.string(),
    version: v.optional(v.string()),
    forceOverwriteSquatter: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<RestoreResult> => {
    try {
      const actor = await ctx.runQuery(internal.users.getByIdInternal, {
        userId: args.actorUserId,
      });
      if (!actor || actor.deletedAt || actor.deactivatedAt) {
        return { slug: args.slug, status: "error", detail: "Actor not found" };
      }
      assertAdmin(actor as Doc<"users">);

      if (!isRegistryArtifactBackupConfigured()) {
        return { slug: args.slug, status: "error", detail: "Registry backup not configured" };
      }

      const backupContext = getRegistryArtifactBackupContext();
      if (!args.version) {
        return {
          slug: args.slug,
          status: "no_backup",
          detail: "Restore requires an explicit backup version",
        };
      }

      let verifiedBackup: VerifiedSkillBackup | null = null;
      const loadVerifiedBackup = async (): Promise<VerifiedSkillBackup | RestoreResult> => {
        if (verifiedBackup) return verifiedBackup;
        const meta = await fetchSkillVersionBackupMeta(
          backupContext,
          args.ownerHandle,
          args.slug,
          args.version!,
        );
        if (!meta) {
          return { slug: args.slug, status: "no_backup", detail: "No version backup found" };
        }

        const backupFiles = meta.metadata.files;
        if (backupFiles.length === 0) {
          return { slug: args.slug, status: "no_backup", detail: "Backup has no files" };
        }

        const owner = normalizeOwner(args.ownerHandle);
        const files: VerifiedSkillBackup["files"] = [];
        for (const file of backupFiles) {
          if (!validateFilePath(file.path)) {
            return { slug: args.slug, status: "error", detail: "Backup contains unsafe file path" };
          }
          const fileContent = await readRegistryArtifactBackupObject(
            backupContext,
            `${backupContext.skillsRoot}/${owner}/${args.slug}/${encodeBackupPathSegment(
              meta.version,
            )}/${file.path}`,
          );
          if (!fileContent) {
            return {
              slug: args.slug,
              status: "error",
              detail: `Backup missing file ${file.path}`,
            };
          }
          if (fileContent.byteLength !== file.size) {
            return {
              slug: args.slug,
              status: "error",
              detail: `Backup file size mismatch for ${file.path}`,
            };
          }

          const sha256 = await sha256Hex(fileContent);
          if (sha256 !== file.sha256) {
            return {
              slug: args.slug,
              status: "error",
              detail: `Backup file checksum mismatch for ${file.path}`,
            };
          }

          files.push({
            path: file.path,
            size: fileContent.byteLength,
            sha256,
            contentType: file.contentType ?? guessContentTypeForPath(file.path),
            content: fileContent,
          });
        }

        verifiedBackup = { meta, files };
        return verifiedBackup;
      };

      // Check if skill already exists in the DB
      const existingSkill = (await ctx.runQuery(
        internal.skills.getSkillBySlugIncludingSoftDeletedInternal,
        {
          slug: args.slug,
        },
      )) as Doc<"skills"> | null;

      const sameOwnerSoftDeletedSkill =
        existingSkill?.ownerUserId === args.ownerUserId && existingSkill.softDeletedAt
          ? existingSkill
          : null;

      if (existingSkill) {
        const sameOwner = existingSkill.ownerUserId === args.ownerUserId;
        if (sameOwner && existingSkill.softDeletedAt) {
          // Continue: if the backed-up version already exists, restore by
          // reactivating that row instead of republishing a duplicate version.
        } else if (!isPublicSkillDoc(existingSkill)) {
          return {
            slug: args.slug,
            status: "error",
            detail: "Existing skill is not public; restore blocked",
          };
        } else if (sameOwner) {
          return {
            slug: args.slug,
            status: "already_exists",
            detail: "Skill already owned by user",
          };
        } else if (!args.forceOverwriteSquatter) {
          return {
            slug: args.slug,
            status: "slug_conflict",
            detail: `Slug occupied by another user. Set forceOverwriteSquatter=true to reclaim.`,
          };
        } else {
          const backup = await loadVerifiedBackup();
          if ("status" in backup) return backup;
          // Free the slug in-transaction by renaming the squatter, then enqueue cleanup.
          await ctx.runMutation(
            internal.registryArtifactRestoreMutations.evictSquatterSkillForRestoreInternal,
            {
              actorUserId: args.actorUserId,
              slug: args.slug,
              rightfulOwnerUserId: args.ownerUserId,
            },
          );
        }
      }

      const backup = verifiedBackup ?? (await loadVerifiedBackup());
      if ("status" in backup) return backup;
      const { meta } = backup;

      // Download and store each file in Convex storage
      const storedFiles: Array<{
        path: string;
        size: number;
        storageId: Id<"_storage">;
        sha256: string;
        contentType: string;
      }> = [];

      for (const file of backup.files) {
        const blob = new Blob([Buffer.from(file.content)], { type: file.contentType });
        const storageId = await ctx.storage.store(blob);

        storedFiles.push({
          path: file.path,
          size: file.size,
          storageId,
          sha256: file.sha256,
          contentType: file.contentType,
        });
      }

      if (storedFiles.length === 0) {
        return { slug: args.slug, status: "error", detail: "Could not download any backup files" };
      }

      if (sameOwnerSoftDeletedSkill) {
        const existingVersion = (await ctx.runQuery(
          internal.skills.getVersionBySkillAndVersionInternal,
          {
            skillId: sameOwnerSoftDeletedSkill._id,
            version: meta.version,
          },
        )) as Doc<"skillVersions"> | null;
        if (existingVersion && !existingVersion.softDeletedAt) {
          await ctx.runMutation(internal.skills.setSkillSoftDeletedInternal, {
            userId: args.actorUserId,
            slug: args.slug,
            deleted: false,
            reason: "Restored from registry artifact backup",
          });
          await ctx.runMutation(
            internal.registryArtifactRestoreMutations.refreshRestoredSkillVersionInternal,
            {
              actorUserId: args.actorUserId,
              skillId: sameOwnerSoftDeletedSkill._id,
              versionId: existingVersion._id,
              files: storedFiles,
            },
          );
          return { slug: args.slug, status: "restored" };
        }
      }

      await publishVersionForUser(
        ctx,
        args.ownerUserId,
        {
          slug: args.slug,
          displayName: meta.displayName,
          version: meta.version,
          changelog: "Restored from registry artifact backup",
          files: storedFiles,
        },
        {
          bypassGitHubAccountAge: true,
          bypassNewSkillRateLimit: true,
          bypassQualityGate: true,
          skipBackup: true,
          skipWebhook: true,
        },
      );

      return { slug: args.slug, status: "restored" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[restore] Failed to restore ${args.slug}:`, message);
      return { slug: args.slug, status: "error", detail: message };
    }
  },
});

/**
 * Admin-only: bulk restore all skills for a user from registry artifact backup.
 */
export const restoreUserSkillsFromBackup = internalAction({
  args: {
    actorUserId: v.id("users"),
    ownerHandle: v.string(),
    ownerUserId: v.id("users"),
    slugs: v.array(v.string()),
    versionsBySlug: v.optional(v.record(v.string(), v.string())),
    forceOverwriteSquatter: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BulkRestoreResult> => {
    const results: RestoreResult[] = [];
    let totalRestored = 0;
    let totalConflicts = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const slug of args.slugs) {
      const result = (await ctx.runAction(internal.registryArtifactRestore.restoreSkillFromBackup, {
        actorUserId: args.actorUserId,
        ownerHandle: args.ownerHandle,
        ownerUserId: args.ownerUserId,
        slug,
        version: args.versionsBySlug?.[slug],
        forceOverwriteSquatter: args.forceOverwriteSquatter,
      })) as RestoreResult;

      results.push(result);

      switch (result.status) {
        case "restored":
          totalRestored += 1;
          break;
        case "slug_conflict":
          totalConflicts += 1;
          break;
        case "already_exists":
        case "no_backup":
          totalSkipped += 1;
          break;
        case "error":
          totalErrors += 1;
          break;
      }
    }

    return { results, totalRestored, totalConflicts, totalSkipped, totalErrors };
  },
});

async function sha256Hex(bytes: Uint8Array) {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
}

function encodeBackupPathSegment(value: string) {
  return encodeURIComponent(value.trim()).replace(/\./g, "%2E");
}

// guessContentTypeForPath in lib/contentTypes.ts
