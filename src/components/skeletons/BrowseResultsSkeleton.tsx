import { Skeleton } from "../ui/skeleton";

type BrowseResultsSkeletonProps = {
  count?: number;
  label?: string;
  variant?: "list" | "grid";
  showColumnHead?: boolean;
};

export function BrowseResultsSkeleton({
  count = 6,
  label = "Skill",
  variant = "list",
  showColumnHead = true,
}: BrowseResultsSkeletonProps) {
  if (variant === "grid") {
    return (
      <div className="grid browse-results-grid" role="status" aria-label="Loading results">
        {Array.from({ length: count }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
            key={i}
            className="card skill-card skill-card-spaced-footer"
          >
            <div className="skill-card-header">
              <Skeleton className="h-[34px] w-[34px] rounded-[9px]" />
              <div className="skill-card-identity">
                <Skeleton className="h-5 w-40 max-w-full" />
                <Skeleton className="h-4 w-24 max-w-full" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
            <div className="skill-card-footer">
              <div className="skill-card-grid-meta">
                <Skeleton className="h-4 w-24 max-w-full" />
                <Skeleton className="h-4 w-20 max-w-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="browse-list-stack" role="status" aria-label="Loading results">
      {showColumnHead ? (
        <div className="browse-list-head" aria-hidden="true">
          <span className="browse-list-head-icon-spacer" />
          <span className="browse-list-head-label">{label}</span>
          <span className="browse-list-head-label">Category</span>
          <span className="browse-list-head-label browse-list-head-stat">Popularity</span>
        </div>
      ) : null}
      <div className="results-list">
        {Array.from({ length: count }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
            key={i}
            className="skill-list-item skill-list-item-has-creator browse-results-skeleton-row"
          >
            <Skeleton className="browse-results-skeleton-icon h-9 w-9 shrink-0 rounded-[var(--oc-radius-inset)]" />
            <div className="skill-list-item-body">
              <div className="skill-list-item-main">
                <Skeleton className="h-5 w-32 max-w-[45%]" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <div className="skill-list-item-taxonomy">
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="skill-list-item-meta">
              <Skeleton className="h-4 w-24 browse-results-skeleton-updated" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-14" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
