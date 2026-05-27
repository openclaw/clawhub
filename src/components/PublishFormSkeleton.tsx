import { Container } from "./layout/Container";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

export function PublishFormSkeleton() {
  return (
    <main className="py-10" aria-busy="true" aria-label="Loading publish form">
      <Container size="narrow">
        <div className="mb-6 flex flex-col gap-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-[min(520px,80%)]" />
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent>
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[var(--radius-md)] border-2 border-dashed border-[color:var(--line)] bg-[color:var(--surface-muted)]">
                <Skeleton className="h-6 w-44" />
                <Skeleton className="h-4 w-72 max-w-[70%]" />
                <Skeleton className="h-10 w-32" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-11 w-full" />
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Skeleton className="h-13 w-40 rounded-[var(--r-btn)]" />
          </div>
        </div>
      </Container>
    </main>
  );
}
