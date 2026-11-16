import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

type SkillDetailSkeletonProps = {
  kind?: "skill" | "plugin";
};

function DetailTabsSkeleton({ count }: { count: number }) {
  return (
    <div className="tab-card detail-mobile-tabs detail-skeleton-tabs">
      <div className="tab-header" aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <Skeleton
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder count
            key={index}
            className="h-8 w-20 shrink-0 rounded-[var(--r-pill)]"
          />
        ))}
      </div>
      <div className="tab-body">
        <div className="space-y-3">
          <Skeleton className="h-7 w-52 max-w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="mt-5 h-5 w-44" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}

// Mirrors the shared install card: a title with its tab toggle, then one action row.
function InstallCardSkeleton() {
  return (
    <article className="skill-install-command-card">
      <div className="skill-install-command-header">
        <Skeleton className="h-5 w-16" />
        <div className="detail-skeleton-install-tabs" aria-hidden="true">
          <Skeleton className="h-4 w-8" />
          <Skeleton className="h-4 w-14" />
        </div>
      </div>
      <Skeleton className="detail-skeleton-install-action" />
    </article>
  );
}

function SidebarMetadataSkeleton() {
  return (
    <div className="sidebar-metadata sidebar-metadata-compact">
      <div className="sidebar-metadata-row sidebar-metadata-row-large">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="sidebar-metadata-row">
        <Skeleton className="h-3 w-14" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-5 w-32" />
        </div>
      </div>
      <div className="sidebar-metadata-grid">
        <div className="sidebar-metadata-row">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="sidebar-metadata-row">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-5 w-20" />
        </div>
      </div>
      <div className="sidebar-metadata-row">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
    </div>
  );
}

export function SkillDetailSkeleton({ kind = "skill" }: SkillDetailSkeletonProps) {
  const isPlugin = kind === "plugin";
  // Narrow screens show the card once in the content column: before the section
  // tabs for skills, inside the About panel for plugins. Wide screens use the rail copy.
  const mobileInstall = (
    <div
      className={cn(
        isPlugin && "plugin-install-stack",
        "detail-mobile-install detail-skeleton-install-mobile",
      )}
    >
      <InstallCardSkeleton />
    </div>
  );

  return (
    <div className={`skill-detail-stack detail-skeleton detail-skeleton-${kind}`}>
      <div className="skill-hero">
        <div className="skill-hero-top">
          <div className="skill-hero-layout has-sidebar">
            <div className="skill-hero-main">
              <div className="skill-hero-title">
                <div className="skill-hero-breadcrumbs">
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-3" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-3" />
                  <Skeleton className="h-4 w-36 max-w-[45vw]" />
                </div>

                <div className="skill-hero-heading-stack">
                  <div className="skill-hero-title-row">
                    <Skeleton className="h-12 w-full max-w-[430px]" />
                    <Skeleton className="h-7 w-24 rounded-[var(--r-pill)]" />
                  </div>
                  {!isPlugin ? (
                    <div className="skill-hero-mobile-creator detail-skeleton-mobile-creator">
                      <Skeleton className="h-7 w-7 rounded-full" />
                      <Skeleton className="h-4 w-28" />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <Skeleton className="h-5 w-full max-w-[720px]" />
                  <Skeleton className="h-5 w-3/4 max-w-[560px]" />
                </div>
              </div>
            </div>

            <div className="skill-hero-lower has-sidebar">
              <div className="skill-hero-main-extra">
                {!isPlugin ? mobileInstall : null}
                <div className="detail-mobile-master-tabs detail-skeleton-master-tabs">
                  <div className="detail-mobile-master-tab-list" aria-hidden="true">
                    <Skeleton className="h-[42px] w-full rounded-[var(--r-md)]" />
                    <Skeleton className="h-[42px] w-full rounded-[var(--r-md)]" />
                  </div>
                  <div className="detail-mobile-master-panel detail-mobile-master-panel-content">
                    {isPlugin ? mobileInstall : null}
                    <DetailTabsSkeleton count={isPlugin ? 4 : 5} />
                  </div>
                </div>
              </div>

              <aside className="skill-hero-sidebar">
                <div className="skill-hero-sidebar-stack">
                  {!isPlugin ? (
                    <div className="skill-sidebar-star-band detail-hero-summary-row">
                      <Skeleton className="h-5 w-full max-w-[220px]" />
                    </div>
                  ) : null}
                  <InstallCardSkeleton />
                  <div className="detail-sidebar-stats">
                    <SidebarMetadataSkeleton />
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
