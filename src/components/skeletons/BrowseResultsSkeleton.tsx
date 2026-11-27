import { Skeleton } from "../ui/skeleton";

type BrowseResultsSkeletonProps = {
  count?: number;
  showIcon?: boolean;
  showCategoryColumn?: boolean;
  downloadsOnly?: boolean;
  /** Set false where the loaded rows show no download count, so loading matches them. */
  showStats?: boolean;
};

export function BrowseResultsSkeleton({
  count = 6,
  showIcon = true,
  showCategoryColumn = true,
  downloadsOnly = false,
  showStats = true,
}: BrowseResultsSkeletonProps) {
  return (
    <div className="browse-list-stack" role="status" aria-label="Loading results">
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
            {showStats ? (
              <div className="skill-list-item-meta">
                {downloadsOnly ? (
                  <Skeleton className="h-4 w-8" />
                ) : (
                  <>
                    <Skeleton className="h-4 w-24 browse-results-skeleton-updated" />
                    <Skeleton className="h-4 w-14" />
                    <Skeleton className="h-4 w-14" />
                  </>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
