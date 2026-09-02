import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  Ban,
  CircleStop,
  Copy,
  ExternalLink,
  Power,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MetricTrendCard, MetricTrendCardSkeleton } from "../../components/MetricTrendCard";
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
import { Textarea } from "../../components/ui/textarea";
import { getActivityTrendEndDay } from "../../lib/activityTrend";
import { buildPublisherProfileHref, buildSkillDetailHref } from "../../lib/ownerRoute";
import {
  formatPercent,
  formatRatio,
  formatScore,
  formatShortTimestamp,
  formatWholeNumber,
  type PublisherAbuseReviewDashboard,
  type PublisherAbuseReviewDetail,
  type PublisherAbuseReviewItem,
  type PublisherAbuseReviewScore,
  type PublisherAbuseSignalEntry,
  type PublisherAbuseTab,
  USER_BAN_REASON_MAX_LENGTH,
} from "./managementShared";

export function AbusePage({
  admin,
  autobanSetting,
  currentUserId,
  dashboard,
  detail,
  items,
  pageStatus,
  notes,
  search,
  selectedItem,
  selectedNominationId,
  signalItems,
  signalLoadedCount,
  signalPageStatus,
  signalScanCancelPending,
  tab,
  onBanOwner,
  onCancelSignalScan,
  onChangeNotes,
  onChangeSearch,
  onChangeTab,
  onClose,
  onMarkReviewed,
  onLoadMore,
  onRefresh,
  onSelect,
  onToggleAutoban,
}: {
  admin: boolean;
  autobanSetting:
    | {
        enabled: boolean;
        updatedAt: number | null;
        updatedByUserId: Id<"users"> | null;
      }
    | undefined;
  currentUserId: Id<"users"> | null;
  dashboard: PublisherAbuseReviewDashboard | undefined;
  detail: PublisherAbuseReviewDetail | undefined;
  items: PublisherAbuseReviewItem[];
  pageStatus: string;
  notes: string;
  search: string;
  selectedItem: PublisherAbuseReviewItem | null;
  selectedNominationId: Id<"publisherAbuseReviewNominations"> | null;
  signalItems: PublisherAbuseSignalEntry[];
  signalLoadedCount: number;
  signalPageStatus: string;
  signalScanCancelPending: boolean;
  tab: PublisherAbuseTab;
  onBanOwner: (item: PublisherAbuseReviewItem) => void;
  onCancelSignalScan: (runId: Id<"publisherAbuseScoreRuns">) => void;
  onChangeNotes: (value: string) => void;
  onChangeSearch: (value: string) => void;
  onChangeTab: (value: PublisherAbuseTab) => void;
  onClose: () => void;
  onMarkReviewed: (item: PublisherAbuseReviewItem) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  onSelect: (value: Id<"publisherAbuseReviewNominations">) => void;
  onToggleAutoban: () => void;
}) {
  const [selectedSignalItem, setSelectedSignalItem] = useState<PublisherAbuseSignalEntry | null>(
    null,
  );
  const selectedSignalId = selectedSignalItem?.signal._id ?? null;
  useEffect(() => {
    if (!selectedSignalId) return;
    if (tab !== "signals") {
      setSelectedSignalItem(null);
      return;
    }
    const freshSignalItem = signalItems.find((item) => item.signal._id === selectedSignalId);
    if (freshSignalItem) {
      setSelectedSignalItem(freshSignalItem);
      return;
    }
    if (signalPageStatus !== "LoadingFirstPage") {
      setSelectedSignalItem(null);
    }
  }, [selectedSignalId, signalItems, signalPageStatus, tab]);
  const latestRun = dashboard?.latestRun ?? null;
  const latestSignalRun = dashboard?.latestSignalRun ?? null;
  const displayedRun = tab === "signals" ? latestSignalRun : latestRun;
  const displayedScannedCount =
    tab === "signals"
      ? (latestSignalRun?.temporalSampleSize ?? latestSignalRun?.scannedPublishers)
      : displayedRun?.scannedPublishers;
  const signalFailureCount = latestSignalRun?.transientErrorCount ?? 0;
  const selectedScore = selectedItem?.latestScore ?? null;
  const selectedPublisher = selectedItem?.publisher ?? null;
  const canBanSelectedUser = canBanPublisherAbuseOwner(selectedItem, currentUserId);
  const visiblePending = dashboard ? getPublisherAbuseVisiblePendingItems(dashboard) : [];
  const visiblePotentialBan = visiblePending.filter(
    (item) => item.nomination.label === "potential_ban_candidate",
  ).length;
  const visibleReview = visiblePending.filter((item) => item.nomination.label === "review").length;
  const potentialBan =
    dashboard?.pendingPotentialBanCandidateCount ??
    Math.max(dashboard?.latestRun?.potentialBanCandidateCount ?? 0, visiblePotentialBan);
  const review =
    dashboard?.pendingReviewCount ??
    Math.max(dashboard?.latestRun?.reviewCount ?? 0, visibleReview);
  const totalPending =
    dashboard?.pendingCount ?? Math.max(potentialBan + review, visiblePending.length);
  const resolvedVisibleCount = dashboard?.recentResolvedItems.length ?? 0;
  const resolved =
    tab === "resolved" ? Math.max(items.length, resolvedVisibleCount) : resolvedVisibleCount;
  const dashboardLoaded = dashboard !== undefined;
  const nominationPageLoaded = pageStatus !== "LoadingFirstPage";
  const loaded = dashboardLoaded && nominationPageLoaded;
  const signalsLoaded = signalPageStatus !== "LoadingFirstPage";
  const signalDashboardCount = dashboard?.signalCount ?? 0;
  const latestRunTotalForTab =
    tab === "potential_ban_candidate"
      ? potentialBan
      : tab === "review"
        ? review
        : tab === "resolved"
          ? resolved
          : tab === "signals"
            ? signalDashboardCount
            : totalPending;
  const totalForTab = loaded ? Math.max(latestRunTotalForTab, items.length) : latestRunTotalForTab;
  const currentPageTotalForTab = loaded ? totalForTab : 0;
  const canLoadMore = pageStatus === "CanLoadMore";
  const loadingMore = pageStatus === "LoadingMore";
  const nominationPageHasMore = canLoadMore || loadingMore;
  const potentialBanTabCount = Math.max(
    potentialBan,
    tab === "potential_ban_candidate" ? currentPageTotalForTab : 0,
  );
  const potentialBanTabHasMore =
    dashboard?.pendingPotentialBanCandidateCountHasMore ||
    (tab === "potential_ban_candidate" && nominationPageHasMore);
  const reviewTabCount = Math.max(review, tab === "review" ? currentPageTotalForTab : 0);
  const reviewTabHasMore =
    dashboard?.pendingReviewCountHasMore || (tab === "review" && nominationPageHasMore);
  const allPendingTabCount = Math.max(
    totalPending,
    tab === "all_pending" ? currentPageTotalForTab : 0,
    potentialBanTabCount + reviewTabCount,
  );
  const allPendingTabHasMore =
    dashboard?.pendingCountHasMore ||
    potentialBanTabHasMore ||
    reviewTabHasMore ||
    (tab === "all_pending" && nominationPageHasMore);
  const resolvedTabHasMore = tab === "resolved" && nominationPageHasMore;
  const signalTabCount = Math.max(
    signalDashboardCount,
    tab === "signals" && signalsLoaded ? signalLoadedCount : 0,
  );
  const signalTabHasMore =
    dashboard?.signalCountHasMore ||
    signalPageStatus === "CanLoadMore" ||
    signalPageStatus === "LoadingMore";
  const signalTabCountLabel =
    signalTabHasMore && signalTabCount > 0
      ? `${formatWholeNumber(signalTabCount)}+`
      : formatWholeNumber(signalTabCount);
  const potentialBanTabCountLabel = formatAbuseTabCountLabel(
    potentialBanTabCount,
    potentialBanTabHasMore,
  );
  const reviewTabCountLabel = formatAbuseTabCountLabel(reviewTabCount, reviewTabHasMore);
  const allPendingTabCountLabel = formatAbuseTabCountLabel(
    allPendingTabCount,
    allPendingTabHasMore,
  );
  const resolvedTabCountLabel = formatAbuseTabCountLabel(resolved, resolvedTabHasMore);
  const signalsCanLoadMore = signalPageStatus === "CanLoadMore";
  const signalsLoadingMore = signalPageStatus === "LoadingMore";
  const activeNominationHasMore =
    tab === "potential_ban_candidate"
      ? potentialBanTabHasMore
      : tab === "review"
        ? reviewTabHasMore
        : tab === "resolved"
          ? resolvedTabHasMore
          : allPendingTabHasMore;
  const nominationCountLabel =
    loaded && (nominationPageHasMore || activeNominationHasMore)
      ? `Showing ${formatWholeNumber(items.length)} of ${formatWholeNumber(totalForTab)}+ nominations`
      : loaded
        ? `Showing ${formatWholeNumber(items.length)} of ${formatWholeNumber(totalForTab)} nominations`
        : "Loading…";
  const signalCountLabel =
    signalsLoaded && (signalsCanLoadMore || signalsLoadingMore)
      ? `Showing ${formatWholeNumber(signalItems.length)} of ${formatWholeNumber(signalLoadedCount)}+ signals`
      : signalsLoaded
        ? signalItems.length === signalLoadedCount
          ? `Showing ${formatWholeNumber(signalLoadedCount)} signals`
          : `Showing ${formatWholeNumber(signalItems.length)} of ${formatWholeNumber(signalLoadedCount)} signals`
        : "Loading…";
  const activeCanLoadMore = tab === "signals" ? signalsCanLoadMore : canLoadMore;
  const activeLoadingMore = tab === "signals" ? signalsLoadingMore : loadingMore;
  const activeCountLabel = tab === "signals" ? signalCountLabel : nominationCountLabel;
  const autobanLoaded = autobanSetting !== undefined;
  const autobanEnabled = autobanSetting?.enabled ?? false;
  const autobanStatusLabel = autobanLoaded
    ? autobanEnabled
      ? "Auto-ban is on"
      : "Auto-ban is off"
    : "Auto-ban loading";
  const autobanToggleLabel = autobanEnabled ? "Turn off auto-ban" : "Turn on auto-ban";
  const AutobanStatusIcon = autobanEnabled ? ShieldCheck : ShieldOff;
  const signalScanCurrent = dashboard?.latestSignalRunIsCurrentModel ?? false;
  const scanRunning =
    displayedRun?.status === "running" && (tab !== "signals" || signalScanCurrent);
  const runningSignalRunId = tab === "signals" && scanRunning ? latestSignalRun?._id : null;
  const scanOutdated =
    tab === "signals" && latestSignalRun?.status === "running" && !signalScanCurrent;
  const scanCanceled =
    displayedRun?.status === "failed" && (displayedRun.canceledAt ?? null) !== null;
  const signalScanCanceledAt =
    tab === "signals" && latestSignalRun?.status === "failed"
      ? (latestSignalRun.canceledAt ?? null)
      : null;
  const scanStatusClass =
    scanCanceled || scanOutdated
      ? "is-canceled"
      : displayedRun?.status === "completed"
        ? "is-complete"
        : displayedRun?.status === "failed"
          ? "is-failed"
          : displayedRun?.status === "running"
            ? "is-running"
            : "is-idle";

  return (
    <section className="pa" aria-labelledby="pa-title">
      <header className="pa-head">
        <div className="pa-head-copy">
          <h2 id="pa-title" className="section-title pa-title">
            Publisher abuse review
          </h2>
          <p className="section-subtitle pa-subtitle">
            Statistical publisher abuse signals from the latest scoring run.
          </p>
        </div>
        <div
          className={tab === "signals" ? "pa-run pa-run-signals" : "pa-run"}
          aria-label={tab === "signals" ? "Signal scan status" : "Publisher scan status"}
        >
          <div className="pa-run-state">
            <span className="pa-run-eyebrow">
              {tab === "signals" ? "Latest signal scan" : "Latest publisher scan"}
            </span>
            <strong className={`pa-run-status ${scanStatusClass}`}>
              <span className="pa-run-status-dot" aria-hidden="true" />
              {displayedRun
                ? scanCanceled
                  ? "Canceled"
                  : scanOutdated
                    ? "Outdated"
                    : formatPublisherAbuseRunStatus(displayedRun.status)
                : dashboardLoaded
                  ? "No scans yet"
                  : "Loading"}
            </strong>
          </div>
          <dl className="pa-run-meta">
            <div>
              <dt>{tab === "signals" ? "Coverage" : "Scanned"}</dt>
              <dd>
                {formatWholeNumber(displayedScannedCount)}
                {tab === "signals" ? " skills checked" : " publishers"}
              </dd>
            </div>
            {tab !== "signals" ? (
              <div>
                <dt>Scored</dt>
                <dd>{formatWholeNumber(displayedRun?.scoredPublishers)}</dd>
              </div>
            ) : null}
          </dl>
          {tab !== "signals" ? (
            <div className="pa-autoban" aria-label="Publisher abuse auto-ban">
              <span className={autobanEnabled ? "pa-autoban-status is-on" : "pa-autoban-status"}>
                <AutobanStatusIcon size={14} />
                {autobanStatusLabel}
              </span>
              <Button
                type="button"
                variant={autobanEnabled ? "destructive" : "primary"}
                size="sm"
                disabled={!admin || !autobanLoaded}
                onClick={onToggleAutoban}
              >
                <Power size={14} />
                {admin ? autobanToggleLabel : "Admins only"}
              </Button>
            </div>
          ) : null}
          <div className="pa-rescan">
            <div className="pa-rescan-actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={scanRunning}
                aria-label={tab === "signals" && scanRunning ? "Scanning signals" : undefined}
                onClick={onRefresh}
              >
                <RefreshCcw className={scanRunning ? "pa-scan-spin" : undefined} size={14} />
                {scanRunning ? "Scanning…" : tab === "signals" ? "Rescan signals" : "Run new scan"}
              </Button>
              {runningSignalRunId ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  loading={signalScanCancelPending}
                  onClick={() => onCancelSignalScan(runningSignalRunId)}
                >
                  {signalScanCancelPending ? "Canceling…" : "Cancel scan"}
                </Button>
              ) : null}
            </div>
            {tab !== "signals" ? (
              <span className="pa-rescan-hint">Re-scores every publisher</span>
            ) : null}
          </div>
        </div>
      </header>

      {signalScanCanceledAt !== null ? (
        <div className="pa-scan-canceled" role="status">
          <CircleStop aria-hidden="true" size={18} />
          <div>
            <strong>Signal scan canceled</strong>
            <span>
              Canceled {formatShortTimestamp(signalScanCanceledAt)}. Signals already recorded are
              kept — start a new scan when you're ready.
            </span>
          </div>
        </div>
      ) : tab === "signals" && latestSignalRun?.status === "failed" ? (
        <div className="pa-scan-failure" role="alert">
          <XCircle aria-hidden="true" size={18} />
          <div>
            <strong>
              {signalFailureCount > 0
                ? `Stopped after ${signalFailureCount} failed attempts`
                : "Signal scan failed"}
            </strong>
            <span>
              {latestSignalRun.errorMessage ?? "The signal scan failed without an error."}
            </span>
          </div>
        </div>
      ) : tab === "signals" &&
        signalScanCurrent &&
        latestSignalRun?.status === "running" &&
        signalFailureCount > 0 ? (
        <div className="pa-scan-retrying" role="status">
          <RefreshCcw aria-hidden="true" size={18} />
          <div>
            <strong>Retrying after {signalFailureCount} of 5 failed attempts</strong>
            <span>
              {latestSignalRun?.lastTransientError ?? "The previous signal scan attempt failed."}
            </span>
          </div>
        </div>
      ) : null}

      <div className="pa-tabs" role="tablist" aria-label="Publisher abuse queue">
        <PublisherAbuseTabButton
          active={tab === "potential_ban_candidate"}
          count={dashboardLoaded ? potentialBanTabCount : undefined}
          countLabel={dashboardLoaded ? potentialBanTabCountLabel : undefined}
          label="Potential ban"
          loading={!dashboardLoaded}
          onClick={() => onChangeTab("potential_ban_candidate")}
        />
        <PublisherAbuseTabButton
          active={tab === "review"}
          count={dashboardLoaded ? reviewTabCount : undefined}
          countLabel={dashboardLoaded ? reviewTabCountLabel : undefined}
          label="On the brink"
          loading={!dashboardLoaded}
          onClick={() => onChangeTab("review")}
        />
        <PublisherAbuseTabButton
          active={tab === "all_pending"}
          count={dashboardLoaded ? allPendingTabCount : undefined}
          countLabel={dashboardLoaded ? allPendingTabCountLabel : undefined}
          label="All flagged"
          loading={!dashboardLoaded}
          onClick={() => onChangeTab("all_pending")}
        />
        <PublisherAbuseTabButton
          active={tab === "resolved"}
          count={dashboardLoaded ? resolved : undefined}
          countLabel={dashboardLoaded ? resolvedTabCountLabel : undefined}
          label="Resolved"
          loading={!dashboardLoaded}
          onClick={() => onChangeTab("resolved")}
        />
        <PublisherAbuseTabButton
          active={tab === "signals"}
          count={dashboardLoaded || signalsLoaded ? signalTabCount : undefined}
          countLabel={dashboardLoaded || signalsLoaded ? signalTabCountLabel : undefined}
          label="Signals"
          loading={tab === "signals" && !signalsLoaded}
          onClick={() => onChangeTab("signals")}
        />
      </div>

      <Card className="pa-queue">
        <label className="pa-search">
          <Search size={16} />
          <input
            type="search"
            placeholder={
              tab === "signals"
                ? "Search signal, skill, publisher, or user"
                : "Search handle, user, ID, or reason"
            }
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </label>
        {tab === "signals" ? (
          <PublisherAbuseSignalsTable
            canLoadMore={signalsCanLoadMore || signalsLoadingMore}
            items={signalItems}
            loaded={signalsLoaded}
            selectedSignalId={selectedSignalItem?.signal._id ?? null}
            searchActive={search.trim().length > 0}
            onSelectSignal={setSelectedSignalItem}
          />
        ) : (
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
                  <PublisherAbuseTableSkeletonRows
                    columns={5}
                    label="Loading publisher abuse nominations"
                  />
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
                              <Badge variant="compact">
                                +{(score?.reasonCodes.length ?? 0) - 2}
                              </Badge>
                            ) : null}
                            {!score?.reasonCodes.length ? (
                              <span className="pa-muted">—</span>
                            ) : null}
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
        )}
        <div className="pa-foot">
          <span>{activeCountLabel}</span>
          {activeCanLoadMore || activeLoadingMore ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={activeLoadingMore}
              onClick={onLoadMore}
            >
              {activeLoadingMore ? "Loading..." : "Load more"}
            </Button>
          ) : null}
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
                      to={buildPublisherProfileHref(selectedPublisher.handle)}
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
                    <PublisherAbuseMetric
                      label="Total bookmarks"
                      value={selectedScore?.totalStars}
                    />
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
                      label="Bookmarks / skill"
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
                    <div className="pa-section-label">Triage note</div>
                    <Textarea
                      maxLength={USER_BAN_REASON_MAX_LENGTH}
                      placeholder="Why are you taking this action? (optional)"
                      value={notes}
                      onChange={(event) => onChangeNotes(event.target.value)}
                    />
                    <div className="pa-actions">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onMarkReviewed(selectedItem)}
                      >
                        <XCircle size={14} />
                        Mark reviewed
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="pa-ban"
                        disabled={!canBanSelectedUser}
                        onClick={() => onBanOwner(selectedItem)}
                      >
                        <Ban size={14} />
                        Ban user
                      </Button>
                    </div>
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

      <Sheet
        open={tab === "signals" && selectedSignalItem !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedSignalItem(null);
        }}
      >
        <SheetContent side="right" className="pa-sheet w-[600px] max-w-[92vw]">
          {selectedSignalItem ? <PublisherAbuseSignalInspector item={selectedSignalItem} /> : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function PublisherAbuseTabButton({
  active,
  count,
  countLabel,
  label,
  loading = false,
  onClick,
}: {
  active: boolean;
  count: number | undefined;
  countLabel?: string;
  label: string;
  loading?: boolean;
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
      {loading ? (
        <span className="pa-tab-count pa-count-loading" aria-label="Loading" />
      ) : count === undefined ? null : (
        <span className="pa-tab-count">{countLabel ?? formatWholeNumber(count)}</span>
      )}
    </button>
  );
}

function formatAbuseTabCountLabel(count: number, hasMore: boolean | undefined) {
  return hasMore && count > 0 ? `${formatWholeNumber(count)}+` : formatWholeNumber(count);
}

function PublisherAbuseTableSkeletonRows({
  columns,
  label,
  rows = 5,
}: {
  columns: number;
  label: string;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_row, rowIndex) => (
        <tr
          key={rowIndex}
          className="pa-skeleton-row"
          aria-hidden={rowIndex === 0 ? undefined : true}
        >
          {Array.from({ length: columns }, (_column, columnIndex) => (
            <td key={columnIndex}>
              {rowIndex === 0 && columnIndex === 0 ? (
                <span className="sr-only" role="status" aria-label={label}>
                  {label}
                </span>
              ) : null}
              <span
                className="pa-table-skeleton-bar"
                style={{
                  width: publisherAbuseSkeletonWidth(columnIndex, rowIndex),
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function publisherAbuseSkeletonWidth(columnIndex: number, rowIndex: number) {
  const widths = [72, 148, 64, 124, 92, 84, 92, 100, 100];
  const base = widths[columnIndex] ?? 96;
  return Math.max(48, base - (rowIndex % 3) * 14);
}

function PublisherAbuseSignalsTable({
  canLoadMore,
  items,
  loaded,
  selectedSignalId,
  searchActive,
  onSelectSignal,
}: {
  canLoadMore: boolean;
  items: PublisherAbuseSignalEntry[];
  loaded: boolean;
  selectedSignalId: Id<"publisherAbuseSignals"> | null;
  searchActive: boolean;
  onSelectSignal: (item: PublisherAbuseSignalEntry) => void;
}) {
  const emptyState = publisherAbuseSignalEmptyState(searchActive, canLoadMore);
  return (
    <div className="pa-table-wrap">
      <table className="pa-table pa-signals-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Signal</th>
            <th>Subject</th>
            <th className="pa-num">Evidence</th>
            <th>Last seen</th>
          </tr>
        </thead>
        <tbody>
          {!loaded ? (
            <PublisherAbuseTableSkeletonRows columns={5} label="Loading publisher abuse signals" />
          ) : items.length === 0 ? (
            <tr className="pa-empty-row">
              <td colSpan={5}>
                <strong>{emptyState.title}</strong>
                {emptyState.body}
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const selected = item.signal._id === selectedSignalId;
              const isPortfolioSignal =
                item.signal.signalType === "owner_synchronized_download_trends";
              return (
                <tr
                  key={item.signal._id}
                  className={selected ? "is-selected" : undefined}
                  onClick={() => onSelectSignal(item)}
                >
                  <td>
                    <Badge
                      variant={publisherAbuseSignalSeverityVariant(item.signal.signalType)}
                      size="sm"
                    >
                      {formatPublisherAbuseSignalSeverity(item.signal.signalType)}
                    </Badge>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="pa-signal-summary pa-row-button"
                      aria-label={`Open details for ${
                        isPortfolioSignal
                          ? `@${item.signal.handleSnapshot} portfolio`
                          : item.signal.skillDisplayName
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectSignal(item);
                      }}
                    >
                      <strong className="pa-signal-name">
                        {formatPublisherAbuseSignalType(item.signal.signalType)}
                      </strong>
                      <span>Seen {formatWholeNumber(item.signal.seenCount)} times</span>
                    </button>
                  </td>
                  <td>
                    <div className="pa-signal-subject">
                      <strong>
                        {isPortfolioSignal
                          ? `@${item.signal.handleSnapshot} portfolio`
                          : item.signal.skillDisplayName}
                      </strong>
                      <span>
                        {isPortfolioSignal
                          ? `${formatWholeNumber(item.signal.portfolioEvidence?.skillCount ?? 0)} synchronized skills`
                          : `@${item.signal.handleSnapshot} / ${item.signal.skillSlug}`}
                      </span>
                    </div>
                  </td>
                  <PublisherAbuseSignalRatioCell
                    downloads={item.signal.recent30Downloads}
                    installs={item.signal.recent30Installs}
                    ratio={item.signal.recent30InstallDownloadRatio}
                  />
                  <td className="pa-muted">{formatShortTimestamp(item.signal.lastSeenAt)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function PublisherAbuseSignalInspector({ item }: { item: PublisherAbuseSignalEntry }) {
  const publisherHandle = signalPublisherHandle(item);
  const isPortfolioSignal = item.signal.signalType === "owner_synchronized_download_trends";
  const activityTrend = useQuery(
    api.publisherAbuse.getSignalActivityTrend,
    isPortfolioSignal
      ? "skip"
      : {
          signalId: item.signal._id,
          endDay: getActivityTrendEndDay(item.signal.lastSeenAt),
        },
  );
  return (
    <>
      <SheetHeader className="pa-sheet-head">
        <SheetTitle>
          {isPortfolioSignal
            ? `@${item.signal.handleSnapshot} portfolio`
            : item.signal.skillDisplayName}
        </SheetTitle>
        <SheetDescription className="sr-only">
          Publisher abuse signal evidence with links to the skill and publisher.
        </SheetDescription>
        <div className="pa-pills">
          <Badge variant={publisherAbuseSignalSeverityVariant(item.signal.signalType)} size="sm">
            {formatPublisherAbuseSignalSeverity(item.signal.signalType)}
          </Badge>
          <Badge variant="compact">Seen {formatWholeNumber(item.signal.seenCount)} times</Badge>
        </div>
        <div className="pa-idline">
          {!isPortfolioSignal ? (
            <a
              className="pa-profile-link"
              href={buildSkillDetailHref(publisherHandle, item.signal.skillSlug)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open skill ${item.signal.skillDisplayName}`}
            >
              <ExternalLink size={12} />
              Skill
            </a>
          ) : null}
          <a
            className="pa-profile-link"
            href={buildPublisherProfileHref(publisherHandle)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open publisher ${item.signal.handleSnapshot}`}
          >
            <ExternalLink size={12} />
            Publisher
          </a>
        </div>
      </SheetHeader>

      <div className="pa-sheet-body">
        {!isPortfolioSignal ? (
          <section className="pa-zone pa-signal-trends-zone">
            <div className="pa-section-label">30-day activity</div>
            <div className="pa-signal-trends" aria-label="30-day activity trends">
              <div className="pa-signal-trend">
                <div className="pa-signal-trend-label">Downloads</div>
                {activityTrend ? (
                  <MetricTrendCard
                    trend={activityTrend.downloads}
                    ariaLabel="Daily downloads over the last 30 days"
                    periodLabel="30 days"
                    unitLabel="download"
                    hideIdlePeriodLabel
                  />
                ) : activityTrend === undefined ? (
                  <MetricTrendCardSkeleton />
                ) : (
                  <span className="pa-hint">Trend unavailable</span>
                )}
              </div>
              <div className="pa-signal-trend pa-signal-trend-installs">
                <div className="pa-signal-trend-label">Installs</div>
                {activityTrend ? (
                  <MetricTrendCard
                    trend={activityTrend.installs}
                    ariaLabel="Daily installs over the last 30 days"
                    periodLabel="30 days"
                    unitLabel="install"
                    hideIdlePeriodLabel
                  />
                ) : activityTrend === undefined ? (
                  <MetricTrendCardSkeleton />
                ) : (
                  <span className="pa-hint">Trend unavailable</span>
                )}
              </div>
            </div>
          </section>
        ) : null}

        <section className="pa-zone">
          <div className="pa-section-label">Signal</div>
          <div className="pa-reason-list">
            <div className="pa-reason">
              <strong>{formatPublisherAbuseSignalType(item.signal.signalType)}</strong>
              <small>{describePublisherAbuseSignalType(item.signal.signalType)}</small>
            </div>
            {item.signal.portfolioEvidence ? (
              <>
                <div className="pa-reason">
                  <strong>
                    {formatWholeNumber(item.signal.portfolioEvidence.skillCount)} of{" "}
                    {formatWholeNumber(item.signal.portfolioEvidence.publisherSkillCount)} skills ({" "}
                    {formatPercent(item.signal.portfolioEvidence.catalogCoverage)})
                  </strong>
                  <small>
                    {item.signal.portfolioEvidence.allPublisherSkills
                      ? "Every published skill is represented in the synchronized group."
                      : "A large group of this publisher's skills is represented."}
                  </small>
                </div>
                <div className="pa-reason">
                  <strong>
                    At least {formatPercent(item.signal.portfolioEvidence.correlationFloor)} aligned
                  </strong>
                  <small>
                    Correlation with the portfolio's median download trend; the seven-day peaks
                    range from {formatWholeNumber(item.signal.portfolioEvidence.peak7DownloadsMin)}{" "}
                    to {formatWholeNumber(item.signal.portfolioEvidence.peak7DownloadsMax)}{" "}
                    downloads per day.
                  </small>
                </div>
              </>
            ) : null}
          </div>
        </section>

        {item.signal.signalType === "download_spike_flat_installs" ? (
          <section className="pa-zone">
            <div className="pa-section-label">Why this crossed the spike threshold</div>
            <div className="pa-metrics">
              <PublisherAbuseSignalMeta
                label="Expected downloads (7d)"
                value={formatWholeNumber(item.signal.expected7Downloads ?? 0)}
              />
              <PublisherAbuseSignalMeta
                label="Actual downloads (7d)"
                value={formatWholeNumber(item.signal.recent7Downloads)}
              />
              <PublisherAbuseSignalMeta
                label="Excess downloads (7d)"
                value={formatWholeNumber(item.signal.excess7Downloads ?? 0)}
              />
              <PublisherAbuseSignalMeta
                label="Increase over baseline"
                value={`${formatRatio(item.signal.spikeMultiplier ?? 0)}×`}
              />
              <PublisherAbuseSignalMeta
                label="Platform P99 increase"
                value={`${formatRatio(item.signal.temporalBenchmark?.spikeMultiplier7dP99 ?? 0)}×`}
              />
              <PublisherAbuseSignalMeta
                label="Platform P99 excess"
                value={formatWholeNumber(item.signal.temporalBenchmark?.excess7DownloadsP99 ?? 0)}
              />
            </div>
          </section>
        ) : null}

        {item.signal.signalType === "sustained_abnormal_download_days" ? (
          <section className="pa-zone">
            <div className="pa-section-label">Why this crossed the sustained threshold</div>
            <div className="pa-metrics">
              <PublisherAbuseSignalMeta
                label="Unusual days"
                value={`${formatWholeNumber(item.signal.sustainedDaysAboveThreshold ?? 0)} of ${formatWholeNumber(item.signal.sustainedWindowDays ?? 14)}`}
              />
              <PublisherAbuseSignalMeta
                label="Daily download threshold"
                value={formatWholeNumber(item.signal.sustainedDailyDownloadThreshold ?? 0)}
              />
              <PublisherAbuseSignalMeta
                label="Expected downloads / day"
                value={formatWholeNumber(item.signal.sustainedExpectedDailyDownloads ?? 0)}
              />
              <PublisherAbuseSignalMeta
                label="Window downloads"
                value={formatWholeNumber(item.signal.sustainedWindowDownloads ?? 0)}
              />
              <PublisherAbuseSignalMeta
                label="Window installs"
                value={formatWholeNumber(item.signal.sustainedWindowInstalls ?? 0)}
              />
            </div>
          </section>
        ) : null}

        <section className="pa-zone">
          <div className="pa-section-label">
            {isPortfolioSignal ? "Publisher" : "Publisher and skill"}
          </div>
          <div className="pa-metrics">
            <PublisherAbuseSignalMeta label="Publisher" value={item.signal.handleSnapshot} />
            {!isPortfolioSignal ? (
              <PublisherAbuseSignalMeta label="Skill slug" value={item.signal.skillSlug} />
            ) : null}
            <PublisherAbuseSignalMeta
              label="Owner"
              value={compactIdentifier(item.signal.ownerKey)}
            />
            <PublisherAbuseSignalMeta
              label="Linked user"
              value={item.signal.ownerUserId ? compactIdentifier(item.signal.ownerUserId) : "None"}
            />
          </div>
        </section>

        <section className="pa-zone">
          <div className="pa-section-label">
            {isPortfolioSignal
              ? "Portfolio install / download evidence"
              : "Install / download evidence"}
          </div>
          <div className="pa-metrics pa-signal-evidence-grid">
            <PublisherAbuseSignalEvidenceMetric
              label="7 days"
              downloads={item.signal.recent7Downloads}
              installs={item.signal.recent7Installs}
              ratio={item.signal.recent7InstallDownloadRatio}
            />
            <PublisherAbuseSignalEvidenceMetric
              label="30 days"
              downloads={item.signal.recent30Downloads}
              installs={item.signal.recent30Installs}
              ratio={item.signal.recent30InstallDownloadRatio}
            />
            <PublisherAbuseSignalEvidenceMetric
              label="All time"
              downloads={item.signal.allTimeDownloads}
              installs={item.signal.allTimeInstalls}
              ratio={item.signal.allTimeInstallDownloadRatio}
            />
          </div>
          {item.signal.temporalBenchmark?.scope === "all_active_skills" ? (
            <p className="pa-hint">
              Platform 30d downloads across all{" "}
              {formatWholeNumber(item.signal.temporalBenchmark.sampleSize)} active skills: P95{" "}
              {formatWholeNumber(item.signal.temporalBenchmark.downloads30dP95)}, P99{" "}
              {formatWholeNumber(item.signal.temporalBenchmark.downloads30dP99)}.
            </p>
          ) : null}
        </section>

        <section className="pa-zone">
          <div className="pa-section-label">Observation history</div>
          <div className="pa-metrics">
            <PublisherAbuseSignalMeta
              label="First seen"
              value={formatShortTimestamp(item.signal.firstSeenAt)}
            />
            <PublisherAbuseSignalMeta
              label="Last seen"
              value={formatShortTimestamp(item.signal.lastSeenAt)}
            />
          </div>
        </section>
      </div>
    </>
  );
}

function PublisherAbuseSignalMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="pa-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PublisherAbuseSignalEvidenceMetric({
  downloads,
  installs,
  label,
  ratio,
}: {
  downloads: number;
  installs: number;
  label: string;
  ratio: number;
}) {
  return (
    <div className="pa-metric">
      <span>{label}</span>
      <strong>{formatPercent(ratio)}</strong>
      <small>
        {formatWholeNumber(installs)} installs / {formatWholeNumber(downloads)} downloads
      </small>
    </div>
  );
}

function publisherAbuseSignalEmptyState(searchActive: boolean, canLoadMore: boolean) {
  if (searchActive) {
    return {
      title: "No matching signals",
      body: canLoadMore
        ? "Load more to search additional archived rows."
        : "No loaded signal matches this search.",
    };
  }
  if (canLoadMore) {
    return {
      title: "No visible signals loaded",
      body: "Load more to keep scanning archived rows.",
    };
  }
  return {
    title: "No signals",
    body: "No stored publisher traffic anomalies are currently visible.",
  };
}

function PublisherAbuseSignalRatioCell({
  downloads,
  installs,
  ratio,
}: {
  downloads: number;
  installs: number;
  ratio: number;
}) {
  return (
    <td className="pa-num">
      <strong>{formatPercent(ratio)}</strong>
      <span className="pa-ratio-subtext">
        {formatWholeNumber(installs)} / {formatWholeNumber(downloads)}
      </span>
    </td>
  );
}

function signalPublisherHandle(item: PublisherAbuseSignalEntry) {
  return item.publisher?.handle || item.signal.handleSnapshot;
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
  const isPlatformBenchmark = benchmark?.scope === "all_active_skills";
  return (
    <div className="pa-activity-evidence">
      <div className="pa-subsection-label">Temporal signal</div>
      {benchmark ? (
        <p className="pa-hint">
          Compared with {isPlatformBenchmark ? "all" : "a legacy cohort of"}{" "}
          {formatWholeNumber(benchmark.sampleSize)} active skills:{" "}
          {typeof benchmark.excess7DownloadsP99 === "number" ? (
            <>
              7d rise P99 {formatRatio(benchmark.spikeMultiplier7dP99)}×; 7d excess P99{" "}
              {formatWholeNumber(benchmark.excess7DownloadsP99)}.
            </>
          ) : (
            <>
              30d download P95 {formatWholeNumber(benchmark.downloads30dP95)}, P99{" "}
              {formatWholeNumber(benchmark.downloads30dP99)}.
            </>
          )}
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
                {item.excess7DownloadsCohortBand ? (
                  <Badge variant="compact">
                    {item.excess7DownloadsCohortBand.toUpperCase()} excess
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="pa-temporal-metrics">
              {typeof item.expected7Downloads === "number" ? (
                <>
                  <PublisherAbuseMetric label="7d downloads" value={item.recent7Downloads} />
                  <PublisherAbuseMetric label="Expected 7d" value={item.expected7Downloads} />
                  <PublisherAbuseMetric label="7d excess" value={item.excess7Downloads} />
                  <PublisherAbuseMetric label="7d installs" value={item.recent7Installs} />
                  <PublisherAbuseMetric
                    label="7d rise multiple"
                    value={item.spikeMultiplier}
                    ratio
                  />
                  {benchmark ? (
                    <PublisherAbuseMetric
                      label={`${isPlatformBenchmark ? "Platform" : "Legacy cohort"} rise P99`}
                      value={benchmark.spikeMultiplier7dP99}
                      ratio
                    />
                  ) : null}
                  {benchmark ? (
                    <PublisherAbuseMetric
                      label={`${isPlatformBenchmark ? "Platform" : "Legacy cohort"} excess P99`}
                      value={benchmark.excess7DownloadsP99}
                    />
                  ) : null}
                  <PublisherAbuseMetric
                    label={`Abnormal days (${formatWholeNumber(item.sustainedWindowDays)}d)`}
                    value={item.sustainedDaysAboveThreshold}
                  />
                  <PublisherAbuseMetric
                    label="Daily threshold"
                    value={item.sustainedDailyDownloadThreshold}
                  />
                  <PublisherAbuseMetric
                    label="Frozen daily baseline"
                    value={item.sustainedExpectedDailyDownloads}
                  />
                  <PublisherAbuseMetric
                    label="Sustained-window downloads"
                    value={item.sustainedWindowDownloads}
                  />
                  <PublisherAbuseMetric
                    label="Sustained-window installs"
                    value={item.sustainedWindowInstalls}
                  />
                </>
              ) : (
                <>
                  <PublisherAbuseMetric label="30d downloads" value={item.recent30Downloads} />
                  {benchmark ? (
                    <PublisherAbuseMetric
                      label={`${isPlatformBenchmark ? "Platform" : "Legacy cohort"} 30d P95`}
                      value={benchmark.downloads30dP95}
                    />
                  ) : null}
                  {benchmark ? (
                    <PublisherAbuseMetric
                      label={`${isPlatformBenchmark ? "Platform" : "Legacy cohort"} 30d P99`}
                      value={benchmark.downloads30dP99}
                    />
                  ) : null}
                  <PublisherAbuseMetric
                    label="30d vs P95"
                    value={item.downloads30dVsPeerP95}
                    ratio
                  />
                  <PublisherAbuseMetric
                    label="7d spike multiple"
                    value={item.spikeMultiplier}
                    ratio
                  />
                  {benchmark ? (
                    <PublisherAbuseMetric
                      label={`${isPlatformBenchmark ? "Platform" : "Legacy cohort"} spike P95`}
                      value={benchmark.spikeMultiplier7dP95}
                      ratio
                    />
                  ) : null}
                  <PublisherAbuseMetric
                    label="Spike vs P95"
                    value={item.spikeMultiplierVsPeerP95}
                    ratio
                  />
                </>
              )}
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

export function canBanPublisherAbuseOwner(
  item: PublisherAbuseReviewItem | null,
  currentUserId: Id<"users"> | null,
) {
  const ownerUser = item?.ownerUser;
  if (!ownerUser?._id) return false;
  if (ownerUser._id === currentUserId) return false;
  if (ownerUser.role === "admin" || ownerUser.role === "moderator") return false;
  return true;
}

export function getPublisherAbuseVisiblePendingItems(
  dashboard: PublisherAbuseReviewDashboard,
): PublisherAbuseReviewItem[] {
  const potentialBanItems =
    dashboard.pendingPotentialBanCandidateItems as PublisherAbuseReviewItem[];
  const reviewItems = dashboard.pendingReviewItems as PublisherAbuseReviewItem[];
  return [...potentialBanItems, ...reviewItems].filter(isVisiblePublisherAbuseItem);
}

export function getPublisherAbuseItemsForTab(
  dashboard: PublisherAbuseReviewDashboard,
  tab: PublisherAbuseTab,
): PublisherAbuseReviewItem[] {
  if (tab === "potential_ban_candidate") {
    return (dashboard.pendingPotentialBanCandidateItems as PublisherAbuseReviewItem[]).filter(
      isVisiblePublisherAbuseItem,
    );
  }
  if (tab === "review") {
    return (dashboard.pendingReviewItems as PublisherAbuseReviewItem[]).filter(
      isVisiblePublisherAbuseItem,
    );
  }
  if (tab === "resolved") return dashboard.recentResolvedItems as PublisherAbuseReviewItem[];
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

export function filterPublisherAbuseSignals(items: PublisherAbuseSignalEntry[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => {
    const haystack = [
      item.signal.signalType,
      formatPublisherAbuseSignalType(item.signal.signalType),
      item.signal.handleSnapshot,
      item.signal.ownerKey,
      item.signal.ownerPublisherId,
      item.signal.ownerUserId,
      item.publisher?.displayName,
      item.publisher?.handle,
      item.ownerUser?.handle,
      item.ownerUser?.name,
      item.ownerUser?.displayName,
      item.signal.skillSlug,
      item.signal.skillDisplayName,
      ...(item.signal.reasonCodes ?? []),
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

function formatPublisherAbuseSignalType(signalType: string) {
  if (signalType === "high_install_download_ratio") return "High install/download ratio";
  if (signalType === "download_spike_flat_installs") return "Sudden download spike";
  if (signalType === "owner_synchronized_download_trends") {
    return "Synchronized publisher downloads";
  }
  if (signalType === "sustained_abnormal_download_days") {
    return "Sustained unusual downloads";
  }
  if (signalType === "sustained_downloads_flat_installs") {
    return "Sustained downloads, flat installs";
  }
  return signalType.replaceAll("_", " ");
}

function describePublisherAbuseSignalType(signalType: string) {
  if (signalType === "high_install_download_ratio") {
    return "Install counts are unusually high compared with download counts for this skill.";
  }
  if (signalType === "download_spike_flat_installs") {
    return "The 7-day rise and excess downloads are both unusually high.";
  }
  if (signalType === "sustained_abnormal_download_days") {
    return "Downloads stayed unusually high on most days in the measurement window while installs stayed flat.";
  }
  if (signalType === "sustained_downloads_flat_installs") {
    return "Downloads stayed high over the review window while installs stayed flat.";
  }
  if (signalType === "owner_synchronized_download_trends") {
    return "Several already-anomalous skills under this publisher have nearly identical download trends and similarly sized peaks.";
  }
  return "Stored publisher traffic anomaly visible to staff.";
}

function formatPublisherAbuseSignalSeverity(signalType: string) {
  if (signalType === "high_install_download_ratio") return "High";
  return "Watch";
}

function publisherAbuseSignalSeverityVariant(
  signalType: string,
): NonNullable<BadgeProps["variant"]> {
  if (signalType === "high_install_download_ratio") return "warning";
  return "review";
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
    .replace("Low / Stars / Per / Skill", "Low Bookmarks / Skill")
    .replace("Low / Downloads / Per / Skill", "Low Downloads / Skill")
    .replace("Temporal / Download / Spike / Flat / Installs", "Temporal Download Spike")
    .replace(
      "Temporal / Sustained / Abnormal / Download / Days",
      "Temporal Sustained Unusual Downloads",
    )
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
    return "Very high catalog volume with extremely low engagement across installs, bookmarks, and downloads.";
  }
  if (reason === "low_installs_per_skill") {
    return "Installs per skill are far below the platform median.";
  }
  if (reason === "low_stars_per_skill") {
    return "Bookmarks per skill are far below the platform median.";
  }
  if (reason === "low_downloads_per_skill") {
    return "Downloads per skill are far below the platform median.";
  }
  if (reason === "temporal_download_spike_flat_installs") {
    return "The skill's 7-day rise and excess downloads are both above the platform P99.";
  }
  if (reason === "temporal_sustained_abnormal_download_days") {
    return "The skill exceeded its frozen daily threshold on at least 10 of 14 days while installs stayed flat.";
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

function formatPressureLabel(
  score: Pick<PublisherAbuseReviewScore, "pressure" | "temporalMaxPressure">,
) {
  const pressure = score.temporalMaxPressure ?? score.pressure;
  const formatted = formatRatio(pressure);
  if (pressure >= 100) return `Very High (${formatted})`;
  if (pressure >= 10) return `High (${formatted})`;
  if (pressure >= 2) return `Elevated (${formatted})`;
  return `Low (${formatted})`;
}
