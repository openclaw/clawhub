import { Skeleton } from "../ui/skeleton";
import "../catalog-detail-layout.css";
import "../template-catalog-detail.css";

/** Match the loaded detail grid without turning any placeholder into a link or action. */
export function TemplateDetailSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading Template details…
      </span>
      <main aria-busy="true" className="catalog-detail-page">
        <div
          aria-hidden="true"
          className="catalog-detail template-catalog-detail template-catalog-skeleton"
        >
          <div className="catalog-detail__breadcrumb">
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="catalog-detail__hero">
            <Skeleton className="catalog-detail__icon" />
            <div className="catalog-detail__heading space-y-2">
              <Skeleton className="h-7 w-72 max-w-full" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-9 w-16" />
          </div>
          <div className="catalog-detail__content">
            <div className="catalog-detail__main">
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/5" />
              </div>
              <div className="template-catalog-panel">
                <div>
                  <Skeleton className="mb-3 h-4 w-36" />
                  <Skeleton className="h-40 w-full rounded-2xl" />
                </div>
                <div>
                  <Skeleton className="mb-3 h-4 w-16" />
                  <Skeleton className="h-16 w-full rounded-2xl" />
                </div>
              </div>
            </div>
            <div className="catalog-detail__sidebar">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="catalog-detail__fact">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
