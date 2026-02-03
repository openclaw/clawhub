import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import {
  getSkillBadges,
  isSkillDeprecated,
  isSkillHighlighted,
  isSkillOfficial,
} from '../lib/badges'
import { isAdmin, isModerator } from '../lib/roles'
import { useAuthStatus } from '../lib/useAuthStatus'

type ManagementSkillEntry = {
  skill: Doc<'skills'>
  latestVersion: Doc<'skillVersions'> | null
  owner: Doc<'users'> | null
}

type ReportReasonEntry = {
  reason: string
  createdAt: number
  reporterHandle: string | null
  reporterId: Id<'users'>
}

type ReportedSkillEntry = ManagementSkillEntry & {
  reports: ReportReasonEntry[]
}

type RecentVersionEntry = {
  version: Doc<'skillVersions'>
  skill: Doc<'skills'> | null
  owner: Doc<'users'> | null
}

type DuplicateCandidateEntry = {
  skill: Doc<'skills'>
  latestVersion: Doc<'skillVersions'> | null
  fingerprint: string | null
  matches: Array<{ skill: Doc<'skills'>; owner: Doc<'users'> | null }>
  owner: Doc<'users'> | null
}

type SkillBySlugResult = {
  skill: Doc<'skills'>
  latestVersion: Doc<'skillVersions'> | null
  owner: Doc<'users'> | null
  canonical: {
    skill: { slug: string; displayName: string }
    owner: { handle: string | null; userId: Id<'users'> | null }
  } | null
} | null

function resolveOwnerParam(handle: string | null | undefined, ownerId?: Id<'users'>) {
  return handle?.trim() || (ownerId ? String(ownerId) : 'unknown')
}

export const Route = createFileRoute('/management')({
  validateSearch: (search) => ({
    skill: typeof search.skill === 'string' && search.skill.trim() ? search.skill : undefined,
  }),
  component: Management,
})

function Management() {
  const { me } = useAuthStatus()
  const search = Route.useSearch()
  const staff = isModerator(me)
  const admin = isAdmin(me)

  const users = useQuery(api.users.list, admin ? { limit: 50 } : 'skip') as
    | Doc<'users'>[]
    | undefined
  const selectedSlug = search.skill?.trim()
  const selectedSkill = useQuery(
    api.skills.getBySlugForStaff,
    staff && selectedSlug ? { slug: selectedSlug } : 'skip',
  ) as SkillBySlugResult | undefined
  const recentVersions = useQuery(api.skills.listRecentVersions, staff ? { limit: 20 } : 'skip') as
    | RecentVersionEntry[]
    | undefined
  const reportedSkills = useQuery(api.skills.listReportedSkills, staff ? { limit: 25 } : 'skip') as
    | ReportedSkillEntry[]
    | undefined
  const duplicateCandidates = useQuery(
    api.skills.listDuplicateCandidates,
    staff ? { limit: 20 } : 'skip',
  ) as DuplicateCandidateEntry[] | undefined

  const setRole = useMutation(api.users.setRole)
  const banUser = useMutation(api.users.banUser)
  const setBatch = useMutation(api.skills.setBatch)
  const setSoftDeleted = useMutation(api.skills.setSoftDeleted)
  const hardDelete = useMutation(api.skills.hardDelete)
  const changeOwner = useMutation(api.skills.changeOwner)
  const setDuplicate = useMutation(api.skills.setDuplicate)
  const setOfficialBadge = useMutation(api.skills.setOfficialBadge)
  const setDeprecatedBadge = useMutation(api.skills.setDeprecatedBadge)

  const [selectedDuplicate, setSelectedDuplicate] = useState('')
  const [selectedOwner, setSelectedOwner] = useState('')
  const [reportSearch, setReportSearch] = useState('')
  const [reportSearchDebounced, setReportSearchDebounced] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [userSearchDebounced, setUserSearchDebounced] = useState('')

  const selectedSkillId = selectedSkill?.skill?._id ?? null
  const selectedOwnerUserId = selectedSkill?.skill?.ownerUserId ?? null
  const selectedCanonicalSlug = selectedSkill?.canonical?.skill?.slug ?? ''

  useEffect(() => {
    if (!selectedSkillId || !selectedOwnerUserId) return
    setSelectedDuplicate(selectedCanonicalSlug)
    setSelectedOwner(String(selectedOwnerUserId))
  }, [selectedCanonicalSlug, selectedOwnerUserId, selectedSkillId])

  useEffect(() => {
    const handle = setTimeout(() => setReportSearchDebounced(reportSearch), 250)
    return () => clearTimeout(handle)
  }, [reportSearch])

  useEffect(() => {
    const handle = setTimeout(() => setUserSearchDebounced(userSearch), 250)
    return () => clearTimeout(handle)
  }, [userSearch])

  if (!staff) {
    return (
      <main className="section">
        <div className="card">Management only.</div>
      </main>
    )
  }

  if (!recentVersions || !reportedSkills || !duplicateCandidates) {
    return (
      <main className="section">
        <div className="card">Loading management console…</div>
      </main>
    )
  }

  const reportQuery = reportSearchDebounced.trim().toLowerCase()
  const filteredReportedSkills = reportQuery
    ? reportedSkills.filter((entry) => {
        const reportReasons = (entry.reports ?? []).map((report) => report.reason).join(' ')
        const reporterHandles = (entry.reports ?? [])
          .map((report) => report.reporterHandle)
          .filter(Boolean)
          .join(' ')
        const haystack = [
          entry.skill.displayName,
          entry.skill.slug,
          entry.owner?.handle,
          entry.owner?.name,
          reportReasons,
          reporterHandles,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(reportQuery)
      })
    : reportedSkills
  const reportCountLabel =
    filteredReportedSkills.length === 0 && reportedSkills.length > 0
      ? 'No matching reports.'
      : 'No reports yet.'
  const reportSummary = `Showing ${filteredReportedSkills.length} of ${reportedSkills.length}`

  const userQuery = userSearchDebounced.trim().toLowerCase()
  const filteredUsers = userQuery
    ? (users ?? []).filter((user) => {
        const haystack = [user.handle, user.name, user.role, user._id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(userQuery)
      })
    : (users ?? [])
  const userSummary = `Showing ${filteredUsers.length} of ${(users ?? []).length}`

  return (
    <main className="section">
      <h1 className="section-title">Management console</h1>
      <p className="section-subtitle">Moderation, curation, and ownership tools.</p>

      <div className="card">
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
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
              const { skill, latestVersion, owner, reports } = entry
              const ownerParam = resolveOwnerParam(
                owner?.handle ?? null,
                owner?._id ?? skill.ownerUserId,
              )
              const reportEntries = reports ?? []
              return (
                <div key={skill._id} className="management-item">
                  <div className="management-item-main">
                    <Link to="/$owner/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                      {skill.displayName}
                    </Link>
                    <div className="section-subtitle" style={{ margin: 0 }}>
                      @{owner?.handle ?? owner?.name ?? 'user'} · v{latestVersion?.version ?? '—'} ·
                      {skill.reportCount ?? 0} report{(skill.reportCount ?? 0) === 1 ? '' : 's'}
                      {skill.lastReportedAt
                        ? ` · last ${formatTimestamp(skill.lastReportedAt)}`
                        : ''}
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
                              {report.reporterHandle ? ` · @${report.reporterHandle}` : ''}
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
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void setSoftDeleted({ skillId: skill._id, deleted: !skill.softDeletedAt })
                      }
                    >
                      {skill.softDeletedAt ? 'Restore' : 'Hide'}
                    </button>
                    {admin ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Hard delete ${skill.displayName}?`)) return
                          void hardDelete({ skillId: skill._id })
                        }}
                      >
                        Hard delete
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
          Skill tools
        </h2>
        {selectedSlug ? (
          <div className="section-subtitle" style={{ marginTop: 8 }}>
            Managing "{selectedSlug}" ·{' '}
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
              const { skill, latestVersion, owner, canonical } = selectedSkill
              const ownerParam = resolveOwnerParam(
                owner?.handle ?? null,
                owner?._id ?? skill.ownerUserId,
              )
              const moderationStatus =
                skill.moderationStatus ?? (skill.softDeletedAt ? 'hidden' : 'active')
              const isHighlighted = isSkillHighlighted(skill)
              const isOfficial = isSkillOfficial(skill)
              const isDeprecated = isSkillDeprecated(skill)
              const badges = getSkillBadges(skill)
              const ownerUserId = skill.ownerUserId ?? selectedOwnerUserId
              const ownerHandle = owner?.handle ?? owner?.name ?? 'user'
              const isOwnerAdmin = owner?.role === 'admin'
              const canBanOwner =
                staff && ownerUserId && ownerUserId !== me?._id && (admin || !isOwnerAdmin)

              return (
                <div key={skill._id} className="management-item">
                  <div className="management-item-main">
                    <Link to="/$owner/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                      {skill.displayName}
                    </Link>
                    <div className="section-subtitle" style={{ margin: 0 }}>
                      @{owner?.handle ?? owner?.name ?? 'user'} · v{latestVersion?.version ?? '—'} ·
                      updated {formatTimestamp(skill.updatedAt)} · {moderationStatus}
                      {badges.length ? ` · ${badges.join(', ').toLowerCase()}` : ''}
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
                    <div className="management-controls">
                      <label className="management-control">
                        <span className="mono">duplicate of</span>
                        <input
                          className="search-input"
                          value={selectedDuplicate}
                          onChange={(event) => setSelectedDuplicate(event.target.value)}
                          placeholder={canonical?.skill?.slug ?? 'canonical slug'}
                        />
                      </label>
                      <button
                        className="btn"
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
                      {admin ? (
                        <label className="management-control">
                          <span className="mono">owner</span>
                          <select
                            value={selectedOwner}
                            onChange={(event) => setSelectedOwner(event.target.value)}
                          >
                            {(users ?? []).map((user) => (
                              <option key={user._id} value={user._id}>
                                @{user.handle ?? user.name ?? 'user'}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn"
                            type="button"
                            onClick={() =>
                              void changeOwner({
                                skillId: skill._id,
                                ownerUserId: selectedOwner as Doc<'users'>['_id'],
                              })
                            }
                          >
                            Change owner
                          </button>
                        </label>
                      ) : null}
                    </div>
                  </div>
                  <div className="management-actions">
                    <Link
                      className="btn"
                      to="/$owner/$slug"
                      params={{ owner: ownerParam, slug: skill.slug }}
                    >
                      View
                    </Link>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void setSoftDeleted({ skillId: skill._id, deleted: !skill.softDeletedAt })
                      }
                    >
                      {skill.softDeletedAt ? 'Restore' : 'Hide'}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void setBatch({
                          skillId: skill._id,
                          batch: isHighlighted ? undefined : 'highlighted',
                        })
                      }
                    >
                      {isHighlighted ? 'Unhighlight' : 'Highlight'}
                    </button>
                    {admin ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Hard delete ${skill.displayName}?`)) return
                          void hardDelete({ skillId: skill._id })
                        }}
                      >
                        Hard delete
                      </button>
                    ) : null}
                    {staff ? (
                      <button
                        className="btn"
                        type="button"
                        disabled={!canBanOwner}
                        onClick={() => {
                          if (!ownerUserId || ownerUserId === me?._id) return
                          if (!window.confirm(`Ban @${ownerHandle} and delete their skills?`)) {
                            return
                          }
                          void banUser({ userId: ownerUserId })
                        }}
                      >
                        Ban user
                      </button>
                    ) : null}
                    {admin ? (
                      <>
                        <button
                          className="btn"
                          type="button"
                          onClick={() =>
                            void setOfficialBadge({
                              skillId: skill._id,
                              official: !isOfficial,
                            })
                          }
                        >
                          {isOfficial ? 'Remove official' : 'Mark official'}
                        </button>
                        <button
                          className="btn"
                          type="button"
                          onClick={() =>
                            void setDeprecatedBadge({
                              skillId: skill._id,
                              deprecated: !isDeprecated,
                            })
                          }
                        >
                          {isDeprecated ? 'Remove deprecated' : 'Mark deprecated'}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })()
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
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
                    @{entry.owner?.handle ?? entry.owner?.name ?? 'user'} · v
                    {entry.latestVersion?.version ?? '—'} · fingerprint{' '}
                    {entry.fingerprint?.slice(0, 8)}
                  </div>
                  <div className="management-sublist">
                    {entry.matches.map((match) => (
                      <div key={match.skill._id} className="management-subitem">
                        <div>
                          <strong>{match.skill.displayName}</strong>
                          <div className="section-subtitle" style={{ margin: 0 }}>
                            @{match.owner?.handle ?? match.owner?.name ?? 'user'} ·{' '}
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
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
          Recent pushes
        </h2>
        <div className="management-list">
          {recentVersions.length === 0 ? (
            <div className="stat">No recent versions.</div>
          ) : (
            recentVersions.map((entry) => (
              <div key={entry.version._id} className="management-item">
                <div className="management-item-main">
                  <strong>{entry.skill?.displayName ?? 'Unknown skill'}</strong>
                  <div className="section-subtitle" style={{ margin: 0 }}>
                    v{entry.version.version} · @{entry.owner?.handle ?? entry.owner?.name ?? 'user'}
                  </div>
                </div>
                <div className="management-actions">
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
          <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
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
              <div className="stat">
                {(users ?? []).length === 0 ? 'No users yet.' : 'No matching users.'}
              </div>
            ) : (
              filteredUsers.map((user) => (
                <div key={user._id} className="management-item">
                  <div className="management-item-main">
                    <span className="mono">@{user.handle ?? user.name ?? 'user'}</span>
                  </div>
                  <div className="management-actions">
                    <select
                      value={user.role ?? 'user'}
                      onChange={(event) => {
                        const value = event.target.value
                        if (value === 'admin' || value === 'moderator' || value === 'user') {
                          void setRole({ userId: user._id, role: value })
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
                        if (user._id === me?._id) return
                        if (
                          !window.confirm(
                            `Ban @${user.handle ?? user.name ?? 'user'} and delete their skills?`,
                          )
                        ) {
                          return
                        }
                        void banUser({ userId: user._id })
                      }}
                    >
                      Ban user
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </main>
  )
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString()
}
