import type { ApiV1PackageVersionListResponse } from "clawhub-schema";
import { useMutation, usePaginatedQuery } from "convex/react";
import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { getUserFacingConvexError } from "../lib/convexError";
import { fetchPackageVersions } from "../lib/packageApi";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { VersionChangelog } from "./VersionChangelog";
import { VersionDeleteDialog } from "./VersionDeleteDialog";
import { VersionReleaseRow } from "./VersionReleaseRow";
import { VersionRestoreDialog } from "./VersionRestoreDialog";

export const PLUGIN_VERSIONS_PAGE_SIZE = 20;

type PluginVersionItem = ApiV1PackageVersionListResponse["items"][number] & {
  softDeletedAt?: number;
  ownerDeletedAt?: number;
};

type PluginVersionsPanelProps = {
  packageName: string;
  versions: ApiV1PackageVersionListResponse | null | undefined;
  latestVersion: string | null;
  canDeleteVersions: boolean;
  onVersionDeleted?: () => void | Promise<void>;
  onRetry?: () => void;
  panelId?: string;
  labelledBy?: string;
  hidden?: boolean;
};

function buildPluginDownloadHref(packageName: string, version: string) {
  const convexSiteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? "https://clawhub.ai";
  const packagePath = encodeURIComponent(packageName);
  const params = new URLSearchParams({ version });
  return `${convexSiteUrl}/api/v1/packages/${packagePath}/download?${params.toString()}`;
}

function mergePluginVersions(...groups: PluginVersionItem[][]) {
  return [
    ...new Map(
      groups
        .flat()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((release) => [release.version, release]),
    ).values(),
  ];
}

export function PluginVersionsPanel({
  packageName,
  versions,
  latestVersion,
  canDeleteVersions,
  onVersionDeleted,
  onRetry,
  panelId,
  labelledBy,
  hidden = false,
}: PluginVersionsPanelProps) {
  const isLoading = versions === undefined;
  const isUnavailable = versions === null;
  const deleteOwnedRelease = useMutation(api.packages.deleteOwnedRelease);
  const restoreOwnedRelease = useMutation(api.packages.restoreOwnedRelease);
  const {
    results: managerVersionResults,
    status: managerVersionsStatus,
    loadMore: loadMoreManagerVersions,
  } = usePaginatedQuery(
    api.packages.listVersionsForManager,
    canDeleteVersions ? { name: packageName } : "skip",
    { initialNumItems: PLUGIN_VERSIONS_PAGE_SIZE },
  );
  const managerVersions = managerVersionResults as PluginVersionItem[];
  const [releases, setReleases] = useState<PluginVersionItem[]>(versions?.items ?? []);
  const [nextCursor, setNextCursor] = useState(versions?.nextCursor ?? null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [deletingVersion, setDeletingVersion] = useState<string | null>(null);
  const [restoringVersion, setRestoringVersion] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [withdrawnVersions, setWithdrawnVersions] = useState<Set<string>>(() => new Set());
  const [restoredVersions, setRestoredVersions] = useState<Set<string>>(() => new Set());
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(() => new Set());
  const loadMoreInFlightRef = useRef(false);
  const loadMoreAbortControllerRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const visibleReleases = mergePluginVersions(releases, managerVersions);

  useEffect(() => {
    loadMoreAbortControllerRef.current?.abort();
    requestGenerationRef.current += 1;
    loadMoreInFlightRef.current = false;
    setReleases(versions?.items ?? []);
    setNextCursor(versions?.nextCursor ?? null);
    setIsLoadingMore(false);
    setLoadMoreError(null);
    setDeletingVersion(null);
    setRestoringVersion(null);
    setIsDeleting(false);
    setIsRestoring(false);
    setWithdrawnVersions(new Set());
    setRestoredVersions(new Set());
    setExpandedVersions(new Set());
    return () => loadMoreAbortControllerRef.current?.abort();
  }, [packageName, versions]);

  const toggleVersion = (version: string) => {
    setExpandedVersions((current) => {
      const next = new Set(current);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  };

  const loadMore = async () => {
    const canLoadMoreManagerVersions = managerVersionsStatus === "CanLoadMore";
    if ((!nextCursor && !canLoadMoreManagerVersions) || loadMoreInFlightRef.current) return;
    if (canLoadMoreManagerVersions) loadMoreManagerVersions(PLUGIN_VERSIONS_PAGE_SIZE);
    if (!nextCursor) return;
    const cursor = nextCursor;
    const requestGeneration = requestGenerationRef.current;
    const controller = new AbortController();
    loadMoreAbortControllerRef.current = controller;
    loadMoreInFlightRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchPackageVersions(packageName, {
        cursor,
        limit: PLUGIN_VERSIONS_PAGE_SIZE,
        signal: controller.signal,
      });
      if (requestGeneration !== requestGenerationRef.current) return;
      setReleases((current) => mergePluginVersions(current, page.items));
      setNextCursor(page.nextCursor);
    } catch {
      if (requestGeneration !== requestGenerationRef.current || controller.signal.aborted) return;
      setLoadMoreError("Could not load more releases. Try again.");
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        setIsLoadingMore(false);
        loadMoreInFlightRef.current = false;
        if (loadMoreAbortControllerRef.current === controller) {
          loadMoreAbortControllerRef.current = null;
        }
      }
    }
  };

  const handleDelete = async () => {
    if (!deletingVersion) return;
    const requestGeneration = requestGenerationRef.current;
    const version = deletingVersion;
    setIsDeleting(true);
    try {
      await deleteOwnedRelease({ name: packageName, version });
      if (requestGeneration !== requestGenerationRef.current) return;
      setWithdrawnVersions((current) => new Set(current).add(version));
      setRestoredVersions((current) => {
        const next = new Set(current);
        next.delete(version);
        return next;
      });
      toast.success(`Deleted version ${version}.`);
      setDeletingVersion(null);
      void (async () => {
        try {
          await onVersionDeleted?.();
        } catch {
          // The deleted row is already removed locally; a later route refresh can retry metadata.
        }
      })();
    } catch (error) {
      if (requestGeneration !== requestGenerationRef.current) return;
      toast.error(getUserFacingConvexError(error, "Version could not be deleted. Try again."));
    } finally {
      if (requestGeneration === requestGenerationRef.current) setIsDeleting(false);
    }
  };

  const handleRestore = async () => {
    if (!restoringVersion) return;
    const requestGeneration = requestGenerationRef.current;
    const version = restoringVersion;
    const restoredRelease = visibleReleases.find((release) => release.version === version);
    setIsRestoring(true);
    try {
      await restoreOwnedRelease({ name: packageName, version });
      if (requestGeneration !== requestGenerationRef.current) return;
      setWithdrawnVersions((current) => {
        const next = new Set(current);
        next.delete(version);
        return next;
      });
      setRestoredVersions((current) => new Set(current).add(version));
      if (restoredRelease) {
        setReleases((current) => mergePluginVersions(current, [restoredRelease]));
      }
      toast.success(`Restored version ${version}.`);
      setRestoringVersion(null);
      void (async () => {
        try {
          await onVersionDeleted?.();
        } catch {
          // Local state already reflects the restore; a later route refresh can retry metadata.
        }
      })();
    } catch (error) {
      if (requestGeneration !== requestGenerationRef.current) return;
      toast.error(getUserFacingConvexError(error, "Version could not be restored. Try again."));
    } finally {
      if (requestGeneration === requestGenerationRef.current) setIsRestoring(false);
    }
  };

  return (
    <>
      <div
        className="tab-body skill-versions-panel"
        role={panelId ? "tabpanel" : undefined}
        id={panelId}
        aria-labelledby={labelledBy}
        hidden={hidden}
      >
        <div className="skill-versions-header">
          <h2>Versions</h2>
        </div>
        {isLoading ? (
          <div className="stat p-4" role="status">
            Loading release history...
          </div>
        ) : isUnavailable ? (
          <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
            <p className="empty-state-title">Release history is temporarily unavailable.</p>
            {onRetry ? (
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : (
              <p className="empty-state-body">Try again later.</p>
            )}
          </div>
        ) : visibleReleases.length > 0 ||
          nextCursor ||
          managerVersionsStatus === "CanLoadMore" ||
          managerVersionsStatus === "LoadingMore" ? (
          <div className="skill-versions-scroll">
            <div className="skill-versions-list skill-versions-list-plugins">
              <div
                className="skill-versions-column-header skill-versions-column-header-plugins"
                aria-hidden="true"
              >
                <span className="skill-versions-col-version">Version</span>
                <span className="skill-versions-col-tags">Tags</span>
                <span className="skill-versions-col-release">Release</span>
                <span className="skill-versions-col-download">
                  <Download size={13} aria-hidden="true" />
                  <span className="sr-only">Download</span>
                </span>
                <span className="skill-versions-col-expand" />
              </div>
              {visibleReleases.map((release) => {
                const hasLatestTag = release.distTags?.includes("latest");
                const isLatest = release.version === latestVersion || hasLatestTag;
                const isWithdrawn =
                  !restoredVersions.has(release.version) &&
                  (withdrawnVersions.has(release.version) ||
                    (release.softDeletedAt !== undefined && release.ownerDeletedAt !== undefined));
                const isExpanded = expandedVersions.has(release.version);
                const changelogId = `version-changelog-${release.version}`;
                return (
                  <VersionReleaseRow
                    key={release.version}
                    versionLabel={`v${release.version}`}
                    dateLabel={new Date(release.createdAt).toLocaleDateString()}
                    isLatest={isLatest}
                    isExpanded={isExpanded}
                    changelogId={changelogId}
                    checksLabel="Tags"
                    checks={
                      <>
                        {release.distTags && release.distTags.length > 0
                          ? release.distTags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="compact"
                                className="version-release-channel-badge"
                              >
                                {tag}
                              </Badge>
                            ))
                          : null}
                      </>
                    }
                    release={
                      <>
                        {isLatest && !hasLatestTag ? (
                          <Badge variant="compact" className="version-release-channel-badge">
                            Latest
                          </Badge>
                        ) : null}
                      </>
                    }
                    actions={
                      <>
                        {!isWithdrawn ? (
                          <a
                            href={buildPluginDownloadHref(packageName, release.version)}
                            className="skill-version-release-download"
                            aria-label={`Download .zip for v${release.version}`}
                          >
                            <Download
                              className="skill-version-release-download-icon"
                              size={14}
                              aria-hidden="true"
                            />
                          </a>
                        ) : null}
                        {canDeleteVersions && !isWithdrawn && !isLatest ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            aria-label={`Delete version ${release.version}`}
                            onClick={() => setDeletingVersion(release.version)}
                          >
                            Delete
                          </Button>
                        ) : null}
                        {canDeleteVersions && isWithdrawn ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Restore version ${release.version}`}
                            onClick={() => setRestoringVersion(release.version)}
                          >
                            Restore
                          </Button>
                        ) : null}
                      </>
                    }
                    onToggle={() => toggleVersion(release.version)}
                    changelog={isExpanded ? <VersionChangelog text={release.changelog} /> : null}
                  />
                );
              })}
            </div>
            {loadMoreError ? (
              <p className="mt-3 text-sm font-medium text-status-error-fg" role="alert">
                {loadMoreError}
              </p>
            ) : null}
            {nextCursor ||
            managerVersionsStatus === "CanLoadMore" ||
            managerVersionsStatus === "LoadingMore" ? (
              <div className="mt-3 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={isLoadingMore || managerVersionsStatus === "LoadingMore"}
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
      <VersionDeleteDialog
        version={deletingVersion}
        isDeleting={isDeleting}
        onCancel={() => setDeletingVersion(null)}
        onConfirm={() => {
          void handleDelete();
        }}
      />
      <VersionRestoreDialog
        version={restoringVersion}
        isRestoring={isRestoring}
        onCancel={() => setRestoringVersion(null)}
        onConfirm={() => {
          void handleRestore();
        }}
      />
    </>
  );
}
