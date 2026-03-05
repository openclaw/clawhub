import { useI18n } from '../i18n'
import { getSiteName } from '../lib/site'

export function Footer() {
  const { t } = useI18n()
  const siteName = getSiteName()
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-divider" aria-hidden="true" />
        <div className="site-footer-row">
          <div className="site-footer-copy">
            {siteName} · {t('footer.an')}{t('footer.an') ? ' ' : ''}
            <a href="https://openclaw.ai" target="_blank" rel="noreferrer">
              {t('footer.openClaw')}
            </a>{' '}
            {t('footer.project')} · {t('footer.deployedOn')}{' '}
            <a href="https://vercel.com" target="_blank" rel="noreferrer">
              Vercel
            </a>{' '}
            · {t('footer.poweredBy')}{' '}
            <a href="https://www.convex.dev" target="_blank" rel="noreferrer">
              Convex
            </a>{' '}
            ·{' '}
            <a href="https://github.com/openclaw/clawhub" target="_blank" rel="noreferrer">
              {t('footer.openSourceMIT')}
            </a>{' '}
            ·{' '}
            <a href="https://steipete.me" target="_blank" rel="noreferrer">
              Peter Steinberger
            </a>
            .
          </div>
        </div>
      </div>
    </footer>
  )
}
