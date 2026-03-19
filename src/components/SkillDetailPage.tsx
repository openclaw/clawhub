import { useNavigate } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { canManageSkill, isModerator } from "../lib/roles";
import type { SkillBySlugResult, SkillPageInitialData } from "../lib/skillPage";
import { useAuthStatus } from "../lib/useAuthStatus";
import { ClientOnly } from "./ClientOnly";
import { SkillCommentsPanel } from "./SkillCommentsPanel";
import { SkillDetailTabs } from "./SkillDetailTabs";
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

type SkillDetailPageProps = {
  slug: string;
  canonicalOwner?: string;
  redirectToCanonical?: boolean;
  initialData?: SkillPageInitialData | null;
};

type SkillFile = Doc<"skillVersions">["files"][number];

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
  const getReadme = useAction(api.skills.getReadme);

  const [readme, setReadme] = useState<string | null>(initialData?.readme ?? null);
  const [readmeError, setReadmeError] = useState<string | null>(initialData?.readmeError ?? null);
  const [loadedReadmeVersionId, setLoadedReadmeVersionId] = useState<Id<"skillVersions"> | null>(
    initialResult?.latestVersion?._id ?? null,
  );
  const [tagName, setTagName] = useState("latest");
  const [tagVersionId, setTagVersionId] = useState<Id<"skillVersions"> | "">("");
  const [activeTab, setActiveTab] = useState<"files" | "compare" | "versions">("files");
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

  const canManage = canManageSkill(me, skill);
  const isOwner = Boolean(me && skill && me._id === skill.ownerUserId);
  const ownedSkills = useQuery(
    api.skills.list,
    isOwner && skill ? { ownerUserId: skill.ownerUserId, limit: 100 } : "skip",
  ) as Array<{ _id: Id<"skills">; slug: string; displayName: string }> | undefined;

  const ownerHandle = owner?.handle ?? owner?.name ?? null;
  const ownerParam = ownerHandle ?? (owner?._id ? String(owner._id) : null);
  const wantsCanonicalRedirect = Boolean(
    ownerParam &&
    ((result?.resolvedSlug && result.resolvedSlug !== slug) ||
      redirectToCanonical ||
      (typeof canonicalOwner === "string" && canonicalOwner && canonicalOwner !== ownerParam)),
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
  const staffModerationNote = staffVisibilityTag
    ? isAutoHidden
      ? "Auto-hidden after 4+ unique reports."
      : isRemoved
        ? "Removed from public view."
        : "Hidden from public view."
    : null;

  const versionById = new Map<Id<"skillVersions">, Doc<"skillVersions">>(
    (diffVersions ?? versions ?? []).map((version) => [version._id, version]),
  );

  const clawdis = (latestVersion?.parsed as { clawdis?: ClawdisSkillMetadata } | undefined)
    ?.clawdis;
  const osLabels = useMemo(() => formatOsList(clawdis?.os), [clawdis?.os]);
  const nixPlugin = clawdis?.nix?.plugin;
  const nixSystems = clawdis?.nix?.systems ?? [];
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
    if (!latestVersion) return;
    if (loadedReadmeVersionId === latestVersion._id && (readme !== null || readmeError !== null)) {
      return;
    }

    setReadme(null);
    setReadmeError(null);
    setLoadedReadmeVersionId(latestVersion._id);
    let cancelled = false;

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

  if (isLoadingSkill || wantsCanonicalRedirect) {
    return (
      <main className="section">
        <div className="card">
          <div className="loading-indicator">Loading skill…</div>
        </div>
      </main>
    );
  }

  if (result === null || !skill) {
    return (
      <main className="section">
        <div className="card">Skill not found.</div>
      </main>
    );
  }

  const tagEntries = Object.entries(skill.tags ?? {}) as Array<[string, Id<"skillVersions">]>;

  return (
    <main className="section">
      <div className="skill-detail-stack">
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
          tagEntries={tagEntries}
          versionById={versionById}
          tagName={tagName}
          onTagNameChange={setTagName}
          tagVersionId={tagVersionId}
          onTagVersionChange={setTagVersionId}
          onTagSubmit={submitTag}
          tagVersions={versions ?? []}
          clawdis={clawdis}
          osLabels={osLabels}
        />

        {isOwner && skill ? (
          <SkillOwnershipPanel
            skillId={skill._id}
            slug={skill.slug}
            ownerHandle={ownerHandle}
            ownerId={owner?._id ?? null}
            ownedSkills={(ownedSkills ?? []).filter((entry) => entry._id !== skill._id)}
          />
        ) : null}

        {nixSnippet ? (
          <div className="card">
            <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
              Install via Nix
            </h2>
            <p className="section-subtitle" style={{ margin: 0 }}>
              {nixSystems.length ? `Systems: ${nixSystems.join(", ")}` : "nix-clawdbot"}
            </p>
            <pre className="hero-install-code" style={{ marginTop: 12 }}>
              {nixSnippet}
            </pre>
          </div>
        ) : null}

        {configExample ? (
          <div className="card">
            <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
              Config example
            </h2>
            <p className="section-subtitle" style={{ margin: 0 }}>
              Starter config for this plugin bundle.
            </p>
            <pre className="hero-install-code" style={{ marginTop: 12 }}>
              {configExample}
            </pre>
          </div>
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

        <ClientOnly
          fallback={
            <div className="card">
              <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
                Comments
              </h2>
              <p className="section-subtitle" style={{ marginTop: 12, marginBottom: 0 }}>
                Loading comments…
              </p>
            </div>
          }
        >
          <SkillCommentsPanel
            skillId={skill._id}
            isAuthenticated={isAuthenticated}
            me={me ?? null}
          />
        </ClientOnly>
      </div>

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
