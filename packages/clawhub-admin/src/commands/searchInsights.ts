import { setTimeout as delay } from "node:timers/promises";
import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { fail } from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import { parseArk } from "../../../clawhub/src/schema/ark.js";
import {
  SearchReportRequestSchema,
  SearchReportResponseSchema,
  SearchReportStatusSchema,
  type SearchReportResponse,
  type SearchReportStatus,
} from "../../../clawhub/src/schema/searchReports.js";

export async function cmdSearchInsights(
  opts: GlobalOpts,
  options: {
    view?: string;
    artifactKind?: string;
    scope?: string;
    source?: string;
    window?: string;
    officialGap?: boolean;
    intentKind?: string;
    endDay?: string;
    limit?: string;
    json?: boolean;
    reportId?: string;
    refresh?: string;
  },
) {
  if (options.reportId && options.refresh) fail("Use either --report-id or --refresh");
  const { json: _json, reportId, refresh, ...filters } = options;
  if ((reportId || refresh) && Object.values(filters).some((value) => value !== undefined))
    fail(
      "A saved report uses its original filters; omit view and filter options when resuming or refreshing",
    );
  const request: Record<string, string | number | boolean> = { view: options.view ?? "demand" };
  if (options.view) {
    if (!["demand", "recommendations"].includes(options.view))
      fail("view must be demand or recommendations");
    request.view = options.view;
  }
  if (options.view === "recommendations" && (options.officialGap || options.intentKind))
    fail("Recommendation view does not accept demand-only gap or intent filters");
  if (options.artifactKind) {
    if (!["plugin", "skill"].includes(options.artifactKind))
      fail("artifact-kind must be plugin or skill");
    request.artifactKind = options.artifactKind;
  }
  if (options.scope) {
    if (!["catalog", "shelf", "legacy"].includes(options.scope))
      fail("scope must be catalog, shelf, or legacy");
    request.scope = options.scope;
  }
  if (options.source) {
    if (!["clawhub-web", "openclaw-control-ui"].includes(options.source))
      fail("source must be clawhub-web or openclaw-control-ui");
    request.source = options.source;
  }
  if (options.window) {
    if (!["7", "30"].includes(options.window)) fail("window must be 7 or 30");
    request.window = Number(options.window);
  }
  if (options.officialGap) request.officialGap = true;
  if (options.intentKind) {
    if (!["company_product", "generic_capability", "ambiguous"].includes(options.intentKind))
      fail("intent-kind must be company_product, generic_capability, or ambiguous");
    request.intentKind = options.intentKind;
  }
  if (options.endDay) {
    const time = Date.parse(`${options.endDay}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(options.endDay) ||
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== options.endDay
    )
      fail("end-day must be a UTC date (YYYY-MM-DD)");
    request.endDay = time;
  }
  if (options.limit) {
    if (!/^\d+$/.test(options.limit) || Number(options.limit) < 1 || Number(options.limit) > 100)
      fail("limit must be between 1 and 100");
    request.limit = Number(options.limit);
  }
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const path = "/api/v1/search-insights/reports";
  const read = (id: string) =>
    apiRequest(
      registry,
      {
        method: "GET",
        path: `${path}/${encodeURIComponent(id)}`,
        token,
      },
      SearchReportResponseSchema,
    );
  const previous = reportId || refresh ? await read((reportId || refresh)!) : undefined;
  if (previous && previous.reportId !== (reportId || refresh))
    throw new Error("Saved report identity did not match the requested ID");
  const initial = reportId
    ? previous!
    : await apiRequest(
        registry,
        {
          method: "POST",
          path,
          token,
          body: parseArk(
            SearchReportRequestSchema,
            refresh ? { view: previous!.view, refreshOf: refresh } : request,
            "Invalid report request",
          ),
        },
        SearchReportStatusSchema,
      );
  const result = await waitForReport(initial, read, registry);
  if (result.view === "recommendations") {
    const report = result.report;
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      const time = (value: number | null) =>
        value === null ? "unknown" : new Date(value).toISOString();
      console.log(
        `Featured recommendations · ${report.searchReport.artifactKind} · advisory, requires approval`,
      );
      console.log(
        `Search collection started ${time(report.searchReport.coverage.collectionStartedAt)}; aggregated through ${time(report.searchReport.coverage.dataThrough)}.`,
      );
      console.log(
        `Adoption ${report.adoption.status}: ${time(report.adoption.periodStart)} to ${time(report.adoption.periodEnd)}, generated ${time(report.adoption.generatedAt)}; ${report.adoption.inspectedItems}/${report.adoption.totalItems} snapshot entries inspected.`,
      );
      console.log(
        `Current eligibility checked ${time(report.metadataCheckedAt)}. Search metadata ${report.searchReport.currentMetadataStatus}.`,
      );
      const { lineup } = report.recommendations;
      console.log(
        `Complete proposed set: ${lineup.proposed.length}/${lineup.targetSize}; ${lineup.shortfall} open places. No automatic publication.`,
      );
      for (const entry of lineup.baseline)
        console.log(
          `Current ${entry.id}: ${entry.version ?? "unavailable"}; Featured ${time(entry.featuredAt)}.`,
        );
      for (const entry of lineup.removals)
        console.log(
          `Remove ${entry.displayName}: ${entry.reasons.includes("outside-proposed-set") ? "replaced by evidence-ranked selections, not a safety or zero-demand finding" : entry.reasons.join(", ")}`,
        );
      if (!lineup.proposed.length)
        console.log("No eligible Featured candidates in available evidence.");
      for (const candidate of lineup.proposed) {
        console.log(
          `${candidate.change === "retain" ? "Retain" : "Add"} ${candidate.displayName}${candidate.emerging ? " · Emerging (recent publication or Rising feed with observed adoption)" : ""} · ${candidate.support} · category ${candidate.category ?? "uncategorized"}`,
        );
        if (candidate.summary) console.log(`  ${candidate.summary}`);
        if (candidate.search) {
          console.log(
            `  Matching query counts: ${candidate.search.matchedSearches7d} in 7d, ${candidate.search.previous7d} previous 7d, ${candidate.search.searches30d} in 30d; ${time(candidate.search.periodStart)} to ${time(candidate.search.periodEnd)}.`,
          );
          for (const query of candidate.search.queries)
            console.log(
              `  ${query.query} [${query.scope}]: ${query.searches7d} in 7d, ${query.previous7d} previous 7d, ${query.searches30d} in 30d.`,
            );
          if (candidate.search.omittedQueries)
            console.log(`  ${candidate.search.omittedQueries} additional queries omitted.`);
        } else console.log("  No search evidence in the inspected queries.");
        if (candidate.adoption) {
          const evidence = candidate.adoption;
          console.log(
            `  ${evidence.source} #${evidence.rank}: ${evidence.downloads ?? "unknown"} downloads, ${evidence.installs ?? "unknown"} installs, ${evidence.bookmarks ?? "unknown"} bookmarks; ${time(evidence.periodStart)} to ${time(evidence.periodEnd)}.`,
          );
          console.log(
            `  Snapshot ${evidence.snapshotId}, generated ${time(evidence.generatedAt)}, ranking ${evidence.rankingVersion}.`,
          );
        }
        console.log(`  ${new URL(candidate.url, opts.site)}`);
      }
      for (const excluded of report.recommendations.excluded)
        console.log(`Excluded ${excluded.displayName}: ${excluded.reasons.join(", ")}`);
      console.log(
        `Showing ${report.recommendations.candidates.length}/${report.recommendations.totalCandidates} candidates; search coverage ${report.searchReport.rows.length}/${report.searchReport.totalQueries} queries. Review usefulness, quality, security and category coverage before publishing.`,
      );
    }
    return report;
  }
  const report = result.report;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  }
  console.log(
    `Search demand · ${report.artifactKind} · ${report.scope ?? "all scopes"} · completed UTC days before ${new Date(report.window.endDay).toISOString()} · ${report.source ?? "both sources"}`,
  );
  console.log(
    `Classification: ${report.classificationStatus}. Featured candidates are advisory; Trending is unchanged.`,
  );
  if (report.classificationRun?.truncated)
    console.log(
      "Classification covers a capped shortlist; additional queries were not classified.",
    );
  console.log(
    `Collection started: ${report.coverage.collectionStartedAt === null ? "not available yet" : new Date(report.coverage.collectionStartedAt).toISOString()}. Earlier days have no collected history.`,
  );
  console.log(
    `Aggregated through: ${report.coverage.dataThrough === null ? "not yet refreshed" : new Date(report.coverage.dataThrough).toISOString()}`,
  );
  if (report.coverage.gapStart !== null)
    console.log(
      `Coverage gap: ${new Date(report.coverage.gapStart).toISOString()} — ${new Date(report.coverage.gapEnd!).toISOString()}`,
    );
  console.log(
    `Current catalog: ${report.metadataCheckedAt === null ? "unavailable" : new Date(report.metadataCheckedAt).toISOString()}`,
  );
  if (!report.rows.length) console.log("No matching search demand yet.");
  for (const row of report.rows) {
    const count = report.window.days === 7 ? row.searches7d : row.searches30d;
    console.log(
      `${row.query} [${row.scope}]  ${count} searches (${report.window.days}d)  ${row.change7d >= 0 ? "+" : ""}${row.change7d} vs previous 7d  ${row.searches30d} in 30d  ${row.officialGaps7d} official gaps (7d)`,
    );
    if (row.classification)
      console.log(
        `  ${row.classification.intentKind} · ${(row.classification.confidence * 100).toFixed(0)}% · ${row.classification.model}/${row.classification.modelVersion}`,
      );
    if (row.featuredCandidate)
      console.log(
        `  Featured consideration: ${row.featuredCandidate.name} ${row.featuredCandidate.version}`,
      );
    console.log(`  ${new URL(row.searchUrl, opts.site).toString()}`);
  }
  if (report.truncated)
    console.log(`Showing ${report.rows.length} of ${report.totalQueries} queries.`);
  return report;
}

async function waitForReport(
  initial: SearchReportStatus | SearchReportResponse,
  read: (id: string) => Promise<SearchReportResponse>,
  registry: string,
) {
  const { reportId } = initial;
  // Copying a resume command must retain this registry, including shell metacharacters.
  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = `clawhub-admin --registry ${shellQuote(registry)} search-insights`;
  const resume = `${command} --report-id ${shellQuote(reportId)}`;
  process.stderr.write(`Report ${reportId}. Resume: ${resume}\n`);
  // Waiting is a client concern: stopping here or with Ctrl+C leaves the saved job running.
  const deadline = Date.now() + 5 * 60_000;
  let result: SearchReportStatus | SearchReportResponse = initial;
  let previousProgress = "";
  while (true) {
    if (result.reportId !== reportId || result.view !== initial.view)
      throw new Error(`Report identity changed while waiting. Resume: ${resume}`);
    const progress = `${result.status} (previous attempts: ${result.previousAttempts})`;
    if (progress !== previousProgress) process.stderr.write(`Report ${reportId}: ${progress}\n`);
    previousProgress = progress;
    if (result.status === "ready" && "report" in result) return result;
    if (
      !["pending", "running", "ready"].includes(result.status) ||
      Date.now() >= result.expirationTime
    )
      throw new Error(
        `Report ${reportId} ${Date.now() >= result.expirationTime ? "expired" : result.status}${result.failureCode ? `: ${result.failureCode}` : ""}. Start a fresh report: ${command} --refresh ${shellQuote(reportId)}`,
      );
    if (Date.now() >= deadline)
      throw new Error(
        `Stopped waiting after five minutes; report ${reportId} continues. Resume: ${resume}`,
      );
    // Admission returns status only; even a reused ready report is read through the result owner.
    if (result.status !== "ready")
      await delay(Math.min(1_000, deadline - Date.now(), result.expirationTime - Date.now()));
    try {
      result = await read(reportId);
    } catch (error) {
      throw new Error(
        `Could not read report ${reportId}: ${error instanceof Error ? error.message : String(error)}. Resume: ${resume}`,
        { cause: error },
      );
    }
  }
}
