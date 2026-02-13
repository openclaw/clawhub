import { Link, useNavigate } from '@tanstack/react-router'
import type { ClawdisSkillMetadata, SkillInstallSpec } from 'clawhub-schema'
import { useAction, useMutation, useQuery } from 'convex/react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { getSkillBadges } from '../lib/badges'
import type { PublicSkill, PublicUser } from '../lib/publicUser'
import { canManageSkill, isModerator } from '../lib/roles'
import { useAuthStatus } from '../lib/useAuthStatus'

const SkillDiffCard = lazy(() =>
  import('./SkillDiffCard').then((m) => ({ default: m.SkillDiffCard })),
)

type VtAnalysis = {
  status: string
  verdict?: string
  analysis?: string
  source?: string
  checkedAt: number
}

type LlmAnalysisDimension = {
  name: string
  label: string
  rating: string
  detail: string
}

type LlmAnalysis = {
  status: string
  verdict?: string
  confidence?: string
  summary?: string
  dimensions?: LlmAnalysisDimension[]
  guidance?: string
  findings?: string
  model?: string
  checkedAt: number
}

function VirusTotalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 89"
      aria-label="VirusTotal"
    >
      <title>VirusTotal</title>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M45.292 44.5 0 89h100V0H0l45.292 44.5zM90 80H22l35.987-35.2L22 9h68v71z"
      />
    </svg>
  )
}

function OpenClawIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      aria-label="OpenClaw"
    >
      <title>OpenClaw</title>
      <path
        d="M12 2C8.5 2 5.5 4 4 7c-2 4-1 8 2 11 1.5 1.5 3.5 2.5 6 2.5s4.5-1 6-2.5c3-3 4-7 2-11-1.5-3-4.5-5-8-5z"
        fill="currentColor"
        opacity="0.2"
      />
      <path
        d="M9 8c1-2 3-3 5-2s3 3 2 5l-3 4-2-1 3-4c.5-1 0-2-1-2.5S11 7 10.5 8L8 12l-2-1 3-4z"
        fill="currentColor"
      />
      <path
        d="M15 8c-1-2-3-3-5-2s-3 3-2 5l3 4 2-1-3-4c-.5-1 0-2 1-2.5S14 7 14.5 8L17 12l2-1-4-3z"
        fill="currentColor"
        opacity="0.6"
      />
    </svg>
  )
}

function getScanStatusInfo(status: string) {
  switch (status.toLowerCase()) {
    case 'benign':
    case 'clean':
      return { label: 'Benign', className: 'scan-status-clean' }
    case 'malicious':
      return { label: 'Malicious', className: 'scan-status-malicious' }
    case 'suspicious':
      return { label: 'Suspicious', className: 'scan-status-suspicious' }
    case 'loading':
      return { label: 'Loading...', className: 'scan-status-pending' }
    case 'pending':
    case 'not_found':
      return { label: 'Pending', className: 'scan-status-pending' }
    case 'error':
    case 'failed':
      return { label: 'Error', className: 'scan-status-error' }
    default:
      return { label: status, className: 'scan-status-unknown' }
  }
}

function getDimensionIcon(rating: string) {
  switch (rating) {
    case 'ok':
      return { className: 'dimension-icon-ok', symbol: '\u2713' }
    case 'note':
      return { className: 'dimension-icon-note', symbol: '\u2139' }
    case 'concern':
      return { className: 'dimension-icon-concern', symbol: '!' }
    default:
      return { className: 'dimension-icon-danger', symbol: '\u2717' }
  }
}

function LlmAnalysisDetail({ analysis }: { analysis: LlmAnalysis }) {
  const verdict = analysis.verdict ?? analysis.status
  const [isOpen, setIsOpen] = useState(false)

  const guidanceClass =
    verdict === 'malicious' ? 'malicious' : verdict === 'suspicious' ? 'suspicious' : 'benign'

  return (
    <div className={`analysis-detail${isOpen ? ' is-open' : ''}`}>
      <button
        type="button"
        className="analysis-detail-header"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <span className="analysis-summary-text">{analysis.summary}</span>
        <span className="analysis-detail-toggle">
          Details <span className="chevron">{'\u25BE'}</span>
        </span>
      </button>
      <div className="analysis-body">
        {analysis.dimensions && analysis.dimensions.length > 0 ? (
          <div className="analysis-dimensions">
            {analysis.dimensions.map((dim) => {
              const icon = getDimensionIcon(dim.rating)
              return (
                <div key={dim.name} className="dimension-row">
                  <div className={`dimension-icon ${icon.className}`}>{icon.symbol}</div>
                  <div className="dimension-content">
                    <div className="dimension-label">{dim.label}</div>
                    <div className="dimension-detail">{dim.detail}</div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {analysis.findings ? (
          <div className="scan-findings-section">
            <div className="scan-findings-title">Scan Findings in Context</div>
            {(() => {
              const counts = new Map<string, number>()
              return analysis.findings.split('\n').map((line) => {
                const count = (counts.get(line) ?? 0) + 1
                counts.set(line, count)
                return (
                  <div key={`${line}-${count}`} className="scan-finding-row">
                    {line}
                  </div>
                )
              })
            })()}
          </div>
        ) : null}
        {analysis.guidance ? (
          <div className={`analysis-guidance ${guidanceClass}`}>
            <div className="analysis-guidance-label">
              {verdict === 'malicious'
                ? 'Do not install this skill'
                : verdict === 'suspicious'
                  ? 'What to consider before installing'
                  : 'Assessment'}
            </div>
            {analysis.guidance}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SecurityScanResults({
  sha256hash,
  vtAnalysis,
  llmAnalysis,
  variant = 'panel',
}: {
  sha256hash?: string
  vtAnalysis?: VtAnalysis | null
  llmAnalysis?: LlmAnalysis | null
  variant?: 'panel' | 'badge'
}) {
  if (!sha256hash && !llmAnalysis) return null

  const vtStatus = vtAnalysis?.status ?? 'pending'
  const vtUrl = sha256hash ? `https://www.virustotal.com/gui/file/${sha256hash}` : null
  const vtStatusInfo = getScanStatusInfo(vtStatus)
  const isCodeInsight = vtAnalysis?.source === 'code_insight'
  const aiAnalysis = vtAnalysis?.analysis

  const llmVerdict = llmAnalysis?.verdict ?? llmAnalysis?.status
  const llmStatusInfo = llmVerdict ? getScanStatusInfo(llmVerdict) : null

  if (variant === 'badge') {
    return (
      <>
        {sha256hash ? (
          <div className="version-scan-badge">
            <VirusTotalIcon className="version-scan-icon version-scan-icon-vt" />
            <span className={vtStatusInfo.className}>{vtStatusInfo.label}</span>
            {vtUrl ? (
              <a
                href={vtUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="version-scan-link"
                onClick={(e) => e.stopPropagation()}
              >
                ↗
              </a>
            ) : null}
          </div>
        ) : null}
        {llmStatusInfo ? (
          <div className="version-scan-badge">
            <OpenClawIcon className="version-scan-icon version-scan-icon-oc" />
            <span className={llmStatusInfo.className}>{llmStatusInfo.label}</span>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <div className="scan-results-panel">
      <div className="scan-results-title">Security Scan</div>
      <div className="scan-results-list">
        {sha256hash ? (
          <div className="scan-result-row">
            <div className="scan-result-scanner">
              <VirusTotalIcon className="scan-result-icon scan-result-icon-vt" />
              <span className="scan-result-scanner-name">VirusTotal</span>
            </div>
            <div className={`scan-result-status ${vtStatusInfo.className}`}>
              {vtStatusInfo.label}
            </div>
            {vtUrl ? (
              <a
                href={vtUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="scan-result-link"
              >
                View report →
              </a>
            ) : null}
          </div>
        ) : null}
        {isCodeInsight && aiAnalysis && (vtStatus === 'malicious' || vtStatus === 'suspicious') ? (
          <div className={`code-insight-analysis ${vtStatus}`}>
            <div className="code-insight-label">Code Insight</div>
            <p className="code-insight-text">{aiAnalysis}</p>
          </div>
        ) : null}
        {llmStatusInfo && llmAnalysis ? (
          <div className="scan-result-row">
            <div className="scan-result-scanner">
              <OpenClawIcon className="scan-result-icon scan-result-icon-oc" />
              <span className="scan-result-scanner-name">OpenClaw</span>
            </div>
            <div className={`scan-result-status ${llmStatusInfo.className}`}>
              {llmStatusInfo.label}
            </div>
            {llmAnalysis.confidence ? (
              <span className="scan-result-confidence">{llmAnalysis.confidence} confidence</span>
            ) : null}
          </div>
        ) : null}
        {llmAnalysis &&
        llmAnalysis.status !== 'error' &&
        llmAnalysis.status !== 'pending' &&
        llmAnalysis.summary ? (
          <LlmAnalysisDetail analysis={llmAnalysis} />
        ) : null}
      </div>
    </div>
  )
}

type SkillDetailPageProps = {
  slug: string
  canonicalOwner?: string
  redirectToCanonical?: boolean
}

type ModerationInfo = {
  isPendingScan: boolean
  isMalwareBlocked: boolean
  isSuspicious: boolean
  isHiddenByMod: boolean
  isRemoved: boolean
  reason?: string
}

type SkillBySlugResult = {
  skill: Doc<'skills'> | PublicSkill
  latestVersion: Doc<'skillVersions'> | null
  owner: Doc<'users'> | PublicUser | null
  pendingReview?: boolean
  moderationInfo?: ModerationInfo | null
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
  const addComment = useMutation(api.comments.add)
  const removeComment = useMutation(api.comments.remove)
  const updateTags = useMutation(api.skills.updateTags)
  const getReadme = useAction(api.skills.getReadme)
  const [readme, setReadme] = useState<string | null>(null)
  const [readmeError, setReadmeError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [tagName, setTagName] = useState('latest')
  const [tagVersionId, setTagVersionId] = useState<Id<'skillVersions'> | ''>('')
  const [activeTab, setActiveTab] = useState<'files' | 'compare' | 'versions'>('files')

  const isLoadingSkill = result === undefined
  const skill = result?.skill
  const owner = result?.owner
  const latestVersion = result?.latestVersion
  const versions = useQuery(
    api.skills.listVersions,
    skill ? { skillId: skill._id, limit: 50 } : 'skip',
  ) as Doc<'skillVersions'>[] | undefined
  const diffVersions = useQuery(
    api.skills.listVersions,
    skill ? { skillId: skill._id, limit: 200 } : 'skip',
  ) as Doc<'skillVersions'>[] | undefined

  const isStarred = useQuery(
    api.stars.isStarred,
    isAuthenticated && skill ? { skillId: skill._id } : 'skip',
  )
  const comments = useQuery(
    api.comments.listBySkill,
    skill ? { skillId: skill._id, limit: 50 } : 'skip',
  ) as Array<{ comment: Doc<'comments'>; user: PublicUser | null }> | undefined

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

  useEffect(() => {
    if (!wantsCanonicalRedirect || !ownerParam) return
    void navigate({
      to: '/$owner/$slug',
      params: { owner: ownerParam, slug },
      replace: true,
    })
  }, [navigate, ownerParam, slug, wantsCanonicalRedirect])

  const versionById = new Map<Id<'skillVersions'>, Doc<'skillVersions'>>(
    (diffVersions ?? versions ?? []).map((version) => [version._id, version]),
  )
  const clawdis = (latestVersion?.parsed as { clawdis?: ClawdisSkillMetadata } | undefined)?.clawdis
  const osLabels = useMemo(() => formatOsList(clawdis?.os), [clawdis?.os])
  const requirements = clawdis?.requires
  const installSpecs = clawdis?.install ?? []
  const nixPlugin = clawdis?.nix?.plugin
  const nixSystems = clawdis?.nix?.systems ?? []
  const nixSnippet = nixPlugin ? formatNixInstallSnippet(nixPlugin) : null
  const configRequirements = clawdis?.config
  const configExample = configRequirements?.example
    ? formatConfigSnippet(configRequirements.example)
    : null
  const cliHelp = clawdis?.cliHelp
  const hasRuntimeRequirements = Boolean(
    clawdis?.emoji ||
      osLabels.length ||
      requirements?.bins?.length ||
      requirements?.anyBins?.length ||
      requirements?.env?.length ||
      requirements?.config?.length ||
      clawdis?.primaryEnv,
  )
  const hasInstallSpecs = installSpecs.length > 0
  const hasPluginBundle = Boolean(nixSnippet || configRequirements || cliHelp)
  const readmeContent = useMemo(() => {
    if (!readme) return null
    return stripFrontmatter(readme)
  }, [readme])
  const latestFiles: SkillFile[] = latestVersion?.files ?? []

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
        {modInfo?.isPendingScan ? (
          <div className="pending-banner">
            <div className="pending-banner-content">
              <strong>Security scan in progress</strong>
              <p>
                Your skill is being scanned by VirusTotal. It will be visible to others once the
                scan completes. This usually takes up to 5 minutes — grab a coffee or exfoliate your
                shell while you wait.
              </p>
            </div>
          </div>
        ) : modInfo?.isMalwareBlocked ? (
          <div className="pending-banner pending-banner-blocked">
            <div className="pending-banner-content">
              <strong>Skill blocked — malicious content detected</strong>
              <p>
                ClawHub Security flagged this skill as malicious. Downloads are disabled. Review the
                scan results below.
              </p>
            </div>
          </div>
        ) : modInfo?.isSuspicious ? (
          <div className="pending-banner pending-banner-warning">
            <div className="pending-banner-content">
              <strong>Skill flagged — suspicious patterns detected</strong>
              <p>
                ClawHub Security flagged this skill as suspicious. Review the scan results before
                using.
              </p>
              {canManage ? (
                <p className="pending-banner-appeal">
                  If you believe this skill has been incorrectly flagged, please{' '}
                  <a
                    href="https://github.com/openclaw/clawhub/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    submit an issue on GitHub
                  </a>{' '}
                  and we'll break down why it was flagged and what you can do.
                </p>
              ) : null}
            </div>
          </div>
        ) : modInfo?.isRemoved ? (
          <div className="pending-banner pending-banner-blocked">
            <div className="pending-banner-content">
              <strong>Skill removed by moderator</strong>
              <p>This skill has been removed and is not visible to others.</p>
            </div>
          </div>
        ) : modInfo?.isHiddenByMod ? (
          <div className="pending-banner pending-banner-blocked">
            <div className="pending-banner-content">
              <strong>Skill hidden</strong>
              <p>This skill is currently hidden and not visible to others.</p>
            </div>
          </div>
        ) : null}
        <div className="card skill-hero">
          <div className={`skill-hero-top${hasPluginBundle ? ' has-plugin' : ''}`}>
            <div className="skill-hero-header">
              <div className="skill-hero-title">
                <div className="skill-hero-title-row">
                  <h1 className="section-title" style={{ margin: 0 }}>
                    {skill.displayName}
                  </h1>
                  {nixPlugin ? <span className="tag tag-accent">Plugin bundle (nix)</span> : null}
                </div>
                <p className="section-subtitle">{skill.summary ?? 'No summary provided.'}</p>

                {isStaff && staffModerationNote ? (
                  <div className="skill-hero-note">{staffModerationNote}</div>
                ) : null}
                {nixPlugin ? (
                  <div className="skill-hero-note">
                    Bundles the skill pack, CLI binary, and config requirements in one Nix install.
                  </div>
                ) : null}
                <div className="stat">
                  ⭐ {skill.stats.stars} · ⤓ {skill.stats.downloads} · ⤒{' '}
                  {skill.stats.installsCurrent ?? 0} current · {skill.stats.installsAllTime ?? 0}{' '}
                  all-time
                </div>
                {owner?.handle ? (
                  <div className="stat">
                    by <a href={`/u/${owner.handle}`}>@{owner.handle}</a>
                  </div>
                ) : null}
                {forkOf && forkOfHref ? (
                  <div className="stat">
                    {forkOfLabel}{' '}
                    <a href={forkOfHref}>
                      {forkOfOwnerHandle ? `@${forkOfOwnerHandle}/` : ''}
                      {forkOf.skill.slug}
                    </a>
                    {forkOf.version ? ` (based on ${forkOf.version})` : null}
                  </div>
                ) : null}
                {canonicalHref ? (
                  <div className="stat">
                    canonical:{' '}
                    <a href={canonicalHref}>
                      {canonicalOwnerHandle ? `@${canonicalOwnerHandle}/` : ''}
                      {canonical?.skill?.slug}
                    </a>
                  </div>
                ) : null}
                {getSkillBadges(skill).map((badge) => (
                  <div key={badge} className="tag">
                    {badge}
                  </div>
                ))}
                {isStaff && staffVisibilityTag ? (
                  <div className={`tag${isAutoHidden || isRemoved ? ' tag-accent' : ''}`}>
                    {staffVisibilityTag}
                  </div>
                ) : null}
                <div className="skill-actions">
                  {isAuthenticated ? (
                    <button
                      className={`star-toggle${isStarred ? ' is-active' : ''}`}
                      type="button"
                      onClick={() => void toggleStar({ skillId: skill._id })}
                      aria-label={isStarred ? 'Unstar skill' : 'Star skill'}
                    >
                      <span aria-hidden="true">★</span>
                    </button>
                  ) : null}
                  {isAuthenticated ? (
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={async () => {
                        const reason = window.prompt(
                          'Report this skill? A reason is required. Abuse may result in a ban.',
                        )
                        if (reason === null) return
                        const trimmedReason = reason.trim()
                        if (!trimmedReason) {
                          window.alert('Report reason required.')
                          return
                        }
                        try {
                          const result = await reportSkill({
                            skillId: skill._id,
                            reason: trimmedReason,
                          })
                          if (result.reported) {
                            window.alert('Thanks — your report has been submitted.')
                          } else {
                            window.alert('You have already reported this skill.')
                          }
                        } catch (error) {
                          console.error('Failed to report skill', error)
                          window.alert(formatReportError(error))
                        }
                      }}
                    >
                      Report
                    </button>
                  ) : null}
                  {isStaff ? (
                    <Link className="btn" to="/management" search={{ skill: skill.slug }}>
                      Manage
                    </Link>
                  ) : null}
                </div>
                {isAuthenticated ? (
                  <div className="section-subtitle" style={{ margin: '6px 0 0' }}>
                    Reports require a reason. Abuse may result in a ban.
                  </div>
                ) : null}
                <SecurityScanResults
                  sha256hash={latestVersion?.sha256hash}
                  vtAnalysis={latestVersion?.vtAnalysis}
                  llmAnalysis={latestVersion?.llmAnalysis as LlmAnalysis | undefined}
                />
                {latestVersion?.sha256hash || latestVersion?.llmAnalysis ? (
                  <p className="scan-disclaimer">
                    Like a lobster shell, security has layers — review code before you run it.
                  </p>
                ) : null}
              </div>
              <div className="skill-hero-cta">
                <div className="skill-version-pill">
                  <span className="skill-version-label">Current version</span>
                  <strong>v{latestVersion?.version ?? '—'}</strong>
                </div>
                {!nixPlugin && !modInfo?.isMalwareBlocked && !modInfo?.isRemoved ? (
                  <a
                    className="btn btn-primary"
                    href={`${import.meta.env.VITE_CONVEX_SITE_URL}/api/v1/download?slug=${skill.slug}`}
                  >
                    Download zip
                  </a>
                ) : null}
              </div>
            </div>
            {hasPluginBundle ? (
              <div className="skill-panel bundle-card">
                <div className="bundle-header">
                  <div className="bundle-title">Plugin bundle (nix)</div>
                  <div className="bundle-subtitle">Skill pack · CLI binary · Config</div>
                </div>
                <div className="bundle-includes">
                  <span>SKILL.md</span>
                  <span>CLI</span>
                  <span>Config</span>
                </div>
                {configRequirements ? (
                  <div className="bundle-section">
                    <div className="bundle-section-title">Config requirements</div>
                    <div className="bundle-meta">
                      {configRequirements.requiredEnv?.length ? (
                        <div className="stat">
                          <strong>Required env</strong>
                          <span>{configRequirements.requiredEnv.join(', ')}</span>
                        </div>
                      ) : null}
                      {configRequirements.stateDirs?.length ? (
                        <div className="stat">
                          <strong>State dirs</strong>
                          <span>{configRequirements.stateDirs.join(', ')}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {cliHelp ? (
                  <details className="bundle-section bundle-details">
                    <summary>CLI help (from plugin)</summary>
                    <pre className="hero-install-code mono">{cliHelp}</pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="skill-tag-row">
            {tagEntries.length === 0 ? (
              <span className="section-subtitle" style={{ margin: 0 }}>
                No tags yet.
              </span>
            ) : (
              tagEntries.map(([tag, versionId]) => (
                <span key={tag} className="tag">
                  {tag}
                  <span className="tag-meta">
                    v{versionById.get(versionId)?.version ?? versionId}
                  </span>
                </span>
              ))
            )}
          </div>
          {canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!tagName.trim() || !tagVersionId) return
                void updateTags({
                  skillId: skill._id,
                  tags: [{ tag: tagName.trim(), versionId: tagVersionId }],
                })
              }}
              className="tag-form"
            >
              <input
                className="search-input"
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="latest"
              />
              <select
                className="search-input"
                value={tagVersionId ?? ''}
                onChange={(event) => setTagVersionId(event.target.value as Id<'skillVersions'>)}
              >
                {(diffVersions ?? []).map((version) => (
                  <option key={version._id} value={version._id}>
                    v{version.version}
                  </option>
                ))}
              </select>
              <button className="btn" type="submit">
                Update tag
              </button>
            </form>
          ) : null}
          {hasRuntimeRequirements || hasInstallSpecs ? (
            <div className="skill-hero-content">
              <div className="skill-hero-panels">
                {hasRuntimeRequirements ? (
                  <div className="skill-panel">
                    <h3 className="section-title" style={{ fontSize: '1rem', margin: 0 }}>
                      Runtime requirements
                    </h3>
                    <div className="skill-panel-body">
                      {clawdis?.emoji ? <div className="tag">{clawdis.emoji} Clawdis</div> : null}
                      {osLabels.length ? (
                        <div className="stat">
                          <strong>OS</strong>
                          <span>{osLabels.join(' · ')}</span>
                        </div>
                      ) : null}
                      {requirements?.bins?.length ? (
                        <div className="stat">
                          <strong>Bins</strong>
                          <span>{requirements.bins.join(', ')}</span>
                        </div>
                      ) : null}
                      {requirements?.anyBins?.length ? (
                        <div className="stat">
                          <strong>Any bin</strong>
                          <span>{requirements.anyBins.join(', ')}</span>
                        </div>
                      ) : null}
                      {requirements?.env?.length ? (
                        <div className="stat">
                          <strong>Env</strong>
                          <span>{requirements.env.join(', ')}</span>
                        </div>
                      ) : null}
                      {requirements?.config?.length ? (
                        <div className="stat">
                          <strong>Config</strong>
                          <span>{requirements.config.join(', ')}</span>
                        </div>
                      ) : null}
                      {clawdis?.primaryEnv ? (
                        <div className="stat">
                          <strong>Primary env</strong>
                          <span>{clawdis.primaryEnv}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {hasInstallSpecs ? (
                  <div className="skill-panel">
                    <h3 className="section-title" style={{ fontSize: '1rem', margin: 0 }}>
                      Install
                    </h3>
                    <div className="skill-panel-body">
                      {installSpecs.map((spec, index) => {
                        const command = formatInstallCommand(spec)
                        return (
                          <div key={`${spec.id ?? spec.kind}-${index}`} className="stat">
                            <div>
                              <strong>{spec.label ?? formatInstallLabel(spec)}</strong>
                              {spec.bins?.length ? (
                                <div style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}>
                                  Bins: {spec.bins.join(', ')}
                                </div>
                              ) : null}
                              {command ? <code>{command}</code> : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
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
        <div className="card tab-card">
          <div className="tab-header">
            <button
              className={`tab-button${activeTab === 'files' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('files')}
            >
              Files
            </button>
            <button
              className={`tab-button${activeTab === 'compare' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('compare')}
            >
              Compare
            </button>
            <button
              className={`tab-button${activeTab === 'versions' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('versions')}
            >
              Versions
            </button>
          </div>
          {activeTab === 'files' ? (
            <div className="tab-body">
              <div>
                <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
                  SKILL.md
                </h2>
                <div className="markdown">
                  {readmeContent ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{readmeContent}</ReactMarkdown>
                  ) : readmeError ? (
                    <div className="stat">Failed to load SKILL.md: {readmeError}</div>
                  ) : (
                    <div>Loading…</div>
                  )}
                </div>
              </div>
              <div className="file-list">
                <div className="file-list-header">
                  <h3 className="section-title" style={{ fontSize: '1.05rem', margin: 0 }}>
                    Files
                  </h3>
                  <span className="section-subtitle" style={{ margin: 0 }}>
                    {latestFiles.length} total
                  </span>
                </div>
                <div className="file-list-body">
                  {latestFiles.length === 0 ? (
                    <div className="stat">No files available.</div>
                  ) : (
                    latestFiles.map((file) => (
                      <div key={file.path} className="file-row">
                        <span className="file-path">{file.path}</span>
                        <span className="file-meta">{formatBytes(file.size)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}
          {activeTab === 'compare' && skill ? (
            <div className="tab-body">
              <Suspense fallback={<div className="stat">Loading diff viewer…</div>}>
                <SkillDiffCard skill={skill} versions={diffVersions ?? []} variant="embedded" />
              </Suspense>
            </div>
          ) : null}
          {activeTab === 'versions' ? (
            <div className="tab-body">
              <div>
                <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
                  Versions
                </h2>
                <p className="section-subtitle" style={{ margin: 0 }}>
                  {nixPlugin
                    ? 'Review release history and changelog.'
                    : 'Download older releases or scan the changelog.'}
                </p>
              </div>
              <div className="version-scroll">
                <div className="version-list">
                  {(versions ?? []).map((version) => (
                    <div key={version._id} className="version-row">
                      <div className="version-info">
                        <div>
                          v{version.version} · {new Date(version.createdAt).toLocaleDateString()}
                          {version.changelogSource === 'auto' ? (
                            <span style={{ color: 'var(--ink-soft)' }}> · auto</span>
                          ) : null}
                        </div>
                        <div style={{ color: '#5c554e', whiteSpace: 'pre-wrap' }}>
                          {version.changelog}
                        </div>
                        <div className="version-scan-results">
                          {version.sha256hash || version.llmAnalysis ? (
                            <SecurityScanResults
                              sha256hash={version.sha256hash}
                              vtAnalysis={version.vtAnalysis}
                              llmAnalysis={version.llmAnalysis as LlmAnalysis | undefined}
                              variant="badge"
                            />
                          ) : null}
                        </div>
                      </div>
                      {!nixPlugin ? (
                        <div className="version-actions">
                          <a
                            className="btn version-zip"
                            href={`${import.meta.env.VITE_CONVEX_SITE_URL}/api/v1/download?slug=${skill.slug}&version=${version.version}`}
                          >
                            Zip
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="card">
          <h2 className="section-title" style={{ fontSize: '1.2rem', margin: 0 }}>
            Comments
          </h2>
          {isAuthenticated ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!comment.trim()) return
                void addComment({ skillId: skill._id, body: comment.trim() }).then(() =>
                  setComment(''),
                )
              }}
              className="comment-form"
            >
              <textarea
                className="comment-input"
                rows={4}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Leave a note…"
              />
              <button className="btn comment-submit" type="submit">
                Post comment
              </button>
            </form>
          ) : (
            <p className="section-subtitle">Sign in to comment.</p>
          )}
          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            {(comments ?? []).length === 0 ? (
              <div className="stat">No comments yet.</div>
            ) : (
              (comments ?? []).map((entry) => (
                <div key={entry.comment._id} className="stat" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <strong>@{entry.user?.handle ?? entry.user?.name ?? 'user'}</strong>
                    <div style={{ color: '#5c554e' }}>{entry.comment.body}</div>
                  </div>
                  {isAuthenticated && me && (me._id === entry.comment.userId || isModerator(me)) ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void removeComment({ commentId: entry.comment._id })}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

function buildSkillHref(ownerHandle: string | null, ownerId: Id<'users'> | null, slug: string) {
  const owner = ownerHandle?.trim() || (ownerId ? String(ownerId) : 'unknown')
  return `/${owner}/${slug}`
}

function formatConfigSnippet(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed || raw.includes('\n')) return raw
  try {
    const parsed = JSON.parse(raw)
    return JSON.stringify(parsed, null, 2)
  } catch {
    // fall through
  }

  let out = ''
  let indent = 0
  let inString = false
  let isEscaped = false

  const newline = () => {
    out = out.replace(/[ \t]+$/u, '')
    out += `\n${' '.repeat(indent * 2)}`
  }

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      out += ch
      if (isEscaped) {
        isEscaped = false
      } else if (ch === '\\') {
        isEscaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }

    if (ch === '{' || ch === '[') {
      out += ch
      indent += 1
      newline()
      continue
    }

    if (ch === '}' || ch === ']') {
      indent = Math.max(0, indent - 1)
      newline()
      out += ch
      continue
    }

    if (ch === ';' || ch === ',') {
      out += ch
      newline()
      continue
    }

    if (ch === '\n' || ch === '\r' || ch === '\t') {
      continue
    }

    if (ch === ' ') {
      if (out.endsWith(' ') || out.endsWith('\n')) {
        continue
      }
      out += ' '
      continue
    }

    out += ch
  }

  return out.trim()
}

function stripFrontmatter(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.startsWith('---')) return content
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return content
  return normalized.slice(endIndex + 4).replace(/^\n+/, '')
}

function formatOsList(os?: string[]) {
  if (!os?.length) return []
  return os.map((entry) => {
    const key = entry.trim().toLowerCase()
    if (key === 'darwin' || key === 'macos' || key === 'mac') return 'macOS'
    if (key === 'linux') return 'Linux'
    if (key === 'windows' || key === 'win32') return 'Windows'
    return entry
  })
}

function formatInstallLabel(spec: SkillInstallSpec) {
  if (spec.kind === 'brew') return 'Homebrew'
  if (spec.kind === 'node') return 'Node'
  if (spec.kind === 'go') return 'Go'
  if (spec.kind === 'uv') return 'uv'
  return 'Install'
}

function formatInstallCommand(spec: SkillInstallSpec) {
  if (spec.kind === 'brew' && spec.formula) {
    if (spec.tap && !spec.formula.includes('/')) {
      return `brew install ${spec.tap}/${spec.formula}`
    }
    return `brew install ${spec.formula}`
  }
  if (spec.kind === 'node' && spec.package) {
    return `npm i -g ${spec.package}`
  }
  if (spec.kind === 'go' && spec.module) {
    return `go install ${spec.module}`
  }
  if (spec.kind === 'uv' && spec.package) {
    return `uv tool install ${spec.package}`
  }
  return null
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatNixInstallSnippet(plugin: string) {
  const snippet = `programs.clawdbot.plugins = [ { source = "${plugin}"; } ];`
  return formatConfigSnippet(snippet)
}
