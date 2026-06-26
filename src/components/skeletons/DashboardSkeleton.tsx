import { Skeleton } from "../ui/skeleton";
import { BrowseResultsSkeleton } from "./BrowseResultsSkeleton";

export function DashboardSkeleton() {
  return (
    <main className="browse-page browse-page-borderless-header dashboard-route">
      <header className="browse-page-header dashboard-page-header dashboard-header">
        <div className="browse-page-header-main dashboard-page-header-main">
          <div className="dashboard-header-top">
            <div className="dashboard-header-intro">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <Skeleton className="h-9 w-20" />
          </div>
          <Skeleton className="h-11 w-full max-w-md" />
        </div>
      </header>

      <div className="dashboard-workspace">
        <div className="dashboard-workspace-main">
          <Skeleton className="h-28 w-full" />
          <div className="dashboard-inventory-section">
            <Skeleton className="h-6 w-32" />
            <div className="browse-controls">
              <Skeleton className="h-9 w-full max-w-xl" />
            </div>
            <BrowseResultsSkeleton label="Name" variant="list" />
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
        <aside className="dashboard-right-sidebar">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-32 w-full" />
        </aside>
      </div>
    </main>
  );
}
