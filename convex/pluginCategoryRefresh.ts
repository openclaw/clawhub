import { getDeclaredPluginCategoriesFromManifest } from "clawhub-schema";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import bundledInventory from "./lib/bundledPluginCategoryAssignments.json";
import { sha256Hex } from "./lib/clawpack";
import { derivePluginManifestSummary } from "./lib/packageRegistry";
import {
  classifyPluginCategories,
  pluginCategoryClassificationValidator,
} from "./lib/pluginCategoryClassification";
import { pluginManifestSummaryValidator } from "./schema";

const bundledAssignments = new Map(
  bundledInventory.assignments.map((entry) => [entry.packageName, entry]),
);

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
async function snapshotHash(pkg: Doc<"packages">, release: Doc<"packageReleases">) {
  return sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        releaseId: release._id,
        latestReleaseId: pkg.latestReleaseId,
        categories: pkg.categories,
        releaseCategories: release.pluginManifestSummary?.categories,
        inferredCategories: pkg.inferredCategories,
        inferredFromReleaseId: pkg.inferredFromReleaseId,
        hadSummary: Boolean(release.pluginManifestSummary),
        classification: release.categoryClassification,
        integrity: release.integritySha256,
        manifest: release.extractedPluginManifest,
        ownerPublisherId: pkg.ownerPublisherId,
        source: release.source,
        sourceRepo: release.sourceRepo,
        package: release.extractedPackageJson,
        bundle: release.normalizedBundleManifest,
        files: release.files.map(({ path, sha256 }) => ({ path, sha256 })),
      }),
    ),
  );
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
    };
  },
});

export const getPage = internalQuery({
  args: { cursor: v.optional(v.string()), batchSize: v.number() },
  handler: async (ctx, args) => {
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

/** One bounded page per call; the returned cursor resumes without replacing reviewed rows. */
export const preview = internalAction({
  args: { runId: v.string(), cursor: v.optional(v.string()), batchSize: v.optional(v.number()) },
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
        let pluginManifest: unknown = current.release.extractedPluginManifest;
        if (!pluginManifest) {
          const file = current.release.files.find(
            (candidate) => candidate.path === "openclaw.plugin.json" && candidate.size <= 512_000,
          );
          const blob = file ? await ctx.storage.get(file.storageId) : null;
          if (!blob || blob.size > 512_000) {
            skipped++;
            diagnostics.push({ packageId, reason: "No bounded plugin manifest evidence." });
            continue;
          }
          pluginManifest = JSON.parse(await blob.text());
        }
        const docs: string[] = [];
        let remaining = 16_000;
        for (const file of current.release.files
          .filter(
            (candidate) =>
              candidate.size <= 512_000 && /(?:^|\/)(?:readme|skills?)\.md$/i.test(candidate.path),
          )
          .sort((a, b) => a.path.localeCompare(b.path))
          .slice(0, 8)) {
          if (remaining <= 0) break;
          const blob = await ctx.storage.get(file.storageId);
          if (!blob) continue;
          const text = (await blob.slice(0, Math.min(blob.size, remaining * 4)).text()).slice(
            0,
            remaining,
          );
          docs.push(text);
          remaining -= text.length;
        }
        const assignment = current.bundled
          ? {
              categories: getDeclaredPluginCategoriesFromManifest(current.bundled)!,
              classification: {
                source: "bundled" as const,
                classifierVersion: `bundled-product-categories:${bundledInventory.sourceCommit}`,
                inputHash: current.bundled.manifestSha256,
                evidence: `Reviewed OpenClaw bundled manifest: extensions/${current.bundled.pluginId}/openclaw.plugin.json`,
              },
            }
          : await classifyPluginCategories({
              name: current.pkg.name,
              pluginManifest,
              packageJson: current.release.extractedPackageJson,
              bundleManifest: current.release.normalizedBundleManifest,
              documentation: docs.join("\n"),
            });
        const id = await ctx.runMutation(internal.pluginCategoryRefresh.storePreview, {
          runId: args.runId,
          packageId,
          releaseId: current.release._id,
          beforeHash: current.beforeHash,
          categories: assignment.categories,
          classification: assignment.classification,
          ...(!current.release.pluginManifestSummary && {
            newReleaseSummary: derivePluginManifestSummary({
              pluginManifest: pluginManifest as Record<string, unknown>,
              skillManifest: current.release.normalizedBundleManifest,
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
          diagnostics.push({ packageId, reason: "Release or category evidence changed during preview." });
        }
      } catch {
        // Individual malformed artifacts must not prevent a cursor from advancing.
        failed++;
        diagnostics.push({ packageId, reason: "Artifact evidence could not be read or validated." });
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
  args: { ids: v.array(v.id("pluginCategoryRefreshes")), confirm: v.string() },
  handler: async (ctx, args) => {
    if (args.confirm !== "apply-plugin-category-refresh")
      throw new ConvexError("Category refresh confirmation required.");
    if (args.ids.length > 100) throw new ConvexError("Accept at most 100 reviewed rows at a time.");
    let accepted = 0;
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (!row || row.status !== "preview") continue;
      if (row.classification.source === "fallback")
        throw new ConvexError("Refresh failed classifications before accepting them.");
      await ctx.db.patch(id, { status: "accepted", acceptedAt: Date.now() });
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
    const pkg = await ctx.db.get(row.packageId);
    const release = await ctx.db.get(row.releaseId);
    if (
      !pkg ||
      !release ||
      !eligible(pkg, release) ||
      (await snapshotHash(pkg, release)) !== row.beforeHash
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
    const summary = release.pluginManifestSummary ?? row.newReleaseSummary;
    if (!summary) {
      await ctx.db.patch(id, { status: "stale", reason: "Generate a new preview with manifest summary evidence." });
      return { applied: false };
    }
    const nextRelease = {
      ...release,
      pluginManifestSummary: { ...summary, categories: row.categories },
      categoryClassification: row.classification,
    };
    const nextPackage = { ...pkg, categories: row.categories };
    await ctx.db.patch(release._id, {
      pluginManifestSummary: nextRelease.pluginManifestSummary,
      categoryClassification: row.classification,
    });
    // The trigger wrapper updates the category/search digests in this transaction.
    await ctx.db.patch(pkg._id, { categories: row.categories });
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
