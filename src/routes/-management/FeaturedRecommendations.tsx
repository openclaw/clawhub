import type { FeaturedIntelligenceReport } from "../../../convex/featuredIntelligence";
import { insightTime as date } from "./insightTime";

const supportLabels = {
  both: "Search demand + adoption",
  "search-only": "Search demand",
  "adoption-only": "Adoption",
};
const reasonLabels: Record<string, string> = {
  "already-featured": "Already Featured",
  "security-not-clean": "A completed clean security review is required",
  "no-public-version": "No published version is available",
  "not-installable": "No installable artifact is available",
  "external-no-feature-owner": "External skill; ClawHub cannot publish its Featured badge",
};

export function FeaturedRecommendations({ report }: { report: FeaturedIntelligenceReport }) {
  const { adoption, recommendations, searchReport } = report;
  return (
    <section aria-labelledby="featured-recommendations-title">
      <h2 id="featured-recommendations-title">Featured recommendations</h2>
      <p>
        Advisory shortlist for {searchReport.artifactKind === "plugin" ? "plugins" : "skills"}.
        Review usefulness, quality, security and category coverage before approving a selection.
        This report does not publish Featured changes.
      </p>
      <p className="text-muted-foreground">
        Evidence groups appear in this order: both signals, search demand, adoption. Within each
        group, search counts and then the existing Trending rank determine order. No blended score
        is used; plugins and skills are ranked separately.
      </p>
      <p className="text-muted-foreground">
        Adoption: {adoption.status}. Snapshot generated {date(adoption.generatedAt)}; observed
        period {date(adoption.periodStart)} to {date(adoption.periodEnd)}. Inspected{" "}
        {adoption.inspectedItems} of {adoption.totalItems} entries in the existing Trending
        snapshot.
        {adoption.truncated ? " Additional adoption entries were not inspected." : ""}
      </p>
      <p className="text-muted-foreground">
        Search evidence covers the top {searchReport.rows.length} of {searchReport.totalQueries}{" "}
        matching queries. Current eligibility checked {date(report.metadataCheckedAt)}.
        {searchReport.currentMetadataStatus === "unavailable"
          ? " Current search-result metadata is unavailable; adoption candidates may still be available."
          : ""}
      </p>
      {recommendations.candidates.length ? (
        <div className="featured-recommendations-grid">
          {recommendations.candidates.map((candidate) => (
            <article key={candidate.id} className="featured-recommendation-card">
              <header>
                <h3>
                  <a href={candidate.url}>{candidate.displayName}</a>
                </h3>
                <span>{supportLabels[candidate.support]}</span>
              </header>
              <p>
                {candidate.summary ??
                  "No catalog summary is available. Review the artifact details."}
              </p>
              <p>Category: {candidate.category ?? "Uncategorized — review coverage"}</p>
              {candidate.search ? (
                <details>
                  <summary>
                    {searchReport.window.days === 7
                      ? candidate.search.matchedSearches7d
                      : candidate.search.searches30d}{" "}
                    searches matched current catalog results · {searchReport.window.days} days
                  </summary>
                  <p>
                    {date(candidate.search.periodStart)} to {date(candidate.search.periodEnd)}.
                    Aggregated through {date(candidate.search.dataThrough)}. These are matching
                    query counts, not unique people or installs of this artifact.
                  </p>
                  <ul>
                    {candidate.search.queries.map((query) => (
                      <li key={`${query.scope}:${query.query}`}>
                        “{query.query}” · {query.searches7d} in 7 days · {query.previous7d} previous
                        7 days · {query.searches30d} in 30 days · {query.scope} scope
                      </li>
                    ))}
                  </ul>
                  {candidate.search.omittedQueries ? (
                    <p>{candidate.search.omittedQueries} more matching queries omitted.</p>
                  ) : null}
                </details>
              ) : (
                <p>No matching collected search demand in this period.</p>
              )}
              {candidate.adoption ? (
                <details open>
                  <summary>
                    Trending #{candidate.adoption.rank} · {candidate.adoption.source}
                  </summary>
                  <p>
                    {candidate.adoption.downloads ?? "Unknown"} downloads ·{" "}
                    {candidate.adoption.installs ?? "Unknown"} installs ·{" "}
                    {candidate.adoption.bookmarks ?? "Unknown"} bookmarks
                  </p>
                  <p>
                    {date(candidate.adoption.periodStart)} to {date(candidate.adoption.periodEnd)}
                  </p>
                  <small>
                    Snapshot {candidate.adoption.snapshotId} · generated{" "}
                    {date(candidate.adoption.generatedAt)} · ranking{" "}
                    {candidate.adoption.rankingVersion}
                  </small>
                  {candidate.adoption.sourceObservedAt !== null ? (
                    <p>Source last observed {date(candidate.adoption.sourceObservedAt)}</p>
                  ) : null}
                  {candidate.adoption.lifetimeInstalls !== null ? (
                    <p>
                      {candidate.adoption.lifetimeInstalls} lifetime installs (separate from the
                      observed period)
                    </p>
                  ) : null}
                </details>
              ) : (
                <p>No adoption evidence in the inspected Trending snapshot.</p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p role="status">
          No eligible Featured candidates in the available evidence. Review coverage and exclusions
          below.
        </p>
      )}
      {recommendations.omittedCandidates ? (
        <p>
          Showing {recommendations.candidates.length} of {recommendations.totalCandidates} eligible
          candidates.
        </p>
      ) : null}
      {recommendations.excluded.length ? (
        <details>
          <summary>{recommendations.excluded.length} entries excluded from the shortlist</summary>
          <ul>
            {recommendations.excluded.map((entry) => (
              <li key={entry.id}>
                <a href={entry.url}>{entry.displayName}</a>:{" "}
                {entry.reasons.map((reason) => reasonLabels[reason] ?? reason).join("; ")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
