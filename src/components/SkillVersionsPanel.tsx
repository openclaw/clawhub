import { useMutation, usePaginatedQuery } from "convex/react";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { Id } from "../../convex/_generated/dataModel";
import { emitAnalytics } from "../lib/analyticsEvents";
import { useVersionWithdrawal } from "../lib/useVersionWithdrawal";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { VersionChangelog } from "./VersionChangelog";
import { VersionDeleteDialog } from "./VersionDeleteDialog";
import { VersionReleaseRow } from "./VersionReleaseRow";
import { VersionRestoreDialog } from "./VersionRestoreDialog";

type SkillVersionsPanelProps = {
  skillId: Id<"skills">;
  versions: Doc<"skillVersions">[] | undefined;
  latestVersionId: Id<"skillVersions"> | null;
  latestTaggedVersionId?: Id<"skillVersions"> | null;
  canDeleteVersions: boolean;
  nixPlugin: boolean;
  skillSlug: string;
  ownerHandle?: string | null;
};

function mergeSkillVersions(...groups: Doc<"skillVersions">[][]) {
  return [
    ...new Map(
      groups
        .flat()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((version) => [version._id, version]),
    ).values(),
  ];
}

function buildVersionDownloadHref(
  skillSlug: string,
  ownerHandle: string | null | undefined,
  version: string,
) {
  const params = new URLSearchParams({ slug: skillSlug });
  const normalizedOwner = ownerHandle?.trim().replace(/^@+/, "");
  if (normalizedOwner) params.set("ownerHandle", normalizedOwner);
  params.set("version", version);
  return `/api/v1/download?${params.toString()}`;
}

export function SkillVersionsPanel({
  skillId,
  versions,
  latestVersionId,
  latestTaggedVersionId = null,
  canDeleteVersions,
  nixPlugin,
  skillSlug,
  ownerHandle,
}: SkillVersionsPanelProps) {
  const deleteOwnedVersion = useMutation(api.skills.deleteOwnedVersion);
  const restoreOwnedVersion = useMutation(api.skills.restoreOwnedVersion);
  const {
    results: managerVersionResults,
    status: managerVersionsStatus,
    loadMore: loadMoreManagerVersions,
  } = usePaginatedQuery(
    api.skills.listWithdrawnVersionsForManager,
    canDeleteVersions ? { skillId } : "skip",
    { initialNumItems: 20 },
  );
  const withdrawal = useVersionWithdrawal({
    deleteVersion: (versionId: Id<"skillVersions">) => deleteOwnedVersion({ versionId }),
    restoreVersion: (versionId: Id<"skillVersions">) => restoreOwnedVersion({ versionId }),
  });
  const { reset: resetWithdrawal } = withdrawal;
  const [expandedVersionIds, setExpandedVersionIds] = useState<Set<string>>(() => new Set());
  const visibleVersions = mergeSkillVersions(
    versions ?? [],
    managerVersionResults as Doc<"skillVersions">[],
  );

  useEffect(() => {
    resetWithdrawal();
    setExpandedVersionIds(new Set());
  }, [skillId, resetWithdrawal]);

  const toggleVersion = (versionId: string) => {
    setExpandedVersionIds((current) => {
      const next = new Set(current);
      if (next.has(versionId)) {
        next.delete(versionId);
      } else {
        next.add(versionId);
      }
      return next;
    });
  };

  return (
    <>
      <div className="tab-body skill-versions-panel">
        <div className="skill-versions-header">
          <h2>Versions</h2>
        </div>
        <div className="skill-versions-scroll">
          <div className="skill-versions-list skill-versions-list-skills">
            <div
              className="skill-versions-column-header skill-versions-column-header-skills"
              aria-hidden="true"
            >
              <span className="skill-versions-col-version">Version</span>
              <span className="skill-versions-col-release">Release</span>
              <span className="skill-versions-col-download">Download</span>
              <span className="skill-versions-col-expand" />
            </div>
            {visibleVersions.map((version) => {
              const isLatest =
                version._id === latestVersionId || version._id === latestTaggedVersionId;
              const isWithdrawn =
                withdrawal.overrides.get(version._id) ??
                (version.softDeletedAt !== undefined && version.ownerDeletedAt !== undefined);
              const isAvailable =
                !isWithdrawn &&
                version.softDeletedAt === undefined &&
                version.ownerDeletedAt === undefined;
              const isExpanded = expandedVersionIds.has(version._id);
              const isAutoChangelog = version.changelogSource === "auto";
              const changelogId = `version-changelog-${version._id}`;
              return (
                <VersionReleaseRow
                  key={version._id}
                  versionLabel={`v${version.version}`}
                  dateLabel={new Date(version.createdAt).toLocaleDateString()}
                  isLatest={isLatest}
                  isExpanded={isExpanded}
                  changelogId={changelogId}
                  release={
                    <>
                      {isLatest ? (
                        <Badge variant="compact" className="version-release-channel-badge">
                          Latest
                        </Badge>
                      ) : null}
                      {isAutoChangelog ? (
                        <Badge variant="compact" className="version-release-channel-badge">
                          auto
                        </Badge>
                      ) : null}
                    </>
                  }
                  actions={
                    <>
                      {!nixPlugin && isAvailable ? (
                        <a
                          href={buildVersionDownloadHref(skillSlug, ownerHandle, version.version)}
                          onClick={() =>
                            emitAnalytics("select_content", {
                              content_type: "install",
                              ui_location: "detail",
                              method: "download",
                              artifact_version: /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(
                                version.version,
                              )
                                ? version.version
                                : undefined,
                            })
                          }
                          download={`${skillSlug}-${version.version}.zip`}
                          className="skill-version-release-download skill-version-release-download-labeled"
                          aria-label={`Download version v${version.version}`}
                        >
                          <Download
                            className="skill-version-release-download-icon"
                            size={14}
                            aria-hidden="true"
                          />
                          <span>Download version</span>
                        </a>
                      ) : null}
                      {canDeleteVersions && isAvailable && !isLatest ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          aria-label={`Delete version ${version.version}`}
                          onClick={() => withdrawal.requestDelete(version._id, version.version)}
                        >
                          Delete
                        </Button>
                      ) : null}
                      {canDeleteVersions && isWithdrawn ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Restore version ${version.version}`}
                          onClick={() => withdrawal.requestRestore(version._id, version.version)}
                        >
                          Restore
                        </Button>
                      ) : null}
                    </>
                  }
                  onToggle={() => toggleVersion(version._id)}
                  changelog={isExpanded ? <VersionChangelog text={version.changelog} /> : null}
                />
              );
            })}
          </div>
          {canDeleteVersions &&
          (managerVersionsStatus === "CanLoadMore" || managerVersionsStatus === "LoadingMore") ? (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={managerVersionsStatus === "LoadingMore"}
                onClick={() => loadMoreManagerVersions(20)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <VersionDeleteDialog {...withdrawal.deleteDialog} />
      <VersionRestoreDialog {...withdrawal.restoreDialog} />
    </>
  );
}
