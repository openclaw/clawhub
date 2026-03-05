import { useMemo, useState } from 'react'
import { useI18n } from '../i18n/useI18n'

type PackageManager = 'npm' | 'pnpm' | 'bun'

type InstallSwitcherProps = {
  exampleSlug?: string
}

const PACKAGE_MANAGERS: Array<{ id: PackageManager; label: string }> = [
  { id: 'npm', label: 'npm' },
  { id: 'pnpm', label: 'pnpm' },
  { id: 'bun', label: 'bun' },
]

export function InstallSwitcher({ exampleSlug = 'sonoscli' }: InstallSwitcherProps) {
  const { t } = useI18n()
  const [pm, setPm] = useState<PackageManager>('npm')

  const command = useMemo(() => {
    switch (pm) {
      case 'npm':
        return `npx clawhub@latest install ${exampleSlug}`
      case 'pnpm':
        return `pnpm dlx clawhub@latest install ${exampleSlug}`
      case 'bun':
        return `bunx clawhub@latest install ${exampleSlug}`
    }
  }, [exampleSlug, pm])

  return (
    <div className="install-switcher">
      <div className="install-switcher-row">
        <div className="stat">{t('installSwitcher.instruction')}</div>
        <div className="install-switcher-toggle" role="tablist" aria-label={t('installSwitcher.ariaLabel')}>
          {PACKAGE_MANAGERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={
                pm === entry.id ? 'install-switcher-pill is-active' : 'install-switcher-pill'
              }
              role="tab"
              aria-selected={pm === entry.id}
              onClick={() => setPm(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      <div className="hero-install-code mono">{command}</div>
    </div>
  )
}
