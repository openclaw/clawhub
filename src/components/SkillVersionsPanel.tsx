import { useMutation } from "convex/react";
import { Download } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
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

  const toggleVersionFromKeyboard = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    versionId: string,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleVersion(versionId);
  };

  const stopVersionActionPropagation = (event: ReactMouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const stopVersionKeyPropagation = (event: ReactKeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
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
            <div className="skill-versions-column-header" aria-hidden="true">
              <span>Version</span>
              <span>Checks</span>
              <span>Release</span>
              <span>Package</span>
              <span />
            </div>
            {visibleVersions.map((version) => {
              const isLatest =
                version._id === latestVersionId || version._id === latestTaggedVersionId;
              const isAvailable =
                version.softDeletedAt === undefined && version.ownerDeletedAt === undefined;
              const isExpanded = expandedVersionIds.has(version._id);
              const isAutoChangelog = version.changelogSource === "auto";
              return (
                <article
                  key={version._id}
                  className={`skill-version-release${isLatest ? " is-latest" : ""}`}
                  data-expanded={isExpanded ? "true" : "false"}
                >
                  <div
                    className="skill-version-release-summary"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={() => toggleVersion(version._id)}
                    onKeyDown={(event) => toggleVersionFromKeyboard(event, version._id)}
                  >
                    <div className="skill-version-release-toggle">
                      <span className="skill-version-release-version">v{version.version}</span>
                      <span className="skill-version-release-meta">
                        <span>{new Date(version.createdAt).toLocaleDateString()}</span>
                      </span>
                    </div>
                    {!suppressScanResults && (version.sha256hash || version.llmAnalysis) ? (
                      <div
                        className="skill-version-release-scan"
                        aria-label="Security checks"
                        onClick={stopVersionActionPropagation}
                        onKeyDown={stopVersionKeyPropagation}
                      >
                        <SecurityScanResults
                          sha256hash={version.sha256hash}
                          vtAnalysis={version.vtAnalysis}
                          llmAnalysis={version.llmAnalysis as LlmAnalysis | undefined}
                          variant="badge"
                        />
                      </div>
                    ) : null}
                    <div className="skill-version-release-tags">
                      {isLatest ? <Badge variant="compact">Latest</Badge> : null}
                      {isAutoChangelog ? (
                        <span className="version-channel-badge">auto</span>
                      ) : null}
                    </div>
                    <div
                      className="skill-version-release-actions"
                      onClick={stopVersionActionPropagation}
                      onKeyDown={stopVersionKeyPropagation}
                    >
                      {!nixPlugin && isAvailable ? (
                        <a
                          href={buildVersionDownloadHref(
                            convexSiteUrl,
                            skillSlug,
                            ownerHandle,
                            version.version,
                          )}
                          className="skill-version-release-download"
                          aria-label={`Download .zip for v${version.version}`}
                        >
                          <Download
                            className="skill-version-release-download-icon"
                            size={14}
                            aria-hidden="true"
                          />
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
                    <span className="skill-version-release-chevron" aria-hidden="true" />
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
