import { Skeleton } from "../ui/skeleton";

type BrowseResultsSkeletonProps = {
  count?: number;
  variant?: "list" | "grid";
};

export function BrowseResultsSkeleton({ count = 6, variant = "list" }: BrowseResultsSkeletonProps) {
  if (variant === "grid") {
    return (
      <div className="grid" role="status" aria-label="Loading results">
        {Array.from({ length: count }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
            key={i}
            className="card skill-card skill-card-spaced-footer"
          >
            <div className="skill-card-tags">
              <Skeleton className="h-6 w-16 rounded-[var(--radius-pill)]" />
              <Skeleton className="h-6 w-20 rounded-[var(--radius-pill)]" />
            </div>
            <div className="skill-card-header">
              <Skeleton className="h-11 w-11 rounded-[var(--r-sm)]" />
              <Skeleton className="h-6 w-40 max-w-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
            <div className="skill-card-footer">
              <div className="skill-card-footer-rows">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-4 w-44 max-w-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="results-list" role="status" aria-label="Loading results">
      {Array.from({ length: count }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder count
          key={i}
          className="skill-list-item"
        >
          <Skeleton className="h-11 w-11 shrink-0 rounded-[var(--r-sm)]" />
          <div className="skill-list-item-body">
            <div className="skill-list-item-main">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-2" />
              <Skeleton className="h-5 w-44 max-w-full" />
              <Skeleton className="h-6 w-16 rounded-[var(--radius-pill)]" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="skill-list-item-meta">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
