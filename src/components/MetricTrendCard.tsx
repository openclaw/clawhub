import { useId, useMemo, useState, type MouseEvent, type PointerEvent } from "react";
import type { MetricTrend, MetricTrendPoint } from "../lib/activityTrend";
import { formatCompactStat } from "../lib/numberFormat";

function clampPointValue(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function formatActivityDate(day: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(day * 86_400_000));
}

function formatActivityValue(value: number, unitLabel: string) {
  const rounded = Math.max(0, Math.floor(value));
  return `${formatCompactStat(rounded)} ${unitLabel}${rounded === 1 ? "" : "s"}`;
}

function buildSparkline(points: MetricTrendPoint[]) {
  const values = points.map((point) => clampPointValue(point.value));
  const max = Math.max(1, ...values);
  const width = 100;
  const height = 34;
  const topPad = 3;
  const bottomPad = 5;
  const chartHeight = height - topPad - bottomPad;
  const divisor = Math.max(1, values.length - 1);
  const coords = values.map((value, index) => {
    const x = (index / divisor) * width;
    const y = topPad + chartHeight - (value / max) * chartHeight;
    return { x, y };
  });
  const line = coords.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area =
    coords.length > 0
      ? `M 0 ${height} L ${coords
          .map(({ x, y }) => `${x.toFixed(2)} ${y.toFixed(2)}`)
          .join(" L ")} L ${width} ${height} Z`
      : "";
  return { line, area, coords };
}

function getNearestPointIndex(params: {
  clientX: number;
  left: number;
  width: number;
  pointCount: number;
}) {
  if (params.pointCount <= 1 || params.width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (params.clientX - params.left) / params.width));
  return Math.round(ratio * (params.pointCount - 1));
}

export function MetricTrendCard({
  trend,
  ariaLabel,
  periodLabel,
  unitLabel,
}: {
  trend: MetricTrend;
  ariaLabel: string;
  periodLabel?: string;
  unitLabel: "download" | "install";
}) {
  const descriptionId = useId();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chart = useMemo(() => buildSparkline(trend.points), [trend.points]);
  const activePoint =
    activeIndex !== null && activeIndex >= 0 && activeIndex < trend.points.length
      ? trend.points[activeIndex]
      : null;
  const activeCoord =
    activeIndex !== null && activeIndex >= 0 && activeIndex < chart.coords.length
      ? chart.coords[activeIndex]
      : null;
  const activeLabel = activePoint
    ? `${formatActivityDate(activePoint.day)} · ${formatActivityValue(activePoint.value, unitLabel)}`
    : (periodLabel ?? `${trend.days} days`);

  function showNearestPoint(event: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setActiveIndex(
      getNearestPointIndex({
        clientX: event.clientX,
        left: rect.left,
        width: rect.width,
        pointCount: trend.points.length,
      }),
    );
  }

  function showLatestPoint() {
    setActiveIndex(Math.max(0, trend.points.length - 1));
  }

  return (
    <div className="metric-trend-card">
      <div className="metric-trend-value-row">
        <strong>{formatCompactStat(trend.total)}</strong>
        <span className="metric-trend-point-label" id={descriptionId}>
          {activeLabel}
        </span>
      </div>
      <svg
        className="metric-trend-chart"
        viewBox="0 0 100 34"
        role="img"
        aria-label={ariaLabel}
        aria-describedby={descriptionId}
        preserveAspectRatio="none"
        tabIndex={0}
        onFocus={showLatestPoint}
        onBlur={() => setActiveIndex(null)}
        onMouseEnter={showNearestPoint}
        onMouseMove={showNearestPoint}
        onPointerEnter={showNearestPoint}
        onPointerMove={showNearestPoint}
        onPointerLeave={() => setActiveIndex(null)}
      >
        <path className="metric-trend-area" d={chart.area} aria-hidden="true" />
        <polyline
          className="metric-trend-line"
          points={chart.line}
          vectorEffect="non-scaling-stroke"
          aria-hidden="true"
        />
        {activeCoord ? (
          <line
            className="metric-trend-marker-line"
            x1={activeCoord.x}
            x2={activeCoord.x}
            y1="2"
            y2="32"
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />
        ) : null}
      </svg>
    </div>
  );
}

export function MetricTrendCardSkeleton() {
  return (
    <div className="metric-trend-card metric-trend-card-skeleton" aria-hidden="true">
      <div className="metric-trend-value-row">
        <span className="metric-trend-skeleton-total" />
        <span className="metric-trend-skeleton-label" />
      </div>
      <div className="metric-trend-skeleton-chart" />
    </div>
  );
}
