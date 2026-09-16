import { Skeleton } from "../ui/skeleton";

type BrowseResultsSkeletonProps = {
  count?: number;
  label?: string;
  showIcon?: boolean;
  variant?: "list" | "grid";
  showColumnHead?: boolean;
  showCategoryColumn?: boolean;
};

export function BrowseResultsSkeleton({
  count = 6,
  label = "Skill",
  showIcon = true,
  variant = "list",
  showColumnHead = true,
  showCategoryColumn = true,
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
            <div className={`skill-card-header${showIcon ? "" : " skill-card-header-no-icon"}`}>
              {showIcon ? (
                <Skeleton className="browse-results-skeleton-icon h-[34px] w-[34px] rounded-[var(--oc-radius-inset)]" />
              ) : null}
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
        <div
          className={`browse-list-head${
            showCategoryColumn
              ? showIcon
                ? ""
                : " browse-list-head-no-icon"
              : showIcon
                ? " browse-list-head-simple"
                : " browse-list-head-simple-no-icon"
          }`}
          aria-hidden="true"
        >
          {showIcon ? <span className="browse-list-head-icon-spacer" /> : null}
          <span className="browse-list-head-label">{label}</span>
          {showCategoryColumn ? (
            <span className="browse-list-head-label browse-list-head-category">Category</span>
          ) : null}
          <span className="browse-list-head-label browse-list-head-stat">Downloads</span>
        </div>
      ) : null}
      <div className="results-list">
        {Array.from({ length: count }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
            key={i}
            className={`skill-list-item browse-results-skeleton-row${
              showCategoryColumn ? " skill-list-item-has-creator" : ""
            }${showIcon ? "" : showCategoryColumn ? " skill-list-item-no-icon" : " skill-list-item-simple-no-icon"}`}
          >
            {showIcon ? (
              <Skeleton className="browse-results-skeleton-icon h-[27px] w-[27px] shrink-0 rounded-[var(--oc-radius-inset)]" />
            ) : null}
            <div className="skill-list-item-body">
              <div className="skill-list-item-main">
                <Skeleton className="h-5 w-32 max-w-[45%]" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            {showCategoryColumn ? (
              <div className="skill-list-item-taxonomy">
                <Skeleton className="h-4 w-24" />
              </div>
            ) : null}
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
