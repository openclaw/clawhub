import { Skeleton } from "../ui/skeleton";

export function SkillDetailSkeleton() {
  return (
    <div className="skill-detail-stack">
      <div className="rounded-[var(--r-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <Skeleton className="h-4 w-48" />
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Skeleton className="h-9 w-full max-w-[360px]" />
                <Skeleton className="h-6 w-20 rounded-[var(--r-pill)]" />
              </div>
              <Skeleton className="h-5 w-full max-w-[680px]" />
              <Skeleton className="h-5 w-3/4 max-w-[520px]" />
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <div className="w-full space-y-3 lg:max-w-[360px]">
            <Skeleton className="h-12 w-full rounded-[var(--r-sm)]" />
            <Skeleton className="h-12 w-full rounded-[var(--r-pill)]" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          </div>
        </div>
      </div>

      <div className="detail-layout">
        <div className="detail-main">
          <div className="rounded-[var(--r-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              <Skeleton className="h-10 w-24 rounded-[var(--r-pill)]" />
              <Skeleton className="h-10 w-20 rounded-[var(--r-pill)]" />
              <Skeleton className="h-10 w-24 rounded-[var(--r-pill)]" />
            </div>
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

          <div className="rounded-[var(--r-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <Skeleton className="mb-3 h-6 w-28" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>

      </div>
    </div>
  );
}
