import { useMutation } from "convex/react";
import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { Id } from "../../convex/_generated/dataModel";
import { getUserFacingConvexError } from "../lib/convexError";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { VersionChangelog } from "./VersionChangelog";
import { VersionDeleteDialog } from "./VersionDeleteDialog";
import { VersionReleaseRow } from "./VersionReleaseRow";

type SkillVersionsPanelProps = {
  versions: Doc<"skillVersions">[] | undefined;
  latestVersionId: Id<"skillVersions"> | null;
  latestTaggedVersionId?: Id<"skillVersions"> | null;
  canDeleteVersions: boolean;
  nixPlugin: boolean;
  skillSlug: string;
  ownerHandle?: string | null;
  suppressScanResults: boolean;
  suppressedMessage: string | null;
};

function buildVersionDownloadHref(
  convexSiteUrl: string,
  skillSlug: string,
  ownerHandle: string | null | undefined,
  version: string,
) {
  const params = new URLSearchParams({ slug: skillSlug });
  const normalizedOwner = ownerHandle?.trim().replace(/^@+/, "");
  if (normalizedOwner) params.set("ownerHandle", normalizedOwner);
  params.set("version", version);
  return `${convexSiteUrl}/api/v1/download?${params.toString()}`;
}

export function SkillVersionsPanel({
  versions,
  latestVersionId,
  latestTaggedVersionId = null,
  canDeleteVersions,
  nixPlugin,
  skillSlug,
  ownerHandle,
  suppressedMessage,
}: SkillVersionsPanelProps) {
  const convexSiteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? "https://clawhub.ai";
  const deleteOwnedVersion = useMutation(api.skills.deleteOwnedVersion);
  const [deletingVersion, setDeletingVersion] = useState<Doc<"skillVersions"> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [removedVersionIds, setRemovedVersionIds] = useState<Set<Id<"skillVersions">>>(
    () => new Set(),
  );
  const [expandedVersionIds, setExpandedVersionIds] = useState<Set<string>>(() => new Set());
  const deleteContextIdRef = useRef(0);
  const visibleVersions = (versions ?? []).filter((version) => !removedVersionIds.has(version._id));

  useEffect(() => {
    deleteContextIdRef.current += 1;
    setDeletingVersion(null);
    setIsDeleting(false);
    setRemovedVersionIds(new Set());
    setExpandedVersionIds(new Set());
  }, [skillSlug]);

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

  const handleDelete = async () => {
    if (!deletingVersion) return;
    const deleteContextId = deleteContextIdRef.current;
    const version = deletingVersion;
    setIsDeleting(true);
    try {
      await deleteOwnedVersion({ versionId: version._id });
      if (deleteContextIdRef.current !== deleteContextId) return;
      setRemovedVersionIds((current) => new Set(current).add(version._id));
      toast.success(`Deleted version ${version.version}.`);
      setDeletingVersion(null);
    } catch (error) {
      if (deleteContextIdRef.current !== deleteContextId) return;
      toast.error(getUserFacingConvexError(error, "Version could not be deleted. Try again."));
    } finally {
      if (deleteContextIdRef.current === deleteContextId) setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="tab-body skill-versions-panel">
        <div className="skill-versions-header">
          <h2>Versions</h2>
          {suppressedMessage ? (
            <p className="skill-versions-suppressed-message">{suppressedMessage}</p>
          ) : null}
        </div>
        <div className="skill-versions-scroll">
          <div className="skill-versions-list skill-versions-list-without-checks">
            <div className="skill-versions-column-header" aria-hidden="true">
              <span>Version</span>
              <span>Release</span>
              <span className="skill-versions-column-header-download">Download</span>
              <span />
            </div>
            {visibleVersions.map((version) => {
              const isLatest =
                version._id === latestVersionId || version._id === latestTaggedVersionId;
              const isAvailable =
                version.softDeletedAt === undefined && version.ownerDeletedAt === undefined;
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
                          href={buildVersionDownloadHref(
                            convexSiteUrl,
                            skillSlug,
                            ownerHandle,
                            version.version,
                          )}
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
                          onClick={() => setDeletingVersion(version)}
                        >
                          Delete
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
        </div>
      </div>
      <VersionDeleteDialog
        version={deletingVersion?.version ?? null}
        isDeleting={isDeleting}
        onCancel={() => setDeletingVersion(null)}
        onConfirm={() => {
          void handleDelete();
        }}
      />
    </>
  );
}
