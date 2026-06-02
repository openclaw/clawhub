import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  AlertTriangle,
  Ban,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  GitBranch,
  PackageSearch,
  Plug,
  RefreshCcw,
  Search,
  UserRound,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { ManagementSkeleton } from "../components/skeletons/ProtectedPageSkeletons";
import { Badge, type BadgeProps } from "../components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import { Textarea } from "../components/ui/textarea";
import {
  getSkillBadges,
  isSkillDeprecated,
  isSkillHighlighted,
  isSkillOfficial,
} from "../lib/badges";
import { getUserFacingConvexError } from "../lib/convexError";
import { familyLabel } from "../lib/packageLabels";
import type { PublicPublisher } from "../lib/publicUser";
import { isAdmin, isModerator } from "../lib/roles";
import { useAuthStatus } from "../lib/useAuthStatus";

const SKILL_AUDIT_LOG_LIMIT = 10;
const USER_BAN_REASON_MAX_LENGTH = 500;

type ManagementUserSummary = {
  _id: Id<"users">;
  handle?: string | null;
  name?: string | null;
  displayName?: string | null;
};

type ManagementUserListResult = { items: Doc<"users">[]; total: number };

type SkillAuditLogEntry = {
  _id: Id<"auditLogs">;
  action: string;
  metadata?: unknown;
  createdAt: number;
  actor: ManagementUserSummary | null;
};

type ManagementSkillEntry = {
  skill: Doc<"skills">;
  latestVersion: Doc<"skillVersions"> | null;
  owner: Doc<"users"> | null;
};

type ReportReasonEntry = {
  reason: string;
  createdAt: number;
  reporterHandle: string | null;
  reporterId: Id<"users">;
};

type ReportedSkillEntry = ManagementSkillEntry & {
  reports: ReportReasonEntry[];
};

type RecentVersionEntry = {
  version: Doc<"skillVersions">;
  skill: Doc<"skills"> | null;
  owner: Doc<"users"> | null;
};

type DuplicateCandidateEntry = {
  skill: Doc<"skills">;
  latestVersion: Doc<"skillVersions"> | null;
  fingerprint: string | null;
  matches: Array<{ skill: Doc<"skills">; owner: Doc<"users"> | null }>;
  owner: Doc<"users"> | null;
};

type SkillBySlugResult = {
  skill: Doc<"skills">;
  latestVersion: Doc<"skillVersions"> | null;
  owner: Doc<"users"> | null;
  overrideReviewer: ManagementUserSummary | null;
  auditLogs: SkillAuditLogEntry[];
  canonical: {
    skill: { slug: string; displayName: string };
    owner: { handle: string | null; userId: Id<"users"> | null };
  } | null;
} | null;

type PluginByNameResult = {
  package: Doc<"packages">;
  latestRelease: Doc<"packageReleases"> | null;
  owner: PublicPublisher | null;
  highlighted: { byUserId: Id<"users">; at: number } | null;
} | null;

type PublisherAbuseReviewDashboard = FunctionReturnType<
  typeof api.publisherAbuse.listReviewDashboard
>;
type PublisherAbuseReviewDetail = FunctionReturnType<
  typeof api.publisherAbuse.getReviewNominationDetail
>;
type PublisherAbuseReviewItem = PublisherAbuseReviewDashboard["pendingItems"][number];
type PublisherAbuseReviewScore = NonNullable<PublisherAbuseReviewItem["latestScore"]>;
type PublisherAbuseTab = "potential_ban_candidate" | "review" | "all_pending" | "resolved";
type ManagementView =
  | "overview"
  | "abuse"
  | "reports"
  | "users"
  | "publishers"
  | "skills"
  | "plugins"
  | "duplicates"
  | "recent"
  | "audit"
  | "system"
  | "settings";

const MANAGEMENT_VIEWS = new Set<ManagementView>([
  "overview",
  "abuse",
  "reports",
  "users",
  "publishers",
  "skills",
  "plugins",
  "duplicates",
  "recent",
  "audit",
  "system",
  "settings",
]);

function resolveOwnerParam(
  handle: string | null | undefined,
  ownerId?: Id<"users"> | Id<"publishers">,
) {
  return handle?.trim().toLowerCase() || (ownerId ? String(ownerId) : "unknown");
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
    } = {};
    if (typeof search.skill === "string" && search.skill.trim()) {
      validated.skill = search.skill;
    }
    if (typeof search.plugin === "string" && search.plugin.trim()) {
      validated.plugin = search.plugin;
    }
    if (typeof search.view === "string" && MANAGEMENT_VIEWS.has(search.view as ManagementView)) {
      validated.view = search.view as ManagementView;
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
    staff && abuseViewActive ? { limit: 150 } : "skip",
  );

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
  const startPublisherAbuseScoreRun = useAction(api.publisherAbuse.startPublisherAbuseScoreRun);

  const [selectedDuplicate, setSelectedDuplicate] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");
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
  const [publisherAbuseTab, setPublisherAbuseTab] =
    useState<PublisherAbuseTab>("potential_ban_candidate");
  const [publisherAbuseSearch, setPublisherAbuseSearch] = useState("");
  const [publisherAbuseNotes, setPublisherAbuseNotes] = useState("");
  const [selectedPublisherAbuseNominationId, setSelectedPublisherAbuseNominationId] =
    useState<Id<"publisherAbuseReviewNominations"> | null>(null);

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
  const publisherAbuseItemsForTab = useMemo(
    () =>
      publisherAbuseDashboard
        ? getPublisherAbuseItemsForTab(publisherAbuseDashboard, publisherAbuseTab)
        : [],
    [publisherAbuseDashboard, publisherAbuseTab],
  );
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

  useEffect(() => {
    if (!selectedSkillId || !selectedOwnerUserId) return;
    setSelectedDuplicate(selectedCanonicalSlug);
    setSelectedOwner(String(selectedOwnerUserId));
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
    if (!stillVisible) setSelectedPublisherAbuseNominationId(null);
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
  const selectedOwnerUser = selectedSkill?.owner ?? null;
  const ownerUsers = ownerResult?.items ?? [];
  const ownerOptions =
    selectedOwnerUser && !ownerUsers.some((user) => user._id === selectedOwnerUser._id)
      ? [selectedOwnerUser, ...ownerUsers]
      : ownerUsers;
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
    if (!ownerUser || !canBanPublisherAbuseOwner(item, me?._id ?? null, admin)) return;
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
          <PublisherAbuseReviewPanel
            admin={admin}
            currentUserId={me?._id ?? null}
            dashboard={publisherAbuseDashboard}
            detail={selectedPublisherAbuseDetail}
            items={filteredPublisherAbuseItems}
            notes={publisherAbuseNotes}
            search={publisherAbuseSearch}
            selectedItem={selectedPublisherAbuseItem}
            selectedNominationId={selectedPublisherAbuseNominationId}
            tab={publisherAbuseTab}
            onBanOwner={banPublisherAbuseOwner}
            onChangeNotes={setPublisherAbuseNotes}
            onChangeSearch={setPublisherAbuseSearch}
            onChangeTab={setPublisherAbuseTab}
            onRefresh={() => {
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
            onClose={() => setSelectedPublisherAbuseNominationId(null)}
            onSelect={setSelectedPublisherAbuseNominationId}
          />
        ) : null}

        {activeView === "reports" ? (
          <div className="management-view">
            <h2 className="section-title text-[1.2rem] m-0">Reported skills</h2>
            <p className="section-subtitle m-0 mt-1">
              Skills the community has flagged. Review each report and take action.
            </p>
            <div className="management-controls">
              <div className="management-control management-search">
                <span className="mono">Filter</span>
                <input
                  type="search"
                  placeholder="Search reported skills"
                  value={reportSearch}
                  onChange={(event) => setReportSearch(event.target.value)}
                />
              </div>
              <div className="management-count">{reportSummary}</div>
            </div>
            <div className="management-list">
              {!filteredReportedSkills ? (
                <div className="management-empty">Loading reports…</div>
              ) : filteredReportedSkills.length === 0 ? (
                <div className="management-empty">{reportCountLabel}</div>
              ) : (
                filteredReportedSkills.map((entry) => {
                  const { skill, latestVersion, owner, reports } = entry;
                  const ownerParam = resolveOwnerParam(
                    owner?.handle ?? null,
                    owner?._id ?? skill.ownerUserId,
                  );
                  const reportEntries = reports ?? [];
                  return (
                    <div key={skill._id} className="management-item">
                      <div className="management-item-main">
                        <Link to="/$owner/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                          {skill.displayName}
                        </Link>
                        <div className="section-subtitle m-0">
                          @{owner?.handle ?? owner?.name ?? "user"} · v
                          {latestVersion?.version ?? "—"} ·{skill.reportCount ?? 0} report
                          {(skill.reportCount ?? 0) === 1 ? "" : "s"}
                          {skill.lastReportedAt
                            ? ` · last ${formatTimestamp(skill.lastReportedAt)}`
                            : ""}
                        </div>
                        {reportEntries.length > 0 ? (
                          <div className="management-sublist">
                            {reportEntries.map((report) => (
                              <div
                                key={`${report.reporterId}-${report.createdAt}`}
                                className="management-report-item"
                              >
                                <span className="management-report-meta">
                                  {formatTimestamp(report.createdAt)}
                                  {report.reporterHandle ? ` · @${report.reporterHandle}` : ""}
                                </span>
                                <span>{report.reason}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="section-subtitle m-0">No report reasons yet.</div>
                        )}
                      </div>
                      <div className="management-actions">
                        <Button asChild>
                          <Link
                            to="/management"
                            search={{
                              view: "skills",
                              skill: skill.slug,
                              plugin: undefined,
                            }}
                          >
                            Manage
                          </Link>
                        </Button>
                        <Button type="button" onClick={() => requestToggleSkillHidden(skill)}>
                          {skill.softDeletedAt ? "Restore" : "Hide"}
                        </Button>
                        {admin ? (
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => requestHardDeleteSkill(skill)}
                          >
                            Hard delete
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {activeView === "skills" ? (
          <div className="management-view">
            <h2 className="section-title text-[1.2rem] m-0">Skill tools</h2>
            <p className="section-subtitle m-0 mt-1">
              Look up a skill by slug to manage moderation overrides and view its audit history.
            </p>
            <div className="management-controls">
              <div className="management-control management-search">
                <span className="mono">Skill</span>
                <input
                  type="search"
                  placeholder="skill-slug"
                  value={skillSearch}
                  onChange={(event) => setSkillSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      manageSkill();
                    }
                  }}
                />
              </div>
              <Button type="button" onClick={manageSkill} disabled={!skillSearch.trim()}>
                Manage
              </Button>
            </div>
            {selectedSlug ? (
              <div className="section-subtitle mt-2">
                Managing "{selectedSlug}" ·{" "}
                <Link
                  to="/management"
                  search={{
                    view: "skills",
                    skill: undefined,
                    plugin: undefined,
                  }}
                >
                  Clear selection
                </Link>
              </div>
            ) : null}
            <div className="management-list">
              {!selectedSlug ? (
                <div className="management-empty">
                  Enter a skill slug above, or use the Manage button on a skill in another view.
                </div>
              ) : selectedSkill === undefined ? (
                <div className="management-empty">Loading skill…</div>
              ) : !selectedSkill?.skill ? (
                <div className="management-empty">No skill found for "{selectedSlug}".</div>
              ) : (
                (() => {
                  const { skill, latestVersion, owner, canonical, overrideReviewer, auditLogs } =
                    selectedSkill;
                  const ownerParam = resolveOwnerParam(
                    owner?.handle ?? null,
                    owner?._id ?? skill.ownerUserId,
                  );
                  const moderationStatus =
                    skill.moderationStatus ?? (skill.softDeletedAt ? "hidden" : "active");
                  const isHighlighted = isSkillHighlighted(skill);
                  const isOfficial = isSkillOfficial(skill);
                  const isDeprecated = isSkillDeprecated(skill);
                  const badges = getSkillBadges(skill);
                  const ownerUserId = skill.ownerUserId ?? selectedOwnerUserId;
                  const ownerHandle = owner?.handle ?? owner?.name ?? "user";
                  const isOwnerAdmin = owner?.role === "admin";
                  const canBanOwner =
                    staff && ownerUserId && ownerUserId !== me?._id && (admin || !isOwnerAdmin);

                  return (
                    <div key={skill._id} className="management-item management-item-detail">
                      <div className="management-item-main">
                        <Link to="/$owner/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                          {skill.displayName}
                        </Link>
                        <div className="section-subtitle m-0">
                          @{owner?.handle ?? owner?.name ?? "user"} · v
                          {latestVersion?.version ?? "—"} · updated{" "}
                          {formatTimestamp(skill.updatedAt)} · {moderationStatus}
                          {badges.length ? ` · ${badges.join(", ").toLowerCase()}` : ""}
                        </div>
                        {skill.moderationFlags?.length ? (
                          <div className="management-tags">
                            {skill.moderationFlags.map((flag: string) => (
                              <Badge key={flag}>{flag}</Badge>
                            ))}
                          </div>
                        ) : null}
                        <div className="management-sublist">
                          <div className="section-subtitle m-0">Manual overrides</div>
                          <section className="management-override-panel">
                            <div className="management-report-item">
                              <span className="management-report-meta">Current override</span>
                              <span>
                                {formatManualOverrideState(skill.manualOverride, overrideReviewer)}
                              </span>
                            </div>
                            <div className="management-report-item">
                              <span className="management-report-meta">Latest version</span>
                              <span>
                                {latestVersion
                                  ? `v${latestVersion.version}`
                                  : "No published version."}
                              </span>
                            </div>
                            <div className="management-report-item">
                              <span className="management-report-meta">Behavior</span>
                              <span>Applies to the full skill until a moderator clears it.</span>
                            </div>
                            <textarea
                              className="form-input management-textarea"
                              rows={4}
                              placeholder={
                                skill.manualOverride
                                  ? "Audit note required to update or clear the okay override"
                                  : "Audit note required to mark this skill okay"
                              }
                              value={skillOverrideNote}
                              onChange={(event) => setSkillOverrideNote(event.target.value)}
                            />
                            <div className="management-actions management-actions-start">
                              <Button
                                className="management-action-btn"
                                type="button"
                                disabled={!skillOverrideNote.trim()}
                                onClick={applySkillOverride}
                              >
                                {skill.manualOverride ? "Update okay override" : "Mark skill okay"}
                              </Button>
                              {skill.manualOverride ? (
                                <Button
                                  className="management-action-btn"
                                  type="button"
                                  disabled={!skillOverrideNote.trim()}
                                  onClick={clearSkillOverride}
                                >
                                  Clear skill override
                                </Button>
                              ) : null}
                            </div>
                          </section>
                        </div>
                        <div className="management-sublist">
                          <div className="section-subtitle m-0">Recent audit activity</div>
                          <section className="management-override-panel management-audit-panel">
                            <div className="management-report-item">
                              <span className="management-report-meta">Window</span>
                              <span>Last {SKILL_AUDIT_LOG_LIMIT} entries for this skill.</span>
                            </div>
                            {auditLogs.length === 0 ? (
                              <div className="section-subtitle m-0">No audit activity yet.</div>
                            ) : (
                              <div className="management-audit-list">
                                {auditLogs.map((entry) => {
                                  const auditSummary = formatAuditMetadataSummary(
                                    entry.action,
                                    entry.metadata,
                                  );
                                  return (
                                    <div key={entry._id} className="management-audit-item">
                                      <div className="management-report-item">
                                        <span className="management-report-meta">
                                          {formatTimestamp(entry.createdAt)} ·{" "}
                                          {formatManagementUserLabel(entry.actor)}
                                        </span>
                                        <span>
                                          {formatAuditActionLabel(entry.action, entry.metadata)}
                                        </span>
                                      </div>
                                      {auditSummary ? (
                                        <div className="section-subtitle management-audit-summary">
                                          {auditSummary}
                                        </div>
                                      ) : null}
                                      {entry.metadata ? (
                                        <details className="management-audit-details">
                                          <summary>metadata</summary>
                                          <pre className="management-audit-json">
                                            {JSON.stringify(entry.metadata, null, 2)}
                                          </pre>
                                        </details>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        </div>
                        <div className="management-tool-grid">
                          <label className="management-control management-control-stack">
                            <span className="mono">duplicate of</span>
                            <input
                              className="management-field"
                              value={selectedDuplicate}
                              onChange={(event) => setSelectedDuplicate(event.target.value)}
                              placeholder={canonical?.skill?.slug ?? "canonical slug"}
                            />
                          </label>
                          <div className="management-control management-control-stack">
                            <span className="mono">duplicate action</span>
                            <Button
                              className="management-action-btn"
                              type="button"
                              onClick={() =>
                                void setDuplicate({
                                  skillId: skill._id,
                                  canonicalSlug: selectedDuplicate.trim() || undefined,
                                })
                              }
                            >
                              Set duplicate
                            </Button>
                          </div>
                          {admin ? (
                            <>
                              <label className="management-control management-control-stack">
                                <span className="mono">owner search</span>
                                <input
                                  className="management-field"
                                  type="search"
                                  placeholder="Search users by handle"
                                  value={ownerSearch}
                                  onChange={(event) => setOwnerSearch(event.target.value)}
                                />
                                <span className="management-count">{ownerSummary}</span>
                              </label>
                              <label className="management-control management-control-stack">
                                <span className="mono">owner</span>
                                <Select value={selectedOwner} onValueChange={setSelectedOwner}>
                                  <SelectTrigger className="management-field">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ownerOptions.map((user) => (
                                      <SelectItem key={user._id} value={user._id}>
                                        @{user.handle ?? user.name ?? "user"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </label>
                              <div className="management-control management-control-stack">
                                <span className="mono">owner action</span>
                                <Button
                                  className="management-action-btn"
                                  type="button"
                                  onClick={() =>
                                    void changeOwner({
                                      skillId: skill._id,
                                      ownerUserId: selectedOwner as Doc<"users">["_id"],
                                    })
                                  }
                                >
                                  Change owner
                                </Button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="management-actions management-action-grid">
                        <Button asChild className="management-action-btn">
                          <Link to="/$owner/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                            View
                          </Link>
                        </Button>
                        <Button
                          className="management-action-btn"
                          type="button"
                          onClick={() => requestToggleSkillHidden(skill)}
                        >
                          {skill.softDeletedAt ? "Restore" : "Hide"}
                        </Button>
                        <Button
                          className="management-action-btn"
                          type="button"
                          onClick={() =>
                            void setBatch({
                              skillId: skill._id,
                              batch: isHighlighted ? undefined : "highlighted",
                            })
                          }
                        >
                          {isHighlighted ? "Unhighlight" : "Highlight"}
                        </Button>
                        {admin ? (
                          <Button
                            className="management-action-btn"
                            type="button"
                            variant="destructive"
                            onClick={() => requestHardDeleteSkill(skill)}
                          >
                            Hard delete
                          </Button>
                        ) : null}
                        {staff ? (
                          <Button
                            className="management-action-btn"
                            type="button"
                            variant="destructive"
                            disabled={!canBanOwner}
                            onClick={() => {
                              if (!ownerUserId || ownerUserId === me?._id) return;
                              requestBanUser(ownerUserId, `@${ownerHandle}`);
                            }}
                          >
                            Ban user
                          </Button>
                        ) : null}
                        {admin ? (
                          <>
                            <Button
                              className="management-action-btn"
                              type="button"
                              onClick={() =>
                                void setOfficialBadge({
                                  skillId: skill._id,
                                  official: !isOfficial,
                                })
                              }
                            >
                              {isOfficial ? "Remove official" : "Mark official"}
                            </Button>
                            <Button
                              className="management-action-btn"
                              type="button"
                              onClick={() =>
                                void setDeprecatedBadge({
                                  skillId: skill._id,
                                  deprecated: !isDeprecated,
                                })
                              }
                            >
                              {isDeprecated ? "Remove deprecated" : "Mark deprecated"}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        ) : null}

        {activeView === "plugins" ? (
          <div className="management-view">
            <h2 className="section-title text-[1.2rem] m-0">Plugin tools</h2>
            <p className="section-subtitle m-0 mt-1">
              Look up a plugin package to open its moderation tooling.
            </p>
            <div className="management-controls">
              <div className="management-control management-search">
                <span className="mono">Package</span>
                <input
                  type="search"
                  placeholder="@scope/plugin-name or package-name"
                  value={pluginSearch}
                  onChange={(event) => setPluginSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      managePlugin();
                    }
                  }}
                />
              </div>
              <Button type="button" onClick={managePlugin} disabled={!pluginSearch.trim()}>
                Manage
              </Button>
            </div>
            {selectedPluginName ? (
              <div className="section-subtitle mt-2">
                Managing "{selectedPluginName}" ·{" "}
                <Link
                  to="/management"
                  search={{
                    view: "plugins",
                    skill: undefined,
                    plugin: undefined,
                  }}
                >
                  Clear selection
                </Link>
              </div>
            ) : null}
            <div className="management-list">
              {!selectedPluginName ? (
                <div className="management-empty">
                  Enter a plugin package name to open tooling here.
                </div>
              ) : selectedPlugin === undefined ? (
                <div className="management-empty">Loading plugin…</div>
              ) : !selectedPlugin?.package ? (
                <div className="management-empty">No plugin found for "{selectedPluginName}".</div>
              ) : (
                (() => {
                  const plugin = selectedPlugin.package;
                  const owner = selectedPlugin.owner;
                  const latestRelease = selectedPlugin.latestRelease;
                  const isHighlighted = Boolean(selectedPlugin.highlighted);

                  return (
                    <div key={plugin._id} className="management-item management-item-detail">
                      <div className="management-item-main">
                        <Link to="/plugins/$name" params={{ name: plugin.name }}>
                          {plugin.displayName}
                        </Link>
                        <div className="section-subtitle m-0">
                          {owner?.handle ? `@${owner.handle}` : "unknown owner"} ·{" "}
                          {familyLabel(plugin.family)} · v{latestRelease?.version ?? "—"} · updated{" "}
                          {formatTimestamp(plugin.updatedAt)}
                          {plugin.softDeletedAt ? " · hidden" : ""}
                          {isHighlighted ? " · highlighted" : ""}
                        </div>
                        <div className="management-tags">
                          <Badge>{plugin.channel}</Badge>
                          {plugin.isOfficial ? <Badge variant="official">Official</Badge> : null}
                          {plugin.executesCode ? <Badge>executes code</Badge> : null}
                          {plugin.runtimeId ? <Badge>{plugin.runtimeId}</Badge> : null}
                        </div>
                        <div className="management-sublist">
                          <div className="management-report-item">
                            <span className="management-report-meta">Package name</span>
                            <span className="mono">{plugin.name}</span>
                          </div>
                          <div className="management-report-item">
                            <span className="management-report-meta">Summary</span>
                            <span>{plugin.summary ?? "No summary provided."}</span>
                          </div>
                          <div className="management-report-item">
                            <span className="management-report-meta">Featured state</span>
                            <span>
                              {isHighlighted
                                ? `Highlighted ${formatTimestamp(selectedPlugin.highlighted?.at ?? 0)}`
                                : "Not highlighted"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="management-actions management-action-grid">
                        <Button asChild className="management-action-btn">
                          <Link to="/plugins/$name" params={{ name: plugin.name }}>
                            View
                          </Link>
                        </Button>
                        <Button
                          className="management-action-btn"
                          type="button"
                          onClick={() =>
                            void setPackageBatch({
                              packageId: plugin._id,
                              batch: isHighlighted ? undefined : "highlighted",
                            }).catch((error) => toast.error(formatMutationError(error)))
                          }
                        >
                          {isHighlighted ? "Unhighlight" : "Highlight"}
                        </Button>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        ) : null}

        {activeView === "duplicates" ? (
          <div className="management-view">
            <h2 className="section-title text-[1.2rem] m-0">Duplicate candidates</h2>
            <p className="section-subtitle m-0 mt-1">
              Skills whose code fingerprint matches another publisher's — possible copies. Pick the
              canonical original.
            </p>
            <div className="management-list">
              {!duplicateCandidates ? (
                <div className="management-empty">Loading duplicate candidates…</div>
              ) : duplicateCandidates.length === 0 ? (
                <div className="management-empty">No duplicate candidates.</div>
              ) : (
                duplicateCandidates.map((entry) => (
                  <div key={entry.skill._id} className="management-item management-dupe">
                    <div className="management-dupe-head">
                      <div className="management-item-main">
                        <Link
                          to="/$owner/$slug"
                          params={{
                            owner: resolveOwnerParam(
                              entry.owner?.handle ?? null,
                              entry.owner?._id ?? entry.skill.ownerUserId,
                            ),
                            slug: entry.skill.slug,
                          }}
                        >
                          {entry.skill.displayName}
                        </Link>
                        <div className="section-subtitle m-0">
                          @{entry.owner?.handle ?? entry.owner?.name ?? "user"} · v
                          {entry.latestVersion?.version ?? "—"} ·{" "}
                          <span className="management-fingerprint">
                            {entry.fingerprint ? entry.fingerprint.slice(0, 8) : "—"}
                          </span>
                        </div>
                      </div>
                      <div className="management-actions">
                        <Button asChild>
                          <Link
                            to="/$owner/$slug"
                            params={{
                              owner: resolveOwnerParam(
                                entry.owner?.handle ?? null,
                                entry.owner?._id ?? entry.skill.ownerUserId,
                              ),
                              slug: entry.skill.slug,
                            }}
                          >
                            View
                          </Link>
                        </Button>
                      </div>
                    </div>
                    <div className="management-dupe-matches">
                      <div className="management-dupe-label">
                        {entry.matches.length === 1
                          ? "Possible duplicate of"
                          : "Possible duplicates of"}
                      </div>
                      {entry.matches.map((match) => (
                        <div key={match.skill._id} className="management-dupe-match">
                          <div className="management-item-main">
                            <strong>{match.skill.displayName}</strong>
                            <div className="section-subtitle m-0">
                              @{match.owner?.handle ?? match.owner?.name ?? "user"} ·{" "}
                              {match.skill.slug}
                            </div>
                          </div>
                          <div className="management-actions">
                            <Button asChild>
                              <Link
                                to="/$owner/$slug"
                                params={{
                                  owner: resolveOwnerParam(
                                    match.owner?.handle ?? null,
                                    match.owner?._id ?? match.skill.ownerUserId,
                                  ),
                                  slug: match.skill.slug,
                                }}
                              >
                                View
                              </Link>
                            </Button>
                            <Button
                              type="button"
                              onClick={() =>
                                void setDuplicate({
                                  skillId: entry.skill._id,
                                  canonicalSlug: match.skill.slug,
                                })
                              }
                            >
                              Mark duplicate
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {activeView === "recent" ? (
          <div className="management-view">
            <h2 className="section-title text-[1.2rem] m-0">Recent pushes</h2>
            <p className="section-subtitle m-0 mt-1">
              The latest skill versions published across ClawHub.
            </p>
            <div className="management-list">
              {!recentVersions ? (
                <div className="management-empty">Loading recent pushes…</div>
              ) : recentVersions.length === 0 ? (
                <div className="management-empty">No recent versions.</div>
              ) : (
                recentVersions.map((entry) => (
                  <div key={entry.version._id} className="management-item">
                    <div className="management-item-main">
                      <strong>{entry.skill?.displayName ?? "Unknown skill"}</strong>
                      <div className="section-subtitle m-0">
                        v{entry.version.version} · @
                        {entry.owner?.handle ?? entry.owner?.name ?? "user"} ·{" "}
                        {formatShortTimestamp(entry.version._creationTime)}
                      </div>
                    </div>
                    <div className="management-actions">
                      {entry.skill ? (
                        <Button asChild>
                          <Link
                            to="/management"
                            search={{
                              view: "skills",
                              skill: entry.skill.slug,
                              plugin: undefined,
                            }}
                          >
                            Manage
                          </Link>
                        </Button>
                      ) : null}
                      {entry.skill ? (
                        <Button asChild>
                          <Link
                            to="/$owner/$slug"
                            params={{
                              owner: resolveOwnerParam(
                                entry.owner?.handle ?? null,
                                entry.owner?._id ?? entry.skill.ownerUserId,
                              ),
                              slug: entry.skill.slug,
                            }}
                          >
                            View
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

        {admin && activeView === "users" ? (
          <div className="management-view">
            <h2 className="section-title text-[1.2rem] m-0">Users</h2>
            <p className="section-subtitle m-0 mt-1">
              Staff and member accounts. Search by handle, change a role, or ban an account.
            </p>
            <div className="management-controls">
              <div className="management-control management-search">
                <span className="mono">Filter</span>
                <input
                  type="search"
                  placeholder="Search users"
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                />
              </div>
              <div className="management-count">{userSummary}</div>
            </div>
            <div className="management-list">
              {filteredUsers.length === 0 ? (
                <div className="management-empty">{userEmptyLabel}</div>
              ) : (
                filteredUsers.map((user) => {
                  const removed = Boolean(user.deletedAt || user.deactivatedAt);
                  return (
                    <div
                      key={user._id}
                      className={removed ? "management-item is-removed" : "management-item"}
                    >
                      <div className="management-item-main">
                        <span className="mono">@{user.handle ?? user.name ?? "user"}</span>
                        <div className="management-item-meta">
                          {removed
                            ? user.banReason && user.deletedAt
                              ? `Banned ${formatTimestamp(user.deletedAt)} · ${user.banReason}`
                              : `Deleted ${formatTimestamp((user.deactivatedAt ?? user.deletedAt) as number)}`
                            : `${user.role ?? "user"} · joined ${formatTimestamp(user._creationTime)}`}
                        </div>
                      </div>
                      <div className="management-actions">
                        <Select
                          value={user.role ?? "user"}
                          onValueChange={(value) => {
                            if (value === "admin" || value === "moderator" || value === "user") {
                              void setRole({ userId: user._id, role: value });
                            }
                          }}
                        >
                          <SelectTrigger size="sm" className="w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="moderator">Moderator</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={user._id === me?._id}
                          onClick={() => {
                            if (user._id === me?._id) return;
                            requestBanUser(user._id, `@${user.handle ?? user.name ?? "user"}`);
                          }}
                        >
                          Ban user
                        </Button>
                        {user.deletedAt && !user.deactivatedAt ? (
                          <Button
                            type="button"
                            onClick={() =>
                              requestUnbanUser(user._id, `@${user.handle ?? user.name ?? "user"}`)
                            }
                          >
                            Unban user
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
        {!admin && activeView === "users" ? (
          <ManagementPlaceholder
            title="Users"
            description="User administration is available to admins."
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

function publisherAbuseLabelVariant(label: string) {
  if (label === "potential_ban_candidate") return "destructive" as const;
  if (label === "review") return "review" as const;
  return "success" as const;
}

function PublisherAbuseReviewPanel({
  admin,
  currentUserId,
  dashboard,
  detail,
  items,
  notes,
  search,
  selectedItem,
  selectedNominationId,
  tab,
  onBanOwner,
  onChangeNotes,
  onChangeSearch,
  onChangeTab,
  onClose,
  onRefresh,
  onSelect,
}: {
  admin: boolean;
  currentUserId: Id<"users"> | null;
  dashboard: PublisherAbuseReviewDashboard | undefined;
  detail: PublisherAbuseReviewDetail | undefined;
  items: PublisherAbuseReviewItem[];
  notes: string;
  search: string;
  selectedItem: PublisherAbuseReviewItem | null;
  selectedNominationId: Id<"publisherAbuseReviewNominations"> | null;
  tab: PublisherAbuseTab;
  onBanOwner: (item: PublisherAbuseReviewItem) => void;
  onChangeNotes: (value: string) => void;
  onChangeSearch: (value: string) => void;
  onChangeTab: (value: PublisherAbuseTab) => void;
  onClose: () => void;
  onRefresh: () => void;
  onSelect: (value: Id<"publisherAbuseReviewNominations">) => void;
}) {
  const latestRun = dashboard?.latestRun ?? null;
  const selectedScore = selectedItem?.latestScore ?? null;
  const selectedPublisher = selectedItem?.publisher ?? null;
  const canBanSelectedUser = canBanPublisherAbuseOwner(selectedItem, currentUserId, admin);
  // Counts reflect what's actually shown: pass-labelled and already-banned
  // publishers are hidden, so derive from the visible pending set.
  const visiblePending = dashboard ? getPublisherAbuseVisiblePendingItems(dashboard) : [];
  const totalPending = visiblePending.length;
  const potentialBan = visiblePending.filter(
    (item) => item.nomination.label === "potential_ban_candidate",
  ).length;
  const review = visiblePending.filter((item) => item.nomination.label === "review").length;
  const resolved = dashboard?.recentResolvedItems.length ?? 0;
  const totalForTab =
    tab === "potential_ban_candidate"
      ? potentialBan
      : tab === "review"
        ? review
        : tab === "resolved"
          ? resolved
          : totalPending;
  const loaded = dashboard !== undefined;

  return (
    <section className="pa" aria-labelledby="pa-title">
      <header className="pa-head">
        <div>
          <h2 id="pa-title" className="section-title pa-title">
            Publisher abuse review
          </h2>
          <p className="section-subtitle pa-subtitle">
            Statistical publisher abuse signals from the latest scoring run.
          </p>
        </div>
        <div className="pa-run">
          <dl className="pa-run-meta">
            <div>
              <dt>Last scan</dt>
              <dd
                className={
                  latestRun?.status === "completed"
                    ? "pa-run-ok"
                    : latestRun?.status === "failed"
                      ? "pa-run-bad"
                      : undefined
                }
              >
                {latestRun
                  ? formatPublisherAbuseRunStatus(latestRun.status)
                  : loaded
                    ? "No scans yet"
                    : "Loading"}
              </dd>
            </div>
            <div>
              <dt>Scanned</dt>
              <dd>{formatWholeNumber(latestRun?.scannedPublishers)}</dd>
            </div>
            <div>
              <dt>Scored</dt>
              <dd>{formatWholeNumber(latestRun?.scoredPublishers)}</dd>
            </div>
          </dl>
          <div className="pa-rescan">
            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCcw size={14} />
              Run new scan
            </Button>
            <span className="pa-rescan-hint">Re-scores every publisher</span>
          </div>
        </div>
      </header>

      <div className="pa-tabs" role="tablist" aria-label="Publisher abuse queue">
        <PublisherAbuseTabButton
          active={tab === "potential_ban_candidate"}
          count={loaded ? potentialBan : undefined}
          label="Potential ban"
          onClick={() => onChangeTab("potential_ban_candidate")}
        />
        <PublisherAbuseTabButton
          active={tab === "review"}
          count={loaded ? review : undefined}
          label="On the brink"
          onClick={() => onChangeTab("review")}
        />
        <PublisherAbuseTabButton
          active={tab === "all_pending"}
          count={loaded ? totalPending : undefined}
          label="All flagged"
          onClick={() => onChangeTab("all_pending")}
        />
        <PublisherAbuseTabButton
          active={tab === "resolved"}
          count={loaded ? resolved : undefined}
          label="Resolved"
          onClick={() => onChangeTab("resolved")}
        />
      </div>

      <Card className="pa-queue">
        <label className="pa-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search handle, user, ID, or reason"
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </label>
        <div className="pa-table-wrap">
          <table className="pa-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Handle</th>
                <th className="pa-num">Z-score</th>
                <th>Reasons</th>
                <th>Last scored</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr>
                  <td colSpan={5}>Loading publisher abuse nominations…</td>
                </tr>
              ) : items.length === 0 ? (
                <tr className="pa-empty-row">
                  <td colSpan={5}>
                    <strong>Queue clear</strong>
                    No publishers in this view from the latest scoring run.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const score = item.latestScore;
                  const selected = item.nomination._id === selectedNominationId;
                  return (
                    <tr
                      key={item.nomination._id}
                      className={selected ? "is-selected" : undefined}
                      onClick={() => onSelect(item.nomination._id)}
                    >
                      <td>
                        <Badge
                          variant={publisherAbuseLabelVariant(item.nomination.label)}
                          size="sm"
                        >
                          {formatPublisherAbuseLabel(item.nomination.label)}
                        </Badge>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="pa-handle pa-row-button"
                          aria-label={`Open details for ${item.nomination.handleSnapshot}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(item.nomination._id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            event.currentTarget.click();
                          }}
                        >
                          <strong>{item.nomination.handleSnapshot}</strong>
                          <span>{compactIdentifier(item.nomination.ownerKey)}</span>
                        </button>
                      </td>
                      <td className={`pa-num ${score ? zScoreClass(score.zScore) : ""}`}>
                        {score ? formatScore(score.zScore) : "—"}
                      </td>
                      <td>
                        <div className="pa-reasons">
                          {(score?.reasonCodes ?? []).slice(0, 2).map((reason) => (
                            <Badge key={reason} variant="compact">
                              {formatReasonCode(reason)}
                            </Badge>
                          ))}
                          {(score?.reasonCodes.length ?? 0) > 2 ? (
                            <Badge variant="compact">+{(score?.reasonCodes.length ?? 0) - 2}</Badge>
                          ) : null}
                          {!score?.reasonCodes.length ? <span className="pa-muted">—</span> : null}
                        </div>
                      </td>
                      <td className="pa-muted">
                        {formatShortTimestamp(item.nomination.lastScoredAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="pa-foot">
          {loaded
            ? `Showing ${formatWholeNumber(items.length)} of ${formatWholeNumber(totalForTab)} nominations`
            : "Loading…"}
        </div>
      </Card>

      <Sheet
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent side="right" className="pa-sheet w-[600px] max-w-[92vw]">
          {selectedItem ? (
            <>
              <SheetHeader className="pa-sheet-head">
                <SheetTitle>{selectedItem.nomination.handleSnapshot}</SheetTitle>
                <SheetDescription className="sr-only">
                  Publisher abuse score details, owner identifiers, signal metrics, and available
                  moderation action.
                </SheetDescription>
                <div className="pa-pills">
                  <Badge
                    variant={publisherAbuseLabelVariant(selectedItem.nomination.label)}
                    size="sm"
                  >
                    {formatPublisherAbuseLabel(selectedItem.nomination.label)}
                  </Badge>
                </div>
                <div className="pa-idline">
                  <PublisherAbuseIdentity
                    label="Publisher"
                    value={
                      selectedItem.nomination.ownerPublisherId ?? selectedItem.nomination.ownerKey
                    }
                  />
                  <PublisherAbuseIdentity
                    label="User"
                    value={selectedItem.nomination.ownerUserId ?? "No linked user"}
                  />
                  {selectedPublisher ? (
                    <Link
                      className="pa-profile-link"
                      to="/p/$handle"
                      params={{ handle: selectedPublisher.handle }}
                    >
                      <ExternalLink size={12} />
                      Profile
                    </Link>
                  ) : null}
                </div>
              </SheetHeader>

              <div className="pa-sheet-body">
                <div className="pa-score">
                  <div>
                    <span>Z-score</span>
                    <strong
                      className={selectedScore ? zScoreClass(selectedScore.zScore) : undefined}
                    >
                      {selectedScore ? formatScore(selectedScore.zScore) : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Rank</span>
                    <strong>{selectedScore ? formatWholeNumber(selectedScore.rank) : "—"}</strong>
                    <small>
                      of {formatWholeNumber(latestRunScoredCount(detail, dashboard))} scored
                    </small>
                  </div>
                  <div>
                    <span>Pressure</span>
                    <strong>{selectedScore ? formatPressureLabel(selectedScore) : "—"}</strong>
                  </div>
                </div>

                <section className="pa-zone">
                  <div className="pa-section-label">Why it was flagged</div>
                  <div className="pa-reason-list">
                    {(selectedScore?.reasonCodes ?? []).map((reason) => (
                      <div key={reason} className="pa-reason">
                        <strong>{formatReasonCode(reason)}</strong>
                        <small>{describeReasonCode(reason)}</small>
                      </div>
                    ))}
                    {!selectedScore?.reasonCodes.length ? (
                      <div className="pa-reason">
                        <strong>No active reason code</strong>
                        <small>The latest score did not cross a named reason threshold.</small>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="pa-zone">
                  <div className="pa-section-label">Publisher activity</div>
                  <div className="pa-metrics">
                    <PublisherAbuseMetric
                      label="Published skills"
                      value={selectedScore?.publishedSkills}
                    />
                    <PublisherAbuseMetric
                      label="Total installs"
                      value={selectedScore?.totalInstalls}
                    />
                    <PublisherAbuseMetric label="Total stars" value={selectedScore?.totalStars} />
                    <PublisherAbuseMetric
                      label="Total downloads"
                      value={selectedScore?.totalDownloads}
                    />
                  </div>
                  <div className="pa-metrics pa-metrics-ratios">
                    <PublisherAbuseMetric
                      label="Installs / skill"
                      value={selectedScore?.installsPerSkill}
                      ratio
                    />
                    <PublisherAbuseMetric
                      label="Stars / skill"
                      value={selectedScore?.starsPerSkill}
                      ratio
                    />
                    <PublisherAbuseMetric
                      label="Downloads / skill"
                      value={selectedScore?.downloadsPerSkill}
                      ratio
                    />
                  </div>
                </section>

                {detail?.scoreHistory.length ? (
                  <section className="pa-zone">
                    <div className="pa-section-label">Scoring history</div>
                    <div className="pa-history">
                      {detail.scoreHistory.map((score) => (
                        <div key={score._id} className="pa-history-item">
                          <span>{formatShortTimestamp(score.createdAt)}</span>
                          <strong className={zScoreClass(score.zScore)}>
                            {formatScore(score.zScore)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {selectedItem.nomination.status !== "pending" ? (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">Resolution</div>
                    <div className="pa-actions">
                      <Badge variant={publisherAbuseStatusVariant(selectedItem.nomination.status)}>
                        {formatPublisherAbuseStatus(selectedItem.nomination.status)}
                      </Badge>
                      <span className="pa-muted">
                        Reviewed{" "}
                        {formatShortTimestamp(
                          selectedItem.nomination.reviewedAt ?? selectedItem.nomination.updatedAt,
                        )}
                      </span>
                    </div>
                    <p className="pa-hint">
                      {selectedItem.nomination.notes?.trim() ||
                        "This nomination is no longer in the pending queue."}
                    </p>
                  </section>
                ) : selectedItem.nomination.label === "potential_ban_candidate" ? (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">Triage note</div>
                    <Textarea
                      maxLength={USER_BAN_REASON_MAX_LENGTH}
                      placeholder="Why are you taking this action? (optional)"
                      value={notes}
                      onChange={(event) => onChangeNotes(event.target.value)}
                    />
                    <div className="pa-actions">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="pa-ban"
                        disabled={!canBanSelectedUser}
                        onClick={() => onBanOwner(selectedItem)}
                      >
                        <Ban size={14} />
                        Ban user
                      </Button>
                    </div>
                  </section>
                ) : (
                  <section className="pa-zone pa-review">
                    <div className="pa-section-label">Calibration signal</div>
                    <p className="pa-hint">
                      This publisher is close to the ban line, but is not a ban candidate. Leave it
                      here so we can tune the scoring gap.
                    </p>
                  </section>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function PublisherAbuseTabButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number | undefined;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "pa-tab is-active" : "pa-tab"}
      onClick={onClick}
    >
      {label}{" "}
      {count === undefined ? (
        <span className="pa-tab-count pa-count-loading" aria-label="Loading" />
      ) : (
        <span className="pa-tab-count">{formatWholeNumber(count)}</span>
      )}
    </button>
  );
}

function PublisherAbuseIdentity({ label, value }: { label: string; value: string }) {
  return (
    <div className="pa-id">
      <span className="pa-id-label">{label}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
        }}
      >
        {compactIdentifier(value)}
        <Copy size={12} />
      </button>
    </div>
  );
}

function PublisherAbuseMetric({
  label,
  ratio,
  value,
}: {
  label: string;
  ratio?: boolean;
  value?: number;
}) {
  return (
    <div className="pa-metric">
      <span>{label}</span>
      <strong>{ratio ? formatRatio(value) : formatWholeNumber(value)}</strong>
    </div>
  );
}

// A publisher only belongs in the queue while it is actively flagged and not yet
// banned. `pass` (the scorer cleared them) and already-banned owners drop out.
function isVisiblePublisherAbuseItem(item: PublisherAbuseReviewItem) {
  return (
    item.nomination.label !== "pass" &&
    !item.ownerUser?.deletedAt &&
    !item.ownerUser?.deactivatedAt &&
    !item.publisher?.deletedAt &&
    !item.publisher?.deactivatedAt
  );
}

function canBanPublisherAbuseOwner(
  item: PublisherAbuseReviewItem | null,
  currentUserId: Id<"users"> | null,
  admin: boolean,
) {
  const ownerUser = item?.ownerUser;
  if (!ownerUser?._id) return false;
  if (ownerUser._id === currentUserId) return false;
  if (ownerUser.role === "admin" && !admin) return false;
  return true;
}

function getPublisherAbuseVisiblePendingItems(dashboard: PublisherAbuseReviewDashboard) {
  return [...dashboard.pendingPotentialBanCandidateItems, ...dashboard.pendingReviewItems].filter(
    isVisiblePublisherAbuseItem,
  );
}

function getPublisherAbuseItemsForTab(
  dashboard: PublisherAbuseReviewDashboard,
  tab: PublisherAbuseTab,
) {
  if (tab === "potential_ban_candidate") {
    return dashboard.pendingPotentialBanCandidateItems.filter(isVisiblePublisherAbuseItem);
  }
  if (tab === "review") return dashboard.pendingReviewItems.filter(isVisiblePublisherAbuseItem);
  if (tab === "resolved") return dashboard.recentResolvedItems;
  return getPublisherAbuseVisiblePendingItems(dashboard);
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

function filterPublisherAbuseItems(items: PublisherAbuseReviewItem[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => {
    const score = item.latestScore;
    const haystack = [
      item.nomination.handleSnapshot,
      item.nomination.ownerKey,
      item.nomination.ownerPublisherId,
      item.nomination.ownerUserId,
      item.ownerUser?.handle,
      item.ownerUser?.name,
      item.ownerUser?.displayName,
      item.publisher?.displayName,
      item.publisher?.handle,
      item.nomination.label,
      item.nomination.status,
      ...(score?.reasonCodes ?? []),
    ]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function comparePublisherAbuseItems(
  left: PublisherAbuseReviewItem,
  right: PublisherAbuseReviewItem,
) {
  const leftScore = left.latestScore?.zScore ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.latestScore?.zScore ?? Number.NEGATIVE_INFINITY;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return right.nomination.lastScoredAt - left.nomination.lastScoredAt;
}

function latestRunScoredCount(
  detail: PublisherAbuseReviewDetail | undefined,
  dashboard: PublisherAbuseReviewDashboard | undefined,
) {
  return (
    detail?.latestScoreRun?.scoredPublishers ??
    detail?.item.openedByRun?.scoredPublishers ??
    dashboard?.latestRun?.scoredPublishers
  );
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function formatShortTimestamp(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWholeNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatRatio(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 1 ? 2 : 1,
    minimumFractionDigits: value < 1 ? 2 : 0,
  }).format(value);
}

function formatScore(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

function formatPublisherAbuseRunStatus(status: string) {
  if (status === "completed") return "Completed";
  if (status === "running") return "Running";
  if (status === "failed") return "Failed";
  return status;
}

function formatPublisherAbuseLabel(label: string) {
  if (label === "potential_ban_candidate") return "Potential Ban";
  if (label === "review") return "On the brink";
  if (label === "pass") return "Pass";
  return label;
}

function formatPublisherAbuseStatus(status: string) {
  if (status === "pending") return "Pending";
  if (status === "banned") return "Banned";
  if (status === "reviewed_no_action") return "Reviewed";
  if (status === "false_positive") return "False positive";
  if (status === "needs_policy_discussion") return "Needs discussion";
  if (status === "candidate_for_future_action") return "Future action";
  return status;
}

function publisherAbuseStatusVariant(status: string): NonNullable<BadgeProps["variant"]> {
  if (status === "banned") return "destructive";
  if (status === "false_positive" || status === "reviewed_no_action") return "success";
  if (status === "needs_policy_discussion" || status === "candidate_for_future_action") {
    return "warning";
  }
  return "default";
}

function formatReasonCode(reason: string) {
  return reason
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ")
    .replace("High / Catalog / Volume", "High Catalog Volume")
    .replace("Extreme / Volume / Low / Engagement", "Extreme Volume, Low Engagement")
    .replace("Low / Installs / Per / Skill", "Low Installs / Skill")
    .replace("Low / Stars / Per / Skill", "Low Stars / Skill")
    .replace("Low / Downloads / Per / Skill", "Low Downloads / Skill");
}

function describeReasonCode(reason: string) {
  if (reason === "high_catalog_volume") {
    return "Publisher has an unusually high number of skills compared to peers.";
  }
  if (reason === "extreme_volume_low_engagement") {
    return "Very high catalog volume with extremely low engagement across installs, stars, and downloads.";
  }
  if (reason === "low_installs_per_skill") {
    return "Installs per skill are far below the platform median.";
  }
  if (reason === "low_stars_per_skill") {
    return "Stars per skill are far below the platform median.";
  }
  if (reason === "low_downloads_per_skill") {
    return "Downloads per skill are far below the platform median.";
  }
  return "Model reason emitted by the publisher abuse scorer.";
}

function compactIdentifier(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function zScoreClass(value: number) {
  if (value >= 2.5) return "pa-z-danger";
  if (value >= 1.5) return "pa-z-warn";
  return "pa-z-ok";
}

function formatPressureLabel(score: Pick<PublisherAbuseReviewScore, "zScore">) {
  if (score.zScore >= 2.5) return "Very High";
  if (score.zScore >= 1.5) return "High";
  if (score.zScore >= 0.5) return "Elevated";
  return "Low";
}

function formatMutationError(error: unknown) {
  return getUserFacingConvexError(error, "Request failed.");
}

function formatManualOverrideState(
  override:
    | {
        verdict: string;
        note: string;
        reviewerUserId: string;
        updatedAt: number;
      }
    | null
    | undefined,
  reviewer?: ManagementUserSummary | null,
) {
  if (!override) return "No override.";
  return `${formatVerdictLabel(override.verdict)} · reviewer ${formatManagementUserLabel(reviewer, override.reviewerUserId)} · updated ${formatTimestamp(
    override.updatedAt,
  )} · ${override.note}`;
}

function formatManagementUserLabel(
  user: ManagementUserSummary | null | undefined,
  fallbackId?: string | null,
) {
  if (user?.handle?.trim()) return `@${user.handle.trim()}`;
  if (user?.displayName?.trim()) return user.displayName.trim();
  if (user?.name?.trim()) return user.name.trim();
  if (fallbackId?.trim()) return fallbackId.trim();
  return "unknown user";
}

function formatAuditActionLabel(action: string, metadata?: unknown) {
  const record = asAuditMetadataRecord(metadata);
  if (action === "skill.manual_override.set") {
    const verdict = typeof record?.verdict === "string" ? record.verdict : "unknown";
    return `Override set to ${formatVerdictLabel(verdict)}`;
  }
  if (action === "skill.manual_override.clear") {
    return "Override cleared";
  }
  if (action === "skill.owner.change") {
    return "Owner changed";
  }
  if (action === "skill.duplicate.set") {
    return "Duplicate target set";
  }
  if (action === "skill.duplicate.clear") {
    return "Duplicate target cleared";
  }
  if (action === "skill.auto_hide") {
    return "Skill auto-hidden";
  }
  if (action === "skill.hard_delete") {
    return "Skill hard-deleted";
  }
  if (action.startsWith("skill.transfer.")) {
    return `Transfer ${action.slice("skill.transfer.".length).replaceAll("_", " ")}`;
  }
  if (action.startsWith("skill.")) {
    return action.slice("skill.".length).replaceAll(".", " ").replaceAll("_", " ");
  }
  return action.replaceAll(".", " ").replaceAll("_", " ");
}

function formatAuditMetadataSummary(action: string, metadata?: unknown) {
  const record = asAuditMetadataRecord(metadata);
  if (!record) return null;

  if (action === "skill.manual_override.set") {
    const note = typeof record.note === "string" ? record.note.trim() : "";
    if (note) return note;
    const previousVerdict =
      typeof record.previousVerdict === "string" ? record.previousVerdict : null;
    return previousVerdict ? `Previous verdict: ${formatVerdictLabel(previousVerdict)}` : null;
  }

  if (action === "skill.manual_override.clear") {
    const note = typeof record.note === "string" ? record.note.trim() : "";
    if (note) return note;
    const previousVerdict =
      typeof record.previousVerdict === "string" ? record.previousVerdict : null;
    return previousVerdict
      ? `Previous override verdict: ${formatVerdictLabel(previousVerdict)}`
      : null;
  }

  if (action === "skill.owner.change") {
    const from = typeof record.from === "string" ? record.from : null;
    const to = typeof record.to === "string" ? record.to : null;
    if (from || to) return `from ${from ?? "unknown"} to ${to ?? "unknown"}`;
  }

  if (action === "skill.duplicate.set") {
    return typeof record.canonicalSlug === "string"
      ? `Canonical skill: ${record.canonicalSlug}`
      : null;
  }

  if (action === "skill.duplicate.clear") {
    return "Canonical skill cleared.";
  }

  if (action === "skill.auto_hide") {
    return typeof record.reportCount === "number" ? `${record.reportCount} active reports` : null;
  }

  if (action === "skill.hard_delete") {
    return typeof record.slug === "string" ? `Deleted slug: ${record.slug}` : null;
  }

  if (typeof record.note === "string" && record.note.trim()) {
    return record.note.trim();
  }
  if (typeof record.reason === "string" && record.reason.trim()) {
    return record.reason.trim();
  }
  return null;
}

function asAuditMetadataRecord(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

function formatVerdictLabel(verdict: string) {
  return verdict === "clean" ? "okay" : verdict;
}
