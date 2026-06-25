import type { ApiV1PackageVersionListResponse } from "clawhub-schema";
import { useMutation } from "convex/react";
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

export const PLUGIN_VERSIONS_PAGE_SIZE = 20;

type PluginVersionsPanelProps = {
  packageName: string;
  versions: ApiV1PackageVersionListResponse | null | undefined;
  latestVersion: string | null;
  canDeleteVersions: boolean;
  onVersionDeleted?: () => void | Promise<void>;
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

export function PluginVersionsPanel({
  packageName,
  versions,
  latestVersion,
  canDeleteVersions,
  onVersionDeleted,
  panelId,
  labelledBy,
  hidden = false,
}: PluginVersionsPanelProps) {
  const isUnavailable = versions == null;
  const deleteOwnedRelease = useMutation(api.packages.deleteOwnedRelease);
  const [releases, setReleases] = useState(versions?.items ?? []);
  const [nextCursor, setNextCursor] = useState(versions?.nextCursor ?? null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [deletingVersion, setDeletingVersion] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(() => new Set());
  const loadMoreInFlightRef = useRef(false);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    requestGenerationRef.current += 1;
    loadMoreInFlightRef.current = false;
    setReleases(versions?.items ?? []);
    setNextCursor(versions?.nextCursor ?? null);
    setIsLoadingMore(false);
    setLoadMoreError(null);
    setDeletingVersion(null);
    setIsDeleting(false);
    setExpandedVersions(new Set());
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

  const handleDelete = async () => {
    if (!deletingVersion) return;
    const requestGeneration = requestGenerationRef.current;
    const version = deletingVersion;
    setIsDeleting(true);
    try {
      await deleteOwnedRelease({ name: packageName, version });
      if (requestGeneration !== requestGenerationRef.current) return;
      setReleases((current) => current.filter((release) => release.version !== version));
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
        {isUnavailable ? (
          <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
            <p className="empty-state-title">Release history is temporarily unavailable.</p>
            <p className="empty-state-body">Try again later.</p>
          </div>
        ) : releases.length > 0 || nextCursor ? (
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
              {releases.map((release) => {
                const hasLatestTag = release.distTags?.includes("latest");
                const isLatest = release.version === latestVersion || hasLatestTag;
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
                        {canDeleteVersions && !isLatest ? (
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
                      </>
                    }
                    onToggle={() => toggleVersion(release.version)}
                    changelog={isExpanded ? <VersionChangelog text={release.changelog} /> : null}
                  />
                );
              })}
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
      <VersionDeleteDialog
        version={deletingVersion}
        isDeleting={isDeleting}
        onCancel={() => setDeletingVersion(null)}
        onConfirm={() => {
          void handleDelete();
        }}
      />
    </>
  );
}
