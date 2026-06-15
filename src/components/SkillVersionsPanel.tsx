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
import { VersionDeleteDialog } from "./VersionDeleteDialog";

type SkillVersionsPanelProps = {
  versions: Doc<"skillVersions">[] | undefined;
  latestVersionId: Id<"skillVersions"> | null;
  latestTaggedVersionId?: Id<"skillVersions"> | null;
  canDeleteVersions: boolean;
  nixPlugin: boolean;
  skillSlug: string;
  suppressScanResults: boolean;
  suppressedMessage: string | null;
};

export function SkillVersionsPanel({
  versions,
  latestVersionId,
  latestTaggedVersionId = null,
  canDeleteVersions,
  nixPlugin,
  skillSlug,
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
  const deleteContextIdRef = useRef(0);
  const visibleVersions = (versions ?? []).filter((version) => !removedVersionIds.has(version._id));

  useEffect(() => {
    deleteContextIdRef.current += 1;
    setDeletingVersion(null);
    setIsDeleting(false);
    setRemovedVersionIds(new Set());
  }, [skillSlug]);

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
      <div className="grid max-w-full gap-5 overflow-x-auto">
        <div>
          <h2 className="m-0 font-display text-[1.2rem] font-bold text-[color:var(--ink)]">
            Versions
          </h2>
          <p className="m-0 text-sm text-[color:var(--ink-soft)]">
            {nixPlugin
              ? "Review release history and changelog."
              : "Download older releases or scan the changelog."}
          </p>
          {suppressedMessage ? (
            <p className="text-sm text-[color:var(--ink-soft)]">{suppressedMessage}</p>
          ) : null}
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          <div className="flex flex-col gap-3">
            {visibleVersions.map((version) => {
              const isLatest =
                version._id === latestVersionId || version._id === latestTaggedVersionId;
              return (
                <div
                  key={version._id}
                  className="flex items-start justify-between gap-4 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div>
                      v{version.version} · {new Date(version.createdAt).toLocaleDateString()}
                      {version.changelogSource === "auto" ? (
                        <span className="text-[color:var(--ink-soft)]"> · auto</span>
                      ) : null}
                    </div>
                    <div className="whitespace-pre-wrap break-words text-[color:var(--ink-soft)]">
                      {version.changelog}
                    </div>
                    <div className="pt-1">
                      {!suppressScanResults && (version.sha256hash || version.llmAnalysis) ? (
                        <SecurityScanResults
                          sha256hash={version.sha256hash}
                          vtAnalysis={version.vtAnalysis}
                          llmAnalysis={version.llmAnalysis as LlmAnalysis | undefined}
                          variant="badge"
                        />
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {isLatest ? <Badge variant="compact">Latest</Badge> : null}
                    {!nixPlugin ? (
                      <a
                        href={`${convexSiteUrl}/api/v1/download?slug=${skillSlug}&version=${version.version}`}
                        className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold text-xs min-h-[34px] rounded-[var(--radius-pill)] px-3 py-1.5 border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] transition-all duration-200 no-underline"
                      >
                        Zip
                      </a>
                    ) : null}
                    {canDeleteVersions && !isLatest ? (
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
