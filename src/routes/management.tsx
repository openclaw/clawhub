import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
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

type ManagementUserSummary = {
  _id: Id<"users">;
  handle?: string | null;
  name?: string | null;
  displayName?: string | null;
};

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

type PublisherAbuseLabelFilter = "all" | Doc<"publisherAbuseScores">["label"];
type PublisherAbuseStatusFilter =
  | "unreviewed"
  | "reviewed"
  | "all"
  | Doc<"publisherAbuseReviewNominations">["status"];

type PublisherAbuseQueueResult = {
  latestRun: {
    _id: Id<"publisherAbuseScoreRuns">;
    status: Doc<"publisherAbuseScoreRuns">["status"];
    phase: Doc<"publisherAbuseScoreRuns">["phase"];
    trigger: Doc<"publisherAbuseScoreRuns">["trigger"];
    modelVersion: string;
    startedAt: number;
    completedAt?: number;
    updatedAt: number;
    scannedPublishers: number;
    scoredPublishers: number;
    finalizedScores: number;
    nominatedPublishers: number;
    passCount: number;
    reviewCount: number;
    potentialBanCandidateCount: number;
    meanLogPressure?: number;
    stdDevLogPressure?: number;
  } | null;
  items: Array<{
    nomination: Doc<"publisherAbuseReviewNominations">;
    score: Doc<"publisherAbuseScores"> | null;
  }>;
  total: number;
};

function resolveOwnerParam(
  handle: string | null | undefined,
  ownerId?: Id<"users"> | Id<"publishers">,
) {
  return handle?.trim().toLowerCase() || (ownerId ? String(ownerId) : "unknown");
}

function promptBanReason(label: string) {
  const result = window.prompt(`Ban reason for ${label} (optional)`);
  if (result === null) return null;
  const trimmed = result.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function promptUnbanReason(label: string) {
  const result = window.prompt(`Unban reason for ${label} (optional)`);
  if (result === null) return null;
  const trimmed = result.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const Route = createFileRoute("/management")({
  validateSearch: (search) => ({
    skill: typeof search.skill === "string" && search.skill.trim() ? search.skill : undefined,
    plugin: typeof search.plugin === "string" && search.plugin.trim() ? search.plugin : undefined,
  }),
  component: Management,
});

function Management() {
  const { me } = useAuthStatus();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const staff = isModerator(me);
  const admin = isAdmin(me);

  const selectedSlug = search.skill?.trim();
  const selectedPluginName = search.plugin?.trim();
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

  const [abuseLabelFilter, setAbuseLabelFilter] = useState<PublisherAbuseLabelFilter>("all");
  const [abuseStatusFilter, setAbuseStatusFilter] =
    useState<PublisherAbuseStatusFilter>("unreviewed");
  const [abuseSearch, setAbuseSearch] = useState("");
  const [abuseSearchDebounced, setAbuseSearchDebounced] = useState("");
  const [abuseMinSkillCount, setAbuseMinSkillCount] = useState("");
  const [abuseRunMessage, setAbuseRunMessage] = useState("");
  const parsedAbuseMinSkillCount = parseOptionalPositiveInt(abuseMinSkillCount);
  const abuseQueue = useQuery(
    api.publisherAbuse.listPublisherAbuseReviewQueue,
    admin
      ? {
          label: abuseLabelFilter,
          status: abuseStatusFilter,
          search: abuseSearchDebounced.trim() || undefined,
          minSkillCount: parsedAbuseMinSkillCount,
          limit: 50,
        }
      : "skip",
  ) as PublisherAbuseQueueResult | undefined;

  const setRole = useMutation(api.users.setRole);
  const banUser = useMutation(api.users.banUser);
  const unbanUser = useMutation(api.users.unbanUser);
  const startManualAbuseScoreRun = useMutation(
    api.publisherAbuse.startManualPublisherAbuseScoreRun,
  );
  const setAbuseReviewStatus = useMutation(api.publisherAbuse.setPublisherAbuseReviewStatus);
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

  const [selectedDuplicate, setSelectedDuplicate] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportSearchDebounced, setReportSearchDebounced] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userSearchDebounced, setUserSearchDebounced] = useState("");
  const [pluginSearch, setPluginSearch] = useState(selectedPluginName ?? "");
  const [skillOverrideNote, setSkillOverrideNote] = useState("");

  const userQuery = userSearchDebounced.trim();
  const userResult = useQuery(
    api.users.list,
    admin ? { limit: 200, search: userQuery || undefined } : "skip",
  ) as { items: Doc<"users">[]; total: number } | undefined;

  const selectedOwnerUserId = selectedSkill?.skill?.ownerUserId ?? null;
  const selectedCanonicalSlug = selectedSkill?.canonical?.skill?.slug ?? "";

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
    const handle = setTimeout(() => setReportSearchDebounced(reportSearch), 250);
    return () => clearTimeout(handle);
  }, [reportSearch]);

  useEffect(() => {
    const handle = setTimeout(() => setUserSearchDebounced(userSearch), 250);
    return () => clearTimeout(handle);
  }, [userSearch]);

  useEffect(() => {
    const handle = setTimeout(() => setAbuseSearchDebounced(abuseSearch), 250);
    return () => clearTimeout(handle);
  }, [abuseSearch]);

  if (!staff) {
    return (
      <main className="section">
        <Card>Management only.</Card>
      </main>
    );
  }

  if (!recentVersions || !reportedSkills || !duplicateCandidates) {
    return (
      <main className="section">
        <Card>Loading management console…</Card>
      </main>
    );
  }

  const reportQuery = reportSearchDebounced.trim().toLowerCase();
  const filteredReportedSkills = reportQuery
    ? reportedSkills.filter((entry) => {
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
      })
    : reportedSkills;
  const reportCountLabel =
    filteredReportedSkills.length === 0 && reportedSkills.length > 0
      ? "No matching reports."
      : "No reports yet.";
  const reportSummary = `Showing ${filteredReportedSkills.length} of ${reportedSkills.length}`;

  const filteredUsers = userResult?.items ?? [];
  const userTotal = userResult?.total ?? 0;
  const userSummary = userResult
    ? `Showing ${filteredUsers.length} of ${userTotal}`
    : "Loading users…";
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
      })
      .catch((error) => window.alert(formatMutationError(error)));
  };

  const clearSkillOverride = () => {
    if (!selectedSkill?.skill?.manualOverride) return;
    void clearSkillManualOverride({
      skillId: selectedSkill.skill._id,
      note: skillOverrideNote,
    })
      .then(() => {
        setSkillOverrideNote("");
      })
      .catch((error) => window.alert(formatMutationError(error)));
  };

  const managePlugin = () => {
    const name = pluginSearch.trim();
    if (!name) return;
    void navigate({
      to: "/management",
      search: { skill: undefined, plugin: name },
    });
  };

  const startAbuseRun = () => {
    setAbuseRunMessage("Starting dry-run score refresh…");
    void startManualAbuseScoreRun({ batchSize: 250, maxPages: 5 })
      .then((result) => {
        setAbuseRunMessage(`Started run ${result.runId}.`);
      })
      .catch((error) => setAbuseRunMessage(formatMutationError(error)));
  };

  const changeAbuseStatus = (
    nomination: Doc<"publisherAbuseReviewNominations">,
    status: Doc<"publisherAbuseReviewNominations">["status"],
  ) => {
    const notes = window.prompt(`Notes for @${nomination.handleSnapshot} (optional)`);
    if (notes === null) return;
    void setAbuseReviewStatus({
      nominationId: nomination._id,
      status,
      notes,
    }).catch((error) => window.alert(formatMutationError(error)));
  };

  return (
    <main className="section">
      <h1 className="section-title">Management console</h1>
      <p className="section-subtitle">Moderation, curation, and ownership tools.</p>

      {admin ? (
        <Card>
          <div className="management-section-header">
            <div>
              <h2 className="section-title text-[1.2rem] m-0">Publisher abuse dry run</h2>
              <p className="section-subtitle mt-2 mb-0">
                Dry run only. Scores create admin review work; they do not ban, hide, throttle, or
                block publishing.
              </p>
            </div>
            <Button type="button" onClick={startAbuseRun}>
              Refresh scores
            </Button>
          </div>
          {abuseRunMessage ? <div className="management-count mt-2">{abuseRunMessage}</div> : null}
          {abuseQueue?.latestRun ? (
            <div className="management-stat-grid">
              <div className="stat">
                <strong>{abuseQueue.latestRun.scoredPublishers.toLocaleString()}</strong>
                <span>scored</span>
              </div>
              <div className="stat">
                <strong>{abuseQueue.latestRun.reviewCount.toLocaleString()}</strong>
                <span>review</span>
              </div>
              <div className="stat">
                <strong>{abuseQueue.latestRun.potentialBanCandidateCount.toLocaleString()}</strong>
                <span>potential ban candidates</span>
              </div>
              <div className="stat">
                <strong>{abuseQueue.latestRun.status}</strong>
                <span>{formatTimestamp(abuseQueue.latestRun.updatedAt)}</span>
              </div>
            </div>
          ) : (
            <div className="stat mt-3">No score run recorded yet.</div>
          )}
          <div className="management-controls mt-4">
            <label className="management-control management-control-stack">
              <span className="mono">Label</span>
              <Select
                value={abuseLabelFilter}
                onValueChange={(value) => {
                  if (isPublisherAbuseLabelFilter(value)) setAbuseLabelFilter(value);
                }}
              >
                <SelectTrigger className="management-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All labels</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="potential_ban_candidate">Potential ban candidate</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="management-control management-control-stack">
              <span className="mono">Status</span>
              <Select
                value={abuseStatusFilter}
                onValueChange={(value) => {
                  if (isPublisherAbuseStatusFilter(value)) setAbuseStatusFilter(value);
                }}
              >
                <SelectTrigger className="management-field">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unreviewed">Unreviewed</SelectItem>
                  <SelectItem value="reviewed">Reviewed</SelectItem>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="needs_policy_discussion">Needs policy discussion</SelectItem>
                  <SelectItem value="candidate_for_future_action">
                    Candidate for future action
                  </SelectItem>
                  <SelectItem value="reviewed_no_action">Reviewed, no action</SelectItem>
                  <SelectItem value="false_positive">False positive</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="management-control management-control-stack">
              <span className="mono">Min skills</span>
              <input
                className="management-field"
                inputMode="numeric"
                value={abuseMinSkillCount}
                onChange={(event) => setAbuseMinSkillCount(event.target.value)}
                placeholder="0"
              />
            </label>
            <div className="management-control management-search">
              <span className="mono">Search</span>
              <input
                type="search"
                placeholder="Publisher or owner key"
                value={abuseSearch}
                onChange={(event) => setAbuseSearch(event.target.value)}
              />
            </div>
            <div className="management-count">
              {abuseQueue
                ? `Showing ${abuseQueue.items.length} of ${abuseQueue.total}`
                : "Loading…"}
            </div>
          </div>
          <div className="management-list">
            {!abuseQueue ? (
              <div className="stat">Loading publisher abuse queue…</div>
            ) : abuseQueue.items.length === 0 ? (
              <div className="stat">No matching nominations.</div>
            ) : (
              abuseQueue.items.map(({ nomination, score }) => (
                <div key={nomination._id} className="management-item management-abuse-item">
                  <div className="management-item-main">
                    <div className="management-abuse-title">
                      <Link to="/p/$handle" params={{ handle: nomination.handleSnapshot }}>
                        @{nomination.handleSnapshot}
                      </Link>
                      <Badge>{formatPublisherAbuseLabel(nomination.label)}</Badge>
                    </div>
                    <div className="section-subtitle m-0">
                      {nomination.status.replaceAll("_", " ")} · model {nomination.modelVersion} ·
                      last scored {formatTimestamp(nomination.lastScoredAt)}
                    </div>
                    {score ? (
                      <div className="management-abuse-metrics">
                        <span>{score.rank.toLocaleString()} rank</span>
                        <span>{formatFixed(score.zScore, 2)} z</span>
                        <span>{formatFixed(score.pressure, 2)} pressure</span>
                        <span>{score.publishedSkills.toLocaleString()} skills</span>
                        <span>{score.totalInstalls.toLocaleString()} installs</span>
                        <span>{score.totalStars.toLocaleString()} stars</span>
                        <span>{score.totalDownloads.toLocaleString()} downloads</span>
                        <span>{formatFixed(score.installsPerSkill, 2)} installs/skill</span>
                        <span>{formatFixed(score.starsPerSkill, 3)} stars/skill</span>
                        <span>{formatFixed(score.downloadsPerSkill, 1)} downloads/skill</span>
                      </div>
                    ) : (
                      <div className="section-subtitle m-0">Latest score row is missing.</div>
                    )}
                    {score?.reasonCodes.length ? (
                      <div className="management-tags">
                        {score.reasonCodes.map((reason) => (
                          <Badge key={reason}>{reason.replaceAll("_", " ")}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="management-actions management-action-grid">
                    <Select
                      value={nomination.status}
                      onValueChange={(value) => {
                        if (isPublisherAbuseTriageStatus(value)) {
                          changeAbuseStatus(nomination, value);
                        }
                      }}
                    >
                      <SelectTrigger className="management-action-btn">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="reviewed_no_action">Reviewed, no action</SelectItem>
                        <SelectItem value="false_positive">False positive</SelectItem>
                        <SelectItem value="needs_policy_discussion">
                          Needs policy discussion
                        </SelectItem>
                        <SelectItem value="candidate_for_future_action">
                          Candidate for future action
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button asChild className="management-action-btn">
                      <Link to="/p/$handle" params={{ handle: nomination.handleSnapshot }}>
                        View publisher
                      </Link>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <h2 className="section-title text-[1.2rem] m-0">Reported skills</h2>
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
          {filteredReportedSkills.length === 0 ? (
            <div className="stat">{reportCountLabel}</div>
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
                      @{owner?.handle ?? owner?.name ?? "user"} · v{latestVersion?.version ?? "—"} ·
                      {skill.reportCount ?? 0} report{(skill.reportCount ?? 0) === 1 ? "" : "s"}
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
                      <Link to="/management" search={{ skill: skill.slug, plugin: undefined }}>
                        Manage
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        const reason = window.prompt(
                          skill.softDeletedAt ? "Restore reason:" : "Hide reason:",
                        );
                        if (!reason?.trim()) return;
                        void setSoftDeleted({
                          skillId: skill._id,
                          deleted: !skill.softDeletedAt,
                          reason: reason.trim(),
                        }).catch((error) => window.alert(formatMutationError(error)));
                      }}
                    >
                      {skill.softDeletedAt ? "Restore" : "Hide"}
                    </Button>
                    {admin ? (
                      <Button
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Hard delete ${skill.displayName}?`)) return;
                          void hardDelete({ skillId: skill._id });
                        }}
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
      </Card>

      <Card className="mt-5">
        <h2 className="section-title text-[1.2rem] m-0">Skill tools</h2>
        {selectedSlug ? (
          <div className="section-subtitle mt-2">
            Managing "{selectedSlug}" ·{" "}
            <Link to="/management" search={{ skill: undefined, plugin: undefined }}>
              Clear selection
            </Link>
          </div>
        ) : null}
        <div className="management-list">
          {!selectedSlug ? (
            <div className="stat">Use the Manage button on a skill to open tooling here.</div>
          ) : selectedSkill === undefined ? (
            <div className="stat">Loading skill…</div>
          ) : !selectedSkill?.skill ? (
            <div className="stat">No skill found for "{selectedSlug}".</div>
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
                      @{owner?.handle ?? owner?.name ?? "user"} · v{latestVersion?.version ?? "—"} ·
                      updated {formatTimestamp(skill.updatedAt)} · {moderationStatus}
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
                            {latestVersion ? `v${latestVersion.version}` : "No published version."}
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
                            <span className="mono">owner</span>
                            <Select value={selectedOwner} onValueChange={setSelectedOwner}>
                              <SelectTrigger className="management-field">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {filteredUsers.map((user) => (
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
                      onClick={() => {
                        const reason = window.prompt(
                          skill.softDeletedAt ? "Restore reason:" : "Hide reason:",
                        );
                        if (!reason?.trim()) return;
                        void setSoftDeleted({
                          skillId: skill._id,
                          deleted: !skill.softDeletedAt,
                          reason: reason.trim(),
                        }).catch((error) => window.alert(formatMutationError(error)));
                      }}
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
                        onClick={() => {
                          if (!window.confirm(`Hard delete ${skill.displayName}?`)) return;
                          void hardDelete({ skillId: skill._id });
                        }}
                      >
                        Hard delete
                      </Button>
                    ) : null}
                    {staff ? (
                      <Button
                        className="management-action-btn"
                        type="button"
                        disabled={!canBanOwner}
                        onClick={() => {
                          if (!ownerUserId || ownerUserId === me?._id) return;
                          if (!window.confirm(`Ban @${ownerHandle} and delete their skills?`)) {
                            return;
                          }
                          const reason = promptBanReason(`@${ownerHandle}`);
                          if (reason === null) return;
                          void banUser({ userId: ownerUserId, reason });
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
      </Card>

      <Card className="mt-5">
        <h2 className="section-title text-[1.2rem] m-0">Plugin tools</h2>
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
            <Link to="/management" search={{ skill: undefined, plugin: undefined }}>
              Clear selection
            </Link>
          </div>
        ) : null}
        <div className="management-list">
          {!selectedPluginName ? (
            <div className="stat">Enter a plugin package name to open tooling here.</div>
          ) : selectedPlugin === undefined ? (
            <div className="stat">Loading plugin…</div>
          ) : !selectedPlugin?.package ? (
            <div className="stat">No plugin found for "{selectedPluginName}".</div>
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
                      {plugin.isOfficial ? <Badge>official</Badge> : null}
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
                        }).catch((error) => window.alert(formatMutationError(error)))
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
      </Card>

      <Card className="mt-5">
        <h2 className="section-title text-[1.2rem] m-0">Duplicate candidates</h2>
        <div className="management-list">
          {duplicateCandidates.length === 0 ? (
            <div className="stat">No duplicate candidates.</div>
          ) : (
            duplicateCandidates.map((entry) => (
              <div key={entry.skill._id} className="management-item">
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
                    {entry.latestVersion?.version ?? "—"} · fingerprint{" "}
                    {entry.fingerprint?.slice(0, 8)}
                  </div>
                  <div className="management-sublist">
                    {entry.matches.map((match) => (
                      <div key={match.skill._id} className="management-subitem">
                        <div>
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
            ))
          )}
        </div>
      </Card>

      <Card className="mt-5">
        <h2 className="section-title text-[1.2rem] m-0">Recent pushes</h2>
        <div className="management-list">
          {recentVersions.length === 0 ? (
            <div className="stat">No recent versions.</div>
          ) : (
            recentVersions.map((entry) => (
              <div key={entry.version._id} className="management-item">
                <div className="management-item-main">
                  <strong>{entry.skill?.displayName ?? "Unknown skill"}</strong>
                  <div className="section-subtitle m-0">
                    v{entry.version.version} · @{entry.owner?.handle ?? entry.owner?.name ?? "user"}
                  </div>
                </div>
                <div className="management-actions">
                  {entry.skill ? (
                    <Button asChild>
                      <Link
                        to="/management"
                        search={{ skill: entry.skill.slug, plugin: undefined }}
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
      </Card>

      {admin ? (
        <Card className="mt-5">
          <h2 className="section-title text-[1.2rem] m-0">Users</h2>
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
              <div className="stat">{userEmptyLabel}</div>
            ) : (
              filteredUsers.map((user) => (
                <div key={user._id} className="management-item">
                  <div className="management-item-main">
                    <span className="mono">@{user.handle ?? user.name ?? "user"}</span>
                    {user.deletedAt || user.deactivatedAt ? (
                      <div className="section-subtitle m-0">
                        {user.banReason && user.deletedAt
                          ? `Banned ${formatTimestamp(user.deletedAt)} · ${user.banReason}`
                          : `Deleted ${formatTimestamp((user.deactivatedAt ?? user.deletedAt) as number)}`}
                      </div>
                    ) : null}
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
                      disabled={user._id === me?._id}
                      onClick={() => {
                        if (user._id === me?._id) return;
                        if (
                          !window.confirm(
                            `Ban @${user.handle ?? user.name ?? "user"} and delete their skills?`,
                          )
                        ) {
                          return;
                        }
                        const label = `@${user.handle ?? user.name ?? "user"}`;
                        const reason = promptBanReason(label);
                        if (reason === null) return;
                        void banUser({ userId: user._id, reason }).catch((error) =>
                          window.alert(formatMutationError(error)),
                        );
                      }}
                    >
                      Ban user
                    </Button>
                    {user.deletedAt && !user.deactivatedAt ? (
                      <Button
                        type="button"
                        onClick={() => {
                          const label = `@${user.handle ?? user.name ?? "user"}`;
                          if (!window.confirm(`Unban ${label} and restore eligible skills?`)) {
                            return;
                          }
                          const reason = promptUnbanReason(label);
                          if (reason === null) return;
                          void unbanUser({ userId: user._id, reason }).catch((error) =>
                            window.alert(formatMutationError(error)),
                          );
                        }}
                      >
                        Unban user
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      ) : null}
    </main>
  );
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

function formatFixed(value: number, digits: number) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function parseOptionalPositiveInt(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatPublisherAbuseLabel(label: Doc<"publisherAbuseScores">["label"]) {
  if (label === "potential_ban_candidate") return "Potential ban candidate";
  if (label === "review") return "Review";
  return "Pass";
}

function isPublisherAbuseLabelFilter(value: string): value is PublisherAbuseLabelFilter {
  return (
    value === "all" || value === "pass" || value === "review" || value === "potential_ban_candidate"
  );
}

function isPublisherAbuseStatusFilter(value: string): value is PublisherAbuseStatusFilter {
  return (
    value === "unreviewed" ||
    value === "reviewed" ||
    value === "all" ||
    isPublisherAbuseTriageStatus(value)
  );
}

function isPublisherAbuseTriageStatus(
  value: string,
): value is Doc<"publisherAbuseReviewNominations">["status"] {
  return (
    value === "pending" ||
    value === "reviewed_no_action" ||
    value === "false_positive" ||
    value === "needs_policy_discussion" ||
    value === "candidate_for_future_action"
  );
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
