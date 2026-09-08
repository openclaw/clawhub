import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { SearchInsightArgs, SearchInsightReport } from "../../../convex/lib/searchInsights";
import { Button } from "../../components/ui/button";

function date(value: number | null) {
  return value === null
    ? "Not available yet"
    : new Date(value).toISOString().replace("T", " ").replace(/Z$/, " UTC");
}

export function SearchInsightsPage({ endDay }: { endDay?: number }) {
  const getReport = useAction(api.searchInsights.get);
  const [source, setSource] = useState<SearchInsightArgs["source"]>();
  const [window, setWindow] = useState<7 | 30>(7);
  const [view, setView] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<SearchInsightReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getReport({
      endDay,
      source,
      window,
      officialGap: view === "gaps" || view === "company",
      ...(view === "company" ? { intentKind: "company_product" as const } : {}),
    })
      .then((value) => {
        if (active) setReport(value);
      })
      .catch(() => {
        if (active) setError("Search insights could not be loaded. Refresh to retry.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [getReport, source, window, view, refresh, endDay]);
  const rows =
    view === "featured" ? report?.rows.filter((row) => row.featuredCandidate) : report?.rows;
  return (
    <div className="search-insights">
      <header className="search-insights-header">
        <div>
          <h1>Search intelligence</h1>
          <p className="text-muted-foreground">
            Manual plugin search demand, official gaps, and curation leads.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </Button>
      </header>
      <div className="search-insights-controls">
        <label>
          Source
          <select
            aria-label="Source"
            value={source ?? "all"}
            onChange={(event) =>
              setSource(
                event.target.value === "all"
                  ? undefined
                  : (event.target.value as SearchInsightArgs["source"]),
              )
            }
          >
            <option value="all">Both sources</option>
            <option value="clawhub-web">ClawHub web</option>
            <option value="openclaw-control-ui">OpenClaw Control UI</option>
          </select>
        </label>
        <label>
          Rank by
          <select
            aria-label="Rank by"
            value={window}
            onChange={(event) => setWindow(Number(event.target.value) as 7 | 30)}
          >
            <option value={7}>Last 7 complete days</option>
            <option value={30}>Last 30 complete days</option>
          </select>
        </label>
        <label>
          View
          <select aria-label="View" value={view} onChange={(event) => setView(event.target.value)}>
            <option value="all">All demand</option>
            <option value="gaps">Official gaps</option>
            <option value="company">Company plugin opportunities</option>
            <option value="featured">Featured candidates</option>
          </select>
        </label>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p role="status">Loading search demand…</p> : null}
      {!loading && report ? (
        <>
          <div className="search-insights-summary">
            <div>
              <strong>{report.totalSearches7d.toLocaleString()}</strong>
              <span>searches in 7 days</span>
            </div>
            <div>
              <strong>{report.sources7d["clawhub-web"].toLocaleString()}</strong>
              <span>ClawHub web</span>
            </div>
            <div>
              <strong>{report.sources7d["openclaw-control-ui"].toLocaleString()}</strong>
              <span>Control UI</span>
            </div>
            <div>
              <strong>{report.totalQueries.toLocaleString()}</strong>
              <span>matching queries</span>
            </div>
          </div>
          <p className="text-muted-foreground">
            Completed UTC days before {date(report.window.endDay)}. Aggregated through{" "}
            {date(report.coverage.dataThrough)}.
          </p>
          <p className="text-muted-foreground">
            Collection started: {date(report.coverage.collectionStartedAt)}. Earlier days have no
            collected history.
          </p>
          {view === "featured" ? (
            <p>Featured candidates among the top {report.rows.length} demand queries.</p>
          ) : null}
          {report.coverage.gapStart !== null ? (
            <p role="status">
              Incomplete coverage: {date(report.coverage.gapStart)} to{" "}
              {date(report.coverage.gapEnd)}. Expired raw searches cannot be recovered.
            </p>
          ) : null}
          <p className="text-muted-foreground">
            Company classification: <strong>{report.classificationStatus}</strong>
            {report.classificationRun
              ? ` · ${report.classificationRun.model}/${report.classificationRun.modelVersion} · processed ${date(report.classificationRun.processedAt)}`
              : ". Available after a weekly rollup."}
            {report.classificationRun?.truncated
              ? " · capped shortlist; additional queries were not classified"
              : null}
          </p>
          <p className="text-muted-foreground">
            Official gaps count searches with no returned official package. Company intent is
            advisory (confidence ≥80%, at least 3 gap searches). Featured candidates require staff
            quality and security review. Trending is unchanged.
          </p>
          <div className="search-insights-table-wrap">
            <table className="search-insights-table">
              <thead>
                <tr>
                  <th>Query</th>
                  <th>7 days</th>
                  <th>Change</th>
                  <th>30 days</th>
                  <th>Official gaps · 7d</th>
                  <th>Company intent</th>
                  <th>Featured consideration</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((row) => (
                  <tr key={row.query}>
                    <td>
                      <a href={row.searchUrl}>{row.query}</a>
                    </td>
                    <td>{row.searches7d}</td>
                    <td>
                      {row.change7d >= 0 ? "+" : ""}
                      {row.change7d}
                      <small>
                        {row.changePercent === null ? "New" : `${row.changePercent.toFixed(0)}%`} vs
                        previous 7d
                      </small>
                    </td>
                    <td>{row.searches30d}</td>
                    <td>{row.officialGaps7d}</td>
                    <td>
                      {row.classification ? (
                        <>
                          {row.classification.companyProductName ??
                            row.classification.intentKind.replaceAll("_", " ")}
                          <small>
                            {(row.classification.confidence * 100).toFixed(0)}% confidence
                            {row.companyOpportunity ? " · opportunity" : ""}
                          </small>
                        </>
                      ) : (
                        "Unavailable"
                      )}
                    </td>
                    <td>
                      {row.featuredCandidate ? (
                        <a href={row.featuredCandidate.url}>
                          {row.featuredCandidate.displayName}
                          <small>{row.featuredCandidate.version}</small>
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows?.length ? (
            <p role="status">
              No matching search demand yet. Collection starts with manually entered searches; there
              is no historical log backfill.
            </p>
          ) : null}
          {report.truncated ? (
            <p>
              Showing the top {report.rows.length} of {report.totalQueries} queries. Narrow the
              filters to inspect more.
            </p>
          ) : null}
          <p className="text-muted-foreground">
            Current package metadata checked: {date(report.metadataCheckedAt)}. These are current
            catalog results, not historical result snapshots. Raw searches expire after 30 days;
            daily totals after 13 months.
          </p>
        </>
      ) : null}
    </div>
  );
}
