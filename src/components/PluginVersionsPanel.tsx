import type { ApiV1PackageVersionListResponse } from "clawhub-schema";
import { useEffect, useRef, useState } from "react";
import { fetchPackageVersions } from "../lib/packageApi";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export const PLUGIN_VERSIONS_PAGE_SIZE = 20;

type PluginVersionsPanelProps = {
  packageName: string;
  versions: ApiV1PackageVersionListResponse | null | undefined;
};

export function PluginVersionsPanel({ packageName, versions }: PluginVersionsPanelProps) {
  const isUnavailable = versions == null;
  const [releases, setReleases] = useState(versions?.items ?? []);
  const [nextCursor, setNextCursor] = useState(versions?.nextCursor ?? null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    requestGenerationRef.current += 1;
    loadMoreInFlightRef.current = false;
    setReleases(versions?.items ?? []);
    setNextCursor(versions?.nextCursor ?? null);
    setIsLoadingMore(false);
    setLoadMoreError(null);
  }, [packageName, versions]);

  const loadMore = async () => {
    if (!nextCursor || loadMoreInFlightRef.current) return;
    const cursor = nextCursor;
    const requestGeneration = requestGenerationRef.current;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchPackageVersions(packageName, {
        cursor,
        limit: PLUGIN_VERSIONS_PAGE_SIZE,
      });
      if (requestGeneration !== requestGenerationRef.current) return;
      setReleases((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      if (requestGeneration !== requestGenerationRef.current) return;
      setLoadMoreError("Could not load more releases. Try again.");
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        setIsLoadingMore(false);
        loadMoreInFlightRef.current = false;
      }
    }
  };

  return (
    <div className="grid max-w-full gap-5 overflow-x-auto">
      <div>
        <h2 className="m-0 font-display text-[1.2rem] font-bold text-[color:var(--ink)]">
          Versions
        </h2>
        <p className="m-0 text-sm text-[color:var(--ink-soft)]">
          Review active release history and changelog.
        </p>
      </div>
      {isUnavailable ? (
        <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
          <p className="empty-state-title">Release history is temporarily unavailable.</p>
          <p className="empty-state-body">Try again later.</p>
        </div>
      ) : releases.length > 0 || nextCursor ? (
        <div className="max-h-[600px] overflow-y-auto">
          <div className="flex flex-col gap-3">
            {releases.map((release) => (
              <div
                key={release.version}
                className="flex items-start justify-between gap-4 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div>
                    v{release.version} · {new Date(release.createdAt).toLocaleDateString()}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[color:var(--ink-soft)]">
                    {release.changelog}
                  </div>
                  {release.distTags && release.distTags.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {release.distTags.map((tag) => (
                        <Badge key={tag} variant="compact">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          {loadMoreError ? (
            <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400" role="alert">
              {loadMoreError}
            </p>
          ) : null}
          {nextCursor ? (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={isLoadingMore}
                onClick={() => void loadMore()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
          <p className="empty-state-title">No active releases are available.</p>
        </div>
      )}
    </div>
  );
}
