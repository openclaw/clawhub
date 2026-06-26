import { BrowseResultsSkeleton } from "./BrowseResultsSkeleton";
import { Skeleton } from "../ui/skeleton";

export function DashboardSkeleton() {
  return (
    <main className="browse-page browse-page-borderless-header dashboard-route">
      <header className="browse-page-header">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-9 w-24" />
      </header>
      <div className="browse-controls">
        <div className="browse-controls-row">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
      <div className="browse-layout">
        <div className="browse-results">
          <BrowseResultsSkeleton label="Name" variant="list" />
        </div>
      </div>
    </main>
  );
}
