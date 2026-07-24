import { useAuthActions } from "@convex-dev/auth/react";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  inferSkillCategories,
  resolveSkillCategories,
  type ClawdisSkillMetadata,
} from "clawhub-schema";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { getActivityTrendEndDay } from "../lib/activityTrend";
import {
  getUserFacingAuthError,
  isBannedAccountAuthError,
  routeToBannedAccountPage,
} from "../lib/authErrorMessage";
import { getSkillCategoriesForSkill, getSkillCategoryForSkill } from "../lib/categories";
import { getUserFacingConvexError } from "../lib/convexError";
import { buildSkillSecurityAuditHref } from "../lib/ownerRoute";
import { canManageSkill, isModerator } from "../lib/roles";
import { skillCardLoadKey } from "../lib/skillCards";
import type { SkillBySlugResult, SkillPageInitialData } from "../lib/skillPage";
import { resolveGitHubSkillReadmeHref } from "../lib/skillReadmeLinks";
import { clearAuthError, setAuthError } from "../lib/useAuthError";
import { useAuthStatus } from "../lib/useAuthStatus";
import { useDeferredSkillActivityTrend } from "../lib/useDeferredActivityTrend";
import { DetailBody, DetailPageShell } from "./DetailPageShell";
import { DetailSecuritySummary } from "./DetailSecuritySummary";
import { GenericNotFoundPage } from "./GenericNotFoundPage";
import { SkillDetailSkeleton } from "./skeletons/SkillDetailSkeleton";
import { SkillDetailTabs, type DetailTab } from "./SkillDetailTabs";
import {
  buildSkillHref,
  formatConfigSnippet,
  formatNixInstallSnippet,
  formatOsList,
  stripFrontmatter,
} from "./skillDetailUtils";
import { SkillHeader } from "./SkillHeader";
import { buildSkillInstallTabs } from "./SkillInstallCard";
import { SkillOwnershipPanel } from "./SkillOwnershipPanel";
import { SkillPublishSuccessDialog } from "./SkillPublishSuccessDialog";
import { SkillRelatedSection, type RelatedSkillEntry } from "./SkillRelatedSection";
import { SkillReportDialog } from "./SkillReportDialog";
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

type SkillFile = Doc<"skillVersions">["files"][number];
type SkillDetailVersion = NonNullable<NonNullable<SkillBySlugResult>["latestVersion"]> & {
  generatedSkillCard?: SkillFile | null;
};
type GitHubBackedSkillFields = {
  installKind?: "github";
  githubHasSkillCard?: boolean;
  githubScanStatus?: string | null;
};

function tabFromHash(hash: string): DetailTab {
  const normalized = hash.replace(/^#/, "").toLowerCase();
  if (normalized === "files") return "files";
  if (normalized === "skill-card" || normalized === "card") return "skill-card";
  if (normalized === "compare" || normalized === "diff") return "compare";
  if (normalized === "versions") return "versions";
  if (
    normalized === "runtime" ||
    normalized === "dependencies" ||
    normalized === "install" ||
    normalized === "links"
  ) {
    return normalized;
  }
  return "readme";
}

function isPostPublishSearchValue(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().replace(/^"|"$/g, "") : value;
  return normalized === "1" || normalized === "true" || normalized === 1 || normalized === true;
}

function hasPostPublishSearch(searchStr: string) {
  return isPostPublishSearchValue(new URLSearchParams(searchStr).get("published"));
}

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

  const toggleStar = useMutation(api.stars.toggle);
  const reportSkill = useMutation(api.skills.report);
  const updateSummary = useMutation(api.skills.updateSummary);
  const setCatalogMetadata = useMutation(api.skills.setCatalogMetadata);
  const getReadme = useAction(api.skills.getReadme);
  const getSkillCard = useAction(api.skills.getSkillCard);
  const myPublishers = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | Array<{ publisher: { _id: Id<"publishers"> }; role: string }>
    | undefined;

  const [readme, setReadme] = useState<string | null>(initialData?.readme ?? null);
  const [readmeError, setReadmeError] = useState<string | null>(initialData?.readmeError ?? null);
  const [loadedReadmeVersionId, setLoadedReadmeVersionId] = useState<Id<"skillVersions"> | null>(
    initialResult?.latestVersion?._id ?? null,
  );
  const [skillCard, setSkillCard] = useState<string | null>(null);
  const [skillCardError, setSkillCardError] = useState<string | null>(null);
  const [loadedSkillCardKey, setLoadedSkillCardKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("readme");
  const [shouldPrefetchCompare, setShouldPrefetchCompare] = useState(false);
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
  const owner = result?.owner ?? null;
  const latestVersion = (result?.latestVersion ?? null) as SkillDetailVersion | null;
  const latestVersionId = latestVersion?._id ?? null;
  const githubBackedFields = skill as GitHubBackedSkillFields | null | undefined;
  const isGitHubBackedSkill = githubBackedFields?.installKind === "github" && !latestVersionId;
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

  const versions = useQuery(
    api.skills.listVersions,
    skill && !isGitHubBackedSkill
      ? { skillId: skill._id, limit: activeTab === "versions" ? 50 : 2 }
      : "skip",
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
  const { trend: activityTrend, loading: activityTrendLoading } = useDeferredSkillActivityTrend(
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
  const githubSkillCard = useQuery(
    api.skills.getGitHubSkillContent,
    isGitHubBackedSkill && skill && githubBackedFields?.githubHasSkillCard !== false
      ? { skillId: skill._id, kind: "skill-card" }
      : "skip",
  ) as { path: string; text: string; sourceBaseUrl?: string } | null | undefined;
  const githubSourceBaseUrl = githubReadme?.sourceBaseUrl ?? githubSkillCard?.sourceBaseUrl;
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
  const latestFiles: SkillFile[] = latestVersion?.files ?? [];
  const skillCardFile = useMemo(
    () => latestVersion?.generatedSkillCard ?? null,
    [latestVersion?.generatedSkillCard],
  );
  const hasArchiveSkillCard = Boolean(skillCardFile);
  const hasSkillCard = hasArchiveSkillCard || Boolean(githubSkillCard);
  const displayedSkillCard = isGitHubBackedSkill ? (githubSkillCard?.text ?? null) : skillCard;
  const displayedSkillCardError = isGitHubBackedSkill
    ? githubSkillCard === null
      ? "No Skill Card available"
      : null
    : skillCardError;
  const currentSkillCardKey = useMemo(
    () => skillCardLoadKey(latestVersionId, skillCardFile),
    [latestVersionId, skillCardFile],
  );

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
      setActiveTab(tabFromHash(window.location.hash));
    };
    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => {
      window.removeEventListener("hashchange", syncTabFromHash);
    };
  }, []);

  // Set of tab IDs that are currently rendered — used to validate hash-driven
  // navigation so stale bookmarks fall back to readme rather than leaving the
  // content pane blank.
  const validTabIds = useMemo<Set<DetailTab>>(() => {
    const installTabs = buildSkillInstallTabs({ clawdis, osLabels });
    const baseTabs: DetailTab[] = isGitHubBackedSkill
      ? ["readme"]
      : ["readme", "files", "versions"];
    if (hasSkillCard) baseTabs.splice(1, 0, "skill-card");
    if (!isGitHubBackedSkill && (versions?.length ?? 0) > 1) baseTabs.push("compare");
    return new Set([...baseTabs, ...installTabs.map((t) => t.id)]);
  }, [clawdis, hasSkillCard, isGitHubBackedSkill, osLabels, versions]);

  useEffect(() => {
    setActiveTab((prev) => {
      const hashTab = typeof window === "undefined" ? "readme" : tabFromHash(window.location.hash);
      if (hashTab !== "readme" && validTabIds.has(hashTab)) return hashTab;
      return validTabIds.has(prev) ? prev : "readme";
    });
  }, [validTabIds]);

  useEffect(() => {
    let cancelled = false;
    if (!skill) {
      return () => {
        cancelled = true;
      };
    }
    if (!latestVersionId) {
      setReadme(null);
      setReadmeError(isGitHubBackedSkill ? null : "No SKILL.md available");
      setLoadedReadmeVersionId(null);
      return () => {
        cancelled = true;
      };
    }
    if (
      latestVersionId &&
      !(loadedReadmeVersionId === latestVersionId && (readme !== null || readmeError !== null))
    ) {
      setReadme(null);
      setReadmeError(null);
      setLoadedReadmeVersionId(latestVersionId);

      void getReadme({ versionId: latestVersionId })
        .then((data) => {
          if (cancelled) return;
          setReadme(data.text);
          setLoadedReadmeVersionId(latestVersionId);
        })
        .catch((error) => {
          if (cancelled) return;
          setReadmeError(error instanceof Error ? error.message : "Failed to load README");
          setReadme(null);
          setLoadedReadmeVersionId(latestVersionId);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    getReadme,
    isGitHubBackedSkill,
    latestVersionId,
    loadedReadmeVersionId,
    readme,
    readmeError,
    skill,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!latestVersionId || !hasArchiveSkillCard || !currentSkillCardKey) {
      setSkillCard(null);
      setSkillCardError(null);
      setLoadedSkillCardKey(currentSkillCardKey);
      return () => {
        cancelled = true;
      };
    }
    if (
      loadedSkillCardKey === currentSkillCardKey &&
      (skillCard !== null || skillCardError !== null)
    ) {
      return () => {
        cancelled = true;
      };
    }

    setSkillCard(null);
    setSkillCardError(null);
    setLoadedSkillCardKey(currentSkillCardKey);
    void getSkillCard({ versionId: latestVersionId })
      .then((data) => {
        if (cancelled) return;
        setSkillCard(data.text);
        setLoadedSkillCardKey(currentSkillCardKey);
      })
      .catch((error) => {
        if (cancelled) return;
        setSkillCardError(error instanceof Error ? error.message : "Failed to load Skill Card");
        setSkillCard(null);
        setLoadedSkillCardKey(currentSkillCardKey);
      });

    return () => {
      cancelled = true;
    };
  }, [
    getSkillCard,
    currentSkillCardKey,
    hasArchiveSkillCard,
    latestVersionId,
    loadedSkillCardKey,
    skillCard,
    skillCardError,
  ]);

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

  const handleToggleStar = async () => {
    if (!skill) return;
    const activeStar = activeOptimisticStar;
    const baselineStarred = activeStar?.baselineStarred ?? Boolean(effectiveIsStarred);
    const previousIsStarred = Boolean(effectiveIsStarred);
    const baselineStars = activeStar?.baselineStars ?? skill.stats.stars ?? 0;

    try {
      const starResult = (await toggleStar({ skillId: skill._id })) as { starred: boolean };
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
    void signIn("github", redirectTo ? { redirectTo } : undefined).catch((error) => {
      const message = getUserFacingAuthError(error, "Sign in failed. Please try again.");
      if (isBannedAccountAuthError(message)) {
        routeToBannedAccountPage();
        return;
      }
      setAuthError(message);
    });
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

  const githubScanStatus =
    !latestVersion && (displayedSkill as GitHubBackedSkillFields).installKind === "github"
      ? (displayedSkill as GitHubBackedSkillFields).githubScanStatus
      : null;
  const securitySummary =
    latestVersion || githubScanStatus ? (
      <DetailSecuritySummary
        auditHref={buildSkillSecurityAuditHref(ownerParam ?? ownerHandle ?? "unknown", skill.slug)}
        vtAnalysis={latestVersion?.vtAnalysis ?? null}
        llmAnalysis={latestVersion?.llmAnalysis ?? null}
        githubScanStatus={githubScanStatus}
        suppressScanResults={suppressVersionScanResults}
      />
    ) : null;
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
              settingsPanel
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
    <main className="section detail-page-section skill-detail-page">
      <DetailPageShell>
        <SkillHeader
          skill={displayedSkill}
          owner={owner}
          ownerHandle={ownerHandle}
          latestVersion={latestVersion}
          modInfo={modInfo}
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
          clawdis={clawdis}
          category={relatedCategory}
          categories={relatedCategories}
          staffVisibilityAlert={staffVisibilityAlert}
          securityAuditSummary={securitySummary}
          activityTrend={activityTrend}
          activityTrendLoading={activityTrendLoading}
          newVersionHref={newVersionHref}
          settingsHref={settingsHref}
          showArchiveMetadata={!isGitHubBackedSkill}
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
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onCompareIntent={() => setShouldPrefetchCompare(true)}
            readmeContent={readmeContent}
            readmeError={displayedReadmeError}
            skillCardContent={displayedSkillCard}
            skillCardError={displayedSkillCardError}
            hasSkillCard={hasSkillCard}
            latestFiles={latestFiles}
            latestVersionId={latestVersion?._id ?? null}
            latestVersion={latestVersion?.version ?? null}
            canDeleteVersions={canDeleteSkillVersions}
            skill={skill as Doc<"skills">}
            ownerHandle={ownerHandle}
            diffVersions={diffVersions}
            versions={versions}
            nixPlugin={Boolean(nixPlugin)}
            showArchiveTabs={!isGitHubBackedSkill}
            suppressVersionScanResults={suppressVersionScanResults}
            scanResultsSuppressedMessage={scanResultsSuppressedMessage}
            clawdis={clawdis}
            osLabels={osLabels}
            readmeHrefResolver={readmeHrefResolver}
          />
          <SkillRelatedSection
            category={relatedCategory}
            relatedSkills={relatedSkillsResult?.items ?? []}
            isLoading={shouldLoadRelatedSkills && relatedSkillsResult === undefined}
            variant="compact"
          />
        </SkillHeader>
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
    </main>
  );
}
