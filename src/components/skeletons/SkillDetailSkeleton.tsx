import { Skeleton } from "../ui/skeleton";

export function SkillDetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] px-7 py-10">
      {/* Breadcrumb */}
      <Skeleton className="mb-6 h-4 w-48" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
        {/* Main column */}
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-6 w-16 rounded-[var(--radius-pill)]" />
            </div>
            <Skeleton className="h-5 w-full max-w-lg" />
            {/* Meta row */}
            <div className="flex items-center gap-4">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>

          {/* README skeleton */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-6">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-2 h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>

          {/* Tabs skeleton */}
          <div className="flex gap-2">
            <Skeleton className="h-[44px] w-24 rounded-[var(--radius-pill)]" />
            <Skeleton className="h-[44px] w-28 rounded-[var(--radius-pill)]" />
            <Skeleton className="h-[44px] w-24 rounded-[var(--radius-pill)]" />
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-5">
          {/* Install card */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-[var(--radius-sm)]" />
            <Skeleton className="h-10 w-full rounded-[var(--radius-pill)]" />
          </div>
          {/* Stats card */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <Skeleton className="h-4 w-16" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </div>
          {/* Security card */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
