import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  collectFeaturedEvidence,
  renderFeaturedEvidence,
  unavailableAdoption,
  type FeaturedEvidence,
} from "../featuredIntelligence";
import { readReport } from "../searchInsights";
import type { SearchCurrentResult, SearchInsightReport } from "./searchInsights";
import type { ReportRequest } from "./searchReportContract";

export type ReportEvidence =
  | { view: "demand"; searchReport: SearchInsightReport }
  | { view: "recommendations"; evidence: FeaturedEvidence };

export async function collectReportEvidence(
  ctx: ActionCtx,
  request: ReportRequest,
): Promise<ReportEvidence> {
  const { view, refreshOf: _refreshOf, ...input } = request;
  const saved: ReportEvidence =
    view === "demand"
      ? { view, searchReport: await readReport(ctx, input) }
      : {
          view,
          evidence: await collectFeaturedEvidence(ctx, {
            ...input,
            artifactKind: input.artifactKind ?? "plugin",
          }),
        };
  const searchReport = saved.view === "demand" ? saved.searchReport : saved.evidence.searchReport;
  // The synchronous demand API preserves counts on lookup failure. A durable
  // generation must retry rather than freeze missing associations as a result.
  if (searchReport.rows.length && searchReport.currentMetadataStatus === "unavailable")
    throw new ConvexError("report_catalog_unavailable");
  return saved;
}

// Associations are immutable evidence; only current public metadata and eligibility
// are replaced. Re-searching here would silently change the saved demand cohort.
export async function renderReportEvidence(ctx: ActionCtx, saved: ReportEvidence, limit: number) {
  const searchReport = saved.view === "demand" ? saved.searchReport : saved.evidence.searchReport;
  const identities = [
    ...new Set([
      ...searchReport.rows.flatMap((row) => row.currentResults.map((entry) => entry.id)),
      ...(saved.view === "recommendations"
        ? saved.evidence.adoption.artifacts.map((entry) => entry.artifact.id)
        : []),
    ]),
  ];
  const artifacts: SearchCurrentResult[] = [];
  for (let offset = 0; offset < identities.length; offset += 100) {
    artifacts.push(
      ...(await ctx.runQuery(internal.featuredArtifacts.readInternal, {
        identities: identities.slice(offset, offset + 100),
      })),
    );
  }
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const refreshed: SearchInsightReport = {
    ...searchReport,
    rows: searchReport.rows.map((row) => {
      const currentResults = row.currentResults.flatMap((entry) => byId.get(entry.id) ?? []);
      return {
        ...row,
        currentResults,
        featuredCandidate: currentResults.find((entry) => entry.eligibleForFeatured) ?? null,
      };
    }),
  };
  if (saved.view === "demand") return { view: saved.view, report: refreshed } as const;
  let adoption = saved.evidence.adoption;
  if (adoption.snapshotCursor) {
    const current = await ctx.runQuery(internal.canonicalTrending.getPageInternal, {
      cursor: adoption.snapshotCursor,
      limit: 1,
      now: Date.now(),
    });
    if (current.status !== "ok") adoption = unavailableAdoption;
  }
  const currentFeatured = await ctx.runQuery(
    internal.featuredArtifacts.readCurrentFeaturedInternal,
    { artifactKind: searchReport.artifactKind },
  );
  return {
    view: saved.view,
    report: renderFeaturedEvidence(
      {
        ...saved.evidence,
        searchReport: refreshed,
        currentFeatured,
        metadataCheckedAt: Date.now(),
        adoption: {
          ...adoption,
          artifacts: adoption.artifacts.flatMap((entry) => {
            const artifact = byId.get(entry.artifact.id);
            return artifact ? [{ artifact, evidence: entry.evidence }] : [];
          }),
        },
      },
      limit,
    ),
  } as const;
}
