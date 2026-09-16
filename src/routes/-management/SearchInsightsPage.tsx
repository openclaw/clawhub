import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { FeaturedIntelligenceReport } from "../../../convex/featuredIntelligence";
import type { SearchInsightArgs, SearchInsightReport } from "../../../convex/lib/searchInsights";
import type {
  SearchReportRequest,
  SearchReportStatus,
} from "../../../packages/clawhub/src/schema/searchReports";
import { Button } from "../../components/ui/button";
import { FeaturedRecommendations } from "./FeaturedRecommendations";
import { insightTime as date } from "./insightTime";

export function SearchInsightsPage({ endDay }: { endDay?: number }) {
  const startReport = useMutation(api.searchReports.start);
  const getReport = useAction(api.searchReports.get);
  const [intelligence, setIntelligence] = useState<FeaturedIntelligenceReport | null>(null);
  const [artifactKind, setArtifactKind] = useState<"plugin" | "skill">("plugin");
  const [scope, setScope] = useState<SearchInsightArgs["scope"]>();
  const [source, setSource] = useState<SearchInsightArgs["source"]>();
  const [window, setWindow] = useState<7 | 30>(7);
  const [view, setView] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [loadedReport, setReport] = useState<SearchInsightReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<(SearchReportStatus & { requestKey: string }) | null>(null);
  const [now, setNow] = useState(Date.now);
  const windowEnd = endDay ?? new Date(now).setUTCHours(0, 0, 0, 0);
  const lastRequest = useRef<{ requestKey: string; reportId: string } | null>(null);
  const input = useMemo<SearchReportRequest>(
    () => ({
      view: view === "featured" ? "recommendations" : "demand",
      endDay: windowEnd,
      artifactKind,
      scope,
      source,
      window,
      ...(view === "featured"
        ? {}
        : {
            officialGap: view === "gaps" || view === "company",
            ...(view === "company" ? { intentKind: "company_product" as const } : {}),
          }),
    }),
    [windowEnd, artifactKind, scope, source, window, view],
  );
  const requestKey = JSON.stringify(input);
  const currentJob = job?.requestKey === requestKey ? job : null;
  const report = currentJob ? loadedReport : null;
  const status = useQuery(
    api.searchReports.status,
    currentJob
      ? {
          reportId: currentJob.reportId,
          now,
        }
      : "skip",
  );
  useEffect(() => {
    // Time alone does not invalidate a Convex query. Refresh expiry checks even
    // when an open report receives no further lifecycle updates.
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    setReport(null);
    setIntelligence(null);
    setError(null);
    setJob(null);
    setNow(Date.now());
    const previous = lastRequest.current;
    void startReport({
      ...input,
      ...(refresh > 0 && previous?.requestKey === requestKey
        ? { refreshOf: previous.reportId }
        : {}),
    })
      .then((value) => {
        if (!active) return;
        lastRequest.current = { requestKey, reportId: value.reportId };
        setJob({ ...value, requestKey });
      })
      .catch(() => {
        if (active) {
          // A refresh parent may expire during admission. The next explicit
          // attempt can use normal request deduplication after any lost response.
          lastRequest.current = null;
          setError("The report could not be started. Refresh to retry.");
        }
      });
    return () => {
      active = false;
    };
  }, [startReport, input, requestKey, refresh]);
  const reportId = currentJob?.reportId;
  const phase = status === null ? undefined : (status?.status ?? currentJob?.status);
  useEffect(() => {
    if (!reportId || phase !== "ready") return undefined;
    let active = true;
    void getReport({ reportId })
      .then((value) => {
        if (!active) return;
        if (value.status !== "ready") {
          setError(reportFailure(value.status));
          return;
        }
        if (value.view === "recommendations") {
          setIntelligence(value.report);
          setReport(value.report.searchReport);
        } else setReport(value.report);
      })
      .catch(() => {
        if (active) setError("The completed report could not be loaded. Refresh to retry.");
      });
    return () => {
      // Changing filters stops this view from consuming a shared generation;
      // it does not cancel work another staff member may be waiting for.
      active = false;
    };
  }, [getReport, reportId, phase]);
  const failure =
    error ??
    (currentJob && status === null
      ? "This report is no longer available. Refresh to generate a new report."
      : null) ??
    (phase === "failed" || phase === "expired" || phase === "incomplete"
      ? reportFailure(phase)
      : null);
  const loading = !failure && !report;
  const rows = report?.rows;
  return (
    <div className="search-insights">
      <header className="search-insights-header">
        <div>
          <h1>ClawHub intelligence</h1>
          <p className="text-muted-foreground">
            Search demand, adoption trends and Featured recommendations for plugins and skills.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => {
            if (status === null) lastRequest.current = null;
            setRefresh((value) => value + 1);
          }}
        >
          Refresh
        </Button>
      </header>
      <div className="search-insights-controls">
        <label>
          Catalog
          <select
            aria-label="Catalog"
            value={artifactKind}
            onChange={(event) => setArtifactKind(event.target.value as "plugin" | "skill")}
          >
            <option value="plugin">Plugins</option>
            <option value="skill">Skills</option>
          </select>
        </label>
        <label>
          Search scope
          <select
            aria-label="Search scope"
            value={scope ?? "all"}
            onChange={(event) =>
              setScope(
                event.target.value === "all"
                  ? undefined
                  : (event.target.value as SearchInsightArgs["scope"]),
              )
            }
          >
            <option value="all">All scopes</option>
            <option value="catalog">Whole catalog</option>
            <option value="shelf">Filtered shelf</option>
            <option value="legacy">Scope unknown</option>
          </select>
        </label>
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
            <option value="company">Company opportunities</option>
            <option value="featured">Featured selection</option>
          </select>
        </label>
      </div>
      {failure ? <p role="alert">{failure}</p> : null}
      {loading ? (
        <div role="status" aria-live="polite">
          <p>
            {phase === "ready"
              ? "Checking current eligibility…"
              : phase === "running"
                ? view === "featured"
                  ? "Analyzing search demand and adoption…"
                  : "Analyzing search demand…"
                : "Waiting to generate the report…"}
          </p>
          <p className="text-muted-foreground">
            Analysis runs in the background. You can change filters or leave this page while it
            finishes.
          </p>
        </div>
      ) : null}
      {!failure && report ? (
        <>
          <p className="text-muted-foreground">
            Report generated {date(status?.completedAt ?? currentJob?.completedAt ?? null)}. Refresh
            to collect a new set of search-result associations.
          </p>
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
            Official gaps count searches with no returned official result within the recorded scope.
            Only whole-catalog searches can identify company opportunities. Company intent is
            advisory (confidence ≥80%, at least 3 gap searches). Featured candidates require staff
            quality and security review. Trending is unchanged.
          </p>
          {artifactKind === "skill" ? (
            <p className="text-muted-foreground">
              Skill collection covers manual global, Skills catalog, and homepage Featured,
              Official, and New searches on ClawHub web. Homepage Trending filters and OpenClaw
              skill search are not collected.
            </p>
          ) : null}
          {view === "featured" && intelligence ? (
            <FeaturedRecommendations report={intelligence} />
          ) : (
            <>
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
                      <tr key={`${row.artifactKind}:${row.scope}:${row.query}`}>
                        <td>
                          <a href={row.searchUrl}>{row.query}</a>
                          <small>
                            {row.scope === "legacy"
                              ? "Scope unknown"
                              : row.scope === "catalog"
                                ? "Whole catalog"
                                : "Filtered shelf"}
                          </small>
                        </td>
                        <td>{row.searches7d}</td>
                        <td>
                          {row.change7d >= 0 ? "+" : ""}
                          {row.change7d}
                          <small>
                            {row.changePercent === null
                              ? "New"
                              : `${row.changePercent.toFixed(0)}%`}{" "}
                            vs previous 7d
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
                  No matching search demand yet. Collection starts with manually entered searches;
                  there is no historical log backfill.
                </p>
              ) : null}
              {report.truncated ? (
                <p>
                  Showing the top {report.rows.length} of {report.totalQueries} queries. Narrow the
                  filters to inspect more.
                </p>
              ) : null}
            </>
          )}
          <p className="text-muted-foreground">
            Search-result associations checked: {date(report.metadataCheckedAt)}. These are current
            catalog results, not historical result snapshots. Raw searches expire after 30 days;
            daily totals after 13 months.
          </p>
        </>
      ) : null}
    </div>
  );
}

function reportFailure(status: SearchReportStatus["status"]) {
  if (status === "expired") return "This report has expired. Refresh to generate a new report.";
  if (status === "incomplete")
    return "Analysis ended without a usable report. Refresh to generate a new report.";
  return "The report could not be completed. Refresh to retry.";
}
