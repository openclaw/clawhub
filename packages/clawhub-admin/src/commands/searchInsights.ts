import { requireAuthToken } from "../../../clawhub/src/cli/authToken.js";
import { getRegistry } from "../../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../../clawhub/src/cli/types.js";
import { fail } from "../../../clawhub/src/cli/ui.js";
import { apiRequest } from "../../../clawhub/src/http.js";
import { SearchInsightsReportSchema } from "../../../clawhub/src/schema/searchInsights.js";

export async function cmdSearchInsights(
  opts: GlobalOpts,
  options: {
    source?: string;
    window?: string;
    officialGap?: boolean;
    intentKind?: string;
    endDay?: string;
    limit?: string;
    json?: boolean;
  },
) {
  const params = new URLSearchParams();
  if (options.source) {
    if (!["clawhub-web", "openclaw-control-ui"].includes(options.source))
      fail("source must be clawhub-web or openclaw-control-ui");
    params.set("source", options.source);
  }
  if (options.window) {
    if (!["7", "30"].includes(options.window)) fail("window must be 7 or 30");
    params.set("window", options.window);
  }
  if (options.officialGap) params.set("officialGap", "true");
  if (options.intentKind) {
    if (!["company_product", "generic_capability", "ambiguous"].includes(options.intentKind))
      fail("intent-kind must be company_product, generic_capability, or ambiguous");
    params.set("intentKind", options.intentKind);
  }
  if (options.endDay) {
    const time = Date.parse(`${options.endDay}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(options.endDay) ||
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== options.endDay
    )
      fail("end-day must be a UTC date (YYYY-MM-DD)");
    params.set("endDay", String(time));
  }
  if (options.limit) {
    if (!/^\d+$/.test(options.limit) || Number(options.limit) < 1 || Number(options.limit) > 100)
      fail("limit must be between 1 and 100");
    params.set("limit", options.limit);
  }
  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const report = await apiRequest(
    registry,
    { method: "GET", path: `/api/v1/search-insights?${params}`, token },
    SearchInsightsReportSchema,
  );
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  }
  console.log(
    `Search demand · completed UTC days before ${new Date(report.window.endDay).toISOString()} · ${report.source ?? "both sources"}`,
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
      `${row.query}  ${count} searches (${report.window.days}d)  ${row.change7d >= 0 ? "+" : ""}${row.change7d} vs previous 7d  ${row.searches30d} in 30d  ${row.officialGaps7d} official gaps (7d)`,
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
