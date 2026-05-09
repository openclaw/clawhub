import type { ReactNode } from "react";
import {
  ArtifactScanResult,
  ArtifactScanStrip,
  type ArtifactRescanState,
} from "./ArtifactScanStrip";
import type { ArtifactDisplayStatus, ArtifactScanSignalStatus } from "./artifactStatus";

type ArtifactStat = {
  label: string;
  value: string;
};

type ArtifactScanSignals = {
  vtStatus: string | null;
  llmStatus: string | null;
  staticScanStatus: ArtifactScanSignalStatus;
  rescanState: ArtifactRescanState | null;
};

export function ArtifactCard({
  href,
  title,
  titleId,
  icon,
  meta,
  summary,
  status,
  scanSignals,
  stats,
  actions,
}: {
  href: string;
  title: string;
  titleId: string;
  icon: ReactNode;
  meta: ReactNode;
  summary?: string | null;
  status: ArtifactDisplayStatus;
  scanSignals: ArtifactScanSignals;
  stats: ArtifactStat[];
  actions?: ReactNode;
}) {
  return (
    <div className="dashboard-artifact-card">
      <a href={href} className="dashboard-artifact-card-body" aria-labelledby={titleId}>
        <div className="dashboard-artifact-main">
          <div className="dashboard-artifact-icon" aria-hidden="true">
            {icon}
          </div>
          <div className="dashboard-artifact-heading">
            <div className="dashboard-artifact-title-row">
              <span id={titleId} className="dashboard-skill-name">
                {title}
              </span>
              <ArtifactScanResult status={status} />
            </div>
            <div className="dashboard-artifact-meta">{meta}</div>
          </div>
        </div>
        <p className="dashboard-artifact-summary">{summary ?? "No summary provided."}</p>
        <ArtifactScanStrip {...scanSignals} />
        <ArtifactStats stats={stats} />
      </a>
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
