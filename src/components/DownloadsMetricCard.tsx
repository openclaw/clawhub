import { useState } from "react";
import {
  buildDownloadsTrendForPeriod,
  getDownloadTrendAriaLabel,
  getDownloadTrendPeriodLabel,
  type DownloadTrendPeriod,
  type MetricTrend,
} from "../lib/activityTrend";
import { formatCompactStat } from "../lib/numberFormat";
import { cn } from "../lib/utils";
import { MetricTrendCard, MetricTrendCardSkeleton } from "./MetricTrendCard";

const DOWNLOAD_PERIODS: Array<{ id: DownloadTrendPeriod; label: string }> = [
  { id: "all-time", label: "All time" },
  { id: "30d", label: "30d" },
  { id: "7d", label: "7d" },
];

export function DownloadsMetricCard({
  allTimeDownloads,
  activityTrend,
  loading = false,
}: {
  allTimeDownloads: number;
  activityTrend?: MetricTrend | null;
  loading?: boolean;
}) {
  const [period, setPeriod] = useState<DownloadTrendPeriod>("30d");

  if (loading) {
    return <MetricTrendCardSkeleton />;
  }

  if (!activityTrend) {
    return <span>{formatCompactStat(allTimeDownloads)}</span>;
  }

  const trend = buildDownloadsTrendForPeriod(period, activityTrend, allTimeDownloads);

  return (
    <div className="downloads-metric-card">
      <div
        className="downloads-metric-tabs clawhub-segmented"
        role="tablist"
        aria-label="Download period"
      >
        {DOWNLOAD_PERIODS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={cn("clawhub-segmented-btn", period === tab.id && "is-active")}
            aria-selected={period === tab.id}
            onClick={() => setPeriod(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <MetricTrendCard
        trend={trend}
        ariaLabel={getDownloadTrendAriaLabel(period)}
        periodLabel={getDownloadTrendPeriodLabel(period)}
        unitLabel="download"
      />
    </div>
  );
}
