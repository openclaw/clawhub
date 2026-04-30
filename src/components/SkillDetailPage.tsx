import { useNavigate } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { useAction, useMutation, useQuery } from "convex/react";
import type { ComponentProps } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { getUserFacingConvexError } from "../lib/convexError";
import { canManageSkill, isModerator } from "../lib/roles";
import type { SkillBySlugResult, SkillPageInitialData } from "../lib/skillPage";
import { useAuthStatus } from "../lib/useAuthStatus";
import { ClientOnly } from "./ClientOnly";
import { DetailBody, DetailPageShell } from "./DetailPageShell";
import { DetailSecuritySummary } from "./DetailSecuritySummary";
import { SkillDetailSkeleton } from "./skeletons/SkillDetailSkeleton";
import { SkillCommentsPanel } from "./SkillCommentsPanel";
import { SkillDetailTabs, type DetailTab } from "./SkillDetailTabs";
import {
  buildSkillHref,
  formatConfigSnippet,
  formatNixInstallSnippet,
  formatOsList,
  stripFrontmatter,
} from "./skillDetailUtils";
import { SkillHeader } from "./SkillHeader";
import { SkillOwnershipPanel } from "./SkillOwnershipPanel";
import { SkillReportDialog } from "./SkillReportDialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type SkillDetailPageProps = {
  slug: string;
  canonicalOwner?: string;
  redirectToCanonical?: boolean;
  initialData?: SkillPageInitialData | null;
  mode?: "detail" | "settings";
};

type SkillFile = Doc<"skillVersions">["files"][number];

const SHOW_SKILL_COMMENTS = false;

function formatReportError(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === "string" && data.trim()) return data.trim();
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      const message = (data as { message?: string }).message?.trim();
      if (message) return message;
    }
  }

  if (error instanceof Error) {
    const cleaned = error.message
      .replace(/\[CONVEX[^\]]*\]\s*/g, "")
      .replace(/\[Request ID:[^\]]*\]\s*/g, "")
      .replace(/^Server Error Called by client\s*/i, "")
      .replace(/^ConvexError:\s*/i, "")
      .trim();
    if (cleaned && cleaned !== "Server Error") return cleaned;
  }

  return "Unable to submit report. Please try again.";
}

export function SkillDetailPage({
  slug,
  canonicalOwner,
  redirectToCanonical,
  initialData,
  mode = "detail",
}: SkillDetailPageProps) {
  const navigate = useNavigate();
  const { isAuthenticated, me } = useAuthStatus();
  const initialResult = initialData?.result ?? undefined;

  const isStaff = isModerator(me);
  const staffResult = useQuery(api.skills.getBySlugForStaff, isStaff ? { slug } : "skip") as
    | SkillBySlugResult
    | undefined;
  const publicResult = useQuery(api.skills.getBySlug, !isStaff ? { slug } : "skip") as
    | SkillBySlugResult
    | undefined;
  const result = isStaff ? staffResult : publicResult === undefined ? initialResult : publicResult;

  const toggleStar = useMutation(api.stars.toggle);
  const reportSkill = useMutation(api.skills.report);
  const updateTags = useMutation(api.skills.updateTags);
  const deleteTags = useMutation(api.skills.deleteTags);
  const requestRescan = useMutation(api.skills.requestRescan);
  const getReadme = useAction(api.skills.getReadme);
  const myPublishers = useQuery(api.publishers.listMine) as
    | Array<{ publisher: { _id: Id<"publishers"> }; role: string }>
    | undefined;

  const [readme, setReadme] = useState<string | null>(initialData?.readme ?? null);
  const [readmeError, setReadmeError] = useState<string | null>(initialData?.readmeError ?? null);
  const [loadedReadmeVersionId, setLoadedReadmeVersionId] = useState<Id<"skillVersions"> | null>(
    initialResult?.latestVersion?._id ?? null,
  );
  const [tagName, setTagName] = useState("latest");
  const [tagVersionId, setTagVersionId] = useState<Id<"skillVersions"> | "">("");
  const [activeTab, setActiveTab] = useState<DetailTab>("readme");
  const [shouldPrefetchCompare, setShouldPrefetchCompare] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  const isLoadingSkill = isStaff ? staffResult === undefined : result === undefined;
  const skill = result?.skill;
  const owner = result?.owner ?? null;
  const latestVersion = result?.latestVersion ?? null;

  const versions = useQuery(
    api.skills.listVersions,
    skill ? { skillId: skill._id, limit: 50 } : "skip",
  ) as Doc<"skillVersions">[] | undefined;
  const shouldLoadDiffVersions = Boolean(
    skill && (activeTab === "compare" || shouldPrefetchCompare),
  );
  const diffVersions = useQuery(
    api.skills.listVersions,
    shouldLoadDiffVersions && skill ? { skillId: skill._id, limit: 200 } : "skip",
  ) as Doc<"skillVersions">[] | undefined;

  const isStarred = useQuery(
    api.stars.isStarred,
    isAuthenticated && skill ? { skillId: skill._id } : "skip",
  );

  const myPublisherIds = useMemo(
    () =>
      new Set(
        (Array.isArray(myPublishers) ? myPublishers : []).map((entry) => entry.publisher._id),
      ),
    [myPublishers],
  );
  const canManage =
    canManageSkill(me, skill) ||
    Boolean(skill?.ownerPublisherId && myPublisherIds.has(skill.ownerPublisherId));
  const isOwner =
    Boolean(me && skill && me._id === skill.ownerUserId) ||
    Boolean(skill?.ownerPublisherId && myPublisherIds.has(skill.ownerPublisherId));
  const ownedSkills = useQuery(
    api.skills.list,
    isOwner && skill
      ? skill.ownerPublisherId
        ? { ownerPublisherId: skill.ownerPublisherId, limit: 100 }
        : { ownerUserId: skill.ownerUserId, limit: 100 }
      : "skip",
  ) as Array<{ _id: Id<"skills">; slug: string; displayName: string }> | undefined;
  const canViewOwnerRescanState = isOwner || me?.role === "admin";
  const rescanState = useQuery(
    api.skills.getRescanState,
    canViewOwnerRescanState && skill ? { skillId: skill._id } : "skip",
  ) as ComponentProps<typeof DetailSecuritySummary>["rescanState"] | undefined;

  const ownerHandle = owner?.handle ?? null;
  const ownerParam = ownerHandle?.trim().toLowerCase() || (owner?._id ? String(owner._id) : null);
  const canonicalOwnerParam =
    typeof canonicalOwner === "string" ? canonicalOwner.trim().toLowerCase() : null;
  const wantsCanonicalRedirect = Boolean(
    ownerParam &&
    ((result?.resolvedSlug && result.resolvedSlug !== slug) ||
      redirectToCanonical ||
      (canonicalOwnerParam && canonicalOwnerParam !== ownerParam)),
  );

  const forkOf = result?.forkOf ?? null;
  const canonical = result?.canonical ?? null;
  const modInfo = result?.moderationInfo ?? null;
  const suppressVersionScanResults =
    !isStaff &&
    Boolean(modInfo?.overrideActive) &&
    !modInfo?.isMalwareBlocked &&
    !modInfo?.isSuspicious;
  const scanResultsSuppressedMessage = suppressVersionScanResults
    ? "Security findings on these releases were reviewed by staff and cleared for public use."
    : null;
  const forkOfLabel = forkOf?.kind === "duplicate" ? "duplicate of" : "fork of";
  const forkOfOwnerHandle = forkOf?.owner?.handle ?? null;
  const forkOfOwnerId = forkOf?.owner?.userId ?? null;
  const canonicalOwnerHandle = canonical?.owner?.handle ?? null;
  const canonicalOwnerId = canonical?.owner?.userId ?? null;
  const forkOfHref = forkOf?.skill?.slug
    ? buildSkillHref(forkOfOwnerHandle, forkOfOwnerId, forkOf.skill.slug)
    : null;
  const canonicalHref =
    canonical?.skill?.slug && canonical.skill.slug !== forkOf?.skill?.slug
      ? buildSkillHref(canonicalOwnerHandle, canonicalOwnerId, canonical.skill.slug)
      : null;

  const staffSkill = isStaff && skill ? (skill as Doc<"skills">) : null;
  const moderationStatus =
    staffSkill?.moderationStatus ?? (staffSkill?.softDeletedAt ? "hidden" : undefined);
  const isHidden = moderationStatus === "hidden" || Boolean(staffSkill?.softDeletedAt);
  const isRemoved = moderationStatus === "removed";
  const isAutoHidden = isHidden && staffSkill?.moderationReason === "auto.reports";
  const staffVisibilityTag = isRemoved
    ? "Removed"
    : isAutoHidden
      ? "Auto-hidden"
      : isHidden
        ? "Hidden"
        : null;
  const staffModerationNote =
    staffSkill?.moderationNotes?.trim() ||
    (staffVisibilityTag
      ? isAutoHidden
        ? "Auto-hidden after 4+ unique reports."
        : isRemoved
          ? "Removed from public view."
          : "Hidden from public view."
      : null);

  const versionById = new Map<Id<"skillVersions">, Doc<"skillVersions">>(
    (diffVersions ?? versions ?? []).map((version) => [version._id, version]),
  );

  const clawdis = (latestVersion?.parsed as { clawdis?: ClawdisSkillMetadata } | undefined)
    ?.clawdis;
  const osLabels = useMemo(() => formatOsList(clawdis?.os), [clawdis?.os]);
  const nixPlugin = clawdis?.nix?.plugin;
  const nixSnippet = nixPlugin ? formatNixInstallSnippet(nixPlugin) : null;
  const configRequirements = clawdis?.config;
  const configExample = configRequirements?.example
    ? formatConfigSnippet(configRequirements.example)
    : null;
  const cliHelp = clawdis?.cliHelp;
  const hasPluginBundle = Boolean(nixSnippet || configRequirements || cliHelp);

  const readmeContent = useMemo(() => {
    if (!readme) return null;
    return stripFrontmatter(readme);
  }, [readme]);
  const latestFiles: SkillFile[] = latestVersion?.files ?? [];

  useEffect(() => {
    if (!wantsCanonicalRedirect || !ownerParam) return;
    void navigate({
      to: "/$owner/$slug",
      params: { owner: ownerParam, slug },
      replace: true,
    });
  }, [navigate, ownerParam, slug, wantsCanonicalRedirect]);

  useEffect(() => {
    let cancelled = false;
    if (
      latestVersion &&
      !(loadedReadmeVersionId === latestVersion._id && (readme !== null || readmeError !== null))
    ) {
      setReadme(null);
      setReadmeError(null);
      setLoadedReadmeVersionId(latestVersion._id);

      void getReadme({ versionId: latestVersion._id })
        .then((data) => {
          if (cancelled) return;
          setReadme(data.text);
          setLoadedReadmeVersionId(latestVersion._id);
        })
        .catch((error) => {
          if (cancelled) return;
          setReadmeError(error instanceof Error ? error.message : "Failed to load README");
          setReadme(null);
          setLoadedReadmeVersionId(latestVersion._id);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [getReadme, latestVersion, loadedReadmeVersionId, readme, readmeError]);

  useEffect(() => {
    if (!tagVersionId && latestVersion) {
      setTagVersionId(latestVersion._id);
    }
  }, [latestVersion, tagVersionId]);

  const closeReportDialog = () => {
    setIsReportDialogOpen(false);
    setReportReason("");
    setReportError(null);
    setIsSubmittingReport(false);
  };

  const openReportDialog = () => {
    setReportReason("");
    setReportError(null);
    setIsSubmittingReport(false);
    setIsReportDialogOpen(true);
  };

  const submitTag = () => {
    if (!skill) return;
    if (!tagName.trim() || !tagVersionId) return;
    void updateTags({
      skillId: skill._id,
      tags: [{ tag: tagName.trim(), versionId: tagVersionId }],
    });
  };

  const deleteTag = (tag: string) => {
    if (!skill) return;
    if (!window.confirm(`Delete tag "${tag}"?`)) return;
    void deleteTags({
      skillId: skill._id,
      tags: [tag],
    });
  };

  const submitReport = async () => {
    if (!skill) return;

    const trimmedReason = reportReason.trim();
    if (!trimmedReason) {
      setReportError("Report reason required.");
      return;
    }

    setIsSubmittingReport(true);
    setReportError(null);
    try {
      const submission = await reportSkill({ skillId: skill._id, reason: trimmedReason });
      closeReportDialog();
      if (submission.reported) {
        window.alert("Thanks — your report has been submitted.");
      } else {
        window.alert("You have already reported this skill.");
      }
    } catch (error) {
      console.error("Failed to report skill", error);
      setReportError(formatReportError(error));
      setIsSubmittingReport(false);
    }
  };

  const submitRescanRequest = async () => {
    if (!skill) return;
    try {
      await requestRescan({ skillId: skill._id });
      toast.success("Rescan requested.", {
        action: {
          label: "Dashboard",
          onClick: () => {
            window.location.href = "/dashboard";
          },
        },
      });
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "Could not request a rescan."));
    }
  };

  if (isLoadingSkill || wantsCanonicalRedirect) {
    return (
      <main className="section detail-page-section" aria-busy="true">
        <div role="status" aria-label="Loading skill details">
          <SkillDetailSkeleton />
        </div>
      </main>
    );
  }

  if (result === null || !skill) {
    return (
      <main className="section detail-page-section">
        <Card>Skill not found.</Card>
      </main>
    );
  }

  const tagEntries = Object.entries(skill.tags ?? {}) as Array<[string, Id<"skillVersions">]>;
  const latestTagVersionId = latestVersion?._id ?? skill.latestVersionId ?? null;
  const currentTagEntries =
    latestTagVersionId === null
      ? tagEntries
      : tagEntries.filter(([, versionId]) => versionId === latestTagVersionId);
  const historicalTagEntries =
    latestTagVersionId === null
      ? []
      : tagEntries.filter(([, versionId]) => versionId !== latestTagVersionId);
  const securitySummary = latestVersion ? (
    <DetailSecuritySummary
      scannerBasePath={`/${encodeURIComponent(
        ownerParam ?? ownerHandle ?? "unknown",
      )}/${encodeURIComponent(skill.slug)}/security`}
      sha256hash={latestVersion.sha256hash ?? null}
      vtAnalysis={latestVersion.vtAnalysis ?? null}
      llmAnalysis={latestVersion.llmAnalysis ?? null}
      staticScan={latestVersion.staticScan ?? null}
      suppressScanResults={suppressVersionScanResults}
      suppressedMessage={scanResultsSuppressedMessage}
      rescanState={rescanState ?? null}
      onRequestRescan={canViewOwnerRescanState ? submitRescanRequest : null}
    />
  ) : null;
  const detailPath = `/${encodeURIComponent(ownerParam ?? ownerHandle ?? "unknown")}/${encodeURIComponent(skill.slug)}`;
  const settingsHref = canManage ? `${detailPath}/settings` : null;

  return (
    <main className="section detail-page-section">
      <DetailPageShell>
        <SkillHeader
          skill={skill}
          owner={owner}
          ownerHandle={ownerHandle}
          latestVersion={latestVersion}
          modInfo={modInfo}
          canManage={canManage}
          isAuthenticated={isAuthenticated}
          isStaff={isStaff}
          isStarred={isStarred}
          onToggleStar={() => void toggleStar({ skillId: skill._id })}
          onOpenReport={openReportDialog}
          forkOf={forkOf}
          forkOfLabel={forkOfLabel}
          forkOfHref={forkOfHref}
          forkOfOwnerHandle={forkOfOwnerHandle}
          canonical={canonical}
          canonicalHref={canonicalHref}
          canonicalOwnerHandle={canonicalOwnerHandle}
          staffModerationNote={staffModerationNote}
          staffVisibilityTag={staffVisibilityTag}
          isAutoHidden={isAutoHidden}
          isRemoved={isRemoved}
          nixPlugin={nixPlugin}
          hasPluginBundle={hasPluginBundle}
          configRequirements={configRequirements}
          cliHelp={cliHelp}
          clawdis={clawdis}
          osLabels={osLabels}
          priorityContent={securitySummary}
          settingsHref={settingsHref}
        >
          {mode === "detail" ? (
            <>
              {nixSnippet ? (
                <Card>
                  <h3 className="m-0 text-[length:var(--text-base)] font-semibold">
                    Install via Nix
                  </h3>
                  <pre className="hero-install-code mt-2">{nixSnippet}</pre>
                </Card>
              ) : null}

              {configExample ? (
                <Card>
                  <h3 className="m-0 text-[length:var(--text-base)] font-semibold">
                    Config example
                  </h3>
                  <pre className="hero-install-code mt-2">{configExample}</pre>
                </Card>
              ) : null}

              <SkillDetailTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onCompareIntent={() => setShouldPrefetchCompare(true)}
                readmeContent={readmeContent}
                readmeError={readmeError}
                latestFiles={latestFiles}
                latestVersionId={latestVersion?._id ?? null}
                skill={skill as Doc<"skills">}
                diffVersions={diffVersions}
                versions={versions}
                nixPlugin={Boolean(nixPlugin)}
                suppressVersionScanResults={suppressVersionScanResults}
                scanResultsSuppressedMessage={scanResultsSuppressedMessage}
              />

              <Card className="skill-tag-card">
                <CardHeader>
                  <CardTitle>Version tags</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="skill-tag-row">
                    {currentTagEntries.length === 0 ? (
                      <span className="section-subtitle m-0">No tags yet.</span>
                    ) : (
                      currentTagEntries.map(([tag, versionId]) => (
                        <Badge key={tag}>
                          {tag}
                          <span className="tag-meta">
                            v{versionById.get(versionId)?.version ?? versionId}
                          </span>
                          {canManage && tag !== "latest" ? (
                            <button
                              type="button"
                              className="tag-delete"
                              onClick={() => deleteTag(tag)}
                              aria-label={`Delete tag ${tag}`}
                              title={`Delete tag "${tag}"`}
                            >
                              x
                            </button>
                          ) : null}
                        </Badge>
                      ))
                    )}
                  </div>

                  {canManage && historicalTagEntries.length > 0 ? (
                    <div className="skill-tag-history">
                      <div className="skill-tag-history-label">Historical tags</div>
                      <div className="skill-tag-row">
                        {historicalTagEntries.map(([tag, versionId]) => (
                          <Badge key={tag}>
                            {tag}
                            <span className="tag-meta">
                              v{versionById.get(versionId)?.version ?? versionId}
                            </span>
                            {tag !== "latest" ? (
                              <button
                                type="button"
                                className="tag-delete"
                                onClick={() => deleteTag(tag)}
                                aria-label={`Delete tag ${tag}`}
                                title={`Delete tag "${tag}"`}
                              >
                                x
                              </button>
                            ) : null}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {canManage ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitTag();
                      }}
                      className="tag-form"
                    >
                      <input
                        aria-label="Tag name"
                        className="search-input"
                        name="tagName"
                        value={tagName}
                        onChange={(event) => setTagName(event.target.value)}
                        placeholder="latest..."
                      />
                      <select
                        aria-label="Tag version"
                        className="search-input"
                        name="tagVersion"
                        value={tagVersionId ?? ""}
                        onChange={(event) =>
                          setTagVersionId(event.target.value as Id<"skillVersions">)
                        }
                      >
                        {(versions ?? []).map((version) => (
                          <option key={version._id} value={version._id}>
                            v{version.version}
                          </option>
                        ))}
                      </select>
                      <Button type="submit">Update Tag</Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>

              {SHOW_SKILL_COMMENTS ? (
                <ClientOnly
                  fallback={
                    <Card>
                      <h2 className="section-title text-[1.2rem] m-0">Comments</h2>
                      <p className="section-subtitle mt-3 mb-0">Loading comments...</p>
                    </Card>
                  }
                >
                  <SkillCommentsPanel
                    skillId={skill._id}
                    isAuthenticated={isAuthenticated}
                    me={me ?? null}
                  />
                </ClientOnly>
              ) : null}
            </>
          ) : null}
        </SkillHeader>

        {mode === "settings" ? (
          <DetailBody>
            {isOwner && skill ? (
              <SkillOwnershipPanel
                skillId={skill._id}
                slug={skill.slug}
                ownerHandle={ownerHandle}
                ownerId={owner?._id ?? null}
                ownedSkills={(ownedSkills ?? []).filter((entry) => entry._id !== skill._id)}
              />
            ) : (
              <Card>
                <h2 className="section-title text-[1.2rem] m-0">Settings unavailable</h2>
                <p className="section-subtitle mt-3 mb-0">
                  Only the skill owner can manage these settings.
                </p>
              </Card>
            )}
          </DetailBody>
        ) : null}
      </DetailPageShell>

      <SkillReportDialog
        isOpen={isAuthenticated && isReportDialogOpen}
        isSubmitting={isSubmittingReport}
        reportReason={reportReason}
        reportError={reportError}
        onReasonChange={setReportReason}
        onCancel={closeReportDialog}
        onSubmit={() => void submitReport()}
      />
    </main>
  );
}
