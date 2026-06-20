import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink, RefreshCcw, Search } from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";
import { Badge, type BadgeProps } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import {
  formatRatio,
  formatScore,
  formatShortTimestamp,
  formatWholeNumber,
  type PublisherAbuseReviewDashboard,
  type PublisherAbuseReviewDetail,
  type PublisherAbuseReviewItem,
  type PublisherAbuseReviewScore,
  type PublisherAbuseTab,
} from "./managementShared";

export function AbusePage({
  dashboard,
  detail,
  items,
  search,
  selectedItem,
  selectedNominationId,
  tab,
  onChangeSearch,
  onChangeTab,
  onClose,
  onRefresh,
  onSelect,
}: {
  dashboard: PublisherAbuseReviewDashboard | undefined;
  detail: PublisherAbuseReviewDetail | undefined;
  items: PublisherAbuseReviewItem[];
  search: string;
  selectedItem: PublisherAbuseReviewItem | null;
  selectedNominationId: Id<"publisherAbuseReviewNominations"> | null;
  tab: PublisherAbuseTab;
  onChangeSearch: (value: string) => void;
  onChangeTab: (value: PublisherAbuseTab) => void;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (value: Id<"publisherAbuseReviewNominations">) => void;
}) {
  const latestRun = dashboard?.latestRun ?? null;
  const selectedScore = selectedItem?.latestScore ?? null;
  const selectedPublisher = selectedItem?.publisher ?? null;
  const visiblePending = dashboard ? getPublisherAbuseVisiblePendingItems(dashboard) : [];
  const totalPending = visiblePending.length;
  const potentialBan = visiblePending.filter(
    (item) => item.nomination.label === "potential_ban_candidate",
  ).length;
  const review = visiblePending.filter((item) => item.nomination.label === "review").length;
  const resolved = dashboard?.recentResolvedItems.length ?? 0;
  const totalForTab =
    tab === "potential_ban_candidate"
      ? potentialBan
      : tab === "review"
        ? review
        : tab === "resolved"
          ? resolved
          : totalPending;
  const loaded = dashboard !== undefined;

  return (
    <section className="pa" aria-labelledby="pa-title">
      <header className="pa-head">
        <div>
          <h2 id="pa-title" className="section-title pa-title">
            Publisher abuse review
          </h2>
          <p className="section-subtitle pa-subtitle">
            Statistical publisher abuse signals from the latest scoring run.
          </p>
        </div>
        <div className="pa-run">
          <dl className="pa-run-meta">
            <div>
              <dt>Last scan</dt>
              <dd
                className={
                  latestRun?.status === "completed"
                    ? "pa-run-ok"
                    : latestRun?.status === "failed"
                      ? "pa-run-bad"
                      : undefined
                }
              >
                {latestRun
                  ? formatPublisherAbuseRunStatus(latestRun.status)
                  : loaded
                    ? "No scans yet"
                    : "Loading"}
              </dd>
            </div>
            <div>
              <dt>Scanned</dt>
              <dd>{formatWholeNumber(latestRun?.scannedPublishers)}</dd>
            </div>
            <div>
              <dt>Scored</dt>
              <dd>{formatWholeNumber(latestRun?.scoredPublishers)}</dd>
            </div>
          </dl>
          <div className="pa-rescan">
            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCcw size={14} />
              Run new scan
            </Button>
            <span className="pa-rescan-hint">Re-scores every publisher</span>
          </div>
        </div>
      </header>

      <div className="pa-tabs" role="tablist" aria-label="Publisher abuse queue">
        <PublisherAbuseTabButton
          active={tab === "potential_ban_candidate"}
          count={loaded ? potentialBan : undefined}
          label="Potential ban"
          onClick={() => onChangeTab("potential_ban_candidate")}
        />
        <PublisherAbuseTabButton
          active={tab === "review"}
          count={loaded ? review : undefined}
          label="On the brink"
          onClick={() => onChangeTab("review")}
        />
        <PublisherAbuseTabButton
          active={tab === "all_pending"}
          count={loaded ? totalPending : undefined}
          label="All flagged"
          onClick={() => onChangeTab("all_pending")}
        />
        <PublisherAbuseTabButton
          active={tab === "resolved"}
          count={loaded ? resolved : undefined}
          label="Resolved"
          onClick={() => onChangeTab("resolved")}
        />
      </div>

      <Card className="pa-queue">
        <label className="pa-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search handle, user, ID, or reason"
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </label>
        <div className="pa-table-wrap">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Handle</th>
                <th className="pa-num">Z-score</th>
                <th>Reasons</th>
                <th>Last scored</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr>
                  <td colSpan={5}>Loading publisher abuse nominations…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr className="pa-empty-row">
                  <td colSpan={5}>
                    <strong>Queue clear</strong>
                    No publishers in this view from the latest scoring run.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const score = item.latestScore;
                  const selected = item.nomination._id === selectedNominationId;
                  return (
                    <tr
                      key={item.nomination._id}
                      className={selected ? "is-selected" : undefined}
                      onClick={() => onSelect(item.nomination._id)}
                    >
                      <td>
                        <Badge
                          variant={publisherAbuseLabelVariant(item.nomination.label)}
                          size="sm"
                        >
                          {formatPublisherAbuseLabel(item.nomination.label)}
                        </Badge>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pa-handle pa-row-button"
                          aria-label={`Open details for ${item.nomination.handleSnapshot}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(item.nomination._id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.currentTarget.click();
                          }}
                        >
                          <strong>{item.nomination.handleSnapshot}</strong>
                          <span>{compactIdentifier(item.nomination.ownerKey)}</span>
                        </button>
                      </td>
                      <td className={`pa-num ${score ? zScoreClass(score.zScore) : ""}`}>
                        {score ? formatScore(score.zScore) : "—"}
                      </td>
                      <td>
                        <div className="pa-reasons">
                          {(score?.reasonCodes ?? []).slice(0, 2).map((reason) => (
                            <Badge key={reason} variant="compact">
                              {formatReasonCode(reason)}
                            </Badge>
                          ))}
                          {(score?.reasonCodes.length ?? 0) > 2 ? (
                            <Badge variant="compact">+{(score?.reasonCodes.length ?? 0) - 2}</Badge>
                          ) : null}
                          {!score?.reasonCodes.length ? <span className="pa-muted">—</span> : null}
                        </div>
                      </td>
                      <td className="pa-muted">
                        {formatShortTimestamp(item.nomination.lastScoredAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="pa-foot">
          {loaded
            ? `Showing ${formatWholeNumber(items.length)} of ${formatWholeNumber(totalForTab)} nominations`
            : "Loading…"}
        </div>
      </Card>

      <Sheet
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent side="right" className="pa-sheet w-[600px] max-w-[92vw]">
          {selectedItem ? (
            <>
              <SheetHeader className="pa-sheet-head">
                <SheetTitle>{selectedItem.nomination.handleSnapshot}</SheetTitle>
                <SheetDescription className="sr-only">
                  Publisher abuse score details, owner identifiers, signal metrics, and available
                  moderation action.
                </SheetDescription>
                <div className="pa-pills">
                  <Badge
                    variant={publisherAbuseLabelVariant(selectedItem.nomination.label)}
                    size="sm"
                  >
                    {formatPublisherAbuseLabel(selectedItem.nomination.label)}
                  </Badge>
                </div>
                <div className="pa-idline">
                  <PublisherAbuseIdentity
                    label="Publisher"
                    value={
                      selectedItem.nomination.ownerPublisherId ?? selectedItem.nomination.ownerKey
                    }
                  />
                  <PublisherAbuseIdentity
                    label="User"
                    value={selectedItem.nomination.ownerUserId ?? "No linked user"}
                  />
                  {selectedPublisher ? (
                    <Link
                      className="pa-profile-link"
                      to="/p/$handle"
                      params={{ handle: selectedPublisher.handle }}
                    >
                      <ExternalLink size={12} />
                      Profile
                    </Link>
                  ) : null}
                </div>
              </SheetHeader>

              <div className="pa-sheet-body">
                <div className="pa-score">
                  <div>
                    <span>Z-score</span>
                    <strong
                      className={selectedScore ? zScoreClass(selectedScore.zScore) : undefined}
                    >
                      {selectedScore ? formatScore(selectedScore.zScore) : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Rank</span>
                    <strong>{selectedScore ? formatWholeNumber(selectedScore.rank) : "—"}</strong>
                    <small>
                      of {formatWholeNumber(latestRunScoredCount(detail, dashboard))} scored
                    </small>
                  </div>
                  <div>
                    <span>Pressure</span>
                    <strong>{selectedScore ? formatPressureLabel(selectedScore) : "—"}</strong>
                  </div>
                </div>

                <section className="pa-zone">
                  <div className="pa-section-label">Why it was flagged</div>
                  <div className="pa-reason-list">
                    {(selectedScore?.reasonCodes ?? []).map((reason) => (
                      <div key={reason} className="pa-reason">
                        <strong>{formatReasonCode(reason)}</strong>
                        <small>{describeReasonCode(reason)}</small>
                      </div>
                    ))}
                    {!selectedScore?.reasonCodes.length ? (
                      <div className="pa-reason">
                        <strong>No active reason code</strong>
                        <small>The latest score did not cross a named reason threshold.</small>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="pa-zone">
                  <div className="pa-section-label">Publisher activity</div>
                  <div className="pa-metrics">
                    <PublisherAbuseMetric
                      label="Published skills"
                      value={selectedScore?.publishedSkills}
                    />
                    <PublisherAbuseMetric
                      label="Total installs"
                      value={selectedScore?.totalInstalls}
                    />
                    <PublisherAbuseMetric label="Total stars" value={selectedScore?.totalStars} />
                    <PublisherAbuseMetric
                      label="Total downloads"
                      value={selectedScore?.totalDownloads}
                    />
                  </div>
                  <div className="pa-metrics pa-metrics-ratios">
                    <PublisherAbuseMetric
                      label="Installs / skill"
                      value={selectedScore?.installsPerSkill}
                      ratio
                    />
                    <PublisherAbuseMetric
                      label="Stars / skill"
                      value={selectedScore?.starsPerSkill}
                      ratio
                    />
                    <PublisherAbuseMetric
                      label="Downloads / skill"
                      value={selectedScore?.downloadsPerSkill}
                      ratio
                    />
                  </div>
                  <PublisherTemporalEvidence score={selectedScore} />
                </section>

                {detail?.scoreHistory.length ? (
                  <section className="pa-zone">
                    <div className="pa-section-label">Scoring history</div>
                    <div className="pa-history">
                      {detail.scoreHistory.map((score) => (
                        <div key={score._id} className="pa-history-item">
                          <span>{formatShortTimestamp(score.createdAt)}</span>
                          <strong className={zScoreClass(score.zScore)}>
                            {formatScore(score.zScore)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedItem.nomination.status !== "pending" ? (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">Resolution</div>
                    <div className="pa-actions">
                      <Badge variant={publisherAbuseStatusVariant(selectedItem.nomination.status)}>
                        {formatPublisherAbuseStatus(selectedItem.nomination.status)}
                      </Badge>
                      <span className="pa-muted">
                        Reviewed{" "}
                        {formatShortTimestamp(
                          selectedItem.nomination.reviewedAt ?? selectedItem.nomination.updatedAt,
                        )}
                      </span>
                    </div>
                    <p className="pa-hint">
                      {selectedItem.nomination.notes?.trim() ||
                        "This nomination is no longer in the pending queue."}
                    </p>
                  </section>
                ) : selectedItem.nomination.label === "potential_ban_candidate" ? (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">Flagged for review</div>
                    <p className="pa-hint">
                      This publisher is in the high-risk bucket. Publisher-abuse bans are disabled
                      while the scoring model is flag-only.
                    </p>
                  </section>
                ) : (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">Calibration signal</div>
                    <p className="pa-hint">
                      This publisher is close to the ban line, but is not a ban candidate. Leave it
                      here so we can tune the scoring gap.
                    </p>
                  </section>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function PublisherAbuseTabButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number | undefined;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "pa-tab is-active" : "pa-tab"}
      onClick={onClick}
    >
      {label}{" "}
      {count === undefined ? (
        <span className="pa-tab-count pa-count-loading" aria-label="Loading" />
      ) : (
        <span className="pa-tab-count">{formatWholeNumber(count)}</span>
      )}
    </button>
  );
}

function PublisherAbuseIdentity({ label, value }: { label: string; value: string }) {
  return (
    <div className="pa-id">
      <span className="pa-id-label">{label}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
        }}
      >
        {compactIdentifier(value)}
        <Copy size={12} />
      </button>
    </div>
  );
}

function PublisherAbuseMetric({
  label,
  ratio,
  value,
}: {
  label: string;
  ratio?: boolean;
  value?: number;
}) {
  return (
    <div className="pa-metric">
      <span>{label}</span>
      <strong>{ratio ? formatRatio(value) : formatWholeNumber(value)}</strong>
    </div>
  );
}

function PublisherTemporalEvidence({ score }: { score: PublisherAbuseReviewScore | null }) {
  const evidence = score?.temporalEvidence ?? [];
  if (!evidence.length) return null;

  const benchmark = score?.temporalBenchmark;
  return (
    <div className="pa-activity-evidence">
      <div className="pa-subsection-label">Temporal signal</div>
      {benchmark ? (
        <p className="pa-hint">
          Compared with {formatWholeNumber(benchmark.sampleSize)} scanned skills: 30d download P95{" "}
          {formatWholeNumber(benchmark.downloads30dP95)}, P99{" "}
          {formatWholeNumber(benchmark.downloads30dP99)}.
        </p>
      ) : null}
      <div className="pa-temporal-list">
        {evidence.map((item) => (
          <div key={`${item.skillId}:${item.slug}`} className="pa-temporal-card">
            <div className="pa-temporal-head">
              <div>
                <strong>{item.displayName}</strong>
                <small>{item.slug}</small>
              </div>
              <div className="pa-temporal-badges">
                {item.downloads30dCohortBand ? (
                  <Badge variant="compact">{item.downloads30dCohortBand.toUpperCase()} 30d</Badge>
                ) : null}
                {item.spikeMultiplierCohortBand ? (
                  <Badge variant="compact">
                    {item.spikeMultiplierCohortBand.toUpperCase()} spike
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="pa-temporal-metrics">
              <PublisherAbuseMetric label="30d downloads" value={item.recent30Downloads} />
              {benchmark ? (
                <PublisherAbuseMetric label="Peer 30d P95" value={benchmark.downloads30dP95} />
              ) : null}
              {benchmark ? (
                <PublisherAbuseMetric label="Peer 30d P99" value={benchmark.downloads30dP99} />
              ) : null}
              <PublisherAbuseMetric label="30d vs P95" value={item.downloads30dVsPeerP95} ratio />
              <PublisherAbuseMetric label="7d spike multiple" value={item.spikeMultiplier} ratio />
              {benchmark ? (
                <PublisherAbuseMetric
                  label="Peer spike P95"
                  value={benchmark.spikeMultiplier7dP95}
                  ratio
                />
              ) : null}
              <PublisherAbuseMetric
                label="Spike vs P95"
                value={item.spikeMultiplierVsPeerP95}
                ratio
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function publisherAbuseLabelVariant(label: string) {
  if (label === "potential_ban_candidate") return "destructive" as const;
  if (label === "review") return "review" as const;
  return "success" as const;
}

function isVisiblePublisherAbuseItem(item: PublisherAbuseReviewItem) {
  return (
    item.nomination.label !== "pass" &&
    !item.ownerUser?.deletedAt &&
    !item.ownerUser?.deactivatedAt &&
    !item.publisher?.deletedAt &&
    !item.publisher?.deactivatedAt
  );
}

export function getPublisherAbuseVisiblePendingItems(dashboard: PublisherAbuseReviewDashboard) {
  return [...dashboard.pendingPotentialBanCandidateItems, ...dashboard.pendingReviewItems].filter(
    isVisiblePublisherAbuseItem,
  );
}

export function getPublisherAbuseItemsForTab(
  dashboard: PublisherAbuseReviewDashboard,
  tab: PublisherAbuseTab,
) {
  if (tab === "potential_ban_candidate") {
    return dashboard.pendingPotentialBanCandidateItems.filter(isVisiblePublisherAbuseItem);
  }
  if (tab === "review") return dashboard.pendingReviewItems.filter(isVisiblePublisherAbuseItem);
  if (tab === "resolved") return dashboard.recentResolvedItems;
  return getPublisherAbuseVisiblePendingItems(dashboard);
}

export function filterPublisherAbuseItems(items: PublisherAbuseReviewItem[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => {
    const score = item.latestScore;
    const haystack = [
      item.nomination.handleSnapshot,
      item.nomination.ownerKey,
      item.nomination.ownerPublisherId,
      item.nomination.ownerUserId,
      item.ownerUser?.handle,
      item.ownerUser?.name,
      item.ownerUser?.displayName,
      item.publisher?.displayName,
      item.publisher?.handle,
      item.nomination.label,
      item.nomination.status,
      ...(score?.reasonCodes ?? []),
    ]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function comparePublisherAbuseItems(
  left: PublisherAbuseReviewItem,
  right: PublisherAbuseReviewItem,
) {
  const leftScore = left.latestScore?.zScore ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.latestScore?.zScore ?? Number.NEGATIVE_INFINITY;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return right.nomination.lastScoredAt - left.nomination.lastScoredAt;
}

function latestRunScoredCount(
  detail: PublisherAbuseReviewDetail | undefined,
  dashboard: PublisherAbuseReviewDashboard | undefined,
) {
  return (
    detail?.latestScoreRun?.scoredPublishers ??
    detail?.item.openedByRun?.scoredPublishers ??
    dashboard?.latestRun?.scoredPublishers
  );
}

function formatPublisherAbuseRunStatus(status: string) {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  if (status === "failed") return "Failed";
  return status;
}

function formatPublisherAbuseLabel(label: string) {
  if (label === "potential_ban_candidate") return "Potential Ban";
  if (label === "review") return "On the brink";
  if (label === "pass") return "Pass";
  return label;
}

function formatPublisherAbuseStatus(status: string) {
  if (status === "pending") return "Pending";
  if (status === "banned") return "Banned";
  if (status === "reviewed_no_action") return "Reviewed";
  if (status === "false_positive") return "False positive";
  if (status === "needs_policy_discussion") return "Needs discussion";
  if (status === "candidate_for_future_action") return "Future action";
  return status;
}

function publisherAbuseStatusVariant(status: string): NonNullable<BadgeProps["variant"]> {
  if (status === "banned") return "destructive";
  if (status === "false_positive" || status === "reviewed_no_action") return "success";
  if (status === "needs_policy_discussion" || status === "candidate_for_future_action") {
    return "warning";
  }
  return "default";
}

function formatReasonCode(reason: string) {
  return reason
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ")
    .replace("High / Catalog / Volume", "High Catalog Volume")
    .replace("Extreme / Volume / Low / Engagement", "Extreme Volume, Low Engagement")
    .replace("Low / Installs / Per / Skill", "Low Installs / Skill")
    .replace("Low / Stars / Per / Skill", "Low Stars / Skill")
    .replace("Low / Downloads / Per / Skill", "Low Downloads / Skill")
    .replace("Temporal / Download / Spike / Flat / Installs", "Temporal Spike, Flat Installs")
    .replace(
      "Temporal / Sustained / Downloads / Flat / Installs",
      "Temporal Sustained Downloads, Flat Installs",
    );
}

function describeReasonCode(reason: string) {
  if (reason === "high_catalog_volume") {
    return "Publisher has an unusually high number of skills compared to peers.";
  }
  if (reason === "extreme_volume_low_engagement") {
    return "Very high catalog volume with extremely low engagement across installs, stars, and downloads.";
  }
  if (reason === "low_installs_per_skill") {
    return "Installs per skill are far below the platform median.";
  }
  if (reason === "low_stars_per_skill") {
    return "Stars per skill are far below the platform median.";
  }
  if (reason === "low_downloads_per_skill") {
    return "Downloads per skill are far below the platform median.";
  }
  if (reason === "temporal_download_spike_flat_installs") {
    return "The skill's 7-day download spike is above the peer cohort while installs stayed flat.";
  }
  if (reason === "temporal_sustained_downloads_flat_installs") {
    return "The skill's 30-day downloads are above the peer cohort while installs stayed flat.";
  }
  return "Model reason emitted by the publisher abuse scorer.";
}

function compactIdentifier(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function zScoreClass(value: number) {
  if (value >= 2.5) return "pa-z-danger";
  if (value >= 1.5) return "pa-z-warn";
  return "pa-z-ok";
}

function formatPressureLabel(score: Pick<PublisherAbuseReviewScore, "zScore">) {
  if (score.zScore >= 2.5) return "Very High";
  if (score.zScore >= 1.5) return "High";
  if (score.zScore >= 0.5) return "Elevated";
  return "Low";
}
