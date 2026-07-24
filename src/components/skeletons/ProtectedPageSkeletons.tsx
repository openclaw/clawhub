import { Container } from "../layout/Container";
import { Card, CardContent } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

export function StarsSkeleton() {
  return (
    <main className="browse-page" aria-busy="true" aria-label="Loading bookmarked skills">
      <header className="stars-header">
        <Skeleton className="h-9 w-48" />
      </header>
      <div className="skeleton-list">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="skeleton-row">
            <Skeleton className="skeleton-icon" />
            <div className="skeleton-row-body">
              <Skeleton className="skeleton-bar skeleton-bar-lg" />
              <Skeleton className="skeleton-bar skeleton-bar-sm" />
              <Skeleton className="skeleton-bar skeleton-bar-xs" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

export function SettingsSkeleton() {
  return (
    <main
      className="border-b border-[color:var(--line)] bg-[color:var(--bg)]"
      aria-busy="true"
      aria-label="Loading settings"
    >
      <div className="mx-auto flex w-full flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-6 [max-width:var(--page-max)]">
        <header>
          <Skeleton className="h-9 w-40" />
          <Skeleton className="mt-3 h-5 w-[min(560px,90%)]" />
        </header>
        <Skeleton className="h-px w-full" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="lg:w-[272px] lg:shrink-0">
            <div className="flex gap-2 overflow-hidden lg:flex-col lg:gap-2">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-32 lg:w-full" />
              ))}
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="settings-card flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Skeleton className="h-10 w-10" />
                  <div className="grid min-w-0 gap-2">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-4 w-72 max-w-full" />
                  </div>
                </div>
                <Skeleton className="hidden h-14 w-14 rounded-full sm:block" />
              </div>
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-28 w-full" />
              <div className="flex justify-end">
                <Skeleton className="h-10 w-32 rounded-[var(--r-btn)]" />
              </div>
            </div>
            <div className="settings-card flex flex-col gap-4">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export function ImportGitHubSkeleton() {
  return (
    <main className="py-10" aria-busy="true" aria-label="Loading GitHub import">
      <Container>
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-5 w-[min(420px,80vw)]" />
          </div>
          <Skeleton className="h-16 w-36" />
        </header>
        <div className="grid gap-5">
          <Card>
            <CardContent>
              <div className="grid gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-10 w-28 rounded-[var(--r-btn)]" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="grid gap-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-32 w-full" />
              </div>
            </CardContent>
          </Card>
        </div>
      </Container>
    </main>
  );
}

export function ManagementSkeleton() {
  return (
    <main className="section" aria-busy="true" aria-label="Loading management console">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-[min(520px,90%)]" />
      {Array.from({ length: 3 }, (_section, index) => (
        <Card key={index}>
          <div className="grid gap-4">
            <div className="management-controls">
              <Skeleton className="h-10 w-64" />
              <Skeleton className="h-5 w-28" />
            </div>
            <div className="management-list">
              {Array.from({ length: 3 }, (_item, row) => (
                <div key={row} className="management-item">
                  <div className="management-item-main">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-72 max-w-full" />
                  </div>
                  <div className="management-actions">
                    <Skeleton className="h-9 w-24 rounded-[var(--r-btn)]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </main>
  );
}

export function AuthFlowSkeleton({ title }: { title: string }) {
  return (
    <main className="py-10" aria-busy="true" aria-label={`Loading ${title}`}>
      <Container size="narrow">
        <Card>
          <CardContent>
            <div className="grid gap-4">
              <Skeleton className="h-8 w-44" />
              <Skeleton className="h-5 w-[min(360px,80%)]" />
              <Skeleton className="h-10 w-36 rounded-[var(--r-btn)]" />
            </div>
          </CardContent>
        </Card>
      </Container>
    </main>
  );
}
