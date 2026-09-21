import type { FeaturedIntelligenceReportSchema } from "../../../packages/clawhub/src/schema/searchInsights";
import { insightTime as date } from "./insightTime";

type Report = typeof FeaturedIntelligenceReportSchema.infer;
type Candidate = Report["recommendations"]["lineup"]["proposed"][number];
const reasonLabels: Record<string, string> = {
  "discovery-excluded:channels": "Channels belong in setup and direct browsing",
  "discovery-excluded:models": "Model providers belong in setup and direct browsing",
  "discovery-excluded:agent-runtimes": "Agent runtimes belong in setup and direct browsing",
  "no-public-version": "No public version",
  "security-not-clean": "Security review is not clean",
  "not-installable": "Not installable",
  "not-in-public-catalog": "Not in the public catalog",
  "external-no-feature-owner": "External skill; ClawHub cannot publish its Featured badge",
  "outside-proposed-set": "Outside this proposed selection; this is not a safety finding",
};
function reasons(values: string[]) {
  return values.map((value) => reasonLabels[value] ?? value).join("; ");
}

function CandidateCard({ candidate }: { candidate: Candidate }) {
  return (
    <article className="featured-recommendation-card" data-slot={candidate.slot + 1}>
      <div>
        <small>
          Slot {candidate.slot + 1} ·{" "}
          {candidate.selectionBasis === "editorial" ? "Editorial" : "Recorded installs"}
        </small>
        <h3>
          <a href={candidate.url}>{candidate.displayName}</a>
        </h3>
        <span>
          {candidate.change === "retain" ? "Retain" : "Add"} ·{" "}
          {candidate.version ?? "Version unavailable"}
        </span>
      </div>
      <p>{candidate.summary ?? "Review the published artifact for its workflow and quality."}</p>
      <p>{candidate.reason}</p>
      <p>Category: {candidate.category ?? "Uncategorized — review coverage"}</p>
      {candidate.adoption ? (
        <div className="featured-install-evidence">
          <strong>
            {candidate.adoption.installs30d.toLocaleString()}{" "}
            <span>recorded installs / 30 days</span>
          </strong>
          <p>
            {candidate.adoption.installs7d.toLocaleString()} in the final 7 days · install rank #
            {candidate.adoption.rank}
          </p>
          <details>
            <summary>Counts, periods and source</summary>
            <p>
              30 days: {date(candidate.adoption.periodStart)} inclusive to{" "}
              {date(candidate.adoption.periodEnd)} exclusive.
            </p>
            <p>
              Final 7 days: {date(candidate.adoption.periodStart7d)} inclusive to{" "}
              {date(candidate.adoption.periodEnd)} exclusive.
            </p>
            <small>
              Read {date(candidate.adoption.generatedAt)} · {candidate.adoption.source} ·{" "}
              {candidate.adoption.rankingVersion}
            </small>
            <small>Snapshot {candidate.adoption.snapshotId}</small>
            {candidate.adoption.importedRows > 0 ? (
              <p>
                {candidate.adoption.importedRows} imported aggregate rows ·{" "}
                {candidate.adoption.importDatasetVersions.join(", ")}
              </p>
            ) : null}
          </details>
        </div>
      ) : (
        <p>
          No recorded install evidence in this report. Editorial membership does not imply adoption.
        </p>
      )}
    </article>
  );
}

export function FeaturedRecommendations({ report }: { report: Report }) {
  const { recommendations, adoption } = report;
  const lineup = recommendations.lineup;
  const catalog = report.searchReport.artifactKind === "plugin" ? "plugins" : "skills";
  const telemetry = lineup.proposed.filter((candidate) => candidate.selectionBasis === "telemetry");
  const selectedBySlot = new Map(lineup.proposed.map((candidate) => [candidate.slot, candidate]));
  return (
    <section aria-labelledby="featured-recommendations-title">
      <h2 id="featured-recommendations-title">Featured recommendations</h2>
      <p>
        {lineup.proposed.length} ready of {lineup.targetSize} {catalog} · {lineup.pendingCount}{" "}
        pending reservations · {lineup.telemetryShortfall} open telemetry places.
      </p>
      <p>
        Telemetry ranks eligible entries by recorded installs over 30 completed UTC days, then
        final-seven-day installs, then stable identity. Downloads, search-result associations,
        publisher status and current Featured membership add no ranking bonus.
      </p>
      <p>
        Review usefulness, quality, security and category coverage before approving publication.
        This report does not publish Featured changes. Recorded installs are events, not unique
        users or proof of successful runtime installation.
      </p>
      {lineup.staleEditorial ? (
        <p role="alert">
          Editorial choices changed from revision {lineup.editorialRevision} to{" "}
          {lineup.currentEditorialRevision}. Refresh this report before approving a selection.
        </p>
      ) : null}
      <p className="text-muted-foreground">
        Adoption: {adoption.status}. {date(adoption.periodStart)} inclusive to{" "}
        {date(adoption.periodEnd)} exclusive. Read {date(adoption.generatedAt)}. Inspected{" "}
        {adoption.inspectedItems} of {adoption.totalItems} identities across {adoption.scannedRows}{" "}
        daily rows
        {adoption.truncated ? "; additional candidates remain outside the inspected metadata" : ""}.
        Current eligibility checked {date(report.metadataCheckedAt)}.
      </p>
      <p className="text-muted-foreground">
        Aggregate scan started {date(adoption.collectionStartedAt)}. Search intelligence remains
        separate demand and gap evidence; current search-result associations do not establish demand
        for an individual artifact.
      </p>
      <p>
        {lineup.proposed.filter((candidate) => candidate.change === "retain").length} retained ·{" "}
        {lineup.proposed.filter((candidate) => candidate.change === "add").length} additions ·{" "}
        {lineup.removals.length} removals proposed.
      </p>
      {lineup.reservedSlots > 0 ? (
        <>
          <h3>Editorial slots · {lineup.reservedSlots} reserved</h3>
          <p>
            Manual choices remain in order when recommendations are recomputed. Pending reservations
            stay visible here and are omitted from public cards.
          </p>
          <div className="featured-recommendations-grid">
            {lineup.reservations.map((reservation) => {
              const candidate = selectedBySlot.get(reservation.slot);
              return candidate ? (
                <CandidateCard key={reservation.slot} candidate={candidate} />
              ) : (
                <article
                  className="featured-recommendation-card is-pending"
                  key={reservation.slot}
                  data-slot={reservation.slot + 1}
                >
                  <small>Slot {reservation.slot + 1} · Editorial · Pending</small>
                  <h3>{reservation.displayName ?? "Unassigned editorial slot"}</h3>
                  {reservation.name ? <span>{reservation.name}</span> : null}
                  <p>{reservation.reason ?? "Reserved for an editorial choice."}</p>
                  <p>
                    {reasons(reservation.pendingReasons) || "No eligible public artifact selected"}
                  </p>
                  <small>No public card. Telemetry will not replace this reservation.</small>
                </article>
              );
            })}
          </div>
        </>
      ) : null}
      <h3>
        Install-ranked selection · {telemetry.length} of {lineup.telemetryTarget}
      </h3>
      <div className="featured-recommendations-grid">
        {telemetry.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} />
        ))}
      </div>
      {lineup.telemetryShortfall > 0 ? (
        <p role="status">
          {lineup.telemetryShortfall} open telemetry places. We do not pad the selection with
          ineligible entries or missing install evidence.
        </p>
      ) : null}
      {lineup.removals.length > 0 ? (
        <details>
          <summary>Proposed removals ({lineup.removals.length})</summary>
          <ul>
            {lineup.removals.map((item) => (
              <li key={item.id}>
                <a href={item.url}>{item.displayName}</a>: {reasons(item.reasons)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <details>
        <summary>Current Featured baseline ({lineup.baseline.length})</summary>
        <ol>
          {lineup.baseline.map((item) => (
            <li key={item.id}>
              {item.id} · version {item.version ?? "unavailable"} · Featured {date(item.featuredAt)}
            </li>
          ))}
        </ol>
      </details>
      <p className="text-muted-foreground">
        {recommendations.totalCandidates} eligible candidates; {recommendations.omittedCandidates}{" "}
        outside the displayed candidate detail.
      </p>
      {recommendations.excluded.length > 0 ? (
        <details>
          <summary>{recommendations.excluded.length} excluded from the shortlist</summary>
          <ul>
            {recommendations.excluded.map((item) => (
              <li key={item.id}>
                <a href={item.url}>{item.displayName}</a>: {reasons(item.reasons)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
