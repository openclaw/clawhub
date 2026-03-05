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
import { useI18n } from '../i18n/useI18n'
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

function promptBanReason(label: string) {
  const result = window.prompt(`Ban reason for ${label} (optional)`)
  if (result === null) return null
  const trimmed = result.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export const Route = createFileRoute('/management')({
  validateSearch: (search) => ({
    skill: typeof search.skill === 'string' && search.skill.trim() ? search.skill : undefined,
  }),
  component: Management,
})

function Management() {
  const { t } = useI18n()
  const { me } = useAuthStatus()
  const search = Route.useSearch()
  const staff = isModerator(me)
  const admin = isAdmin(me)

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

  const userQuery = userSearchDebounced.trim()
  const userResult = useQuery(
    api.users.list,
    admin ? { limit: 200, search: userQuery || undefined } : 'skip',
  ) as { items: Doc<'users'>[]; total: number } | undefined

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
        <div className="card">{t('management.accessRestricted')}</div>
      </main>
    )
  }

  if (!recentVersions || !reportedSkills || !duplicateCandidates) {
    return (
      <main className="section">
        <div className="card">{t('management.loading')}</div>
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
      ? t('management.noMatchingReports')
      : t('management.noReports')
  const reportSummary = t('management.showingCount', { count: String(filteredReportedSkills.length), total: String(reportedSkills.length) })

  const filteredUsers = userResult?.items ?? []
  const userTotal = userResult?.total ?? 0
  const userSummary = userResult
    ? t('management.showingCount', { count: String(filteredUsers.length), total: String(userTotal) })
    : t('management.loadingUsers')
  const userEmptyLabel = userResult
    ? filteredUsers.length === 0
      ? userQuery
        ? t('management.noMatchingUsers')
        : t('management.noUsers')
      : ''
    : 'Loading users…'

  return (
    <main className="section">
      <h1 className="section-title">{t('management.title')}</h1>
      <p className="section-subtitle">{t('management.subtitle')}</p>

      <div className="card">
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
          {t('management.reportedSkills')}
        </h2>
        <div className="management-controls">
          <div className="management-control management-search">
            <span className="mono">{t('management.filter')}</span>
            <input
              type="search"
              placeholder={t('management.searchReported')}
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
                      {skill.reportCount ?? 0} {t('management.reports', { s: (skill.reportCount ?? 0) === 1 ? '' : 's' })}
                      {skill.lastReportedAt
                        ? ` · ${t('management.lastTime', { time: formatTimestamp(skill.lastReportedAt) })}`
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
                        {t('management.noReportReasons')}
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
                      {skill.softDeletedAt ? t('management.restore') : t('management.hide')}
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
                        {t('management.hardDelete')}
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
          {t('management.skillTools')}
        </h2>
        {selectedSlug ? (
          <div className="section-subtitle" style={{ marginTop: 8 }}>
            {t('management.managing', { slug: selectedSlug ?? '' })} ·{' '}
            <Link to="/management" search={{ skill: undefined }}>
              {t('management.clearSelection')}
            </Link>
          </div>
        ) : null}
        <div className="management-list">
          {!selectedSlug ? (
            <div className="stat">{t('management.useManageButton')}</div>
          ) : selectedSkill === undefined ? (
            <div className="stat">{t('management.loadingSkill')}</div>
          ) : !selectedSkill?.skill ? (
            <div className="stat">{t('management.noSkillFound', { slug: selectedSlug ?? '' })}</div>
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
                        <span className="mono">{t('management.duplicateOf')}</span>
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
                        {t('management.setDuplicate')}
                      </button>
                      {admin ? (
                        <label className="management-control">
                          <span className="mono">{t('management.owner')}</span>
                          <select
                            value={selectedOwner}
                            onChange={(event) => setSelectedOwner(event.target.value)}
                          >
                            {filteredUsers.map((user) => (
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
                            {t('management.changeOwner')}
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
                      {t('management.view')}
                    </Link>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        void setSoftDeleted({ skillId: skill._id, deleted: !skill.softDeletedAt })
                      }
                    >
                      {skill.softDeletedAt ? t('management.restore') : t('management.hide')}
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
                      {isHighlighted ? t('management.unhighlight') : t('management.highlight')}
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
                          if (!window.confirm(t('management.banConfirm', { handle: ownerHandle }))) {
                            return
                          }
                          const reason = promptBanReason(`@${ownerHandle}`)
                          if (reason === null) return
                          void banUser({ userId: ownerUserId, reason })
                        }}
                      >
                        {t('management.banUser')}
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
                          {isOfficial ? t('management.removeOfficial') : t('management.markOfficial')}
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
                          {isDeprecated ? t('management.removeDeprecated') : t('management.markDeprecated')}
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
          {t('management.duplicateCandidates')}
        </h2>
        <div className="management-list">
          {duplicateCandidates.length === 0 ? (
            <div className="stat">{t('management.noDuplicates')}</div>
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
                            {t('management.view')}
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
                            {t('management.markDuplicate')}
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
                    {t('management.view')}
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
          {t('management.recentPushes')}
        </h2>
        <div className="management-list">
          {recentVersions.length === 0 ? (
            <div className="stat">{t('management.noRecentVersions')}</div>
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
                      {t('management.view')}
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
            {t('management.users')}
          </h2>
          <div className="management-controls">
            <div className="management-control management-search">
              <span className="mono">{t('management.filter')}</span>
              <input
                type="search"
                placeholder={t('management.searchUsers')}
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
                    <span className="mono">@{user.handle ?? user.name ?? 'user'}</span>
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
                      value={user.role ?? 'user'}
                      onChange={(event) => {
                        const value = event.target.value
                        if (value === 'admin' || value === 'moderator' || value === 'user') {
                          void setRole({ userId: user._id, role: value })
                        }
                      }}
                    >
                      <option value="user">{t('management.user')}</option>
                      <option value="moderator">{t('management.moderator')}</option>
                      <option value="admin">{t('management.admin')}</option>
                    </select>
                    <button
                      className="btn"
                      type="button"
                      disabled={user._id === me?._id}
                      onClick={() => {
                        if (user._id === me?._id) return
                        if (
                          !window.confirm(
                            t('management.banConfirm', { handle: user.handle ?? user.name ?? 'user' }),
                          )
                        ) {
                          return
                        }
                        const label = `@${user.handle ?? user.name ?? 'user'}`
                        const reason = promptBanReason(label)
                        if (reason === null) return
                        void banUser({ userId: user._id, reason })
                      }}
                    >
                      {t('management.banUser')}
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
