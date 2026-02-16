import type { ClawdisSkillMetadata } from 'clawhub-schema'
import { formatInstallCommand, formatInstallLabel } from './skillDetailUtils'

const CAPABILITY_DISPLAY: Record<string, { icon: string; label: string }> = {
  shell: { icon: '>_', label: 'Shell commands' },
  filesystem: { icon: '\uD83D\uDCC2', label: 'File access' },
  network: { icon: '\uD83C\uDF10', label: 'Network requests' },
  browser: { icon: '\uD83D\uDD0D', label: 'Browser control' },
  sessions: { icon: '\u26A1', label: 'Session orchestration' },
}

type SkillInstallCardProps = {
  clawdis: ClawdisSkillMetadata | undefined
  osLabels: string[]
}

export function SkillInstallCard({ clawdis, osLabels }: SkillInstallCardProps) {
  const requirements = clawdis?.requires
  const installSpecs = clawdis?.install ?? []
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
  const hasCapabilities = Boolean(clawdis?.capabilities?.length)

  return (
    <div className="skill-hero-content">
      <div className="skill-hero-panels">
        {hasCapabilities ? (
          <div className="skill-panel">
            <h3 className="section-title" style={{ fontSize: '1rem', margin: 0 }}>
              Capabilities
            </h3>
            <div className="skill-panel-body">
              {clawdis!.capabilities!.map((cap) => (
                <div key={cap} className="stat">
                  <span>{CAPABILITY_DISPLAY[cap]?.icon ?? cap}</span>
                  <span>{CAPABILITY_DISPLAY[cap]?.label ?? cap}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="skill-panel">
            <div className="skill-panel-body">
              <div className="stat" style={{ color: 'var(--ink-soft)' }}>
                <span>No capabilities declared</span>
              </div>
            </div>
          </div>
        )}
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
  )
}
