import { useId, useMemo, useState } from "react";
import { formatCompactStat } from "../../lib/numberFormat";
import { BrowseControlsDivider, BrowseSegmentedTabs, BrowseSortSelect } from "../BrowseControls";
import {
  artifactDownloads,
  buildDownloadInsightOptions,
  buildDownloadSeries,
  formatRangeTotal,
  parseDownloadInsight,
  rangeDelta,
  rangeLabels,
  resolveDownloadInsight,
  sumSeries,
  type DownloadRange,
} from "./dashboardDownloadMetrics";
import type { DashboardPackage, DashboardSkill } from "./types";

type DashboardDownloadsInsightsProps = {
  skills: DashboardSkill[];
  packages: DashboardPackage[];
  skillDownloadsTotal: number;
  pluginDownloadsTotal: number;
  insight?: string;
  onInsightChange?: (insight: string | undefined) => void;
};

const RANGES: { id: DownloadRange; label: string }[] = [
  { id: "1d", label: "1D" },
  { id: "1w", label: "1W" },
  { id: "1m", label: "1M" },
  { id: "all", label: "All time" },
];

type ChartCoord = { x: number; y: number };

export function DashboardDownloadsInsights({
  skills,
  packages,
  skillDownloadsTotal: _skillDownloadsTotal,
  pluginDownloadsTotal: _pluginDownloadsTotal,
  insight,
  onInsightChange,
}: DashboardDownloadsInsightsProps) {
  const [range, setRange] = useState<DownloadRange>("1w");

  const selection = parseDownloadInsight(insight);
  const filtered = useMemo(
    () => resolveDownloadInsight(parseDownloadInsight(insight), skills, packages),
    [insight, skills, packages],
  );
  const isFiltered = selection.scope !== "all" && !filtered.missing;

  const insightOptions = useMemo(
    () => buildDownloadInsightOptions(skills, packages),
    [skills, packages],
  );

  const activeSkills = filtered.missing ? skills : filtered.skills;
  const activePackages = filtered.missing ? packages : filtered.packages;

  const totalSeries = useMemo(
    () => buildDownloadSeries(activeSkills, activePackages, range),
    [activeSkills, activePackages, range],
  );
  const skillSeries = useMemo(
    () => buildDownloadSeries(isFiltered ? [] : skills, [], range),
    [isFiltered, skills, range],
  );
  const pluginSeries = useMemo(
    () => buildDownloadSeries([], isFiltered ? [] : packages, range),
    [isFiltered, packages, range],
  );
  const itemSeries = useMemo(() => (isFiltered ? totalSeries : []), [isFiltered, totalSeries]);

  const rangeTotal = sumSeries(totalSeries);
  const totalDelta = rangeDelta(totalSeries);
  const skillDelta = rangeDelta(skillSeries);
  const pluginDelta = rangeDelta(pluginSeries);
  const itemDelta = rangeDelta(itemSeries);
  const labels = rangeLabels(range);

  const heroDownloads = isFiltered ? artifactDownloads(activeSkills, activePackages) : rangeTotal;
  const heroMetricLabel = isFiltered ? "All-time downloads" : "Total downloads";
  const heroDisplay = isFiltered
    ? formatCompactStat(heroDownloads)
    : formatRangeTotal(heroDownloads);

  const sectionTitle = (() => {
    if (isFiltered && filtered.label) return filtered.label;
    return "Your stats";
  })();

  return (
    <section
      className="dashboard-downloads-insights dashboard-downloads-insights--compact"
      aria-label="Download metrics"
    >
      <header className="dashboard-downloads-compact-toolbar">
        <h2 className="dashboard-section-title">{sectionTitle}</h2>
        <div className="dashboard-downloads-compact-toolbar-controls">
          {insightOptions.length > 1 ? (
            <>
              <BrowseSortSelect
                options={insightOptions}
                value={insight ?? "all"}
                onChange={(value) => {
                  const next = !value || value === "all" ? undefined : value;
                  onInsightChange?.(next);
                }}
              />
              <BrowseControlsDivider />
            </>
          ) : null}
          <BrowseSegmentedTabs
            ariaLabel="Time range"
            options={RANGES.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            value={range}
            onChange={(value) => {
              if (value === "1d" || value === "1w" || value === "1m" || value === "all") {
                setRange(value);
              }
            }}
          />
        </div>
      </header>

      <div className="dashboard-downloads-compact-panel">
        <div className="dashboard-downloads-compact-primary">
          <div className="dashboard-downloads-compact-hero-metric">
            <span className="dashboard-downloads-metric-label">{heroMetricLabel}</span>
            <span className="dashboard-downloads-metric-value dashboard-downloads-metric-value--compact">
              {heroDisplay}
            </span>
            <span className={`dashboard-downloads-delta${totalDelta >= 0 ? " is-up" : " is-down"}`}>
              {totalDelta >= 0 ? "+" : ""}
              {totalDelta}% vs prior period
              {isFiltered ? " (estimated)" : ""}
            </span>
          </div>
          <Sparkline
            series={totalSeries}
            labels={labels}
            className="dashboard-downloads-sparkline--compact-primary"
          />
        </div>

        <div className="dashboard-downloads-compact-split">
          {isFiltered ? (
            <>
              <CompactStat
                label="All-time"
                total={artifactDownloads(activeSkills, activePackages)}
                series={itemSeries}
                delta={itemDelta}
              />
              <CompactStat
                label="In range"
                total={Math.round(rangeTotal)}
                series={itemSeries}
                delta={itemDelta}
              />
            </>
          ) : (
            <>
              <CompactStat
                label="Skills"
                total={Math.round(sumSeries(skillSeries))}
                series={skillSeries}
                delta={skillDelta}
              />
              <CompactStat
                label="Plugins"
                total={Math.round(sumSeries(pluginSeries))}
                series={pluginSeries}
                delta={pluginDelta}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CompactStat({
  label,
  total,
  series,
  delta,
}: {
  label: string;
  total: number;
  series: number[];
  delta: number;
}) {
  return (
    <div className="dashboard-downloads-compact-stat">
      <span className="dashboard-downloads-compact-stat-label">{label}</span>
      <div className="dashboard-downloads-compact-stat-value">{formatCompactStat(total)}</div>
      <span className={`dashboard-downloads-delta${delta >= 0 ? " is-up" : " is-down"}`}>
        {delta >= 0 ? "+" : ""}
        {delta}%
      </span>
      <Sparkline series={series} className="dashboard-downloads-sparkline--compact-stat" />
    </div>
  );
}

function formatBucketValue(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString();
}

function Sparkline({
  series,
  labels,
  className,
}: {
  series: number[];
  labels?: string[];
  className?: string;
}) {
  const rawId = useId();
  const gradientId = rawId.replace(/:/g, "");
  const isCompact = className?.includes("compact");
  const bottomPad = isCompact ? 9 : 11;
  const baseline = 100 - bottomPad;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const coords = useMemo(
    () =>
      buildChartCoords(series, {
        topPad: isCompact ? 5 : 7,
        bottomPad,
        verticalScale: isCompact ? 0.94 : 0.9,
      }),
    [series, isCompact, bottomPad],
  );

  const linePath = useMemo(() => smoothLinePath(coords), [coords]);
  const fillPath = useMemo(() => areaPath(coords, baseline), [coords, baseline]);
  const slotWidth = series.length > 0 ? 100 / series.length : 100;
  const activeCoord = activeIndex === null ? null : coords[activeIndex];
  const activeValue = activeIndex === null ? null : series[activeIndex];
  const activeLabel =
    activeIndex === null ? null : labels?.[activeIndex]?.trim() || `Bucket ${activeIndex + 1}`;

  return (
    <div
      className={`dashboard-downloads-chart-wrap${isCompact ? " is-compact" : ""}`}
      onMouseLeave={() => setActiveIndex(null)}
    >
      <svg
        className={`dashboard-downloads-sparkline ${className ?? ""}`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${gradientId}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
            <stop offset="72%" stopColor="currentColor" stopOpacity="0.05" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gradientId}-stroke`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.72" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>
        </defs>
        <line
          className="dashboard-downloads-sparkline-grid"
          x1="0"
          y1={baseline}
          x2="100"
          y2={baseline}
        />
        <path
          className="dashboard-downloads-sparkline-area"
          d={fillPath}
          fill={`url(#${gradientId}-fill)`}
        />
        <path
          className="dashboard-downloads-sparkline-line"
          d={linePath}
          stroke={`url(#${gradientId}-stroke)`}
        />
        {activeCoord ? (
          <line
            className="dashboard-downloads-chart-crosshair"
            x1={activeCoord.x}
            y1={isCompact ? 5 : 7}
            x2={activeCoord.x}
            y2={baseline}
          />
        ) : null}
        {series.map((value, index) => (
          <rect
            key={index}
            className="dashboard-downloads-chart-hit"
            x={index * slotWidth}
            y="0"
            width={slotWidth}
            height="100"
            onMouseEnter={() => setActiveIndex(index)}
            aria-hidden="true"
          >
            <title>
              {labels?.[index]?.trim()
                ? `${labels[index]}: ${formatBucketValue(value)}`
                : formatBucketValue(value)}
            </title>
          </rect>
        ))}
        {activeCoord ? (
          <circle
            className="dashboard-downloads-sparkline-dot is-active"
            cx={activeCoord.x}
            cy={activeCoord.y}
            r={isCompact ? 2.4 : 3}
          />
        ) : null}
      </svg>
      {activeIndex !== null && activeValue !== null && activeLabel ? (
        <div
          className="dashboard-downloads-chart-tooltip"
          style={{ left: `${((activeIndex + 0.5) / series.length) * 100}%` }}
        >
          <span className="dashboard-downloads-chart-tooltip-label">{activeLabel}</span>
          <span className="dashboard-downloads-chart-tooltip-value">
            {formatBucketValue(activeValue)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function buildChartCoords(
  series: number[],
  options: { topPad: number; bottomPad: number; verticalScale: number },
): ChartCoord[] {
  const chartHeight = 100 - options.topPad - options.bottomPad;
  if (series.length === 0) return [];

  const max = Math.max(...series, 1);
  const divisor = Math.max(1, series.length - 1);

  return series.map((value, index) => ({
    x: (index / divisor) * 100,
    y: options.topPad + chartHeight - (value / max) * chartHeight * options.verticalScale,
  }));
}

function smoothLinePath(coords: ChartCoord[]): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) {
    const point = coords[0];
    return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let index = 0; index < coords.length - 1; index++) {
    const previous = coords[Math.max(0, index - 1)];
    const current = coords[index];
    const next = coords[index + 1];
    const following = coords[Math.min(coords.length - 1, index + 2)];

    const cp1x = current.x + (next.x - previous.x) / 8;
    const cp1y = current.y + (next.y - previous.y) / 8;
    const cp2x = next.x - (following.x - current.x) / 8;
    const cp2y = next.y - (following.y - current.y) / 8;

    path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

function areaPath(coords: ChartCoord[], baseline: number): string {
  if (coords.length === 0) return "";
  return `${smoothLinePath(coords)} L ${coords[coords.length - 1].x.toFixed(2)} ${baseline} L ${coords[0].x.toFixed(2)} ${baseline} Z`;
}
