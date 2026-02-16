import { useNavigate } from '@tanstack/react-router'
import type { ClawdisSkillMetadata } from 'clawhub-schema'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import type { PublicSkill, PublicUser } from '../lib/publicUser'
import { canManageSkill, isModerator } from '../lib/roles'
import { useAuthStatus } from '../lib/useAuthStatus'
import { SkillCommentsPanel } from './SkillCommentsPanel'
import { SkillDetailTabs } from './SkillDetailTabs'
import { SkillHeader, type SkillModerationInfo } from './SkillHeader'
import { SkillReportDialog } from './SkillReportDialog'
import {
  buildSkillHref,
  formatConfigSnippet,
  formatNixInstallSnippet,
  formatOsList,
  stripFrontmatter,
} from './skillDetailUtils'

type SkillDetailPageProps = {
  slug: string
  canonicalOwner?: string
  redirectToCanonical?: boolean
}

type SkillBySlugResult = {
  skill: Doc<'skills'> | PublicSkill
  latestVersion: Doc<'skillVersions'> | null
  owner: Doc<'users'> | PublicUser | null
  pendingReview?: boolean
  moderationInfo?: SkillModerationInfo | null
  forkOf: {
    kind: 'fork' | 'duplicate'
    version: string | null
    skill: { slug: string; displayName: string }
    owner: { handle: string | null; userId: Id<'users'> | null }
  } | null
  canonical: {
    skill: { slug: string; displayName: string }
    owner: { handle: string | null; userId: Id<'users'> | null }
  } | null
} | null

type SkillFile = Doc<'skillVersions'>['files'][number]

function formatReportError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data
    if (typeof data === 'string' && data.trim()) return data.trim()
    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message?: unknown }).message === 'string'
    ) {
      const message = (data as { message?: string }).message?.trim()
      if (message) return message
    }
  }

  if (error instanceof Error) {
    const cleaned = error.message
      .replace(/\[CONVEX[^\]]*\]\s*/g, '')
      .replace(/\[Request ID:[^\]]*\]\s*/g, '')
      .replace(/^Server Error Called by client\s*/i, '')
      .replace(/^ConvexError:\s*/i, '')
      .trim()
    if (cleaned && cleaned !== 'Server Error') return cleaned
  }

  return 'Unable to submit report. Please try again.'
}

export function SkillDetailPage({
  slug,
  canonicalOwner,
  redirectToCanonical,
}: SkillDetailPageProps) {
  const navigate = useNavigate()
  const { isAuthenticated, me } = useAuthStatus()

  const isStaff = isModerator(me)
  const staffResult = useQuery(api.skills.getBySlugForStaff, isStaff ? { slug } : 'skip') as
    | SkillBySlugResult
    | undefined
  const publicResult = useQuery(api.skills.getBySlug, !isStaff ? { slug } : 'skip') as
    | SkillBySlugResult
    | undefined
  const result = isStaff ? staffResult : publicResult

  const toggleStar = useMutation(api.stars.toggle)
  const reportSkill = useMutation(api.skills.report)
  const updateTags = useMutation(api.skills.updateTags)
  const getReadme = useAction(api.skills.getReadme)

  const [readme, setReadme] = useState<string | null>(null)
  const [readmeError, setReadmeError] = useState<string | null>(null)
  const [tagName, setTagName] = useState('latest')
  const [tagVersionId, setTagVersionId] = useState<Id<'skillVersions'> | ''>('')
  const [activeTab, setActiveTab] = useState<'files' | 'compare' | 'versions'>('files')
  const [shouldPrefetchCompare, setShouldPrefetchCompare] = useState(false)
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportError, setReportError] = useState<string | null>(null)
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)

  const isLoadingSkill = result === undefined
  const skill = result?.skill
  const owner = result?.owner
  const latestVersion = result?.latestVersion

  const versions = useQuery(
    api.skills.listVersions,
    skill ? { skillId: skill._id, limit: 50 } : 'skip',
  ) as Doc<'skillVersions'>[] | undefined
  const shouldLoadDiffVersions = Boolean(skill && (activeTab === 'compare' || shouldPrefetchCompare))
  const diffVersions = useQuery(
    api.skills.listVersions,
    shouldLoadDiffVersions && skill ? { skillId: skill._id, limit: 200 } : 'skip',
  ) as Doc<'skillVersions'>[] | undefined

  const isStarred = useQuery(
    api.stars.isStarred,
    isAuthenticated && skill ? { skillId: skill._id } : 'skip',
  )

  const canManage = canManageSkill(me, skill)

  const ownerHandle = owner?.handle ?? owner?.name ?? null
  const ownerParam = ownerHandle ?? (owner?._id ? String(owner._id) : null)
  const wantsCanonicalRedirect = Boolean(
    ownerParam &&
      (redirectToCanonical ||
        (typeof canonicalOwner === 'string' && canonicalOwner && canonicalOwner !== ownerParam)),
  )

  const forkOf = result?.forkOf ?? null
  const canonical = result?.canonical ?? null
  const modInfo = result?.moderationInfo ?? null
  const forkOfLabel = forkOf?.kind === 'duplicate' ? 'duplicate of' : 'fork of'
  const forkOfOwnerHandle = forkOf?.owner?.handle ?? null
  const forkOfOwnerId = forkOf?.owner?.userId ?? null
  const canonicalOwnerHandle = canonical?.owner?.handle ?? null
  const canonicalOwnerId = canonical?.owner?.userId ?? null
  const forkOfHref = forkOf?.skill?.slug
    ? buildSkillHref(forkOfOwnerHandle, forkOfOwnerId, forkOf.skill.slug)
    : null
  const canonicalHref =
    canonical?.skill?.slug && canonical.skill.slug !== forkOf?.skill?.slug
      ? buildSkillHref(canonicalOwnerHandle, canonicalOwnerId, canonical.skill.slug)
      : null

  const staffSkill = isStaff && skill ? (skill as Doc<'skills'>) : null
  const moderationStatus =
    staffSkill?.moderationStatus ?? (staffSkill?.softDeletedAt ? 'hidden' : undefined)
  const isHidden = moderationStatus === 'hidden' || Boolean(staffSkill?.softDeletedAt)
  const isRemoved = moderationStatus === 'removed'
  const isAutoHidden = isHidden && staffSkill?.moderationReason === 'auto.reports'
  const staffVisibilityTag = isRemoved
    ? 'Removed'
    : isAutoHidden
      ? 'Auto-hidden'
      : isHidden
        ? 'Hidden'
        : null
  const staffModerationNote = staffVisibilityTag
    ? isAutoHidden
      ? 'Auto-hidden after 4+ unique reports.'
      : isRemoved
        ? 'Removed from public view.'
        : 'Hidden from public view.'
    : null

  const versionById = new Map<Id<'skillVersions'>, Doc<'skillVersions'>>(
    (diffVersions ?? versions ?? []).map((version) => [version._id, version]),
  )

  const clawdis = (latestVersion?.parsed as { clawdis?: ClawdisSkillMetadata } | undefined)?.clawdis
  const osLabels = useMemo(() => formatOsList(clawdis?.os), [clawdis?.os])
  const nixPlugin = clawdis?.nix?.plugin
  const nixSystems = clawdis?.nix?.systems ?? []
  const nixSnippet = nixPlugin ? formatNixInstallSnippet(nixPlugin) : null
  const configRequirements = clawdis?.config
  const configExample = configRequirements?.example
    ? formatConfigSnippet(configRequirements.example)
    : null
  const cliHelp = clawdis?.cliHelp
  const hasPluginBundle = Boolean(nixSnippet || configRequirements || cliHelp)

  const readmeContent = useMemo(() => {
    if (!readme) return null
    return stripFrontmatter(readme)
  }, [readme])
  const latestFiles: SkillFile[] = latestVersion?.files ?? []

  useEffect(() => {
    if (!wantsCanonicalRedirect || !ownerParam) return
    void navigate({
      to: '/$owner/$slug',
      params: { owner: ownerParam, slug },
      replace: true,
    })
  }, [navigate, ownerParam, slug, wantsCanonicalRedirect])

  useEffect(() => {
    if (!latestVersion) return

    setReadme(null)
    setReadmeError(null)
    let cancelled = false

    void getReadme({ versionId: latestVersion._id })
      .then((data) => {
        if (cancelled) return
        setReadme(data.text)
      })
      .catch((error) => {
        if (cancelled) return
        setReadmeError(error instanceof Error ? error.message : 'Failed to load README')
        setReadme(null)
      })

    return () => {
      cancelled = true
    }
  }, [latestVersion, getReadme])

  useEffect(() => {
    if (!tagVersionId && latestVersion) {
      setTagVersionId(latestVersion._id)
    }
  }, [latestVersion, tagVersionId])

  const closeReportDialog = () => {
    setIsReportDialogOpen(false)
    setReportReason('')
    setReportError(null)
    setIsSubmittingReport(false)
  }

  const openReportDialog = () => {
    setReportReason('')
    setReportError(null)
    setIsSubmittingReport(false)
    setIsReportDialogOpen(true)
  }

  const submitTag = () => {
    if (!skill) return
    if (!tagName.trim() || !tagVersionId) return
    void updateTags({
      skillId: skill._id,
      tags: [{ tag: tagName.trim(), versionId: tagVersionId }],
    })
  }

  const submitReport = async () => {
    if (!skill) return

    const trimmedReason = reportReason.trim()
    if (!trimmedReason) {
      setReportError('Report reason required.')
      return
    }

    setIsSubmittingReport(true)
    setReportError(null)
    try {
      const submission = await reportSkill({ skillId: skill._id, reason: trimmedReason })
      closeReportDialog()
      if (submission.reported) {
        window.alert('Thanks — your report has been submitted.')
      } else {
        window.alert('You have already reported this skill.')
      }
    } catch (error) {
      console.error('Failed to report skill', error)
      setReportError(formatReportError(error))
      setIsSubmittingReport(false)
    }
  }

  if (isLoadingSkill || wantsCanonicalRedirect) {
    return (
      <main className="section">
        <div className="card">
          <div className="loading-indicator">Loading skill…</div>
        </div>
      </main>
    )
  }

  if (result === null || !skill) {
    return (
      <main className="section">
        <div className="card">Skill not found.</div>
      </main>
    )
  }

  const tagEntries = Object.entries(skill.tags ?? {}) as Array<[string, Id<'skillVersions'>]>

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

        {nixSnippet ? (
          <div className="card">
            <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
              Install via Nix
            </h2>
            <p className="section-subtitle" style={{ margin: 0 }}>
              {nixSystems.length ? `Systems: ${nixSystems.join(', ')}` : 'nix-clawdbot'}
            </p>
            <pre className="hero-install-code" style={{ marginTop: 12 }}>
              {nixSnippet}
            </pre>
          </div>
        ) : null}

        {configExample ? (
          <div className="card">
            <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
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
          skill={skill as Doc<'skills'>}
          diffVersions={diffVersions}
          versions={versions}
          nixPlugin={Boolean(nixPlugin)}
        />

        <SkillCommentsPanel skillId={skill._id} isAuthenticated={isAuthenticated} me={me ?? null} />
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
  )
}
