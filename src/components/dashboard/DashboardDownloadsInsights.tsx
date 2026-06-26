import { useId, useMemo, useState } from "react";
import { BrowseSegmentedTabs, BrowseSortSelect } from "../BrowseControls";
import { formatCompactStat } from "../../lib/numberFormat";
import type { DashboardPackage, DashboardSkill } from "./types";
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
  { id: "all", label: "All" },
];

type ChartCoord = { x: number; y: number };

export function DashboardDownloadsInsights({
  skills,
  packages,
  skillDownloadsTotal,
  pluginDownloadsTotal,
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
  const itemSeries = useMemo(
    () => (isFiltered ? totalSeries : []),
    [isFiltered, totalSeries],
  );

  const rangeTotal = sumSeries(totalSeries);
  const totalDelta = rangeDelta(totalSeries);
  const skillDelta = rangeDelta(skillSeries);
  const pluginDelta = rangeDelta(pluginSeries);
  const itemDelta = rangeDelta(itemSeries);
  const labels = rangeLabels(range);

  const heroDownloads = isFiltered
    ? artifactDownloads(activeSkills, activePackages)
    : rangeTotal;
  const heroMetricLabel = isFiltered ? "All-time downloads" : "Total downloads";
  const heroDisplay = isFiltered
    ? formatCompactStat(heroDownloads)
    : formatRangeTotal(heroDownloads);

  const rangeTitle = (() => {
    const base =
      range === "1d"
        ? "Today's download activity"
        : range === "1w"
          ? "Weekly download activity"
          : range === "1m"
            ? "Monthly download activity"
            : "All-time download trend";
    if (isFiltered && filtered.label) return `${filtered.label} — ${base.toLowerCase()}`;
    return base;
  })();

  return (
    <section className="dashboard-downloads-insights" aria-label="Download metrics">
      <div className="dashboard-downloads-insights-toolbar">
        <div className="dashboard-downloads-insights-controls">
          <BrowseSortSelect
            options={insightOptions}
            value={insight ?? "all"}
            onChange={(value) => {
              const next = !value || value === "all" ? undefined : value;
              onInsightChange?.(next);
            }}
          />
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
      </div>

      <div className="dashboard-downloads-grid">
        <article className="dashboard-downloads-panel dashboard-downloads-panel--hero">
          <header className="dashboard-downloads-panel-head">
            <h2 className="dashboard-downloads-panel-title">{rangeTitle}</h2>
          </header>
          <div className="dashboard-downloads-hero-body">
            <div className="dashboard-downloads-hero-metric">
              <span className="dashboard-downloads-metric-label">{heroMetricLabel}</span>
              <span className="dashboard-downloads-metric-value">{heroDisplay}</span>
              <span
                className={`dashboard-downloads-delta${totalDelta >= 0 ? " is-up" : " is-down"}`}
              >
                {totalDelta >= 0 ? "+" : ""}
                {totalDelta}% vs prior period
                {isFiltered ? " (estimated)" : ""}
              </span>
            </div>
            <Sparkline
              series={totalSeries}
              labels={labels}
              className="dashboard-downloads-sparkline--hero"
            />
          </div>
          <BarTimeline series={totalSeries} labels={labels} />
        </article>

        <div className="dashboard-downloads-side">
          {isFiltered ? (
            <>
              <MetricCard
                label="All-time"
                total={artifactDownloads(activeSkills, activePackages)}
                series={itemSeries}
                delta={itemDelta}
                caption="Recorded downloads"
              />
              <MetricCard
                label="In range"
                total={Math.round(rangeTotal)}
                series={itemSeries}
                delta={itemDelta}
                caption="Estimated activity"
              />
            </>
          ) : (
            <>
              <MetricCard
                label="Skills"
                total={skillDownloadsTotal}
                series={skillSeries}
                delta={skillDelta}
                caption="Skill downloads"
              />
              <MetricCard
                label="Plugins"
                total={pluginDownloadsTotal}
                series={pluginSeries}
                delta={pluginDelta}
                caption="Plugin downloads"
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  total,
  series,
  delta,
  caption,
}: {
  label: string;
  total: number;
  series: number[];
  delta: number;
  caption: string;
}) {
  return (
    <article className="dashboard-downloads-panel dashboard-downloads-panel--compact">
      <header className="dashboard-downloads-compact-head">
        <span className="dashboard-downloads-compact-label">{label}</span>
        <Sparkline series={series} className="dashboard-downloads-sparkline--compact" />
      </header>
      <div className="dashboard-downloads-compact-metric">{formatCompactStat(total)}</div>
      <footer className="dashboard-downloads-compact-foot">
        <span>{caption}</span>
        <span className={`dashboard-downloads-delta${delta >= 0 ? " is-up" : " is-down"}`}>
          {delta >= 0 ? "+" : ""}
          {delta}%
        </span>
      </footer>
    </article>
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
  const last = coords.at(-1);
  const slotWidth = series.length > 0 ? 100 / series.length : 100;
  const activeCoord = activeIndex === null ? null : coords[activeIndex];
  const activeValue = activeIndex === null ? null : series[activeIndex];
  const activeLabel =
    activeIndex === null ? null : (labels?.[activeIndex]?.trim() || `Bucket ${activeIndex + 1}`);

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
            <stop offset="0%" stopColor="currentColor" stopOpacity={isCompact ? "0.24" : "0.32"} />
            <stop offset="58%" stopColor="currentColor" stopOpacity="0.1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${gradientId}-stroke`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.5" />
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
        ) : last ? (
          <circle
            className="dashboard-downloads-sparkline-dot"
            cx={last.x}
            cy={last.y}
            r={isCompact ? 2.1 : 2.6}
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

function BarTimeline({ series, labels }: { series: number[]; labels: string[] }) {
  const rawId = useId();
  const gradientId = rawId.replace(/:/g, "");
  const max = Math.max(...series, 1);
  const baseline = 96;
  const chartTop = 6;
  const chartHeight = baseline - chartTop;
  const slotWidth = series.length > 0 ? 100 / series.length : 100;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeValue = activeIndex === null ? null : series[activeIndex];
  const activeLabel =
    activeIndex === null ? null : (labels[activeIndex]?.trim() || `Bucket ${activeIndex + 1}`);

  return (
    <div className="dashboard-downloads-timeline" onMouseLeave={() => setActiveIndex(null)}>
      <div className="dashboard-downloads-chart-wrap">
        <svg
          className="dashboard-downloads-timeline-chart"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${gradientId}-bar`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.38" />
            </linearGradient>
          </defs>
          <line
            className="dashboard-downloads-timeline-baseline"
            x1="0"
            y1={baseline}
            x2="100"
            y2={baseline}
          />
          {activeIndex !== null ? (
            <line
              className="dashboard-downloads-chart-crosshair"
              x1={activeIndex * slotWidth + slotWidth / 2}
              y1={chartTop}
              x2={activeIndex * slotWidth + slotWidth / 2}
              y2={baseline}
            />
          ) : null}
          {series.map((value, index) => {
            const height = value > 0 ? Math.max(1.5, (value / max) * chartHeight) : 0;
            const barWidth = slotWidth * 0.5;
            const x = index * slotWidth + (slotWidth - barWidth) / 2;
            const label = labels[index]?.trim() || `Bucket ${index + 1}`;
            return (
              <rect
                key={index}
                className={`dashboard-downloads-timeline-bar${activeIndex === index ? " is-active" : ""}${height <= 0 ? " is-empty" : ""}`}
                x={x}
                y={height > 0 ? baseline - height : baseline - 1}
                width={barWidth}
                height={height > 0 ? height : 1}
                rx={1.4}
                fill={height > 0 ? `url(#${gradientId}-bar)` : "transparent"}
                style={{ animationDelay: `${index * 0.025}s` }}
                onMouseEnter={() => setActiveIndex(index)}
                aria-hidden="true"
              >
                <title>
                  {label}: {formatBucketValue(value)}
                </title>
              </rect>
            );
          })}
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
      <div className="dashboard-downloads-timeline-labels">
        {labels.map((label, index) => (
          <span key={index} className={activeIndex === index ? "is-active" : undefined}>
            {label}
          </span>
        ))}
      </div>
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

    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (following.x - current.x) / 6;
    const cp2y = next.y - (following.y - current.y) / 6;

    path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

function areaPath(coords: ChartCoord[], baseline: number): string {
  if (coords.length === 0) return "";
  return `${smoothLinePath(coords)} L ${coords[coords.length - 1].x.toFixed(2)} ${baseline} L ${coords[0].x.toFixed(2)} ${baseline} Z`;
}
