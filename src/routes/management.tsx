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
    api.skills.getBySlug,
    staff && selectedSlug ? { slug: selectedSlug } : 'skip',
  ) as SkillBySlugResult | undefined
  const recentVersions = useQuery(api.skills.listRecentVersions, staff ? { limit: 20 } : 'skip') as
    | RecentVersionEntry[]
    | undefined
  const reportedSkills = useQuery(api.skills.listReportedSkills, staff ? { limit: 25 } : 'skip') as
    | ManagementSkillEntry[]
    | undefined
  const duplicateCandidates = useQuery(
    api.skills.listDuplicateCandidates,
    staff ? { limit: 20 } : 'skip',
  ) as DuplicateCandidateEntry[] | undefined

  const setRole = useMutation(api.users.setRole)
  const setBatch = useMutation(api.skills.setBatch)
  const setSoftDeleted = useMutation(api.skills.setSoftDeleted)
  const hardDelete = useMutation(api.skills.hardDelete)
  const changeOwner = useMutation(api.skills.changeOwner)
  const setDuplicate = useMutation(api.skills.setDuplicate)
  const setOfficialBadge = useMutation(api.skills.setOfficialBadge)
  const setDeprecatedBadge = useMutation(api.skills.setDeprecatedBadge)

  const [selectedDuplicate, setSelectedDuplicate] = useState('')
  const [selectedOwner, setSelectedOwner] = useState('')

  const selectedSkillId = selectedSkill?.skill?._id ?? null
  const selectedOwnerUserId = selectedSkill?.skill?.ownerUserId ?? null
  const selectedCanonicalSlug = selectedSkill?.canonical?.skill?.slug ?? ''

  useEffect(() => {
    if (!selectedSkillId || !selectedOwnerUserId) return
    setSelectedDuplicate(selectedCanonicalSlug)
    setSelectedOwner(String(selectedOwnerUserId))
  }, [selectedCanonicalSlug, selectedOwnerUserId, selectedSkillId])

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

  return (
    <main className="section">
      <h1 className="section-title">Management console</h1>
      <p className="section-subtitle">Moderation, curation, and ownership tools.</p>

      <div className="card">
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
          Reported skills
        </h2>
        <div className="management-list">
          {reportedSkills.length === 0 ? (
            <div className="stat">No reports yet.</div>
          ) : (
            reportedSkills.map((entry) => {
              const { skill, latestVersion, owner } = entry
              const ownerParam = resolveOwnerParam(
                owner?.handle ?? null,
                owner?._id ?? skill.ownerUserId,
              )
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
          <div className="management-list">
            {(users ?? []).map((user) => (
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
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  )
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleString()
}
