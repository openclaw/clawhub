import { useState, type ReactNode } from "react";
import {
  buildDownloadsTrendForPeriod,
  DOWNLOAD_TREND_PERIODS,
  getDownloadTrendPeriod,
  type DownloadTrendPeriod,
  type MetricTrend,
} from "../lib/activityTrend";
import { formatCompactStat } from "../lib/numberFormat";
import { cn } from "../lib/utils";
import { ActivityMetricLabel } from "./ActivityMetricLabel";
import { MetricTrendCard, MetricTrendCardSkeleton } from "./MetricTrendCard";

type DownloadsSidebarMetricBlock = {
  key?: string;
  label: ReactNode;
  value: ReactNode;
  large: true;
};

function DownloadsMetricPeriodTabs({
  period,
  onPeriodChange,
}: {
  period: DownloadTrendPeriod;
  onPeriodChange: (period: DownloadTrendPeriod) => void;
}) {
  return (
    <div className="downloads-metric-tabs" role="tablist" aria-label="Download period">
      {DOWNLOAD_TREND_PERIODS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className={cn("detail-inline-tab", period === tab.id && "is-active")}
          aria-selected={period === tab.id}
          onClick={() => onPeriodChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function useDownloadsSidebarMetricBlock({
  allTimeDownloads,
  activityTrend,
  loading = false,
}: {
  allTimeDownloads: number;
  activityTrend?: MetricTrend | null;
  loading?: boolean;
}): DownloadsSidebarMetricBlock {
  const [period, setPeriod] = useState<DownloadTrendPeriod>("30d");

  if (loading) {
    return {
      key: "download-trend-loading",
      label: <ActivityMetricLabel label="Downloads" />,
      value: <MetricTrendCardSkeleton />,
      large: true,
    };
  }

  if (!activityTrend) {
    return {
      label: <ActivityMetricLabel label="Downloads" />,
      value: (
        <div className="metric-trend-value-row">
          <strong>{formatCompactStat(allTimeDownloads)}</strong>
          <span className="metric-trend-point-label">All time</span>
        </div>
      ),
      large: true,
    };
  }

  const trend = buildDownloadsTrendForPeriod(period, activityTrend, allTimeDownloads);
  const { ariaLabel, periodLabel } = getDownloadTrendPeriod(period);

  return {
    key: "download-trend",
    label: (
      <div className="downloads-metric-label-row">
        <ActivityMetricLabel label="Downloads" />
        <DownloadsMetricPeriodTabs period={period} onPeriodChange={setPeriod} />
      </div>
    ),
    value: (
      <MetricTrendCard
        trend={trend}
        ariaLabel={ariaLabel}
        periodLabel={periodLabel}
        unitLabel="download"
        hideIdlePeriodLabel
      />
    ),
    large: true,
  };
}
