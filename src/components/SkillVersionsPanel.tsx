import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import type { Id } from "../../convex/_generated/dataModel";
import { getUserFacingConvexError } from "../lib/convexError";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { type LlmAnalysis, SecurityScanResults } from "./SkillSecurityScanResults";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { VersionChangelog } from "./VersionChangelog";
import { VersionDeleteDialog } from "./VersionDeleteDialog";

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
  suppressScanResults,
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
          <div className="skill-versions-header-copy">
            <p>
              {nixPlugin
                ? "Review release history and changelog."
                : "Download older releases or scan the changelog."}
            </p>
          </div>
          {suppressedMessage ? (
            <p className="skill-versions-suppressed-message">{suppressedMessage}</p>
          ) : null}
        </div>
        <div className="skill-versions-scroll">
          <div className="skill-versions-list">
            {visibleVersions.map((version) => {
              const isLatest =
                version._id === latestVersionId || version._id === latestTaggedVersionId;
              const isAvailable =
                version.softDeletedAt === undefined && version.ownerDeletedAt === undefined;
              const isExpanded = expandedVersionIds.has(version._id);
              return (
                <article key={version._id} className="skill-version-release">
                  <div className="skill-version-release-summary">
                    <button
                      className="skill-version-release-toggle"
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => toggleVersion(version._id)}
                    >
                      <span className="skill-version-release-version">v{version.version}</span>
                      <span className="skill-version-release-meta">
                        <span>{new Date(version.createdAt).toLocaleDateString()}</span>
                        {version.changelogSource === "auto" ? (
                          <span className="skill-version-release-source">auto</span>
                        ) : null}
                      </span>
                      <span className="skill-version-release-toggle-label">
                        <span className="skill-version-release-chevron" aria-hidden="true" />
                        {isExpanded ? "Hide changelog" : "Show changelog"}
                      </span>
                    </button>
                    {!suppressScanResults && (version.sha256hash || version.llmAnalysis) ? (
                      <div className="skill-version-release-scan" aria-label="Security checks">
                        <SecurityScanResults
                          sha256hash={version.sha256hash}
                          vtAnalysis={version.vtAnalysis}
                          llmAnalysis={version.llmAnalysis as LlmAnalysis | undefined}
                          variant="badge"
                        />
                      </div>
                    ) : null}
                    <div className="skill-version-release-actions">
                      {isLatest ? <Badge variant="compact">Latest</Badge> : null}
                      {!nixPlugin && isAvailable ? (
                        <a
                          href={buildVersionDownloadHref(
                            convexSiteUrl,
                            skillSlug,
                            ownerHandle,
                            version.version,
                          )}
                          className="skill-version-release-download"
                        >
                          Zip
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
                    </div>
                  </div>
                  {isExpanded ? (
                    <div className="skill-version-release-changelog">
                      <VersionChangelog text={version.changelog} />
                    </div>
                  ) : null}
                </article>
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
