import { Skeleton } from "../ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] px-7 py-10">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <Skeleton className="h-8 w-52" />
        <div className="flex gap-3">
          <Skeleton className="h-[44px] w-32 rounded-[var(--radius-pill)]" />
          <Skeleton className="h-[44px] w-36 rounded-[var(--radius-pill)]" />
        </div>
      </div>

      {/* Stats row */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-5"
          >
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>

      {/* Publisher tabs */}
      <Skeleton className="mb-6 h-[44px] w-64 rounded-[var(--radius-pill)]" />

      {/* Table skeleton */}
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-[var(--radius-sm)]" />
        ))}
      </div>
    </div>
  );
}
