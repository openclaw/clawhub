import { Skeleton } from "../ui/skeleton";

export function DashboardSkeleton() {
  return (
    <main className="section">
      <div className="dashboard-header">
        <div className="grid gap-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>

      <div className="dashboard-owner-grid">
        {["skills", "plugins"].map((section) => (
          <div
            key={section}
            className="dashboard-owner-panel flex w-full flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-space-5"
          >
            <div className="dashboard-section-header">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-[34px] w-28 rounded-[var(--r-btn)]" />
            </div>
            <div className="dashboard-list">
              {Array.from({ length: section === "skills" ? 2 : 3 }, (_, index) => (
                <div key={index} className="dashboard-list-row">
                  <Skeleton className="h-5 w-48 max-w-full" />
                  <Skeleton className="h-5 w-96 max-w-full" />
                  <Skeleton className="h-8 w-24 rounded-[var(--radius-pill)]" />
                  <Skeleton className="h-8 w-8 rounded-[var(--r-btn)]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
