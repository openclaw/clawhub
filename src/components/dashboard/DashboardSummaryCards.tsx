import { formatCompactStat } from "../../lib/numberFormat";
import type { DashboardAggregateStats } from "./dashboardCatalog";

type DashboardSummaryCardsProps = {
  stats: DashboardAggregateStats;
};

export function DashboardSummaryCards({ stats }: DashboardSummaryCardsProps) {
  return (
    <div className="dashboard-summary-cards" aria-label="Publisher summary">
      <SummaryCard label="Skills" value={stats.skillsCount} />
      <SummaryCard label="Plugins" value={stats.pluginsCount} />
      <SummaryCard label="Downloads" value={stats.totalDownloads} />
      <SummaryCard
        label="Needs attention"
        value={stats.needsAttentionCount}
        highlight={stats.needsAttentionCount > 0}
      />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className={`dashboard-summary-card${highlight ? " is-alert" : ""}`}>
      <span className="dashboard-summary-card-label">{label}</span>
      <span className="dashboard-summary-card-value">{formatCompactStat(value)}</span>
    </div>
  );
}
