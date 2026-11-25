import { useAuthActions } from "@convex-dev/auth/react";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { inferSkillCategories, resolveSkillCategories } from "clawhub-schema/catalogMetadata";
import { useAction, useMutation, useQueries, useQuery, type RequestForQueries } from "convex/react";
import { ArrowLeft, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { getActivityTrendEndDay } from "../lib/activityTrend";
import {
  captureAnalyticsOperation,
  emitAnalytics,
  publicAnalyticsContentId,
} from "../lib/analyticsEvents";
import { getSkillCategoriesForSkill, getSkillCategoryForSkill } from "../lib/categories";
import { getUserFacingConvexError } from "../lib/convexError";
import { isPublicAnalyticsSkill } from "../lib/googleAnalytics";
import { buildSkillSecurityAuditHref } from "../lib/ownerRoute";
import { hasPostPublishSearch } from "../lib/postPublishSearch";
import { canManageSkill, isModerator } from "../lib/roles";
import { handleSignInError } from "../lib/signInError";
import { buildSkillDetailTabs, skillTabFromHash, type DetailTab } from "../lib/skillDetailTabs";
import type { SkillBySlugResult, SkillPageInitialData } from "../lib/skillPage";
import { resolveGitHubSkillReadmeHref } from "../lib/skillReadmeLinks";
import { clearAuthError } from "../lib/useAuthError";
import { useAuthStatus } from "../lib/useAuthStatus";
import { useDeferredSkillActivityTrend } from "../lib/useDeferredActivityTrend";
import { DetailBody, DetailPageShell } from "./DetailPageShell";
import { GenericNotFoundPage } from "./GenericNotFoundPage";
import { SkillDetailSkeleton } from "./skeletons/SkillDetailSkeleton";
import { SkillCatalogOverview } from "./SkillCatalogOverview";
import { SkillDetailPageView } from "./SkillDetailPageView";
import { SkillDetailTabs } from "./SkillDetailTabs";
import {
  buildSkillHref,
  formatConfigSnippet,
  formatNixInstallSnippet,
  formatOsList,
  stripFrontmatter,
} from "./skillDetailUtils";
import { SkillEvaluationReport, type SkillEvaluationResult } from "./SkillEvaluationReport";
import { SkillOwnershipPanel } from "./SkillOwnershipPanel";
import { SkillPublishSuccessDialog } from "./SkillPublishSuccessDialog";
import { SkillRelatedSection, type RelatedSkillEntry } from "./SkillRelatedSection";
import { SkillReportDialog } from "./SkillReportDialog";
import { SkillVersionComparison } from "./SkillVersionComparison";
import { SkillVersionHistory } from "./SkillVersionHistory";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

type SkillDetailPageProps = {
  slug: string;
  canonicalOwner?: string;
  redirectToCanonical?: boolean;
  initialData?: SkillPageInitialData | null;
  mode?: "detail" | "settings";
  showPostPublishSuccess?: boolean;
  onDismissPostPublish?: () => void;
};

type GitHubBackedSkillFields = {
  installKind?: "github";
  githubCurrentRepo?: string | null;
  githubSourceRepo?: string | null;
  githubPath?: string | null;
  githubScanStatus?: string | null;
};

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

function buildStaffVisibilityAlert({
  artifactKind,
  moderationReason,
  moderationNote,
  isAutoHidden,
  isRemoved,
  isSoftDeleted,
  modInfo,
}: {
  artifactKind: "skill" | "plugin";
  moderationReason?: string;
  moderationNote?: string;
  isAutoHidden: boolean;
  isRemoved: boolean;
  isSoftDeleted: boolean;
  modInfo?: { isMalwareBlocked: boolean; isSuspicious: boolean } | null;
}) {
  if (isRemoved) {
    return `This ${artifactKind} was removed from public view by moderation.`;
  }

  let reason = "by moderation.";
  if (isAutoHidden) {
    reason = "because it was automatically hidden after multiple reports.";
  } else if (moderationReason === "manual.report") {
    reason = "because staff reviewed a report.";
  } else if (moderationReason === "pending.scan" || moderationReason === "pending.scan.stale") {
    reason = "while security checks finish.";
  } else if (moderationReason === "quality.low") {
    reason = "because it is on quality hold.";
  } else if (moderationReason === "user.banned") {
    reason = "because the publisher account is banned.";
  } else if (moderationReason === "user.moderation") {
    reason = "because the publisher account is under moderation.";
  } else if (moderationReason === "owner.merged") {
    reason = "because it was merged into another skill.";
  } else if (moderationReason === "security.redaction") {
    reason = "because it was hidden for security redaction.";
  } else if (moderationReason?.startsWith("scanner.") && moderationReason.endsWith(".malicious")) {
    reason = "because automated security checks found security warnings or malicious content.";
  } else if (moderationReason?.startsWith("scanner.") && moderationReason.endsWith(".suspicious")) {
    reason = "because automated security checks found security warnings or malicious content.";
  } else if (modInfo?.isMalwareBlocked) {
    reason = "because automated security checks found security warnings or malicious content.";
  } else if (modInfo?.isSuspicious) {
    reason = "because automated security checks found security warnings or malicious content.";
  } else if (isSoftDeleted && !moderationReason) {
    reason = "because it was unpublished.";
  }

  const base = `This ${artifactKind} is hidden from public view ${reason}`;
  if (!moderationNote) return base;

  const normalizedNote = moderationNote.trim();
  const generatedNotes = new Set([
    "Auto-hidden after 4 unique reports.",
    "Removed from public view.",
    "Hidden from public view.",
  ]);
  if (!normalizedNote || generatedNotes.has(normalizedNote)) return base;
  return `${base} Moderator note: ${normalizedNote}`;
}

export function SkillDetailPage({
  slug,
  canonicalOwner,
  redirectToCanonical,
  initialData,
  mode = "detail",
  showPostPublishSuccess = false,
  onDismissPostPublish,
}: SkillDetailPageProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const { isAuthenticated, me } = useAuthStatus();
  const { signIn } = useAuthActions();
  const initialResult = initialData?.result ?? undefined;

  const isStaff = isModerator(me);
  const liveLookupOwnerHandle =
    initialData && "lookupOwnerHandle" in initialData
      ? initialData.lookupOwnerHandle
      : canonicalOwner;
  const skillLookupArgs = liveLookupOwnerHandle
    ? { slug, ownerHandle: liveLookupOwnerHandle }
    : { slug };
  const staffResult = useQuery(api.skills.getBySlugForStaff, isStaff ? skillLookupArgs : "skip") as
    | SkillBySlugResult
    | undefined;
  const publicResult = useQuery(api.skills.getBySlug, !isStaff ? skillLookupArgs : "skip") as
    | SkillBySlugResult
    | undefined;
  const liveResult = isStaff ? staffResult : publicResult;
  const result = liveResult === undefined ? initialResult : liveResult;
  const analyticsResourceId = result?.skill?._id ?? initialResult?.skill?._id;
  const analyticsResourcePublic = isPublicAnalyticsSkill(result);
  useLayoutEffect(() => {
    if (!analyticsResourceId) return;
    window.dispatchEvent(
      new CustomEvent("clawhub:analytics-resource-visibility", {
        detail: {
          id: publicAnalyticsContentId("skill", String(analyticsResourceId)),
          public: analyticsResourcePublic,
        },
      }),
    );
  }, [analyticsResourceId, analyticsResourcePublic]);

  const toggleStar = useMutation(api.stars.toggle);
  const reportSkill = useMutation(api.skills.report);
  const updateSummary = useMutation(api.skills.updateSummary);
  const setCatalogMetadata = useMutation(api.skills.setCatalogMetadata);
  const getReadme = useAction(api.skillReadme.getReadme);
  const myPublishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<{ publisher: { _id: Id<"publishers"> }; role: string }>
    | undefined;

  const [{ text: readme, error: readmeError }, setReadmeResult] = useState({
    text: initialData?.readme ?? null,
    error: initialData?.readmeError ?? null,
  });
  const loadedReadmeVersionId = useRef<Id<"skillVersions"> | null>(
    readme !== null || readmeError !== null ? (initialResult?.latestVersion?._id ?? null) : null,
  );
  const [activeTab, setActiveTab] = useState<DetailTab>("readme");
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [hasClientPostPublishSearch, setHasClientPostPublishSearch] = useState(false);
  const [optimisticStar, setOptimisticStar] = useState<{
    skillId: Id<"skills">;
    starred: boolean;
    baselineStarred: boolean;
    baselineStars: number;
    delta: number;
  } | null>(null);

  const isLoadingSkill = result === undefined;
  const skill = result?.skill;
  const hasSkill = Boolean(skill);
  const owner = result?.owner ?? null;
  const latestVersion = result?.latestVersion ?? null;
  const latestVersionId = latestVersion?._id ?? null;
  const githubBackedFields = skill as GitHubBackedSkillFields | null | undefined;
  const isGitHubBackedSkill = githubBackedFields?.installKind === "github" && !latestVersionId;
  const skillEvaluationSourceRepo =
    githubBackedFields?.githubCurrentRepo ?? githubBackedFields?.githubSourceRepo ?? undefined;
  const skillEvaluationSourcePath = githubBackedFields?.githubPath ?? undefined;
  const skillEvaluationQueries = useMemo<RequestForQueries>(() => {
    const queries: RequestForQueries = {};
    if (!skill) return queries;
    queries.skillEvaluation = {
      query: api.skillEvaluations.getCurrentForSkill,
      args: {
        skillId: skill._id,
        ...(skillEvaluationSourceRepo ? { sourceRepo: skillEvaluationSourceRepo } : {}),
        ...(skillEvaluationSourcePath ? { sourcePath: skillEvaluationSourcePath } : {}),
      },
    };
    return queries;
  }, [skill?._id, skillEvaluationSourcePath, skillEvaluationSourceRepo]);
  const skillEvaluationResult = useQueries(skillEvaluationQueries).skillEvaluation as
    | SkillEvaluationResult
    | null
    | Error
    | undefined;
  const skillEvaluation = skillEvaluationResult instanceof Error ? null : skillEvaluationResult;
  const modInfo = result?.moderationInfo ?? null;
  const relatedCategory = useMemo(() => (skill ? getSkillCategoryForSkill(skill) : null), [skill]);
  const relatedCategories = useMemo(
    () => (skill ? getSkillCategoriesForSkill(skill).slice(0, 3) : []),
    [skill],
  );
  const suggestedCatalogCategories = useMemo(
    () => (skill ? resolveSkillCategories({ inferred: inferSkillCategories(skill) }) : undefined),
    [skill],
  );
  const shouldLoadRelatedSkills = Boolean(
    skill && relatedCategory && relatedCategory.keywords.length > 0,
  );
  const relatedSkillsResult = useQuery(
    api.skills.listRelatedByCategory,
    shouldLoadRelatedSkills && skill && relatedCategory
      ? {
          skillId: skill._id,
          categorySlug: relatedCategory.slug,
          keywords: relatedCategory.keywords,
          limit: 5,
        }
      : "skip",
  ) as { items: RelatedSkillEntry[] } | undefined;

  const isStarred = useQuery(
    api.stars.isStarred,
    isAuthenticated && skill ? { skillId: skill._id } : "skip",
  );
  const activeOptimisticStar =
    optimisticStar && skill && optimisticStar.skillId === skill._id ? optimisticStar : null;
  const effectiveIsStarred = activeOptimisticStar?.starred ?? isStarred;

  useEffect(() => {
    const browserSearch = typeof window === "undefined" ? "" : window.location.search;
    setHasClientPostPublishSearch(
      hasPostPublishSearch(searchStr) || hasPostPublishSearch(browserSearch),
    );
  }, [searchStr]);

  const displayedSkill = useMemo(() => {
    if (!skill || !activeOptimisticStar) return skill;
    const currentStars = skill.stats.stars ?? 0;
    if (currentStars !== activeOptimisticStar.baselineStars) return skill;
    return {
      ...skill,
      stats: {
        ...skill.stats,
        stars: Math.max(0, currentStars + activeOptimisticStar.delta),
      },
    };
  }, [activeOptimisticStar, skill]);

  const myPublisherIds = useMemo(
    () =>
      new Set(
        (Array.isArray(myPublishers) ? myPublishers : []).map((entry) => entry.publisher._id),
      ),
    [myPublishers],
  );
  const myManagePublisherIds = useMemo(
    () =>
      new Set(
        (Array.isArray(myPublishers) ? myPublishers : [])
          .filter((entry) => entry.role === "owner" || entry.role === "admin")
          .map((entry) => entry.publisher._id),
      ),
    [myPublishers],
  );
  const canManage =
    canManageSkill(me, skill) ||
    Boolean(skill?.ownerPublisherId && myPublisherIds.has(skill.ownerPublisherId));
  const canAccessSettings =
    Boolean(me && skill && me._id === skill.ownerUserId) ||
    isStaff ||
    Boolean(skill?.ownerPublisherId && myManagePublisherIds.has(skill.ownerPublisherId));
  const canManagePersonalPublisherSkill =
    Boolean(me && skill && !skill.ownerPublisherId && me._id === skill.ownerUserId) ||
    Boolean(
      me &&
      skill?.ownerPublisherId &&
      owner?.kind === "user" &&
      (owner.linkedUserId ? owner.linkedUserId === me._id : me._id === skill.ownerUserId),
    );
  const canDeleteSkillFromSettings =
    canManagePersonalPublisherSkill ||
    Boolean(skill?.ownerPublisherId && myManagePublisherIds.has(skill.ownerPublisherId));
  const skillSoftDeletedAt = skill && "softDeletedAt" in skill ? skill.softDeletedAt : undefined;
  const skillModerationStatus =
    skill && "moderationStatus" in skill ? skill.moderationStatus : undefined;
  const isSkillUnavailableForVersionDeletion =
    Boolean(skillSoftDeletedAt) ||
    (skillModerationStatus ?? "active") !== "active" ||
    Boolean(modInfo?.isPendingScan || modInfo?.isHiddenByMod || modInfo?.isRemoved);
  const canDeleteSkillVersions =
    canDeleteSkillFromSettings && !isSkillUnavailableForVersionDeletion;
  const ownedSkills = useQuery(
    api.skills.list,
    canAccessSettings && skill
      ? skill.ownerPublisherId
        ? { ownerPublisherId: skill.ownerPublisherId, limit: 100 }
        : { ownerUserId: skill.ownerUserId, limit: 100 }
      : "skip",
  ) as Array<{ _id: Id<"skills">; slug: string; displayName: string }> | undefined;
  const ownerHandle = owner?.handle ?? null;
  const ownerParam = ownerHandle?.trim().toLowerCase() || (owner?._id ? String(owner._id) : null);
  const settingsHref =
    canAccessSettings && skill
      ? `${buildSkillHref(ownerHandle, owner?._id ?? null, skill.slug)}/settings`
      : null;
  const newVersionHref =
    canAccessSettings && skill
      ? `/skills/publish?${new URLSearchParams({
          updateSlug: skill.slug,
          ...(ownerHandle ? { ownerHandle } : {}),
        }).toString()}`
      : null;
  const activityTrendOwnerHandle =
    ownerHandle ?? liveLookupOwnerHandle ?? (owner?._id ? String(owner._id) : null);
  const activityTrendEndDay = getActivityTrendEndDay();
  const canonicalOwnerParam =
    typeof canonicalOwner === "string" ? canonicalOwner.trim().toLowerCase() : null;
  const { trend: activityTrend } = useDeferredSkillActivityTrend(
    skill
      ? {
          slug: skill.slug,
          endDay: activityTrendEndDay,
          ...(activityTrendOwnerHandle ? { ownerHandle: activityTrendOwnerHandle } : {}),
        }
      : null,
  );
  const wantsCanonicalRedirect = Boolean(
    ownerParam &&
    ((result?.resolvedSlug && result.resolvedSlug !== slug) ||
      redirectToCanonical ||
      (canonicalOwnerParam && canonicalOwnerParam !== ownerParam)),
  );
  const redirectSlug = result?.resolvedSlug ?? skill?.slug ?? slug;

  const forkOf = result?.forkOf ?? null;
  const canonical = result?.canonical ?? null;
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
  const isPendingPublication =
    modInfo?.reason === "pending.publication" ||
    staffSkill?.moderationReason === "pending.publication";
  const moderationStatus =
    staffSkill?.moderationStatus ?? (staffSkill?.softDeletedAt ? "hidden" : undefined);
  const isHidden = moderationStatus === "hidden" || Boolean(staffSkill?.softDeletedAt);
  const isRemoved = moderationStatus === "removed";
  const isAutoHidden = isHidden && staffSkill?.moderationReason === "auto.reports";
  const staffVisibilityTag = isRemoved
    ? "Removed"
    : isPendingPublication
      ? null
      : isAutoHidden
        ? "Auto-hidden"
        : isHidden
          ? "Hidden"
          : null;
  const staffModerationNote = staffVisibilityTag
    ? buildStaffVisibilityAlert({
        artifactKind: "skill",
        moderationReason: staffSkill?.moderationReason,
        moderationNote: staffSkill?.moderationNotes?.trim(),
        isAutoHidden,
        isRemoved,
        isSoftDeleted: Boolean(staffSkill?.softDeletedAt),
        modInfo,
      })
    : null;

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
  const githubReadme = useQuery(
    api.skills.getGitHubSkillContent,
    isGitHubBackedSkill && skill ? { skillId: skill._id, kind: "readme" } : "skip",
  ) as { path: string; text: string; sourceBaseUrl?: string } | null | undefined;
  const githubSourceBaseUrl = githubReadme?.sourceBaseUrl;
  const readmeHrefResolver = useMemo(() => {
    if (!isGitHubBackedSkill || !githubSourceBaseUrl) return undefined;
    return (href: string) => resolveGitHubSkillReadmeHref(href, githubSourceBaseUrl);
  }, [githubSourceBaseUrl, isGitHubBackedSkill]);
  const displayedReadme = isGitHubBackedSkill ? (githubReadme?.text ?? null) : readme;
  const displayedReadmeError = isGitHubBackedSkill
    ? githubReadme === null
      ? "No SKILL.md available"
      : null
    : readmeError;

  const readmeContent = useMemo(() => {
    if (!displayedReadme) return null;
    return stripFrontmatter(displayedReadme);
  }, [displayedReadme]);
  useEffect(() => {
    if (!wantsCanonicalRedirect || !ownerParam || !redirectSlug) return;
    const params = { owner: ownerParam, slug: redirectSlug };
    if (mode === "settings") {
      void navigate({
        to: "/$owner/skills/$slug/settings",
        params,
        replace: true,
      });
      return;
    }
    void navigate({
      to: "/$owner/skills/$slug",
      params,
      replace: true,
    });
  }, [mode, navigate, ownerParam, redirectSlug, wantsCanonicalRedirect]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncTabFromHash = () => {
      setActiveTab(skillTabFromHash(window.location.hash) ?? "readme");
    };
    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => {
      window.removeEventListener("hashchange", syncTabFromHash);
    };
  }, []);

  const detailTabs = useMemo(
    () => buildSkillDetailTabs({ hasEvaluation: Boolean(skillEvaluation), clawdis, osLabels }),
    [clawdis, osLabels, skillEvaluation],
  );
  const visibleTab = detailTabs.some((tab) => tab.id === activeTab) ? activeTab : "readme";

  useEffect(() => {
    let cancelled = false;
    if (!hasSkill) return undefined;
    if (!latestVersionId) {
      setReadmeResult({ text: null, error: isGitHubBackedSkill ? null : "No SKILL.md available" });
      loadedReadmeVersionId.current = null;
      return undefined;
    }
    if (loadedReadmeVersionId.current === latestVersionId) return undefined;

    // Published results must not restart and cancel their own request.
    loadedReadmeVersionId.current = null;
    setReadmeResult({ text: null, error: null });
    void getReadme({ versionId: latestVersionId })
      .then((data) => {
        if (cancelled) return;
        loadedReadmeVersionId.current = latestVersionId;
        setReadmeResult({ text: data.text, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        loadedReadmeVersionId.current = latestVersionId;
        setReadmeResult({
          text: null,
          error: error instanceof Error ? error.message : "Failed to load README",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [getReadme, hasSkill, isGitHubBackedSkill, latestVersionId]);

  useEffect(() => {
    if (!skill || !activeOptimisticStar) return;
    if (skill.stats.stars !== activeOptimisticStar.baselineStars) {
      setOptimisticStar(null);
    }
  }, [activeOptimisticStar, skill]);

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

  const submitSummary = async (value: string) => {
    if (!skill) return;
    const nextSummary = value.trim();
    if (nextSummary === (skill.summary ?? "").trim()) {
      return;
    }
    try {
      await updateSummary({
        skillId: skill._id,
        summary: nextSummary,
      });
      toast.success("Summary updated.");
    } catch (error) {
      console.error("Failed to update summary", error);
      toast.error(getUserFacingConvexError(error, "Failed to update summary."));
    }
  };

  const submitCatalogMetadata = async (value: { categories?: string[]; topics: string[] }) => {
    if (!skill) return;
    await setCatalogMetadata({
      skillId: skill._id,
      categories: value.categories,
      topics: value.topics,
    });
    toast.success("Catalog metadata updated.");
  };

  const submitReport = async () => {
    if (!skill) return;
    emitAnalytics("form_attempt", { form_id: "skill_report", ui_location: "detail" });

    const operation = captureAnalyticsOperation();
    const trimmedReason = reportReason.trim();
    if (!trimmedReason) {
      emitAnalytics("form_validation_error", {
        form_id: "skill_report",
        field_name: "form",
        error_code: "required",
      });
      setReportError("Report reason required.");
      return;
    }

    setIsSubmittingReport(true);
    setReportError(null);
    try {
      const submission = await reportSkill({ skillId: skill._id, reason: trimmedReason });
      closeReportDialog();
      if (submission.reported) {
        operation?.emit("resource_action", {
          action: "report",
          content_type: "skill",
          action_result: "success",
          ui_location: "detail",
        });
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

  const handleToggleStar = async () => {
    if (!skill) return;
    const operation = captureAnalyticsOperation();
    const activeStar = activeOptimisticStar;
    const baselineStarred = activeStar?.baselineStarred ?? Boolean(effectiveIsStarred);
    const previousIsStarred = Boolean(effectiveIsStarred);
    const baselineStars = activeStar?.baselineStars ?? skill.stats.stars ?? 0;

    try {
      const starResult = (await toggleStar({ skillId: skill._id })) as { starred: boolean };
      operation?.emit("resource_action", {
        action: starResult.starred ? "star" : "unstar",
        content_type: "skill",
        content_id: publicAnalyticsContentId("skill", String(skill._id)),
        action_result: "success",
        ui_location: "detail",
      });
      setOptimisticStar({
        skillId: skill._id,
        starred: starResult.starred,
        baselineStarred,
        baselineStars,
        delta:
          starResult.starred === previousIsStarred
            ? (activeStar?.delta ?? 0)
            : starResult.starred === baselineStarred
              ? 0
              : starResult.starred
                ? 1
                : -1,
      });
      void router.invalidate();
    } catch (error) {
      operation?.emit("resource_action", {
        action: "star",
        content_type: "skill",
        action_result: "error",
        ui_location: "detail",
      });
      console.error("Failed to toggle bookmark", error);
      toast.error(getUserFacingConvexError(error, "Unable to update bookmark. Please try again."));
    }
  };

  const requireSignIn = () => {
    clearAuthError();
    const redirectTo =
      typeof window === "undefined"
        ? "/"
        : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    void signIn("github", redirectTo ? { redirectTo } : undefined).catch(handleSignInError);
  };

  if (isLoadingSkill || wantsCanonicalRedirect) {
    return (
      <main className="section detail-page-section skill-detail-page" aria-busy="true">
        <div role="status" aria-label="Loading skill details">
          <SkillDetailSkeleton />
        </div>
      </main>
    );
  }

  if (result === null || !skill || !displayedSkill) {
    return <GenericNotFoundPage />;
  }

  const staffVisibilityAlert = staffModerationNote ? (
    <p className="skill-visibility-alert" role="status">
      <TriangleAlert size={14} aria-hidden="true" />
      <span>{staffModerationNote}</span>
    </p>
  ) : null;
  const settingsPanel =
    canAccessSettings && skill ? (
      <SkillOwnershipPanel
        skillId={skill._id}
        slug={skill.slug}
        ownerHandle={ownerHandle}
        ownerId={owner?._id ?? null}
        ownedSkills={(ownedSkills ?? []).filter((entry) => entry._id !== skill._id)}
        summary={skill.summary ?? ""}
        onSaveSummary={canAccessSettings ? submitSummary : null}
        categories={skill.categories}
        suggestedCategories={suggestedCatalogCategories}
        topics={skill.topics}
        onSaveCatalogMetadata={canAccessSettings ? submitCatalogMetadata : null}
        canDeleteSkill={canDeleteSkillFromSettings}
      />
    ) : null;
  const detailHref = buildSkillHref(ownerHandle, owner?._id ?? null, skill.slug);
  const showPublishSuccessDialog =
    mode === "detail" &&
    (showPostPublishSuccess || hasClientPostPublishSearch) &&
    Boolean(onDismissPostPublish);

  if (mode === "settings") {
    return (
      <main className="section detail-page-section skill-detail-page">
        <DetailPageShell className="skill-settings-page">
          <div className="skill-settings-page-header">
            <a href={detailHref} className="skill-settings-back-link">
              <ArrowLeft size={16} aria-hidden="true" />
              Back to {skill.displayName}
            </a>
            <div className="skill-settings-page-title-row">
              <h1 className="skill-settings-page-title">Skill settings</h1>
              {newVersionHref ? (
                <Button asChild variant="outline" className="skill-settings-new-version-button">
                  <a href={newVersionHref}>
                    <Upload size={14} aria-hidden="true" />
                    Update skill files
                  </a>
                </Button>
              ) : null}
            </div>
            <hr className="skill-settings-page-divider" />
          </div>
          <DetailBody>
            {settingsPanel ? (
              <>
                {settingsPanel}
                {!isGitHubBackedSkill && (skill.stats.versions ?? 0) > 1 ? (
                  <SkillVersionComparison key={skill._id} skill={skill} />
                ) : null}
              </>
            ) : (
              <Card>
                <h2 className="section-title text-[1.2rem] m-0">Settings unavailable</h2>
                <p className="section-subtitle mt-3 mb-0">
                  Only the skill owner, an owner org admin, or platform staff can manage these
                  settings.
                </p>
              </Card>
            )}
          </DetailBody>
        </DetailPageShell>
      </main>
    );
  }

  return (
    <SkillDetailPageView
      skill={displayedSkill}
      owner={owner}
      ownerHandle={ownerHandle}
      latestVersion={latestVersion}
      modInfo={modInfo}
      isPendingPublication={isPendingPublication}
      publicationProgress={result?.publicationProgress}
      canManage={canManage}
      isAuthenticated={isAuthenticated}
      isStaff={isStaff}
      isStarred={effectiveIsStarred}
      onToggleStar={() => void handleToggleStar()}
      onOpenReport={openReportDialog}
      onRequireSignIn={requireSignIn}
      forkOf={forkOf}
      forkOfLabel={forkOfLabel}
      forkOfHref={forkOfHref}
      forkOfOwnerHandle={forkOfOwnerHandle}
      canonical={canonical}
      canonicalHref={canonicalHref}
      canonicalOwnerHandle={canonicalOwnerHandle}
      staffVisibilityTag={staffVisibilityTag}
      isAutoHidden={isAutoHidden}
      isRemoved={isRemoved}
      nixPlugin={nixPlugin}
      hasPluginBundle={hasPluginBundle}
      configRequirements={configRequirements}
      cliHelp={cliHelp}
      category={relatedCategory}
      categories={relatedCategories}
      staffVisibilityAlert={staffVisibilityAlert}
      securityAuditHref={
        latestVersion || githubBackedFields?.githubScanStatus
          ? buildSkillSecurityAuditHref(ownerParam ?? ownerHandle ?? "unknown", skill.slug)
          : undefined
      }
      overview={
        <SkillCatalogOverview
          changelog={latestVersion?.changelog}
          version={latestVersion?.version}
          slug={skill.slug}
          ownerHandle={ownerHandle}
          resolveHref={readmeHrefResolver}
        />
      }
      versionHistory={
        !isGitHubBackedSkill && (latestVersionId || canDeleteSkillVersions) ? (
          <SkillVersionHistory
            key={skill._id}
            skillId={skill._id}
            skillSlug={skill.slug}
            displayName={skill.displayName}
            ownerHandle={ownerHandle}
            latestVersionId={latestVersionId}
            latestTaggedVersionId={skill.tags.latest ?? null}
            canDeleteVersions={canDeleteSkillVersions}
            nixPlugin={Boolean(nixPlugin)}
          />
        ) : null
      }
      footer={
        <SkillRelatedSection
          category={relatedCategory}
          relatedSkills={relatedSkillsResult?.items ?? []}
          isLoading={shouldLoadRelatedSkills && relatedSkillsResult === undefined}
          variant="compact"
        />
      }
      activityTrend={activityTrend}
      newVersionHref={newVersionHref}
      settingsHref={settingsHref}
      showArchiveMetadata={!isGitHubBackedSkill}
      pageOverlays={
        <>
          <SkillReportDialog
            isOpen={isAuthenticated && isReportDialogOpen}
            isSubmitting={isSubmittingReport}
            reportReason={reportReason}
            reportError={reportError}
            onReasonChange={setReportReason}
            onCancel={closeReportDialog}
            onSubmit={() => void submitReport()}
          />
          <SkillPublishSuccessDialog
            isOpen={showPublishSuccessDialog}
            displayName={skill.displayName}
            skillPath={detailHref}
            skill={skill}
            publisher={
              owner
                ? {
                    displayName: owner.displayName,
                    handle: owner.handle ?? ownerHandle,
                    image: owner.image,
                    kind: owner.kind,
                  }
                : ownerHandle
                  ? { handle: ownerHandle }
                  : null
            }
            categoryLabel={relatedCategory?.label ?? null}
            onDismiss={onDismissPostPublish ?? (() => undefined)}
          />
        </>
      }
    >
      {nixSnippet ? (
        <Card>
          <h3 className="m-0 text-[length:var(--text-base)] font-semibold">Install via Nix</h3>
          <pre className="hero-install-code mt-2">{nixSnippet}</pre>
        </Card>
      ) : null}

      {configExample ? (
        <Card>
          <h3 className="m-0 text-[length:var(--text-base)] font-semibold">Config example</h3>
          <pre className="hero-install-code mt-2">{configExample}</pre>
        </Card>
      ) : null}

      <SkillDetailTabs
        activeTab={visibleTab}
        setActiveTab={setActiveTab}
        readmeContent={readmeContent}
        readmeError={displayedReadmeError}
        isPendingPublication={isPendingPublication}
        tabs={detailTabs}
        skill={skill}
        ownerHandle={ownerHandle}
        clawdis={clawdis}
        osLabels={osLabels}
        readmeHrefResolver={readmeHrefResolver}
        evaluationContent={
          skillEvaluation ? <SkillEvaluationReport result={skillEvaluation} /> : undefined
        }
      />
    </SkillDetailPageView>
  );
}
