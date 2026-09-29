import {
  getDeclaredPluginCategoriesFromManifest,
  isCurrentPluginCategoryAssignment,
} from "clawhub-schema";
import { paginationOptsValidator } from "convex/server";
import { convexToJson, ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery, type ActionCtx, type QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import bundledInventory from "./lib/bundledPluginCategoryAssignments.json";
import { sha256Hex } from "./lib/clawpack";
import {
  derivePluginManifestSummary,
  maybeParseJson,
  readStorageText,
  REAL_BUNDLE_MANIFESTS,
} from "./lib/packageRegistry";
import {
  classifyPluginCategories,
  readPluginCategoryDocumentation,
  PLUGIN_CATEGORY_CLASSIFIER_VERSION,
} from "./lib/pluginCategoryClassification";
import {
  pluginCategoryClassificationValidator,
  pluginCategoryCorrectionValidator,
  pluginCategoryReviewProvenanceValidator,
} from "./lib/pluginCategoryClassificationContract";
import {
  categoryReviewPayload,
  validateCategoryCorrections,
  validateCategoryPackageNames,
} from "./lib/pluginCategoryReview";
import { pluginManifestSummaryValidator } from "./schema";

const bundledAssignments = new Map(
  bundledInventory.assignments.map((entry) => [entry.packageName, entry]),
);

function generatedAssignmentIsCurrent(row: Doc<"pluginCategoryRefreshes">) {
  return (
    isCurrentPluginCategoryAssignment(row.review ? [row.review.category] : row.categories) &&
    (row.review !== undefined ||
      row.classification.source !== "generated" ||
      row.classification.classifierVersion === PLUGIN_CATEGORY_CLASSIFIER_VERSION)
  );
}

function bundledAssignment(
  pkg: Doc<"packages">,
  release: Doc<"packageReleases">,
  publisher: Doc<"publishers"> | null,
) {
  const assignment = bundledAssignments.get(pkg.name);
  if (
    !assignment ||
    publisher?.kind !== "org" ||
    publisher.handle !== "openclaw" ||
    release.extractedPluginManifest?.id !== assignment.pluginId ||
    (release.source?.repo ?? release.sourceRepo) !== "openclaw/openclaw"
  )
    return undefined;
  return assignment;
}

function eligible(pkg: Doc<"packages"> | null, release: Doc<"packageReleases"> | null) {
  return Boolean(
    pkg &&
    release &&
    (pkg.family === "code-plugin" || pkg.family === "bundle-plugin") &&
    !pkg.softDeletedAt &&
    !release.softDeletedAt &&
    release.ownerDeletedAt === undefined &&
    pkg.latestReleaseId === release._id &&
    release.packageId === pkg._id &&
    (release.publicationStatus === undefined || release.publicationStatus === "published"),
  );
}

// Include the actual declaration and effective category state, not unrelated download counters.
function snapshotFields(pkg: Doc<"packages">, release: Doc<"packageReleases">) {
  return {
    releaseId: release._id,
    latestReleaseId: pkg.latestReleaseId,
    categories: pkg.categories,
    releaseCategories: release.pluginManifestSummary?.categories,
    inferredCategories: pkg.inferredCategories,
    inferredFromReleaseId: pkg.inferredFromReleaseId,
    hadSummary: Boolean(release.pluginManifestSummary),
    // Prepared review metadata must hash like its persisted Convex representation.
    classification: release.categoryClassification
      ? convexToJson(release.categoryClassification)
      : undefined,
    integrity: release.integritySha256,
    manifest: release.extractedPluginManifest,
    ownerPublisherId: pkg.ownerPublisherId,
    source: release.source,
    sourceRepo: release.sourceRepo,
    package: release.extractedPackageJson,
    bundle: release.normalizedBundleManifest,
    files: release.files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
}
const hash = (value: unknown) => sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
const snapshotHash = (pkg: Doc<"packages">, release: Doc<"packageReleases">) =>
  hash(snapshotFields(pkg, release));

async function sourceHash(pkg: Doc<"packages">, release: Doc<"packageReleases">) {
  // A reviewed release may become latest again. Bind its artifact/owner identity,
  // not the mutable projection or inference fields that publication replaces.
  const {
    latestReleaseId: _latestReleaseId,
    categories: _categories,
    releaseCategories: _releaseCategories,
    inferredCategories: _inferredCategories,
    inferredFromReleaseId: _inferredFromReleaseId,
    hadSummary: _hadSummary,
    classification: _classification,
    ...source
  } = snapshotFields(pkg, release);
  return hash({
    ...source,
    packageId: pkg._id,
    packageName: pkg.name,
    family: pkg.family,
    ownerUserId: pkg.ownerUserId,
  });
}

function acceptedAssignment(row: Doc<"pluginCategoryRefreshes">) {
  return row.review
    ? {
        categories: [row.review.category],
        classification: {
          source: "reviewed" as const,
          reviewId: row._id,
          classifierVersion: "plugin-category-staff-review-v1",
          inputHash: row.classification.inputHash,
          evidence: row.review.evidence,
        },
      }
    : { categories: row.categories, classification: row.classification };
}

async function retainedReview(
  ctx: Pick<QueryCtx, "db">,
  pkg: Doc<"packages">,
  release: Doc<"packageReleases">,
) {
  if (release.categoryClassification?.source !== "reviewed") return undefined;
  const row = await ctx.db.get(release.categoryClassification.reviewId);
  if (
    !row?.review ||
    row.status !== "applied" ||
    row.packageId !== pkg._id ||
    row.releaseId !== release._id ||
    !isCurrentPluginCategoryAssignment([row.review.category]) ||
    row.review.sourceHash !== (await sourceHash(pkg, release))
  )
    return undefined;
  const assignment = acceptedAssignment(row);
  const current = release.categoryClassification;
  if (
    current.inputHash !== assignment.classification.inputHash ||
    current.classifierVersion !== assignment.classification.classifierVersion ||
    current.evidence !== assignment.classification.evidence ||
    JSON.stringify(release.pluginManifestSummary?.categories) !==
      JSON.stringify(assignment.categories)
  )
    return undefined;
  return assignment;
}

export const getEvidence = internalQuery({
  args: { packageId: v.id("packages"), runId: v.string() },
  handler: async (ctx, { packageId, runId }) => {
    const existing = await ctx.db
      .query("pluginCategoryRefreshes")
      .withIndex("by_run_package", (q) => q.eq("runId", runId).eq("packageId", packageId))
      .unique();
    if (existing) return null;
    const pkg = await ctx.db.get(packageId);
    const release = pkg?.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
    if (!pkg || !release || !eligible(pkg, release)) return null;
    const publisher = pkg.ownerPublisherId ? await ctx.db.get(pkg.ownerPublisherId) : null;
    return {
      pkg,
      release,
      beforeHash: await snapshotHash(pkg, release),
      bundled: bundledAssignment(pkg, release, publisher),
      reviewed: await retainedReview(ctx, pkg, release),
    };
  },
});

export const getPage = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.number(),
    packageNames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    if (args.packageNames !== undefined) {
      if (args.cursor !== undefined)
        throw new ConvexError("Named package selection cannot include a cursor.");
      const names = validateCategoryPackageNames(args.packageNames);
      const packages = await Promise.all(
        names.map((name) =>
          ctx.db
            .query("packages")
            .withIndex("by_name", (q) => q.eq("normalizedName", name))
            .unique(),
        ),
      );
      const ids = packages.map((pkg, index) => {
        if (!pkg || (pkg.family !== "code-plugin" && pkg.family !== "bundle-plugin"))
          throw new ConvexError(
            `Named selection requires an existing plugin package: ${names[index]}`,
          );
        return pkg._id;
      });
      return { ids, cursor: "", isDone: true };
    }
    const page = await ctx.db
      .query("packages")
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: Math.max(1, Math.min(10, Math.floor(args.batchSize))),
        maximumBytesRead: 4_000_000,
      });
    return {
      ids: page.page
        .filter((pkg) => pkg.family === "code-plugin" || pkg.family === "bundle-plugin")
        .map((pkg) => pkg._id),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const storePreview = internalMutation({
  args: {
    runId: v.string(),
    packageId: v.id("packages"),
    releaseId: v.id("packageReleases"),
    beforeHash: v.string(),
    categories: v.array(v.string()),
    classification: pluginCategoryClassificationValidator,
    newReleaseSummary: v.optional(pluginManifestSummaryValidator),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pluginCategoryRefreshes")
      .withIndex("by_run_package", (q) => q.eq("runId", args.runId).eq("packageId", args.packageId))
      .unique();
    if (existing) return existing._id;
    const pkg = await ctx.db.get(args.packageId);
    const release = await ctx.db.get(args.releaseId);
    if (
      !pkg ||
      !release ||
      !eligible(pkg, release) ||
      (await snapshotHash(pkg, release)) !== args.beforeHash
    )
      return null;
    return ctx.db.insert("pluginCategoryRefreshes", {
      ...args,
      packageName: pkg.name,
      version: release.version,
      beforeCategories: pkg.categories,
      beforeReleaseCategories: release.pluginManifestSummary?.categories,
      beforeHadSummary: Boolean(release.pluginManifestSummary),
      beforeClassification: release.categoryClassification,
      status: "preview",
      createdAt: Date.now(),
    });
  },
});

function isManifestRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readRefreshManifests(
  ctx: Pick<ActionCtx, "storage">,
  family: Doc<"packages">["family"],
  release: Doc<"packageReleases">,
) {
  const readManifest = async (file: Doc<"packageReleases">["files"][number]) => {
    if (file.size > 512_000) return undefined;
    return maybeParseJson(await readStorageText(ctx, file.storageId, { maxBytes: 512_000 }));
  };
  let pluginManifest: unknown = release.extractedPluginManifest;
  if (pluginManifest == null) {
    const file = release.files.find((candidate) => candidate.path === "openclaw.plugin.json");
    if (file) {
      pluginManifest = await readManifest(file);
      // An unreadable root may contain an explicit declaration; never bypass it with bundle data.
      if (!isManifestRecord(pluginManifest)) return null;
    }
  } else if (!isManifestRecord(pluginManifest)) {
    return null;
  }
  let bundleManifest: unknown = release.normalizedBundleManifest;
  if (isManifestRecord(pluginManifest)) return { pluginManifest, bundleManifest };
  if (family !== "bundle-plugin") return null;

  // Historical bundles predate the required OpenClaw root. Their foreign manifest is evidence,
  // not an OpenClaw category declaration, and follows the same marker order as publication.
  if (!isManifestRecord(bundleManifest)) {
    for (const marker of REAL_BUNDLE_MANIFESTS) {
      const file = release.files.find((candidate) => candidate.path === marker.path);
      if (!file) continue;
      bundleManifest = await readManifest(file);
      break;
    }
  }
  if (!isManifestRecord(bundleManifest) || Object.keys(bundleManifest).length === 0) return null;
  return { pluginManifest: undefined, bundleManifest };
}

/** One bounded page per call; the returned cursor resumes without replacing reviewed rows. */
export const preview = internalAction({
  args: {
    runId: v.string(),
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    packageNames: v.optional(v.array(v.string())),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    cursor: string;
    isDone: boolean;
    previewed: number;
    skipped: number;
    failed: number;
    diagnostics: Array<{ packageId: string; reason: string }>;
  }> => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(args.runId))
      throw new ConvexError(
        "Use a run ID of 1–80 letters, numbers, dots, underscores, or hyphens.",
      );
    const page = await ctx.runQuery(internal.pluginCategoryRefresh.getPage, {
      cursor: args.cursor,
      batchSize: args.batchSize ?? 10,
      packageNames: args.packageNames,
    });
    let previewed = 0;
    let skipped = 0;
    let failed = 0;
    const diagnostics: Array<{ packageId: string; reason: string }> = [];
    for (const packageId of page.ids) {
      const current = await ctx.runQuery(internal.pluginCategoryRefresh.getEvidence, {
        packageId,
        runId: args.runId,
      });
      if (!current) {
        skipped++;
        diagnostics.push({ packageId, reason: "Already previewed or no eligible latest release." });
        continue;
      }
      try {
        const manifests = await readRefreshManifests(ctx, current.pkg.family, current.release);
        if (!manifests) {
          skipped++;
          diagnostics.push({ packageId, reason: "No bounded plugin manifest evidence." });
          continue;
        }
        const { pluginManifest, bundleManifest } = manifests;
        const documentation = await readPluginCategoryDocumentation(ctx, {
          files: current.release.files,
          pluginManifest,
          bundleManifest,
        });
        // Current single-purpose declarations remain authoritative; older capability
        // categories are refreshed from reviewed source without rewriting the artifact.
        if (current.release.categoryClassification?.source === "reviewed" && !current.reviewed)
          diagnostics.push({
            packageId,
            reason: "Prior staff decision no longer matches this source. Fresh review required.",
          });
        const assignment =
          current.reviewed ??
          (current.bundled &&
          !isCurrentPluginCategoryAssignment(
            getDeclaredPluginCategoriesFromManifest(pluginManifest),
          )
            ? {
                categories: getDeclaredPluginCategoriesFromManifest(current.bundled)!,
                classification: {
                  source: "bundled" as const,
                  classifierVersion: `bundled-product-categories:${bundledInventory.sourceCommit}`,
                  inputHash: current.bundled.manifestSha256,
                  evidence: `Reviewed OpenClaw bundled manifest: extensions/${current.bundled.pluginId}/openclaw.plugin.json`,
                },
              }
            : await classifyPluginCategories(
                {
                  name: current.pkg.name,
                  pluginManifest,
                  packageJson: current.release.extractedPackageJson,
                  bundleManifest,
                  documentation,
                },
                // Legacy declarations remain readable but no longer choose discovery purpose.
                { allowLegacyDeclarations: true },
              ));
        const id = await ctx.runMutation(internal.pluginCategoryRefresh.storePreview, {
          runId: args.runId,
          packageId,
          releaseId: current.release._id,
          beforeHash: current.beforeHash,
          categories: assignment.categories,
          classification: assignment.classification,
          ...(!current.release.pluginManifestSummary && {
            newReleaseSummary: derivePluginManifestSummary({
              pluginManifest: pluginManifest ?? {},
              skillManifest: isManifestRecord(bundleManifest) ? bundleManifest : undefined,
              files: current.release.files,
              compatibility: current.release.compatibility,
            }),
          }),
        });
        if (id) {
          previewed++;
          if (assignment.classification.source === "fallback") {
            failed++;
            diagnostics.push({ packageId, reason: assignment.classification.evidence });
          }
        } else {
          skipped++;
          diagnostics.push({
            packageId,
            reason: "Release or category evidence changed during preview.",
          });
        }
      } catch {
        // Individual malformed artifacts must not prevent a cursor from advancing.
        failed++;
        diagnostics.push({
          packageId,
          reason: "Artifact evidence could not be read or validated.",
        });
      }
    }
    return { cursor: page.cursor, isDone: page.isDone, previewed, skipped, failed, diagnostics };
  },
});

export const list = internalQuery({
  args: { runId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems > 100)
      throw new ConvexError("At most 100 preview rows per page.");
    return ctx.db
      .query("pluginCategoryRefreshes")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .paginate(args.paginationOpts);
  },
});

export const accept = internalMutation({
  args: {
    ids: v.array(v.id("pluginCategoryRefreshes")),
    confirm: v.string(),
    corrections: v.optional(v.array(pluginCategoryCorrectionValidator)),
    reviewHash: v.optional(v.string()),
    provenance: v.optional(pluginCategoryReviewProvenanceValidator),
  },
  handler: async (ctx, args) => {
    if (args.confirm !== "apply-plugin-category-refresh")
      throw new ConvexError("Category refresh confirmation required.");
    if (args.ids.length > 100 || new Set(args.ids).size !== args.ids.length)
      throw new ConvexError("Accept at most 100 distinct reviewed rows at a time.");
    const corrections = args.corrections ?? [];
    validateCategoryCorrections(corrections, args.ids);
    const rows = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    if (rows.some((row) => !row)) throw new ConvexError("A reviewed row is missing.");
    const reviewedRows = rows.filter((row): row is Doc<"pluginCategoryRefreshes"> => row !== null);
    if (args.reviewHash !== undefined || corrections.length) {
      const expected = await sha256Hex(
        new TextEncoder().encode(categoryReviewPayload(reviewedRows, corrections)),
      );
      if (args.reviewHash !== expected)
        throw new ConvexError("Review hash changed; report and review again.");
    }
    const provenance = args.provenance;
    if (
      corrections.length &&
      (!provenance ||
        !/^[a-zA-Z0-9_[\]-]{1,64}$/.test(provenance.actor) ||
        !/^\d{1,20}$/.test(provenance.runId) ||
        !/^\d{1,6}$/.test(provenance.runAttempt) ||
        !/^[a-f0-9]{40}$/.test(provenance.sha))
    )
      throw new ConvexError("Category corrections require workflow actor and run provenance.");
    let accepted = 0;
    for (const row of reviewedRows) {
      if (row.status !== "preview") continue;
      const correction = corrections.find((item) => item.id === row._id);
      if (
        correction &&
        (row.review ||
          !["generated", "fallback"].includes(row.classification.source) ||
          row.classification.classifierVersion !== PLUGIN_CATEGORY_CLASSIFIER_VERSION)
      )
        throw new ConvexError(
          "Correct only current generated or fallback proposals; authored and bundled categories remain authoritative.",
        );
      if (!correction && row.classification.source === "fallback")
        throw new ConvexError(
          "Refresh failed classifications or provide an explicit reviewed correction.",
        );
      if (!generatedAssignmentIsCurrent(row))
        throw new ConvexError("Classifier changed. Generate a new preview before accepting it.");
      const pkg = await ctx.db.get(row.packageId);
      const release = await ctx.db.get(row.releaseId);
      if (
        !pkg ||
        !release ||
        !eligible(pkg, release) ||
        pkg.name !== row.packageName ||
        (await snapshotHash(pkg, release)) !== row.beforeHash
      )
        throw new ConvexError(
          "Latest release, source evidence, or category metadata changed. Generate a new preview.",
        );
      await ctx.db.patch(row._id, {
        status: "accepted",
        acceptedAt: Date.now(),
        ...(correction && provenance
          ? {
              review: {
                category: correction.category,
                evidence: correction.evidence,
                sourceHash: await sourceHash(pkg, release),
                provenance,
              },
            }
          : {}),
      });
      accepted++;
    }
    return { accepted };
  },
});

export const applyAccepted = internalMutation({
  args: { id: v.id("pluginCategoryRefreshes") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.status !== "accepted") return { applied: false };
    if (!generatedAssignmentIsCurrent(row)) {
      await ctx.db.patch(id, {
        status: "stale",
        reason: "Classifier changed. Generate a new preview.",
      });
      return { applied: false };
    }
    const pkg = await ctx.db.get(row.packageId);
    const release = await ctx.db.get(row.releaseId);
    if (
      !pkg ||
      !release ||
      !eligible(pkg, release) ||
      pkg.name !== row.packageName ||
      (await snapshotHash(pkg, release)) !== row.beforeHash ||
      (row.review !== undefined && row.review.sourceHash !== (await sourceHash(pkg, release)))
    ) {
      await ctx.db.patch(id, {
        status: "stale",
        reason:
          "Latest release, source evidence, or category metadata changed. Generate a new preview.",
      });
      return { applied: false };
    }
    if (row.classification.source === "bundled") {
      const publisher = pkg.ownerPublisherId ? await ctx.db.get(pkg.ownerPublisherId) : null;
      const assignment = bundledAssignment(pkg, release, publisher);
      if (
        !assignment ||
        assignment.manifestSha256 !== row.classification.inputHash ||
        JSON.stringify(assignment.categories) !== JSON.stringify(row.categories)
      ) {
        await ctx.db.patch(id, {
          status: "stale",
          reason: "Bundled assignment or official package identity changed.",
        });
        return { applied: false };
      }
    }
    if (row.classification.source === "reviewed" && !(await retainedReview(ctx, pkg, release))) {
      await ctx.db.patch(id, {
        status: "stale",
        reason: "Reviewed source changed. Generate a new preview.",
      });
      return { applied: false };
    }
    const assignment = acceptedAssignment(row);
    const summary = release.pluginManifestSummary ?? row.newReleaseSummary;
    if (!summary) {
      await ctx.db.patch(id, {
        status: "stale",
        reason: "Generate a new preview with manifest summary evidence.",
      });
      return { applied: false };
    }
    const nextRelease = {
      ...release,
      pluginManifestSummary: { ...summary, categories: assignment.categories },
      categoryClassification: assignment.classification,
    };
    const nextPackage = { ...pkg, categories: assignment.categories };
    await ctx.db.patch(release._id, {
      pluginManifestSummary: nextRelease.pluginManifestSummary,
      categoryClassification: assignment.classification,
    });
    // The trigger wrapper updates the category/search digests in this transaction.
    await ctx.db.patch(pkg._id, { categories: assignment.categories });
    await ctx.db.patch(id, {
      status: "applied",
      appliedAt: Date.now(),
      afterHash: await snapshotHash(nextPackage, nextRelease),
    });
    return { applied: true };
  },
});

export const rollback = internalMutation({
  args: { id: v.id("pluginCategoryRefreshes"), confirm: v.string() },
  handler: async (ctx, { id, confirm }) => {
    if (confirm !== "rollback-plugin-category-refresh")
      throw new ConvexError("Category rollback confirmation required.");
    const row = await ctx.db.get(id);
    if (!row || row.status !== "applied") return { rolledBack: false };
    const pkg = await ctx.db.get(row.packageId);
    const release = await ctx.db.get(row.releaseId);
    if (
      !pkg ||
      !release ||
      !eligible(pkg, release) ||
      (await snapshotHash(pkg, release)) !== row.afterHash
    ) {
      throw new ConvexError(
        "Category state changed after apply; rollback would overwrite newer work.",
      );
    }
    await ctx.db.patch(pkg._id, { categories: row.beforeCategories });
    await ctx.db.patch(release._id, {
      pluginManifestSummary:
        row.beforeHadSummary && release.pluginManifestSummary
          ? { ...release.pluginManifestSummary, categories: row.beforeReleaseCategories }
          : undefined,
      categoryClassification: row.beforeClassification,
    });
    await ctx.db.patch(id, { status: "rolled-back", rolledBackAt: Date.now() });
    return { rolledBack: true };
  },
});
