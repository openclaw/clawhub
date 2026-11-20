import { Skeleton } from "../ui/skeleton";
import "../template-detail.css";

function InstallPlaceholder({ mobile = false }: { mobile?: boolean }) {
  return (
    <div
      className={
        mobile
          ? "template-skeleton-install-mobile template-detail-install"
          : "template-skeleton-install-desktop"
      }
    >
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="mt-3 h-14 w-full" />
    </div>
  );
}

/** Shares the loaded page's grid and breakpoints; placeholders never become actions. */
export function TemplateDetailSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading Template details…
      </span>
      <main className="template-detail-page template-detail-skeleton" aria-busy="true">
        <div aria-hidden="true" className="template-detail-container">
          <div className="template-detail-hero">
            <Skeleton className="mb-[18px] h-3 w-24" />
            <Skeleton className="h-9 w-80 max-w-[80%]" />
            <Skeleton className="mt-[14px] h-4 w-11/12" />
            <Skeleton className="mt-2 h-4 w-2/3" />
            <div className="template-detail-publisher gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </div>
          <div className="template-detail-layout">
            <div className="template-detail-main">
              <InstallPlaceholder mobile />
              <div className="template-release-inventory space-y-2">
                <Skeleton className="h-5 w-40 max-w-full" />
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-2/5" />
              </div>
              <div className="template-detail-tabs h-[43px] items-center">
                {["w-16", "w-10", "w-20", "w-12", "w-24"].map((width) => (
                  <Skeleton key={width} className={"h-4 shrink-0 " + width} />
                ))}
              </div>
              <div className="template-detail-panel space-y-3">
                <Skeleton className="mb-5 h-7 w-56 max-w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
            <div className="template-detail-metadata">
              <InstallPlaceholder />
              <div className="space-y-3 border-b border-line pb-5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
              <div className="grid grid-cols-2 gap-8">
                <Skeleton className="h-8 w-24 max-w-full" />
                <Skeleton className="h-8 w-24 max-w-full" />
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
