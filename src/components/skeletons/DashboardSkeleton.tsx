import { Skeleton } from '../ui/skeleton';

const ATTENTION_PLACEHOLDERS = 3;
const PACKAGE_PLACEHOLDERS = 5;
const UPDATE_PLACEHOLDERS = 3;

export function DashboardSkeleton() {
  return (
    <main
      className="browse-page browse-page-borderless-header dashboard-route dashboard-final dashboard-skeleton"
      aria-label="Loading dashboard"
      aria-busy="true"
    >
      <header className="browse-page-header dashboard-page-header dashboard-header">
        <div className="browse-page-header-main dashboard-page-header-main">
          <div className="dashboard-header-top">
            <Skeleton className="dashboard-skeleton-title" />
            <div className="dashboard-skeleton-header-actions">
              <Skeleton className="dashboard-skeleton-add-action" />
              <Skeleton className="dashboard-skeleton-sidebar-action" />
            </div>
          </div>
        </div>
      </header>

      <div className="dashboard-workspace">
        <div className="dashboard-workspace-main">
          <section className="dashboard-attention-strip dashboard-skeleton-attention">
            <Skeleton className="dashboard-skeleton-section-title" />
            <div className="dashboard-skeleton-attention-grid">
              {Array.from({ length: ATTENTION_PLACEHOLDERS }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed visual placeholders
                <div className="dashboard-skeleton-attention-card" key={index}>
                  <div className="dashboard-skeleton-attention-copy">
                    <Skeleton className="dashboard-skeleton-kind" />
                    <Skeleton className="dashboard-skeleton-card-title" />
                    <Skeleton className="dashboard-skeleton-card-summary" />
                  </div>
                  <div className="dashboard-skeleton-attention-footer">
                    <Skeleton className="dashboard-skeleton-status" />
                    <Skeleton className="dashboard-skeleton-review-action" />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-inventory-section dashboard-skeleton-inventory">
            <header className="dashboard-section-head">
              <div className="dashboard-section-head-main">
                <Skeleton className="dashboard-skeleton-section-title" />
                <Skeleton className="dashboard-skeleton-count" />
              </div>
            </header>

            <div className="dashboard-skeleton-toolbar">
              <Skeleton className="dashboard-skeleton-tabs" />
              <Skeleton className="dashboard-skeleton-sort" />
              <div className="dashboard-skeleton-toolbar-spacer" />
              <Skeleton className="dashboard-skeleton-search" />
              <Skeleton className="dashboard-skeleton-view" />
            </div>

            <div className="dashboard-skeleton-package-list">
              {Array.from({ length: PACKAGE_PLACEHOLDERS }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed visual placeholders
                <div className="dashboard-skeleton-package-row" key={index}>
                  <div className="dashboard-skeleton-package-copy">
                    <Skeleton className="dashboard-skeleton-package-name" />
                    <Skeleton className="dashboard-skeleton-package-meta" />
                  </div>
                  <div className="dashboard-skeleton-audit">
                    <Skeleton className="dashboard-skeleton-audit-label" />
                    <span className="dashboard-skeleton-audit-meter" aria-hidden="true">
                      <Skeleton />
                      <Skeleton />
                      <Skeleton />
                    </span>
                  </div>
                  <Skeleton className="dashboard-skeleton-downloads" />
                  <Skeleton className="dashboard-skeleton-menu" />
                </div>
              ))}
            </div>
          </section>

          <div className="dashboard-downloads-mobile-slot">
            <DashboardStatsSkeleton />
          </div>
        </div>

        <aside className="dashboard-right-sidebar dashboard-skeleton-sidebar">
          <div className="dashboard-skeleton-promo">
            <Skeleton className="dashboard-skeleton-promo-art" />
            <Skeleton className="dashboard-skeleton-promo-title" />
            <Skeleton className="dashboard-skeleton-promo-copy" />
            <Skeleton className="dashboard-skeleton-promo-action" />
          </div>
          <div className="dashboard-skeleton-updates">
            <Skeleton className="dashboard-skeleton-updates-title" />
            {Array.from({ length: UPDATE_PLACEHOLDERS }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed visual placeholders
              <div className="dashboard-skeleton-update" key={index}>
                <Skeleton className="dashboard-skeleton-update-dot" />
                <div>
                  <Skeleton className="dashboard-skeleton-update-meta" />
                  <Skeleton className="dashboard-skeleton-update-title" />
                </div>
              </div>
            ))}
            <Skeleton className="dashboard-skeleton-updates-action" />
          </div>
        </aside>
      </div>

      <div className="dashboard-downloads-desktop-slot">
        <DashboardStatsSkeleton />
      </div>
    </main>
  );
}

function DashboardStatsSkeleton() {
  return (
    <section className="dashboard-downloads-insights dashboard-downloads-insights--compact dashboard-skeleton-stats">
      <div className="dashboard-skeleton-stats-toolbar">
        <Skeleton className="dashboard-skeleton-section-title" />
        <div className="dashboard-skeleton-stats-controls">
          <Skeleton className="dashboard-skeleton-stats-filter" />
          <Skeleton className="dashboard-skeleton-stats-range" />
        </div>
      </div>
      <div className="dashboard-skeleton-stats-panel">
        <div className="dashboard-skeleton-stats-primary">
          <Skeleton className="dashboard-skeleton-stat-label" />
          <Skeleton className="dashboard-skeleton-stat-value" />
          <Skeleton className="dashboard-skeleton-chart" />
        </div>
        <div className="dashboard-skeleton-stats-side">
          <Skeleton className="dashboard-skeleton-stat-label" />
          <Skeleton className="dashboard-skeleton-stat-value-small" />
          <Skeleton className="dashboard-skeleton-chart-small" />
        </div>
        <div className="dashboard-skeleton-stats-side">
          <Skeleton className="dashboard-skeleton-stat-label" />
          <Skeleton className="dashboard-skeleton-stat-value-small" />
          <Skeleton className="dashboard-skeleton-chart-small" />
        </div>
      </div>
    </section>
  );
}
