import type { Doc, Id } from '../../convex/_generated/dataModel'
import { SkillDiffCard } from './SkillDiffCard'
import { SkillFilesPanel } from './SkillFilesPanel'

type SkillFile = Doc<'skillVersions'>['files'][number]

type SkillDetailTabsProps = {
  activeTab: 'files' | 'compare' | 'versions'
  setActiveTab: (tab: 'files' | 'compare' | 'versions') => void
  readmeContent: string | null
  readmeError: string | null
  latestFiles: SkillFile[]
  latestVersionId: Id<'skillVersions'> | null
  skill: Doc<'skills'>
  diffVersions: Doc<'skillVersions'>[] | undefined
  versions: Doc<'skillVersions'>[] | undefined
  nixPlugin: boolean
}

export function SkillDetailTabs({
  activeTab,
  setActiveTab,
  readmeContent,
  readmeError,
  latestFiles,
  latestVersionId,
  skill,
  diffVersions,
  versions,
  nixPlugin,
}: SkillDetailTabsProps) {
  return (
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
        <SkillFilesPanel
          versionId={latestVersionId}
          readmeContent={readmeContent}
          readmeError={readmeError}
          latestFiles={latestFiles}
        />
      ) : null}
      {activeTab === 'compare' ? (
        <div className="tab-body">
          <SkillDiffCard skill={skill} versions={diffVersions ?? []} variant="embedded" />
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
  )
}
