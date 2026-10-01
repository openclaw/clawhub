import type { ReactNode } from "react";
import { ArtifactScanStatusValue } from "./ArtifactScanStrip";
import type { ArtifactDisplayStatus } from "./artifactStatus";

type ArtifactStat = {
  label: string;
  value: ReactNode;
};

export function ArtifactCard({
  href,
  title,
  titleId,
  icon,
  status,
  stats,
  actions,
}: {
  href: string;
  title: string;
  titleId: string;
  icon: ReactNode;
  status: ArtifactDisplayStatus;
  stats: ArtifactStat[];
  actions?: ReactNode;
}) {
  return (
    <div className="dashboard-artifact-card">
      <a href={href} className="dashboard-artifact-link" aria-label={title} />
      <div className="dashboard-artifact-card-body">
        <div className="dashboard-artifact-icon">{icon}</div>
        <div className="dashboard-artifact-heading">
          <div className="dashboard-artifact-title-row">
            <span id={titleId} className="dashboard-skill-name">
              {title}
            </span>
          </div>
        </div>
      </div>
      <ArtifactStats
        stats={[
          { label: "Security scan", value: <ArtifactScanStatusValue status={status} /> },
          ...stats,
        ]}
      />
      {actions}
    </div>
  );
}

function ArtifactStats({ stats }: { stats: ArtifactStat[] }) {
  return (
    <dl className="dashboard-artifact-stats">
      {stats.map((stat) => (
        <div key={stat.label} className="dashboard-artifact-stat">
          <dt>{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
