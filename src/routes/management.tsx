import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  GitBranch,
  Megaphone,
  PackageSearch,
  Plug,
  UserRound,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ManagementSkeleton } from "../components/skeletons/ProtectedPageSkeletons";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import { isAdmin, isModerator } from "../lib/roles";
import { useAuthStatus } from "../lib/useAuthStatus";
import {
  AbusePage,
  canBanPublisherAbuseOwner,
  comparePublisherAbuseItems,
  filterPublisherAbuseItems,
  filterPublisherAbuseSignals,
  getPublisherAbuseItemsForTab,
  getPublisherAbuseVisiblePendingItems,
} from "./-management/AbusePage";
import { DuplicatesPage } from "./-management/DuplicatesPage";
import {
  formatManagementUserLabel,
  formatMutationError,
  formatWholeNumber,
  SKILL_AUDIT_LOG_LIMIT,
  type DuplicateCandidateEntry,
  type ManagementOwnerOption,
  type ManagementUserListResult,
  type ManagementView,
  type PluginByNameResult,
  type PublisherAbuseSignalEntry,
  type PublisherAbuseReviewItem,
  type PublisherAbuseSignalStatus,
  type PublisherAbuseTab,
  type PromotionEntry,
  type PromotionInput,
  type PromotionStatus,
  type RecentVersionEntry,
  type ReportedSkillEntry,
  type SkillBySlugResult,
  USER_BAN_REASON_MAX_LENGTH,
} from "./-management/managementShared";
import { PluginsPage } from "./-management/PluginsPage";
import { PromotionsPage } from "./-management/PromotionsPage";
import { RecentPushesPage } from "./-management/RecentPushesPage";
import { ReportsPage } from "./-management/ReportsPage";
import { SkillsPage } from "./-management/SkillsPage";
import { UsersPage } from "./-management/UsersPage";

const MANAGEMENT_VIEWS = new Set<string>([
  "overview",
  "abuse",
  "reports",
  "users",
  "publishers",
  "skills",
  "plugins",
  "promotions",
  "duplicates",
  "recent",
  "audit",
  "system",
  "settings",
]);

function isManagementView(value: unknown): value is ManagementView {
  return typeof value === "string" && MANAGEMENT_VIEWS.has(value);
}

const PUBLISHER_ABUSE_TABS = new Set<string>([
  "potential_ban_candidate",
  "review",
  "all_pending",
  "resolved",
  "signals",
]);

function isPublisherAbuseTab(value: unknown): value is PublisherAbuseTab {
  return typeof value === "string" && PUBLISHER_ABUSE_TABS.has(value);
}

type ManagementConfirmRequest = {
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  reason?: {
    label: string;
    placeholder?: string;
    required?: boolean;
    maxLength?: number;
  };
  onConfirm: (reason: string | undefined) => void;
};

// Convex `useQuery` returns undefined while a new query (e.g. a changed search arg)
// is in flight. Keep the previous result visible during that window so search-driven
// lists do not blank out to a loading state on every keystroke.
function useStableQuery<T>(value: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(value);
  if (value !== undefined) ref.current = value;
  return ref.current;
}

function ManagementConfirmDialog({
  request,
  onClose,
}: {
  request: ManagementConfirmRequest | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    setReason("");
  }, [request]);

  const reasonRequired = request?.reason?.required ?? false;
  const canConfirm = !reasonRequired || reason.trim().length > 0;

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="management-confirm">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          {request?.body ? <DialogDescription>{request.body}</DialogDescription> : null}
        </DialogHeader>
        {request?.reason ? (
          <label className="management-confirm-field">
            <span>{request.reason.label}</span>
            <Textarea
              autoFocus
              rows={3}
              maxLength={request.reason.maxLength}
              placeholder={request.reason.placeholder}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={request?.destructive ? "destructive" : "primary"}
            disabled={!canConfirm}
            onClick={() => {
              request?.onConfirm(reason.trim() || undefined);
              onClose();
            }}
          >
            {request?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Route = createFileRoute("/management")({
  validateSearch: (search) => {
    const validated: {
      skill?: string;
      plugin?: string;
      view?: ManagementView;
      tab?: PublisherAbuseTab;
    } = {};
    if (typeof search.skill === "string" && search.skill.trim()) {
      validated.skill = search.skill;
    }
    if (typeof search.plugin === "string" && search.plugin.trim()) {
      validated.plugin = search.plugin;
    }
    if (isManagementView(search.view)) {
      validated.view = search.view;
    }
    if (isPublisherAbuseTab(search.tab)) {
      validated.tab = search.tab;
    }
    return validated;
  },
  component: Management,
});

export function Management() {
  const { isLoading: isAuthLoading, me } = useAuthStatus();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const staff = isModerator(me);
  const admin = isAdmin(me);

  const selectedSlug = search.skill?.trim();
  const selectedPluginName = search.plugin?.trim();
  const activeView = resolveManagementView(search.view, selectedSlug, selectedPluginName);
  const abuseViewActive = activeView === "abuse";
  const selectedSkill = useQuery(
    api.skills.getBySlugForStaff,
    staff && selectedSlug ? { slug: selectedSlug, auditLogLimit: SKILL_AUDIT_LOG_LIMIT } : "skip",
  ) as SkillBySlugResult | undefined;
  const selectedPlugin = useQuery(
    api.packages.getByNameForStaff,
    staff && selectedPluginName ? { name: selectedPluginName } : "skip",
  ) as PluginByNameResult | undefined;
  const selectedSkillId = selectedSkill?.skill?._id ?? null;
  const recentVersions = useQuery(api.skills.listRecentVersions, staff ? { limit: 20 } : "skip") as
    | RecentVersionEntry[]
    | undefined;
  const reportedSkills = useQuery(api.skills.listReportedSkills, staff ? { limit: 25 } : "skip") as
    | ReportedSkillEntry[]
    | undefined;
  const duplicateCandidates = useQuery(
    api.skills.listDuplicateCandidates,
    staff ? { limit: 20 } : "skip",
  ) as DuplicateCandidateEntry[] | undefined;
  const publisherAbuseDashboard = useQuery(
    api.publisherAbuse.listReviewDashboard,
    staff && abuseViewActive ? { limit: 25 } : "skip",
  );
  const publisherAbuseAutobanSetting = useQuery(
    api.publisherAbuse.getPublisherAbuseAutobanSetting,
    staff && abuseViewActive ? {} : "skip",
  );

  const {
    results: promotionResults,
    status: promotionPageStatus,
    loadMore: loadMorePromotions,
  } = usePaginatedQuery(
    api.promotions.listForStaff,
    admin && activeView === "promotions" ? {} : "skip",
    { initialNumItems: 25 },
  );
  const promotions =
    promotionPageStatus === "LoadingFirstPage" ? undefined : (promotionResults as PromotionEntry[]);
  const createPromotion = useMutation(api.promotions.create);
  const updatePromotion = useMutation(api.promotions.update);
  const setPromotionStatus = useMutation(api.promotions.setStatus);
  const setRole = useMutation(api.users.setRole);
  const banUser = useMutation(api.users.banUser);
  const unbanUser = useMutation(api.users.unbanUser);
  const setBatch = useMutation(api.skills.setBatch);
  const setPackageBatch = useMutation(api.packages.setBatch);
  const setSoftDeleted = useMutation(api.skills.setSoftDeleted);
  const hardDelete = useMutation(api.skills.hardDelete);
  const changeOwner = useMutation(api.skills.changeOwner);
  const setDuplicate = useMutation(api.skills.setDuplicate);
  const setOfficialBadge = useMutation(api.skills.setOfficialBadge);
  const setDeprecatedBadge = useMutation(api.skills.setDeprecatedBadge);
  const setSkillManualOverride = useMutation(api.skills.setSkillManualOverride);
  const clearSkillManualOverride = useMutation(api.skills.clearSkillManualOverride);
  const banPublisherAbuseOwnerMutation = useMutation(api.publisherAbuse.banPublisherAbuseOwner);
  const markPublisherAbuseNominationReviewed = useMutation(
    api.publisherAbuse.markPublisherAbuseNominationReviewed,
  );
  const setPublisherAbuseAutobanEnabled = useMutation(
    api.publisherAbuse.setPublisherAbuseAutobanEnabled,
  );
  const snoozePublisherAbuseSignal = useMutation(api.publisherAbuse.snoozePublisherAbuseSignal);
  const dismissPublisherAbuseSignal = useMutation(api.publisherAbuse.dismissPublisherAbuseSignal);
  const reopenPublisherAbuseSignal = useMutation(api.publisherAbuse.reopenPublisherAbuseSignal);
  const startPublisherAbuseScoreRun = useAction(api.publisherAbuse.startPublisherAbuseScoreRun);
  const startPublisherAbuseSignalScan = useAction(
    api.publisherAbuseTemporalScan.startPublisherAbuseSignalScan,
  );

  const [selectedDuplicate, setSelectedDuplicate] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<Id<"users"> | "">("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportSearchDebounced, setReportSearchDebounced] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userSearchDebounced, setUserSearchDebounced] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");
  const [ownerSearchDebounced, setOwnerSearchDebounced] = useState("");
  const [pluginSearch, setPluginSearch] = useState(selectedPluginName ?? "");
  const [skillSearch, setSkillSearch] = useState(selectedSlug ?? "");
  const [skillOverrideNote, setSkillOverrideNote] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<ManagementConfirmRequest | null>(null);
  const [publisherAbuseTab, setPublisherAbuseTab] = useState<PublisherAbuseTab>(
    abuseViewActive ? (search.tab ?? "potential_ban_candidate") : "potential_ban_candidate",
  );
  const [publisherAbuseSearch, setPublisherAbuseSearch] = useState("");
  const [publisherAbuseNotes, setPublisherAbuseNotes] = useState("");
  const [publisherAbuseSignalStatus, setPublisherAbuseSignalStatus] =
    useState<PublisherAbuseSignalStatus>("open");
  const [selectedPublisherAbuseNominationId, setSelectedPublisherAbuseNominationId] =
    useState<Id<"publisherAbuseReviewNominations"> | null>(null);
  const {
    results: publisherAbusePageResults,
    status: publisherAbusePageStatus,
    loadMore: loadMorePublisherAbuseItems,
  } = usePaginatedQuery(
    api.publisherAbuse.listReviewItemsPage,
    staff && abuseViewActive && publisherAbuseTab !== "signals"
      ? { tab: publisherAbuseTab }
      : "skip",
    { initialNumItems: 25 },
  );
  const {
    results: publisherAbuseSignalPageResults,
    status: publisherAbuseSignalPageStatus,
    loadMore: loadMorePublisherAbuseSignals,
  } = usePaginatedQuery(
    api.publisherAbuse.listSignalsPage,
    staff && abuseViewActive && publisherAbuseTab === "signals"
      ? { reviewStatus: publisherAbuseSignalStatus }
      : "skip",
    { initialNumItems: 25 },
  );

  const userQuery = userSearchDebounced.trim();
  const userResult = useStableQuery(
    useQuery(
      api.users.list,
      admin && activeView === "users" ? { limit: 200, search: userQuery || undefined } : "skip",
    ) as ManagementUserListResult | undefined,
  );
  const ownerQuery = ownerSearchDebounced.trim();
  const ownerResult = useStableQuery(
    useQuery(
      api.users.list,
      admin && activeView === "skills" ? { limit: 200, search: ownerQuery || undefined } : "skip",
    ) as ManagementUserListResult | undefined,
  );
  const selectedPublisherAbuseDetail = useQuery(
    api.publisherAbuse.getReviewNominationDetail,
    staff && abuseViewActive && selectedPublisherAbuseNominationId
      ? { nominationId: selectedPublisherAbuseNominationId }
      : "skip",
  );

  const selectedOwnerUserId = selectedSkill?.skill?.ownerUserId ?? null;
  const selectedCanonicalSlug = selectedSkill?.canonical?.skill?.slug ?? "";
  const publisherAbuseDashboardFallbackItems = useMemo(
    () =>
      publisherAbuseDashboard
        ? getPublisherAbuseItemsForTab(publisherAbuseDashboard, publisherAbuseTab)
        : [],
    [publisherAbuseDashboard, publisherAbuseTab],
  );
  const publisherAbusePageItems = (publisherAbusePageResults ?? []) as PublisherAbuseReviewItem[];
  const publisherAbuseSignalItems = (publisherAbuseSignalPageResults ??
    []) as PublisherAbuseSignalEntry[];
  const publisherAbuseItemsForTab =
    publisherAbusePageItems.length > 0 || publisherAbuseDashboardFallbackItems.length === 0
      ? publisherAbusePageItems
      : publisherAbuseDashboardFallbackItems;
  const filteredPublisherAbuseItems = useMemo(() => {
    const filtered = filterPublisherAbuseItems(publisherAbuseItemsForTab, publisherAbuseSearch);
    if (publisherAbuseTab === "resolved") return filtered;
    return filtered.sort(comparePublisherAbuseItems);
  }, [publisherAbuseItemsForTab, publisherAbuseSearch, publisherAbuseTab]);
  const fallbackSelectedPublisherAbuseItem =
    publisherAbuseItemsForTab.find(
      (item) => item.nomination._id === selectedPublisherAbuseNominationId,
    ) ?? null;
  const selectedPublisherAbuseItem =
    selectedPublisherAbuseDetail?.item ?? fallbackSelectedPublisherAbuseItem;
  const filteredPublisherAbuseSignals = useMemo(
    () => filterPublisherAbuseSignals(publisherAbuseSignalItems, publisherAbuseSearch),
    [publisherAbuseSignalItems, publisherAbuseSearch],
  );

  useEffect(() => {
    if (!selectedSkillId || !selectedOwnerUserId) return;
    setSelectedDuplicate(selectedCanonicalSlug);
    setSelectedOwner(selectedOwnerUserId);
  }, [selectedCanonicalSlug, selectedOwnerUserId, selectedSkillId]);

  useEffect(() => {
    setSkillOverrideNote("");
  }, [selectedSkillId]);

  useEffect(() => {
    setPluginSearch(selectedPluginName ?? "");
  }, [selectedPluginName]);

  useEffect(() => {
    setSkillSearch(selectedSlug ?? "");
  }, [selectedSlug]);

  useEffect(() => {
    if (!abuseViewActive) return;
    const nextTab = search.tab ?? "potential_ban_candidate";
    setPublisherAbuseTab(nextTab);
    if (nextTab === "signals") {
      setPublisherAbuseNotes("");
      setSelectedPublisherAbuseNominationId(null);
    }
  }, [abuseViewActive, search.tab]);

  useEffect(() => {
    const handle = setTimeout(() => setReportSearchDebounced(reportSearch), 250);
    return () => clearTimeout(handle);
  }, [reportSearch]);

  useEffect(() => {
    const handle = setTimeout(() => setUserSearchDebounced(userSearch), 250);
    return () => clearTimeout(handle);
  }, [userSearch]);

  useEffect(() => {
    const handle = setTimeout(() => setOwnerSearchDebounced(ownerSearch), 250);
    return () => clearTimeout(handle);
  }, [ownerSearch]);

  // Detail opens in a drawer on row click. If the selected nomination leaves the
  // current tab/filter, close the drawer rather than auto-opening another one.
  useEffect(() => {
    if (!selectedPublisherAbuseNominationId) return;
    const stillVisible = filteredPublisherAbuseItems.some(
      (item) => item.nomination._id === selectedPublisherAbuseNominationId,
    );
    if (!stillVisible) {
      setPublisherAbuseNotes("");
      setSelectedPublisherAbuseNominationId(null);
    }
  }, [filteredPublisherAbuseItems, selectedPublisherAbuseNominationId]);

  useEffect(() => {
    setPublisherAbuseNotes("");
  }, [selectedPublisherAbuseNominationId]);

  if (isAuthLoading) {
    return <ManagementSkeleton />;
  }

  if (!staff) {
    return (
      <main className="section">
        <Card>Management only.</Card>
      </main>
    );
  }

  const reportQuery = reportSearchDebounced.trim().toLowerCase();
  const filteredReportedSkills = reportedSkills?.filter((entry) => {
    if (!reportQuery) return true;
    const reportReasons = (entry.reports ?? []).map((report) => report.reason).join(" ");
    const reporterHandles = (entry.reports ?? [])
      .map((report) => report.reporterHandle)
      .filter(Boolean)
      .join(" ");
    const haystack = [
      entry.skill.displayName,
      entry.skill.slug,
      entry.owner?.handle,
      entry.owner?.name,
      reportReasons,
      reporterHandles,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(reportQuery);
  });
  const reportCountLabel =
    filteredReportedSkills?.length === 0 && (reportedSkills?.length ?? 0) > 0
      ? "No matching reports."
      : "No reports yet.";
  const reportSummary = reportedSkills
    ? `Showing ${filteredReportedSkills?.length ?? 0} of ${reportedSkills.length}`
    : "Loading reports…";

  const filteredUsers = userResult?.items ?? [];
  const userTotal = userResult?.total ?? 0;
  const userSummary = userResult
    ? `Showing ${filteredUsers.length} of ${userTotal}`
    : "Loading users…";
  const ownerUsers = ownerResult?.items ?? [];
  const selectedOwnerOption: ManagementOwnerOption | null = selectedSkill?.owner?.linkedUserId
    ? {
        userId: selectedSkill.owner.linkedUserId,
        label: `@${selectedSkill.owner.handle ?? selectedSkill.owner.displayName ?? "user"}`,
      }
    : null;
  const ownerUserOptions: ManagementOwnerOption[] = ownerUsers.map((user) => ({
    userId: user._id,
    label: formatManagementUserLabel(user, user._id),
  }));
  const ownerOptions =
    selectedOwnerOption &&
    !ownerUserOptions.some((option) => option.userId === selectedOwnerOption.userId)
      ? [selectedOwnerOption, ...ownerUserOptions]
      : ownerUserOptions;
  const ownerSummary = ownerResult
    ? `Showing ${ownerOptions.length} of ${Math.max(ownerResult.total, ownerOptions.length)}`
    : "Loading owners…";
  const userEmptyLabel = userResult
    ? filteredUsers.length === 0
      ? userQuery
        ? "No matching users."
        : "No users yet."
      : ""
    : "Loading users…";

  const applySkillOverride = () => {
    if (!selectedSkill?.skill) return;
    void setSkillManualOverride({
      skillId: selectedSkill.skill._id,
      note: skillOverrideNote,
    })
      .then(() => {
        setSkillOverrideNote("");
        toast.success("Skill marked okay.");
      })
      .catch((error) => toast.error(formatMutationError(error)));
  };

  const clearSkillOverride = () => {
    if (!selectedSkill?.skill?.manualOverride) return;
    void clearSkillManualOverride({
      skillId: selectedSkill.skill._id,
      note: skillOverrideNote,
    })
      .then(() => {
        setSkillOverrideNote("");
        toast.success("Override cleared.");
      })
      .catch((error) => toast.error(formatMutationError(error)));
  };

  const managePlugin = () => {
    const name = pluginSearch.trim();
    if (!name) return;
    void navigate({
      to: "/management",
      search: { view: "plugins", skill: undefined, plugin: name },
    });
  };
  const manageSkill = () => {
    const slug = skillSearch.trim();
    if (!slug) return;
    void navigate({
      to: "/management",
      search: { view: "skills", skill: slug, plugin: undefined },
    });
  };
  const requestBanUser = (userId: Id<"users">, label: string) => {
    setConfirmRequest({
      title: `Ban ${label}?`,
      body: "Hides their skills and personal package/plugin resources, and revokes package publish tokens.",
      confirmLabel: "Ban user",
      destructive: true,
      reason: {
        label: "Reason (optional)",
        placeholder: "Why are you banning this user?",
        maxLength: USER_BAN_REASON_MAX_LENGTH,
      },
      onConfirm: (reason) => {
        void banUser({ userId, reason })
          .then(() => toast.success(`Banned ${label}.`))
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const requestUnbanUser = (userId: Id<"users">, label: string) => {
    setConfirmRequest({
      title: `Unban ${label}?`,
      body: "Restores eligible skills and ban-hidden personal package/plugin resources.",
      confirmLabel: "Unban user",
      reason: {
        label: "Reason (optional)",
        placeholder: "Why are you unbanning this user?",
        maxLength: USER_BAN_REASON_MAX_LENGTH,
      },
      onConfirm: (reason) => {
        void unbanUser({ userId, reason })
          .then(() => toast.success(`Unbanned ${label}.`))
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const requestToggleSkillHidden = (skill: Doc<"skills">) => {
    const hide = !skill.softDeletedAt;
    setConfirmRequest({
      title: hide ? `Hide ${skill.displayName}?` : `Restore ${skill.displayName}?`,
      confirmLabel: hide ? "Hide skill" : "Restore skill",
      destructive: hide,
      reason: {
        label: "Reason",
        placeholder: hide ? "Why hide this skill?" : "Why restore this skill?",
        required: true,
      },
      onConfirm: (reason) => {
        void setSoftDeleted({
          skillId: skill._id,
          deleted: hide,
          reason: reason ?? "",
        })
          .then(() => toast.success(hide ? "Skill hidden." : "Skill restored."))
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const requestHardDeleteSkill = (skill: Doc<"skills">) => {
    setConfirmRequest({
      title: `Hard delete ${skill.displayName}?`,
      body: "This permanently removes the skill and its history. It cannot be undone.",
      confirmLabel: "Hard delete",
      destructive: true,
      onConfirm: () => {
        void hardDelete({ skillId: skill._id })
          .then(() => toast.success("Skill hard-deleted."))
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const banPublisherAbuseOwner = (item: PublisherAbuseReviewItem) => {
    const ownerUser = item.ownerUser;
    if (!ownerUser || !canBanPublisherAbuseOwner(item, me?._id ?? null)) return;
    const label = `@${ownerUser.handle ?? ownerUser.name ?? item.nomination.handleSnapshot}`;
    // The review notes box above the Ban button is the ban reason — no separate prompt.
    const reason = publisherAbuseNotes.trim() || undefined;
    setConfirmRequest({
      title: `Ban ${label}?`,
      body: "Hides their skills and personal package/plugin resources, and revokes package publish tokens.",
      confirmLabel: "Ban user",
      destructive: true,
      onConfirm: () => {
        void banPublisherAbuseOwnerMutation({
          nominationId: item.nomination._id,
          expectedLatestScoreId: item.nomination.latestScoreId,
          expectedUpdatedAt: item.nomination.updatedAt,
          reason,
        })
          .then(() => {
            toast.success(`Banned ${label}.`);
            setPublisherAbuseNotes("");
            setSelectedPublisherAbuseNominationId(null);
          })
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const requestSnoozePublisherAbuseSignal = (item: PublisherAbuseSignalEntry) => {
    setConfirmRequest({
      title: `Snooze ${item.signal.skillDisplayName}?`,
      body: "Hides this signal for at least 14 days and acknowledges the evidence shown now. It reopens only if fresh activity crosses the lower repeat threshold.",
      confirmLabel: "Snooze 14 days",
      reason: {
        label: "Note (optional)",
        placeholder: "Why are you snoozing this signal?",
      },
      onConfirm: (note) => {
        void snoozePublisherAbuseSignal({ signalId: item.signal._id, note, days: 14 })
          .then(() => toast.success("Signal snoozed."))
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const requestMarkPublisherAbuseNominationReviewed = (item: PublisherAbuseReviewItem) => {
    const label = item.nomination.handleSnapshot;
    const note = publisherAbuseNotes.trim() || undefined;
    setConfirmRequest({
      title: `Mark ${label} reviewed?`,
      body: "Removes this nomination from the active abuse queue without banning the user. The score and review note stay in the resolved history.",
      confirmLabel: "Mark reviewed",
      onConfirm: () => {
        void markPublisherAbuseNominationReviewed({
          nominationId: item.nomination._id,
          expectedLatestScoreId: item.nomination.latestScoreId,
          expectedUpdatedAt: item.nomination.updatedAt,
          note,
        })
          .then(() => {
            toast.success("Nomination marked reviewed.");
            setPublisherAbuseNotes("");
            setSelectedPublisherAbuseNominationId(null);
          })
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const requestDismissPublisherAbuseSignal = (item: PublisherAbuseSignalEntry) => {
    setConfirmRequest({
      title: `Dismiss ${item.signal.skillDisplayName}?`,
      body: "Dismissed signals stay archived but are hidden from the default review queue and will not notify Hermit unless reopened.",
      confirmLabel: "Dismiss signal",
      destructive: true,
      reason: {
        label: "Note (optional)",
        placeholder: "Why are you dismissing this signal?",
      },
      onConfirm: (note) => {
        void dismissPublisherAbuseSignal({ signalId: item.signal._id, note })
          .then(() => toast.success("Signal dismissed."))
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const requestReopenPublisherAbuseSignal = (item: PublisherAbuseSignalEntry) => {
    setConfirmRequest({
      title: `Reopen ${item.signal.skillDisplayName}?`,
      body: "Returns this signal to the default review queue and queues a Hermit digest notification.",
      confirmLabel: "Reopen signal",
      reason: {
        label: "Note (optional)",
        placeholder: "Why are you reopening this signal?",
      },
      onConfirm: (note) => {
        void reopenPublisherAbuseSignal({ signalId: item.signal._id, note })
          .then(() => toast.success("Signal reopened."))
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  const handleCreatePromotion = (input: PromotionInput) =>
    createPromotion(input)
      .then(() => {
        toast.success("Promotion created as draft.");
        return true;
      })
      .catch((error) => {
        toast.error(formatMutationError(error));
        return false;
      });

  const handleUpdatePromotion = (targetSlug: string, input: PromotionInput) =>
    updatePromotion({ targetSlug, ...input })
      .then(() => {
        toast.success("Promotion updated.");
        return true;
      })
      .catch((error) => {
        toast.error(formatMutationError(error));
        return false;
      });

  const handleSetPromotionStatus = (slug: string, status: PromotionStatus) => {
    const apply = () => {
      void setPromotionStatus({ slug, status })
        .then(() => toast.success(`Promotion "${slug}" is now ${status}.`))
        .catch((error) => toast.error(formatMutationError(error)));
    };
    if (status === "active") {
      setConfirmRequest({
        title: `Activate "${slug}"?`,
        body: "Active promotions inside their window are served publicly to every OpenClaw CLI.",
        confirmLabel: "Activate promotion",
        onConfirm: apply,
      });
      return;
    }
    apply();
  };

  const requestTogglePublisherAbuseAutoban = () => {
    if (!publisherAbuseAutobanSetting) return;
    const nextEnabled = !publisherAbuseAutobanSetting.enabled;
    setConfirmRequest({
      title: nextEnabled ? "Turn on auto-ban?" : "Turn off auto-ban?",
      body: nextEnabled
        ? "Scheduled publisher abuse sweeps will resume warning and banning potential-ban candidates."
        : "Scheduled publisher abuse sweeps will stop warning or banning candidates. Manual bans stay available.",
      confirmLabel: nextEnabled ? "Turn on auto-ban now" : "Turn off auto-ban now",
      destructive: !nextEnabled,
      onConfirm: () => {
        void setPublisherAbuseAutobanEnabled({ enabled: nextEnabled })
          .then(() => {
            toast.success(nextEnabled ? "Auto-ban turned on." : "Auto-ban turned off.");
          })
          .catch((error) => toast.error(formatMutationError(error)));
      },
    });
  };

  return (
    <main className="management-shell">
      <ManagementSidebar
        activeView={activeView}
        admin={admin}
        abuseCount={
          publisherAbuseDashboard
            ? getPublisherAbuseVisiblePendingItems(publisherAbuseDashboard).length
            : undefined
        }
        duplicateCount={duplicateCandidates?.length}
        recentCount={recentVersions?.length}
        reportCount={reportedSkills?.length}
        userCount={userResult ? userTotal : undefined}
      />
      <section className="management-main">
        <div className="management-breadcrumb">
          <span>Management</span>
          <ChevronRight size={13} aria-hidden="true" />
          <strong>{formatManagementViewLabel(activeView)}</strong>
        </div>

        {activeView === "abuse" ? (
          <AbusePage
            admin={admin}
            autobanSetting={publisherAbuseAutobanSetting}
            currentUserId={me?._id ?? null}
            dashboard={publisherAbuseDashboard}
            detail={selectedPublisherAbuseDetail}
            items={filteredPublisherAbuseItems}
            pageStatus={publisherAbusePageStatus}
            notes={publisherAbuseNotes}
            search={publisherAbuseSearch}
            selectedItem={selectedPublisherAbuseItem}
            selectedNominationId={selectedPublisherAbuseNominationId}
            signalItems={filteredPublisherAbuseSignals}
            signalLoadedCount={publisherAbuseSignalItems.length}
            signalPageStatus={publisherAbuseSignalPageStatus}
            signalStatus={publisherAbuseSignalStatus}
            tab={publisherAbuseTab}
            onBanOwner={banPublisherAbuseOwner}
            onChangeNotes={setPublisherAbuseNotes}
            onChangeSearch={setPublisherAbuseSearch}
            onChangeSignalStatus={setPublisherAbuseSignalStatus}
            onChangeTab={(nextTab) => {
              setPublisherAbuseTab(nextTab);
              if (nextTab === "signals") {
                setPublisherAbuseNotes("");
                setSelectedPublisherAbuseNominationId(null);
              }
              void navigate({
                to: "/management",
                search: {
                  view: "abuse",
                  tab: nextTab,
                  skill: undefined,
                  plugin: undefined,
                },
              });
            }}
            onToggleAutoban={requestTogglePublisherAbuseAutoban}
            onDismissSignal={requestDismissPublisherAbuseSignal}
            onMarkReviewed={requestMarkPublisherAbuseNominationReviewed}
            onLoadMore={() => {
              if (publisherAbuseTab === "signals") {
                loadMorePublisherAbuseSignals(25);
              } else {
                loadMorePublisherAbuseItems(25);
              }
            }}
            onRefresh={() => {
              if (publisherAbuseTab === "signals") {
                setConfirmRequest({
                  title: "Rescan publisher abuse signals?",
                  body: "Re-checks every active skill for all download/install signal types and refreshes the Signals tab. This can take a while.",
                  confirmLabel: "Run signal scan",
                  onConfirm: () => {
                    void startPublisherAbuseSignalScan({})
                      .then((result) =>
                        toast.success(
                          "alreadyRunning" in result && result.alreadyRunning
                            ? "Signal scan is already running."
                            : "Signal scan started.",
                        ),
                      )
                      .catch((error) => toast.error(formatMutationError(error)));
                  },
                });
                return;
              }
              setConfirmRequest({
                title: "Run a new abuse scan?",
                body: "Re-scores every publisher in the catalog against the latest model. This normally runs automatically every few days; a manual run can take a while.",
                confirmLabel: "Run scan",
                onConfirm: () => {
                  void startPublisherAbuseScoreRun({})
                    .then(() => toast.success("Scan started."))
                    .catch((error) => toast.error(formatMutationError(error)));
                },
              });
            }}
            onClose={() => {
              setPublisherAbuseNotes("");
              setSelectedPublisherAbuseNominationId(null);
            }}
            onReopenSignal={requestReopenPublisherAbuseSignal}
            onSelect={(nominationId) => {
              setPublisherAbuseNotes("");
              setSelectedPublisherAbuseNominationId(nominationId);
            }}
            onSnoozeSignal={requestSnoozePublisherAbuseSignal}
          />
        ) : null}

        {activeView === "reports" ? (
          <ReportsPage
            admin={admin}
            items={filteredReportedSkills}
            reportCountLabel={reportCountLabel}
            search={reportSearch}
            summary={reportSummary}
            onChangeSearch={setReportSearch}
            onHardDeleteSkill={requestHardDeleteSkill}
            onToggleSkillHidden={requestToggleSkillHidden}
          />
        ) : null}

        {activeView === "skills" ? (
          <SkillsPage
            admin={admin}
            currentUserId={me?._id ?? null}
            ownerOptions={ownerOptions}
            ownerSearch={ownerSearch}
            ownerSummary={ownerSummary}
            ownerUsers={ownerUsers}
            selectedDuplicate={selectedDuplicate}
            selectedOwner={selectedOwner}
            selectedSkill={selectedSkill}
            selectedSlug={selectedSlug}
            skillOverrideNote={skillOverrideNote}
            skillSearch={skillSearch}
            staff={staff}
            onApplySkillOverride={applySkillOverride}
            onBanUser={requestBanUser}
            onChangeOwner={(skillId, ownerUserId) => {
              void changeOwner({ skillId, ownerUserId });
            }}
            onChangeOwnerSearch={setOwnerSearch}
            onChangeSelectedDuplicate={setSelectedDuplicate}
            onChangeSelectedOwner={setSelectedOwner}
            onChangeSkillOverrideNote={setSkillOverrideNote}
            onChangeSkillSearch={setSkillSearch}
            onClearSkillOverride={clearSkillOverride}
            onHardDeleteSkill={requestHardDeleteSkill}
            onManageSkill={manageSkill}
            onSetBatch={(skillId, batch) => {
              void setBatch({ skillId, batch });
            }}
            onSetDeprecatedBadge={(skillId, deprecated) => {
              void setDeprecatedBadge({ skillId, deprecated });
            }}
            onSetDuplicate={(skillId, canonicalSlug) => {
              void setDuplicate({ skillId, canonicalSlug });
            }}
            onSetOfficialBadge={(skillId, official) => {
              void setOfficialBadge({ skillId, official });
            }}
            onToggleSkillHidden={requestToggleSkillHidden}
          />
        ) : null}

        {activeView === "plugins" ? (
          <PluginsPage
            pluginSearch={pluginSearch}
            selectedPlugin={selectedPlugin}
            selectedPluginName={selectedPluginName}
            onChangePluginSearch={setPluginSearch}
            onManagePlugin={managePlugin}
            onSetPackageBatch={(packageId, batch) => {
              void setPackageBatch({ packageId, batch }).catch((error) =>
                toast.error(formatMutationError(error)),
              );
            }}
          />
        ) : null}

        {activeView === "duplicates" ? (
          <DuplicatesPage
            duplicateCandidates={duplicateCandidates}
            onSetDuplicate={(skillId, canonicalSkillId) => {
              void setDuplicate({ skillId, canonicalSkillId });
            }}
          />
        ) : null}

        {activeView === "recent" ? <RecentPushesPage recentVersions={recentVersions} /> : null}

        {admin && activeView === "users" ? (
          <UsersPage
            currentUserId={me?._id ?? null}
            filteredUsers={filteredUsers}
            search={userSearch}
            summary={userSummary}
            userEmptyLabel={userEmptyLabel}
            onBanUser={requestBanUser}
            onChangeSearch={setUserSearch}
            onSetRole={(userId, role) => {
              void setRole({ userId, role });
            }}
            onUnbanUser={requestUnbanUser}
          />
        ) : null}
        {!admin && activeView === "users" ? (
          <ManagementPlaceholder
            title="Users"
            description="User administration is available to admins."
          />
        ) : null}
        {admin && activeView === "promotions" ? (
          <PromotionsPage
            promotions={promotions}
            pageStatus={promotionPageStatus}
            onCreate={handleCreatePromotion}
            onLoadMore={() => loadMorePromotions(25)}
            onUpdate={handleUpdatePromotion}
            onSetStatus={handleSetPromotionStatus}
          />
        ) : null}
        {!admin && activeView === "promotions" ? (
          <ManagementPlaceholder
            title="Promotions"
            description="Promotion administration is available to admins."
          />
        ) : null}
        {activeView === "overview" ? (
          <ManagementPlaceholder
            title="Overview"
            description="Use the sidebar to jump into focused management queues."
          />
        ) : null}
        {activeView === "publishers" ? (
          <ManagementPlaceholder
            title="Publishers"
            description="Publisher-specific tooling will live here as it graduates out of one-off moderation flows."
          />
        ) : null}
        {activeView === "audit" ? (
          <ManagementPlaceholder
            title="Audit log"
            description="Audit log exploration is still handled inside individual tools for now."
          />
        ) : null}
        {activeView === "system" ? (
          <ManagementPlaceholder
            title="System"
            description="System maintenance shortcuts can be added here without crowding moderation queues."
          />
        ) : null}
        {activeView === "settings" ? (
          <ManagementPlaceholder
            title="Settings"
            description="Staff settings can be split into this view when we have more than inline controls."
          />
        ) : null}
      </section>
      <ManagementConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </main>
  );
}

function ManagementPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <Card className="management-placeholder">
      <h2 className="section-title text-[1.2rem] m-0">{title}</h2>
      <p className="section-subtitle m-0">{description}</p>
    </Card>
  );
}

function ManagementSidebar({
  abuseCount,
  activeView,
  admin,
  duplicateCount,
  recentCount,
  reportCount,
  userCount,
}: {
  abuseCount?: number;
  activeView: ManagementView;
  admin: boolean;
  duplicateCount?: number;
  recentCount?: number;
  reportCount?: number;
  userCount?: number;
}) {
  return (
    <aside className="management-sidebar">
      <nav aria-label="Management sections">
        <div className="management-sidebar-heading">Management</div>
        <div className="management-sidebar-section-title">Review</div>
        <div className="management-sidebar-group">
          <ManagementSidebarLink
            active={activeView === "abuse"}
            badge={queueBadge(abuseCount)}
            icon={<AlertTriangle size={15} />}
            label="Publisher abuse"
            view="abuse"
          />
          <ManagementSidebarLink
            active={activeView === "reports"}
            badge={queueBadge(reportCount)}
            icon={<ClipboardList size={15} />}
            label="Content reports"
            view="reports"
          />
        </div>

        <div className="management-sidebar-section-title">Queues</div>
        <div className="management-sidebar-group">
          <ManagementSidebarLink
            active={activeView === "duplicates"}
            badge={queueBadge(duplicateCount)}
            icon={<PackageSearch size={15} />}
            label="Duplicate candidates"
            view="duplicates"
          />
          <ManagementSidebarLink
            active={activeView === "recent"}
            badge={queueBadge(recentCount)}
            icon={<GitBranch size={15} />}
            label="Recent pushes"
            view="recent"
          />
        </div>

        <div className="management-sidebar-section-title">Staff tools</div>
        <div className="management-sidebar-group">
          {admin ? (
            <ManagementSidebarLink
              active={activeView === "users"}
              badge={userCount === undefined ? undefined : formatWholeNumber(userCount)}
              icon={<UserRound size={15} />}
              label="Users"
              view="users"
            />
          ) : null}
          <ManagementSidebarLink
            active={activeView === "skills"}
            icon={<Wrench size={15} />}
            label="Skills"
            view="skills"
          />
          <ManagementSidebarLink
            active={activeView === "plugins"}
            icon={<Plug size={15} />}
            label="Plugins"
            view="plugins"
          />
          {admin ? (
            <ManagementSidebarLink
              active={activeView === "promotions"}
              icon={<Megaphone size={15} />}
              label="Promotions"
              view="promotions"
            />
          ) : null}
        </div>
      </nav>
    </aside>
  );
}

function ManagementSidebarLink({
  active,
  badge,
  icon,
  label,
  view,
}: {
  active: boolean;
  badge?: string;
  icon: ReactNode;
  label: string;
  view: ManagementView;
}) {
  return (
    <Link
      className={active ? "management-sidebar-link is-active" : "management-sidebar-link"}
      to="/management"
      search={{ view, skill: undefined, plugin: undefined }}
    >
      {icon}
      <span>{label}</span>
      {badge ? <small>{badge}</small> : null}
    </Link>
  );
}

function resolveManagementView(
  view: ManagementView | undefined,
  selectedSlug?: string,
  selectedPluginName?: string,
): ManagementView {
  if (selectedSlug) return "skills";
  if (selectedPluginName) return "plugins";
  return view ?? "abuse";
}

const MANAGEMENT_VIEW_LABELS: Record<ManagementView, string> = {
  overview: "Overview",
  abuse: "Publisher abuse",
  reports: "Content reports",
  users: "Users",
  publishers: "Publishers",
  skills: "Skills",
  plugins: "Plugins",
  promotions: "Promotions",
  duplicates: "Duplicate candidates",
  recent: "Recent pushes",
  audit: "Audit log",
  system: "System",
  settings: "Settings",
};

function formatManagementViewLabel(view: ManagementView) {
  return MANAGEMENT_VIEW_LABELS[view];
}

/** Queue badges only carry signal when there is a backlog; hide 0 and loading. */
function queueBadge(count: number | undefined) {
  return count ? formatWholeNumber(count) : undefined;
}
