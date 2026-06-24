import type { MouseEvent, ReactNode } from "react";

type VersionReleaseRowProps = {
  versionLabel: string;
  dateLabel: string;
  isLatest?: boolean;
  isExpanded: boolean;
  changelogId: string;
  checksLabel?: string;
  releaseLabel?: string;
  actionsLabel?: string;
  checks?: ReactNode;
  release?: ReactNode;
  actions?: ReactNode;
  changelog?: ReactNode;
  onToggle: () => void;
};

export function VersionReleaseRow({
  versionLabel,
  dateLabel,
  isLatest = false,
  isExpanded,
  changelogId,
  checksLabel,
  releaseLabel = "Release",
  actionsLabel = "Download",
  checks,
  release,
  actions,
  changelog,
  onToggle,
}: VersionReleaseRowProps) {
  const handleSummaryClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("a, button")) return;
    onToggle();
  };

  return (
    <article
      className={`skill-version-release${isLatest ? " is-latest" : ""}`}
      data-expanded={isExpanded ? "true" : "false"}
    >
      <div className="skill-version-release-summary" onClick={handleSummaryClick}>
        <button
          type="button"
          className="skill-version-release-toggle"
          aria-expanded={isExpanded}
          aria-controls={changelogId}
          onClick={onToggle}
        >
          <span className="skill-version-release-version">{versionLabel}</span>
          <span className="skill-version-release-meta">
            <span>{dateLabel}</span>
          </span>
        </button>
        {checksLabel ? (
          <div
            className="skill-version-release-cell skill-version-release-scan"
            data-label={checksLabel}
            aria-label={checksLabel}
          >
            {checks}
          </div>
        ) : null}
        <div
          className="skill-version-release-cell skill-version-release-tags"
          data-label={releaseLabel}
        >
          {release}
        </div>
        <div
          className="skill-version-release-cell skill-version-release-actions"
          data-label={actionsLabel}
        >
          {actions}
        </div>
        <button
          type="button"
          className="skill-version-release-chevron-button"
          aria-label={
            isExpanded ? `Hide changelog for ${versionLabel}` : `Show changelog for ${versionLabel}`
          }
          aria-expanded={isExpanded}
          aria-controls={changelogId}
          onClick={onToggle}
        >
          <span className="skill-version-release-chevron" aria-hidden="true" />
        </button>
      </div>
      {isExpanded && changelog ? (
        <div id={changelogId} className="skill-version-release-changelog">
          {changelog}
        </div>
      ) : null}
    </article>
  );
}
