import { useAuthActions } from '@convex-dev/auth/react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { useI18n } from '../../i18n/useI18n'
import { getClawHubSiteUrl, normalizeClawHubSiteOrigin } from '../../lib/site'
import { useAuthStatus } from '../../lib/useAuthStatus'

export const Route = createFileRoute('/cli/auth')({
  component: CliAuth,
})

function CliAuth() {
  const { t } = useI18n()
  const { isAuthenticated, isLoading, me } = useAuthStatus()
  const { signIn } = useAuthActions()
  const createToken = useMutation(api.tokens.create)

  const search = Route.useSearch() as {
    redirect_uri?: string
    label?: string
    label_b64?: string
    state?: string
  }
  const [status, setStatus] = useState<string>(t('cliAuth.preparing'))
  const [token, setToken] = useState<string | null>(null)
  const hasRun = useRef(false)

  const redirectUri = search.redirect_uri ?? ''
  const label = (decodeLabel(search.label_b64) ?? search.label ?? 'CLI token').trim() || 'CLI token'
  const state = typeof search.state === 'string' ? search.state.trim() : ''
  const signInRedirectTo = getCurrentRelativeUrl()

  const safeRedirect = useMemo(() => isAllowedRedirectUri(redirectUri), [redirectUri])
  const registry = useMemo(() => {
    if (typeof window !== 'undefined') {
      return normalizeClawHubSiteOrigin(window.location.origin) ?? getClawHubSiteUrl()
    }
    return getClawHubSiteUrl()
  }, [])

  useEffect(() => {
    if (hasRun.current) return
    if (!safeRedirect) return
    if (!state) return
    if (!isAuthenticated || !me) return
    hasRun.current = true

    const run = async () => {
      setStatus(t('cliAuth.creatingToken'))
      const result = await createToken({ label })
      setToken(result.token)
      setStatus(t('cliAuth.redirecting'))
      const hash = new URLSearchParams()
      hash.set('token', result.token)
      hash.set('registry', registry)
      hash.set('state', state)
      window.location.assign(`${redirectUri}#${hash.toString()}`)
    }

    void run().catch((error) => {
      const message = error instanceof Error ? error.message : t('cliAuth.tokenFailed')
      setStatus(message)
      setToken(null)
    })
  }, [createToken, isAuthenticated, label, me, redirectUri, registry, safeRedirect, state])

  if (!safeRedirect) {
    return (
      <main className="section">
        <div className="card">
          <h1 className="section-title" style={{ marginTop: 0 }}>
            {t('cliAuth.title')}
          </h1>
          <p className="section-subtitle">{t('cliAuth.invalidRedirect')}</p>
          <p className="section-subtitle" style={{ marginBottom: 0 }}>
            {t('cliAuth.runAgain')}
          </p>
        </div>
      </main>
    )
  }

  if (!state) {
    return (
      <main className="section">
        <div className="card">
          <h1 className="section-title" style={{ marginTop: 0 }}>
            {t('cliAuth.title')}
          </h1>
          <p className="section-subtitle">{t('cliAuth.missingState')}</p>
          <p className="section-subtitle" style={{ marginBottom: 0 }}>
            {t('cliAuth.runAgain')}
          </p>
        </div>
      </main>
    )
  }

  if (!isAuthenticated || !me) {
    return (
      <main className="section">
        <div className="card">
          <h1 className="section-title" style={{ marginTop: 0 }}>
            {t('cliAuth.title')}
          </h1>
          <p className="section-subtitle">{t('cliAuth.signInInstruction')}</p>
          <button
            className="btn btn-primary"
            type="button"
            disabled={isLoading}
            onClick={() =>
              void signIn('github', signInRedirectTo ? { redirectTo: signInRedirectTo } : undefined)
            }
          >
            {t('cliAuth.signInWithGitHub')}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="section">
      <div className="card">
        <h1 className="section-title" style={{ marginTop: 0 }}>
          CLI login
        </h1>
        <p className="section-subtitle">{status}</p>
        {token ? (
          <div className="stat" style={{ overflowX: 'auto' }}>
            <div style={{ marginBottom: 8 }}>{t('cliAuth.copyToken')}</div>
            <code>{token}</code>
          </div>
        ) : null}
      </div>
    </main>
  )
}

function isAllowedRedirectUri(value: string) {
  if (!value) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]'
}

function decodeLabel(value: string | undefined) {
  if (!value) return null
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const decoded = new TextDecoder().decode(bytes)
    const label = decoded.trim()
    if (!label) return null
    return label.slice(0, 80)
  } catch {
    return null
  }
}

function getCurrentRelativeUrl() {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}
