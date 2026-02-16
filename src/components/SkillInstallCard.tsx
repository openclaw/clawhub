import type { ClawdisSkillMetadata } from 'clawhub-schema'
import { formatInstallCommand, formatInstallLabel } from './skillDetailUtils'

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

  if (!hasRuntimeRequirements && !hasInstallSpecs) return null

  return (
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
  )
}
