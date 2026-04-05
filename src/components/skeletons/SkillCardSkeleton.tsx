import { Skeleton } from "../ui/skeleton";

export function SkillCardSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-[22px]">
      {/* Title */}
      <Skeleton className="h-5 w-3/4" />
      {/* Summary */}
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      {/* Tags */}
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-6 w-16 rounded-[var(--radius-pill)]" />
        <Skeleton className="h-6 w-20 rounded-[var(--radius-pill)]" />
      </div>
      {/* Footer: author + stats */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}

export function SkillCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
      {Array.from({ length: count }, (_, i) => (
        <SkillCardSkeleton key={i} />
      ))}
    </div>
  );
}
