import { paginationOptsValidator, type PaginationOptions } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { action, internalAction, internalQuery } from "./functions";
import { assertModerator, requireUserFromAction } from "./lib/access";
import {
  recommendFeatured,
  type AdoptionArtifact,
  type AdoptionSummary,
  type CurrentFeaturedArtifact,
  type EditorialSelection,
  type RecommendationArtifact,
} from "./lib/featuredIntelligence";
import {
  SEARCH_DAY_MS,
  searchArtifactKind,
  searchInsightSource,
  searchScope,
  type SearchArtifactKind,
  type SearchInsightArgs,
  type SearchInsightReport,
} from "./lib/searchInsights";
import { readReport as readSearchReport } from "./searchInsights";

const ADOPTION_INSPECTION_LIMIT = 100;
const args = {
  artifactKind: searchArtifactKind,
  endDay: v.optional(v.number()),
  source: v.optional(searchInsightSource),
  scope: v.optional(searchScope),
  window: v.optional(v.union(v.literal(7), v.literal(30))),
  limit: v.optional(v.number()),
};

export type FeaturedIntelligenceReport = {
  searchReport: SearchInsightReport;
  recommendations: ReturnType<typeof recommendFeatured>;
  adoption: AdoptionSummary;
  metadataCheckedAt: number | null;
};

export const get = action({
  args,
  handler: async (ctx, input): Promise<FeaturedIntelligenceReport> => {
    const { user } = await requireUserFromAction(ctx);
    assertModerator(user);
    return readReport(ctx, input);
  },
});

export const getInternal = internalAction({ args, handler: readReport });

export type FeaturedEvidence = {
  searchReport: SearchInsightReport;
  currentFeatured: CurrentFeaturedArtifact[];
  adoption: AdoptionReport;
  metadataCheckedAt: number;
  editorial: EditorialSelection;
  editorialArtifacts: RecommendationArtifact[];
  currentEditorialRevision: number;
};

async function readReport(
  ctx: ActionCtx,
  input: SearchInsightArgs & { artifactKind: SearchArtifactKind },
): Promise<FeaturedIntelligenceReport> {
  return renderFeaturedEvidence(await collectFeaturedEvidence(ctx, input), input.limit ?? 20);
}

export async function collectFeaturedEvidence(
  ctx: ActionCtx,
  input: SearchInsightArgs & { artifactKind: SearchArtifactKind },
): Promise<FeaturedEvidence> {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("limit must be between 1 and 100");
  const startedAt = Date.now();
  const endDay = input.endDay ?? Math.floor(startedAt / SEARCH_DAY_MS) * SEARCH_DAY_MS;
  const [searchReport, currentFeatured, adoption, editorial] = await Promise.all([
    readSearchReport(ctx, { ...input, includeCurrentResults: true, limit: 100 }),
    ctx.runQuery(internal.featuredArtifacts.readCurrentFeaturedInternal, {
      artifactKind: input.artifactKind,
    }),
    readMonthlyAdoption(ctx, input.artifactKind, endDay),
    input.artifactKind === "plugin"
      ? ctx.runQuery(internal.featuredSelections.readEditorialInternal, { artifactKind: "plugin" })
      : Promise.resolve({ revision: 0, items: [] }),
  ]);
  return {
    searchReport,
    currentFeatured,
    adoption,
    editorial,
    currentEditorialRevision: editorial.revision,
    editorialArtifacts: await ctx.runQuery(internal.featuredArtifacts.readInternal, {
      identities: editorial.items.map((item) => item.id),
    }),
    metadataCheckedAt: Math.max(
      startedAt,
      adoption.metadataCheckedAt ?? 0,
      searchReport.metadataCheckedAt ?? 0,
    ),
  };
}

export function renderFeaturedEvidence(
  evidence: FeaturedEvidence,
  limit: number,
): FeaturedIntelligenceReport {
  const { searchReport, currentFeatured, adoption, metadataCheckedAt } = evidence;
  return {
    searchReport,
    recommendations: recommendFeatured({
      artifactKind: searchReport.artifactKind,
      editorial: evidence.editorial,
      editorialArtifacts: evidence.editorialArtifacts,
      currentEditorialRevision: evidence.currentEditorialRevision,
      rows: searchReport.rows,
      adoption: adoption.artifacts,
      window: searchReport.window,
      coverage: searchReport.coverage,
      limit,
      currentFeatured,
    }),
    adoption: adoption.summary,
    metadataCheckedAt,
  };
}

export type AdoptionReport = {
  summary: AdoptionSummary;
  artifacts: AdoptionArtifact[];
  metadataCheckedAt: number;
};

const MONTHLY_RANKING_VERSION = "featured-installs-30d-v1";
type InstallTotal = {
  id: string;
  installs30d: number;
  installs7d: number;
  importedRows: number;
  importDatasetVersions: Set<string>;
};

// Read raw index pages before selecting nonzero rows. A database filter can
// exhaust its scan budget before finding a page, silently losing install facts.
export const readDailyInstallsInternal = internalQuery({
  args: {
    artifactKind: searchArtifactKind,
    day: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { artifactKind, day, paginationOpts }) => {
    const result =
      artifactKind === "plugin"
        ? await ctx.db
            .query("packageDailyStats")
            .withIndex("by_day", (q) => q.eq("day", day))
            .paginate(paginationOpts)
        : await ctx.db
            .query("skillDailyStats")
            .withIndex("by_day", (q) => q.eq("day", day))
            .paginate(paginationOpts);
    return {
      ...result,
      scannedRows: result.page.length,
      page: result.page
        .filter((row) => row.installs !== 0)
        .map((row) => ({
          id: "packageId" in row ? String(row.packageId) : `clawhub:${row.skillId}`,
          installs: row.installs,
          imported: row.rankingImportedAt !== undefined,
          dataset: row.rankingDatasetVersion ?? null,
        })),
    };
  },
});

export const readPackageIdentitiesInternal = internalQuery({
  args: { ids: v.array(v.id("packages")) },
  handler: async (ctx, { ids }) => {
    if (ids.length > 100) throw new Error("Too many package identities");
    return Promise.all(
      ids.map(async (id) => {
        const pkg = await ctx.db.get(id);
        return { id: String(id), identity: pkg ? `plugin:${pkg.name}` : null };
      }),
    );
  },
});

async function readMonthlyAdoption(
  ctx: ActionCtx,
  artifactKind: SearchArtifactKind,
  periodEnd: number,
): Promise<AdoptionReport> {
  const collectionStartedAt = Date.now();
  if (
    !Number.isSafeInteger(periodEnd) ||
    periodEnd % SEARCH_DAY_MS ||
    periodEnd > Math.floor(collectionStartedAt / SEARCH_DAY_MS) * SEARCH_DAY_MS
  )
    throw new Error("Monthly adoption requires completed UTC days");
  const endDay = periodEnd / SEARCH_DAY_MS;
  const periodStart = periodEnd - 30 * SEARCH_DAY_MS;
  const periodStart7d = periodEnd - 7 * SEARCH_DAY_MS;
  const totals = new Map<string, InstallTotal>();
  let scannedRows = 0;
  let importedRows = 0;
  const importDatasetVersions = new Set<string>();
  const readPage = async (
    day: number,
    paginationOpts: PaginationOptions,
  ): Promise<{ isDone: boolean; continueCursor: string }> => {
    const result = await ctx.runQuery(internal.featuredIntelligence.readDailyInstallsInternal, {
      artifactKind,
      day,
      paginationOpts,
    });
    if (result.pageStatus === "SplitRequired") {
      // Native cursor ranges replace the incomplete parent; never count both.
      if (
        !result.splitCursor ||
        result.splitCursor === paginationOpts.cursor ||
        result.splitCursor === result.continueCursor
      )
        throw new Error("Monthly adoption page cannot be completed");
      await readPage(day, { ...paginationOpts, endCursor: result.splitCursor });
      await readPage(day, {
        ...paginationOpts,
        cursor: result.splitCursor,
        endCursor: result.continueCursor,
      });
    } else {
      scannedRows += result.scannedRows;
      for (const row of result.page) {
        let total = totals.get(row.id);
        if (!total) {
          total = {
            id: row.id,
            installs30d: 0,
            installs7d: 0,
            importedRows: 0,
            importDatasetVersions: new Set(),
          };
          totals.set(row.id, total);
        }
        total.installs30d += row.installs;
        if (day >= endDay - 7) total.installs7d += row.installs;
        if (row.imported) {
          total.importedRows++;
          importedRows++;
        }
        if (row.dataset) {
          total.importDatasetVersions.add(row.dataset);
          importDatasetVersions.add(row.dataset);
        }
      }
    }
    return { isDone: result.isDone, continueCursor: result.continueCursor };
  };
  // Four independent day scans bound active transactions. Ranking starts only
  // after every day completes; no Trending or download-sorted admission cap.
  let nextDay = endDay - 30;
  let failed = false;
  const scans = await Promise.allSettled(
    Array.from({ length: 4 }, async () => {
      try {
        while (nextDay < endDay) {
          if (failed) break;
          const day = nextDay++;
          let cursor: string | null = null;
          for (;;) {
            if (failed) break;
            const page = await readPage(day, {
              cursor,
              numItems: 5000,
              maximumBytesRead: 8_000_000,
            });
            if (page.isDone) break;
            cursor = page.continueCursor;
          }
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }),
  );
  for (const result of scans) if (result.status === "rejected") throw result.reason;
  let ranked = [...totals.values()].filter((entry) => entry.installs30d > 0);
  if (artifactKind === "plugin") {
    const resolved: InstallTotal[] = [];
    for (let offset = 0; offset < ranked.length; offset += 100) {
      const batch = ranked.slice(offset, offset + 100);
      const identities = await ctx.runQuery(
        internal.featuredIntelligence.readPackageIdentitiesInternal,
        { ids: batch.map((entry) => entry.id as import("./_generated/dataModel").Id<"packages">) },
      );
      identities.forEach((entry, index) => {
        if (entry.identity) resolved.push({ ...batch[index], id: entry.identity });
      });
    }
    ranked = resolved;
  }
  ranked.sort(
    (a, b) =>
      b.installs30d - a.installs30d ||
      b.installs7d - a.installs7d ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const generatedAt = Date.now();
  const snapshotId = `${artifactKind}:${periodEnd}:${collectionStartedAt}`;
  const artifacts: AdoptionArtifact[] = [];
  let inspectedItems = 0;
  let eligibleItems = 0;
  let retainedExclusions = 0;
  // Limit rich report metadata after ranking the complete install population.
  // Ineligible leading rows cannot starve lower-ranked eligible candidates.
  for (
    let offset = 0;
    offset < ranked.length && eligibleItems < ADOPTION_INSPECTION_LIMIT;
    offset += 100
  ) {
    const batch = ranked.slice(offset, offset + 100);
    const metadata = await ctx.runQuery(internal.featuredArtifacts.readInternal, {
      identities: batch.map((entry) => entry.id),
    });
    const byId = new Map(metadata.map((entry) => [entry.id, entry]));
    inspectedItems += batch.length;
    for (const [index, entry] of batch.entries()) {
      const artifact = byId.get(entry.id);
      if (!artifact) continue;
      if (artifact.eligibleForFeatured) eligibleItems++;
      else if (retainedExclusions++ >= ADOPTION_INSPECTION_LIMIT) continue;
      artifacts.push({
        artifact,
        evidence: {
          source: artifactKind === "plugin" ? "package-daily-installs" : "skill-daily-installs",
          rank: offset + index + 1,
          snapshotId,
          rankingVersion: MONTHLY_RANKING_VERSION,
          periodStart,
          periodStart7d,
          periodEnd,
          generatedAt,
          installs30d: entry.installs30d,
          installs7d: entry.installs7d,
          importedRows: entry.importedRows,
          importDatasetVersions: [...entry.importDatasetVersions].sort(),
        },
      });
    }
  }
  return {
    summary: {
      status: "available",
      generatedAt,
      collectionStartedAt,
      periodStart,
      periodStart7d,
      periodEnd,
      snapshotId,
      rankingVersion: MONTHLY_RANKING_VERSION,
      totalItems: ranked.length,
      inspectedItems,
      truncated: inspectedItems < ranked.length || artifacts.length < inspectedItems,
      scannedRows,
      importedRows,
      importDatasetVersions: [...importDatasetVersions].sort(),
    },
    artifacts,
    metadataCheckedAt: Date.now(),
  };
}
