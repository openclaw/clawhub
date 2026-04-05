import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SKILL_CAPABILITY_TAGS } from "../../convex/lib/skillCapabilityTags";
import {
  getSkillBadges,
  isSkillDeprecated,
  isSkillHighlighted,
  isSkillOfficial,
} from "../lib/badges";
import { getUserFacingConvexError } from "../lib/convexError";
import { isAdmin, isModerator } from "../lib/roles";
import { useAuthStatus } from "../lib/useAuthStatus";

const SKILL_AUDIT_LOG_LIMIT = 10;
const SKILL_CAPABILITY_LABELS: Record<string, string> = {
  crypto: "Crypto",
  "requires-wallet": "Requires wallet",
  "can-make-purchases": "Can make purchases",
  "can-sign-transactions": "Can sign transactions",
  "requires-oauth-token": "Requires OAuth token",
  "posts-externally": "Posts externally",
};

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

type SkillVisibilityDialogState = {
  skillId: Id<"skills">;
  displayName: string;
  action: "hide" | "restore";
} | null;

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
  }),
  component: Management,
});

function Management() {
  const { me } = useAuthStatus();
  const search = Route.useSearch();
  const staff = isModerator(me);
  const admin = isAdmin(me);

  const selectedSlug = search.skill?.trim();
  const selectedSkill = useQuery(
    api.skills.getBySlugForStaff,
    staff && selectedSlug ? { slug: selectedSlug, auditLogLimit: SKILL_AUDIT_LOG_LIMIT } : "skip",
  ) as SkillBySlugResult | undefined;
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

  const setRole = useMutation(api.users.setRole);
  const banUser = useMutation(api.users.banUser);
  const unbanUser = useMutation(api.users.unbanUser);
  const setBatch = useMutation(api.skills.setBatch);
  const setSoftDeleted = useMutation(api.skills.setSoftDeleted);
  const hardDelete = useMutation(api.skills.hardDelete);
  const changeOwner = useMutation(api.skills.changeOwner);
  const setDuplicate = useMutation(api.skills.setDuplicate);
  const setOfficialBadge = useMutation(api.skills.setOfficialBadge);
  const setDeprecatedBadge = useMutation(api.skills.setDeprecatedBadge);
  const setSkillCapabilityTags = useMutation(api.skills.setSkillCapabilityTags);
  const setSkillManualOverride = useMutation(api.skills.setSkillManualOverride);
  const clearSkillManualOverride = useMutation(api.skills.clearSkillManualOverride);

  const [selectedDuplicate, setSelectedDuplicate] = useState("");
  const [selectedOwner, setSelectedOwner] = useState("");
  const [reportSearch, setReportSearch] = useState("");
  const [reportSearchDebounced, setReportSearchDebounced] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userSearchDebounced, setUserSearchDebounced] = useState("");
  const [skillOverrideNote, setSkillOverrideNote] = useState("");
  const [visibilityDialog, setVisibilityDialog] = useState<SkillVisibilityDialogState>(null);
  const [visibilityReason, setVisibilityReason] = useState("");
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [isVisibilitySubmitting, setIsVisibilitySubmitting] = useState(false);

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
    const handle = setTimeout(() => setReportSearchDebounced(reportSearch), 250);
    return () => clearTimeout(handle);
  }, [reportSearch]);

  useEffect(() => {
    const handle = setTimeout(() => setUserSearchDebounced(userSearch), 250);
    return () => clearTimeout(handle);
  }, [userSearch]);

  if (!staff) {
    return (
      <main className="section">
        <div className="card">Management only.</div>
      </main>
    );
  }

  if (!recentVersions || !reportedSkills || !duplicateCandidates) {
    return (
      <main className="section">
        <div className="card">Loading management console…</div>
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

  const toggleSkillCapabilityTag = (tag: string, checked: boolean) => {
    if (!selectedSkill?.skill) return;
    const currentTags = new Set(
      selectedSkill.latestVersion?.capabilityTags ?? selectedSkill.skill.capabilityTags ?? [],
    );
    if (checked) currentTags.add(tag);
    else currentTags.delete(tag);
    void setSkillCapabilityTags({
      skillId: selectedSkill.skill._id,
      capabilityTags: SKILL_CAPABILITY_TAGS.filter((entry) => currentTags.has(entry)),
    }).catch((error) => window.alert(formatMutationError(error)));
  };

  const openVisibilityDialog = (
    skillId: Id<"skills">,
    displayName: string,
    action: "hide" | "restore",
  ) => {
    setVisibilityDialog({ skillId, displayName, action });
    setVisibilityReason("");
    setVisibilityError(null);
    setIsVisibilitySubmitting(false);
  };

  const closeVisibilityDialog = () => {
    if (isVisibilitySubmitting) return;
    setVisibilityDialog(null);
    setVisibilityReason("");
    setVisibilityError(null);
  };

  const submitVisibilityDialog = () => {
    if (!visibilityDialog) return;
    const reason = visibilityReason.trim();
    if (!reason) {
      setVisibilityError(
        visibilityDialog.action === "hide"
          ? "Hide reason is required."
          : "Restore reason is required.",
      );
      return;
    }

    setVisibilityError(null);
    setIsVisibilitySubmitting(true);
    void setSoftDeleted({
      skillId: visibilityDialog.skillId,
      deleted: visibilityDialog.action === "hide",
      reason,
    })
      .then(() => {
        setVisibilityDialog(null);
        setVisibilityReason("");
        setVisibilityError(null);
      })
      .catch((error) => {
        setVisibilityError(formatMutationError(error));
      })
      .finally(() => {
        setIsVisibilitySubmitting(false);
      });
  };

  return (
    <main className="section">
      <h1 className="section-title">Management console</h1>
      <p className="section-subtitle">Moderation, curation, and ownership tools.</p>

      <div className="card">
        <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
          Reported skills
        </h2>
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
                    <div className="section-subtitle" style={{ margin: 0 }}>
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
                      <div className="section-subtitle" style={{ margin: 0 }}>
                        No report reasons yet.
                      </div>
                    )}
                  </div>
                  <div className="management-actions">
                    <Link className="btn" to="/management" search={{ skill: skill.slug }}>
                      Manage
                    </Link>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        openVisibilityDialog(
                          skill._id,
                          skill.displayName,
                          skill.softDeletedAt ? "restore" : "hide",
                        )
                      }
                    >
                      {skill.softDeletedAt ? "Restore" : "Hide"}
                    </button>
                    {admin ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Hard delete ${skill.displayName}?`)) return;
                          void hardDelete({ skillId: skill._id });
                        }}
                      >
                        Hard delete
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
          Skill tools
        </h2>
        {selectedSlug ? (
          <div className="section-subtitle" style={{ marginTop: 8 }}>
            Managing "{selectedSlug}" ·{" "}
            <Link to="/management" search={{ skill: undefined }}>
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
              const capabilityTags = latestVersion?.capabilityTags ?? skill.capabilityTags ?? [];
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
                    <div className="section-subtitle" style={{ margin: 0 }}>
                      @{owner?.handle ?? owner?.name ?? "user"} · v{latestVersion?.version ?? "—"} ·
                      updated {formatTimestamp(skill.updatedAt)} · {moderationStatus}
                      {badges.length ? ` · ${badges.join(", ").toLowerCase()}` : ""}
                    </div>
                    {skill.moderationFlags?.length ? (
                      <div className="management-tags">
                        {skill.moderationFlags.map((flag: string) => (
                          <span key={flag} className="tag">
                            {flag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="management-sublist">
                      <div className="section-subtitle" style={{ margin: 0 }}>
                        Capability tags
                      </div>
                      <div className="management-capability-options">
                        {SKILL_CAPABILITY_TAGS.map((tag) => (
                          <label key={tag} className="management-capability-option">
                            <input
                              type="checkbox"
                              checked={capabilityTags.includes(tag)}
                              onChange={(event) =>
                                toggleSkillCapabilityTag(tag, event.target.checked)
                              }
                            />
                            <span>{SKILL_CAPABILITY_LABELS[tag] ?? tag}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="management-sublist">
                      <div className="section-subtitle" style={{ margin: 0 }}>
                        Manual overrides
                      </div>
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
                          <button
                            className="btn management-action-btn"
                            type="button"
                            disabled={!skillOverrideNote.trim()}
                            onClick={applySkillOverride}
                          >
                            {skill.manualOverride ? "Update okay override" : "Mark skill okay"}
                          </button>
                          {skill.manualOverride ? (
                            <button
                              className="btn management-action-btn"
                              type="button"
                              disabled={!skillOverrideNote.trim()}
                              onClick={clearSkillOverride}
                            >
                              Clear skill override
                            </button>
                          ) : null}
                        </div>
                      </section>
                    </div>
                    <div className="management-sublist">
                      <div className="section-subtitle" style={{ margin: 0 }}>
                        Recent audit activity
                      </div>
                      <section className="management-override-panel management-audit-panel">
                        <div className="management-report-item">
                          <span className="management-report-meta">Window</span>
                          <span>Last {SKILL_AUDIT_LOG_LIMIT} entries for this skill.</span>
                        </div>
                        {auditLogs.length === 0 ? (
                          <div className="section-subtitle" style={{ margin: 0 }}>
                            No audit activity yet.
                          </div>
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
                        <button
                          className="btn management-action-btn"
                          type="button"
                          onClick={() =>
                            void setDuplicate({
                              skillId: skill._id,
                              canonicalSlug: selectedDuplicate.trim() || undefined,
                            })
                          }
                        >
                          Set duplicate
                        </button>
                      </div>
                      {admin ? (
                        <>
                          <label className="management-control management-control-stack">
                            <span className="mono">owner</span>
                            <select
                              className="management-field"
                              value={selectedOwner}
                              onChange={(event) => setSelectedOwner(event.target.value)}
                            >
                              {filteredUsers.map((user) => (
                                <option key={user._id} value={user._id}>
                                  @{user.handle ?? user.name ?? "user"}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="management-control management-control-stack">
                            <span className="mono">owner action</span>
                            <button
                              className="btn management-action-btn"
                              type="button"
                              onClick={() =>
                                void changeOwner({
                                  skillId: skill._id,
                                  ownerUserId: selectedOwner as Doc<"users">["_id"],
                                })
                              }
                            >
                              Change owner
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="management-actions management-action-grid">
                    <Link
                      className="btn management-action-btn"
                      to="/$owner/$slug"
                      params={{ owner: ownerParam, slug: skill.slug }}
                    >
                      View
                    </Link>
                    <button
                      className="btn management-action-btn"
                      type="button"
                      onClick={() =>
                        openVisibilityDialog(
                          skill._id,
                          skill.displayName,
                          skill.softDeletedAt ? "restore" : "hide",
                        )
                      }
                    >
                      {skill.softDeletedAt ? "Restore" : "Hide"}
                    </button>
                    <button
                      className="btn management-action-btn"
                      type="button"
                      onClick={() =>
                        void setBatch({
                          skillId: skill._id,
                          batch: isHighlighted ? undefined : "highlighted",
                        })
                      }
                    >
                      {isHighlighted ? "Unhighlight" : "Highlight"}
                    </button>
                    {admin ? (
                      <button
                        className="btn management-action-btn"
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Hard delete ${skill.displayName}?`)) return;
                          void hardDelete({ skillId: skill._id });
                        }}
                      >
                        Hard delete
                      </button>
                    ) : null}
                    {staff ? (
                      <button
                        className="btn management-action-btn"
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
                      </button>
                    ) : null}
                    {admin ? (
                      <>
                        <button
                          className="btn management-action-btn"
                          type="button"
                          onClick={() =>
                            void setOfficialBadge({
                              skillId: skill._id,
                              official: !isOfficial,
                            })
                          }
                        >
                          {isOfficial ? "Remove official" : "Mark official"}
                        </button>
                        <button
                          className="btn management-action-btn"
                          type="button"
                          onClick={() =>
                            void setDeprecatedBadge({
                              skillId: skill._id,
                              deprecated: !isDeprecated,
                            })
                          }
                        >
                          {isDeprecated ? "Remove deprecated" : "Mark deprecated"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
          Duplicate candidates
        </h2>
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
                  <div className="section-subtitle" style={{ margin: 0 }}>
                    @{entry.owner?.handle ?? entry.owner?.name ?? "user"} · v
                    {entry.latestVersion?.version ?? "—"} · fingerprint{" "}
                    {entry.fingerprint?.slice(0, 8)}
                  </div>
                  <div className="management-sublist">
                    {entry.matches.map((match) => (
                      <div key={match.skill._id} className="management-subitem">
                        <div>
                          <strong>{match.skill.displayName}</strong>
                          <div className="section-subtitle" style={{ margin: 0 }}>
                            @{match.owner?.handle ?? match.owner?.name ?? "user"} ·{" "}
                            {match.skill.slug}
                          </div>
                        </div>
                        <div className="management-actions">
                          <Link
                            className="btn"
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
                          <button
                            className="btn"
                            type="button"
                            onClick={() =>
                              void setDuplicate({
                                skillId: entry.skill._id,
                                canonicalSlug: match.skill.slug,
                              })
                            }
                          >
                            Mark duplicate
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="management-actions">
                  <Link
                    className="btn"
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
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
          Recent pushes
        </h2>
        <div className="management-list">
          {recentVersions.length === 0 ? (
            <div className="stat">No recent versions.</div>
          ) : (
            recentVersions.map((entry) => (
              <div key={entry.version._id} className="management-item">
                <div className="management-item-main">
                  <strong>{entry.skill?.displayName ?? "Unknown skill"}</strong>
                  <div className="section-subtitle" style={{ margin: 0 }}>
                    v{entry.version.version} · @{entry.owner?.handle ?? entry.owner?.name ?? "user"}
                  </div>
                </div>
                <div className="management-actions">
                  {entry.skill ? (
                    <Link className="btn" to="/management" search={{ skill: entry.skill.slug }}>
                      Manage
                    </Link>
                  ) : null}
                  {entry.skill ? (
                    <Link
                      className="btn"
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
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {admin ? (
        <div className="card" style={{ marginTop: 20 }}>
          <h2 className="section-title" style={{ fontSize: "1.2rem", margin: 0 }}>
            Users
          </h2>
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
                      <div className="section-subtitle" style={{ margin: 0 }}>
                        {user.banReason && user.deletedAt
                          ? `Banned ${formatTimestamp(user.deletedAt)} · ${user.banReason}`
                          : `Deleted ${formatTimestamp((user.deactivatedAt ?? user.deletedAt) as number)}`}
                      </div>
                    ) : null}
                  </div>
                  <div className="management-actions">
                    <select
                      value={user.role ?? "user"}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "admin" || value === "moderator" || value === "user") {
                          void setRole({ userId: user._id, role: value });
                        }
                      }}
                    >
                      <option value="user">User</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      className="btn"
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
                    </button>
                    {user.deletedAt && !user.deactivatedAt ? (
                      <button
                        className="btn"
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
                      </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {visibilityDialog ? (
        <div className="report-dialog-backdrop">
          <div className="report-dialog" role="dialog" aria-modal="true" aria-labelledby="visibility-dialog-title">
            <h2
              id="visibility-dialog-title"
              className="section-title"
              style={{ margin: 0, fontSize: "1.1rem" }}
            >
              {visibilityDialog.action === "hide" ? "Hide skill" : "Restore skill"}
            </h2>
            <p className="section-subtitle" style={{ margin: 0 }}>
              {visibilityDialog.action === "hide"
                ? `Why are you hiding ${visibilityDialog.displayName}?`
                : `Why are you restoring ${visibilityDialog.displayName}?`}
            </p>
            <form
              className="report-dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitVisibilityDialog();
              }}
            >
              <textarea
                className="report-dialog-textarea"
                aria-label={
                  visibilityDialog.action === "hide" ? "Hide reason" : "Restore reason"
                }
                placeholder={
                  visibilityDialog.action === "hide"
                    ? "What should staff know about why this is being hidden?"
                    : "What changed, and why is this being restored?"
                }
                value={visibilityReason}
                onChange={(event) => setVisibilityReason(event.target.value)}
                rows={5}
                disabled={isVisibilitySubmitting}
              />
              {visibilityError ? <p className="report-dialog-error">{visibilityError}</p> : null}
              <div className="report-dialog-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeVisibilityDialog}
                  disabled={isVisibilitySubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn"
                  disabled={isVisibilitySubmitting || !visibilityReason.trim()}
                >
                  {isVisibilitySubmitting
                    ? visibilityDialog.action === "hide"
                      ? "Hiding…"
                      : "Restoring…"
                    : visibilityDialog.action === "hide"
                      ? "Hide skill"
                      : "Restore skill"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
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
