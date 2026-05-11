import { Skeleton } from "../ui/skeleton";

type SkillDetailSkeletonProps = {
  kind?: "skill" | "plugin";
};

export function SkillDetailSkeleton({ kind = "skill" }: SkillDetailSkeletonProps) {
  const tabCount = kind === "plugin" ? 4 : 6;

  return (
    <div className="skill-detail-stack">
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
                  {kind === "plugin" ? (
                    <>
                      <Skeleton className="h-4 w-14" />
                      <Skeleton className="h-4 w-3" />
                    </>
                  ) : null}
                  <Skeleton className="h-4 w-36 max-w-[45vw]" />
                </div>

                <div className="skill-hero-title-row">
                  <Skeleton className="h-12 w-full max-w-[430px]" />
                  <Skeleton className="h-7 w-24 rounded-[var(--r-pill)]" />
                </div>

                <div className="space-y-3">
                  <Skeleton className="h-5 w-full max-w-[720px]" />
                  <Skeleton className="h-5 w-3/4 max-w-[560px]" />
                </div>

                {kind === "plugin" ? (
                  <div className="skill-hero-badges">
                    <Skeleton className="h-6 w-56 rounded-[var(--r-pill)]" />
                  </div>
                ) : null}
              </div>

              <div className="skill-hero-lower has-sidebar">
                <div className="skill-hero-main-extra">
                  <Skeleton className="h-12 w-full rounded-[var(--r-sm)]" />

                  <article className="skill-install-command-card">
                    <div className="skill-install-command-header">
                      <Skeleton className="h-7 w-20" />
                      {kind === "skill" ? (
                        <div className="flex gap-2">
                          <Skeleton className="h-8 w-14 rounded-[var(--r-pill)]" />
                          <Skeleton className="h-8 w-20 rounded-[var(--r-pill)]" />
                        </div>
                      ) : null}
                    </div>
                    <div className="skill-install-command-wrap">
                      <div className="skill-install-command-shell">
                        <Skeleton className="h-5 w-full max-w-[520px]" />
                        <Skeleton className="skill-install-command-inline-button h-[34px] rounded-[var(--r-btn)]" />
                      </div>
                    </div>
                  </article>

                  <div className="tab-card">
                    <div className="tab-header">
                      {Array.from({ length: tabCount }).map((_, i) => (
                        <Skeleton
                          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder count
                          key={i}
                          className="h-9 w-24 shrink-0 rounded-none"
                        />
                      ))}
                    </div>
                    <div className="tab-body">
                      <div className="space-y-3">
                        <Skeleton className="h-6 w-40" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-11/12" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="mt-5 h-5 w-52" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="skill-hero-sidebar">
                  <div className="skill-hero-sidebar-stack">
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

                    <div className="skill-sidebar-actions">
                      <Skeleton className="h-10 w-full rounded-[var(--r-btn)]" />
                      <Skeleton className="h-10 w-full rounded-[var(--r-btn)]" />
                      {kind === "skill" ? (
                        <Skeleton className="h-10 w-full rounded-[var(--r-btn)]" />
                      ) : null}
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
