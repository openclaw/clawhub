import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useI18n } from '../i18n'
import { gravatarUrl } from '../lib/gravatar'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  const { t } = useI18n()
  const me = useQuery(api.users.me)
  const updateProfile = useMutation(api.users.updateProfile)
  const deleteAccount = useMutation(api.users.deleteAccount)
  const tokens = useQuery(api.tokens.listMine) as
    | Array<{
        _id: Id<'apiTokens'>
        label: string
        prefix: string
        createdAt: number
        lastUsedAt?: number
        revokedAt?: number
      }>
    | undefined
  const createToken = useMutation(api.tokens.create)
  const revokeToken = useMutation(api.tokens.revoke)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [tokenLabel, setTokenLabel] = useState('CLI token')
  const [newToken, setNewToken] = useState<string | null>(null)

  useEffect(() => {
    if (!me) return
    setDisplayName(me.displayName ?? '')
    setBio(me.bio ?? '')
  }, [me])

  if (!me) {
    return (
      <main className="section">
        <div className="card">{t('settings.signInRequired')}</div>
      </main>
    )
  }

  const avatar = me.image ?? (me.email ? gravatarUrl(me.email, 160) : undefined)
  const identityName = me.displayName ?? me.name ?? me.handle ?? 'Profile'
  const handle = me.handle ?? (me.email ? me.email.split('@')[0] : undefined)

  async function onSave(event: React.FormEvent) {
    event.preventDefault()
    await updateProfile({ displayName, bio })
    setStatus(t('settings.saved'))
  }

  async function onDelete() {
    const ok = window.confirm(
      'Delete your account permanently? This cannot be undone.\n\n' +
        'Published skills will remain public.',
    )
    if (!ok) return
    await deleteAccount()
  }

  async function onCreateToken() {
    const label = tokenLabel.trim() || t('settings.cliToken')
    const result = await createToken({ label })
    setNewToken(result.token)
  }

  return (
    <main className="section settings-shell">
      <h1 className="section-title">{t('settings.title')}</h1>
      <div className="card settings-profile">
        <div className="settings-avatar">
          {avatar ? (
            <img src={avatar} alt={identityName} />
          ) : (
            <span>{identityName[0]?.toUpperCase() ?? 'U'}</span>
          )}
        </div>
        <div className="settings-profile-body">
          <div className="settings-name">{identityName}</div>
          {handle ? <div className="settings-handle">@{handle}</div> : null}
          {me.email ? <div className="settings-email">{me.email}</div> : null}
        </div>
      </div>
      <form className="card settings-card" onSubmit={onSave}>
        <label className="settings-field">
          <span>{t('settings.displayName')}</span>
          <input
            className="settings-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>{t('settings.bio')}</span>
          <textarea
            className="settings-input"
            rows={5}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder={t('settings.bioPlaceholder')}
          />
        </label>
        <div className="settings-actions">
          <button className="btn btn-primary settings-save" type="submit">
            {t('settings.save')}
          </button>
          {status ? <div className="stat">{status}</div> : null}
        </div>
      </form>

      <div className="card settings-card">
        <h2 className="section-title danger-title" style={{ marginTop: 0 }}>
          {t('settings.apiTokens')}
        </h2>
        <p className="section-subtitle">
          {t('settings.apiTokensSubtitle')}
        </p>

        <div className="settings-field">
          <span>{t('settings.label')}</span>
          <input
            className="settings-input"
            value={tokenLabel}
            onChange={(event) => setTokenLabel(event.target.value)}
            placeholder={t('settings.cliToken')}
          />
        </div>
        <div className="settings-actions">
          <button
            className="btn btn-primary settings-save"
            type="button"
            onClick={() => void onCreateToken()}
          >
            {t('settings.createToken')}
          </button>
          {newToken ? (
            <div className="stat" style={{ overflowX: 'auto' }}>
              <div style={{ marginBottom: 8 }}>{t('settings.copyTokenNow')}</div>
              <code>{newToken}</code>
            </div>
          ) : null}
        </div>

        {(tokens ?? []).length ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            {(tokens ?? []).map((token) => (
              <div
                key={token._id}
                className="stat"
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
              >
                <div>
                  <div>
                    <strong>{token.label}</strong>{' '}
                    <span style={{ opacity: 0.7 }}>({token.prefix}…)</span>
                  </div>
                  <div style={{ opacity: 0.7 }}>
                    {t('settings.created')} {formatDate(token.createdAt)}
                    {token.lastUsedAt ? ` · ${t('settings.used')} ${formatDate(token.lastUsedAt)}` : ''}
                    {token.revokedAt ? ` · ${t('settings.revoked')} ${formatDate(token.revokedAt)}` : ''}
                  </div>
                </div>
                <div>
                  <button
                    className="btn"
                    type="button"
                    disabled={Boolean(token.revokedAt)}
                    onClick={() => void revokeToken({ tokenId: token._id })}
                  >
                    {token.revokedAt ? t('settings.revoked') : t('settings.revoke')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="section-subtitle" style={{ marginTop: 16 }}>
            {t('settings.noTokens')}
          </p>
        )}
      </div>

      <div className="card danger-card">
        <h2 className="section-title danger-title">{t('settings.dangerZone')}</h2>
        <p className="section-subtitle">
          {t('settings.dangerText')}
        </p>
        <button className="btn btn-danger" type="button" onClick={() => void onDelete()}>
          {t('settings.deleteAccount')}
        </button>
      </div>
    </main>
  )
}

function formatDate(value: number) {
  try {
    return new Date(value).toLocaleString()
  } catch {
    return String(value)
  }
}
