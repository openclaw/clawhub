import { useAuthActions } from '@convex-dev/auth/react'
import { Link } from '@tanstack/react-router'
import { Globe, Menu, Monitor, Moon, Sun } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { useI18n } from '../i18n'
import type { Locale } from '../i18n'
import { gravatarUrl } from '../lib/gravatar'
import { isModerator } from '../lib/roles'
import { getClawHubSiteUrl, getSiteMode, getSiteName } from '../lib/site'
import { applyTheme, useThemeMode } from '../lib/theme'
import { startThemeTransition } from '../lib/theme-transition'
import { useAuthStatus } from '../lib/useAuthStatus'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

const localeLabels: Record<Locale, string> = {
  en: 'EN',
  'zh-CN': '中文',
}

export default function Header() {
  const { isAuthenticated, isLoading, me } = useAuthStatus()
  const { signIn, signOut } = useAuthActions()
  const { mode, setMode } = useThemeMode()
  const { t, locale, setLocale } = useI18n()
  const toggleRef = useRef<HTMLDivElement | null>(null)
  const siteMode = getSiteMode()
  const siteName = useMemo(() => getSiteName(siteMode), [siteMode])
  const isSoulMode = siteMode === 'souls'
  const clawHubUrl = getClawHubSiteUrl()

  const avatar = me?.image ?? (me?.email ? gravatarUrl(me.email) : undefined)
  const handle = me?.handle ?? me?.displayName ?? 'user'
  const initial = (me?.displayName ?? me?.name ?? handle).charAt(0).toUpperCase()
  const isStaff = isModerator(me)
  const signInRedirectTo = getCurrentRelativeUrl()

  const setTheme = (next: 'system' | 'light' | 'dark') => {
    startThemeTransition({
      nextTheme: next,
      currentTheme: mode,
      setTheme: (value) => {
        const nextMode = value as 'system' | 'light' | 'dark'
        applyTheme(nextMode)
        setMode(nextMode)
      },
      context: { element: toggleRef.current },
    })
  }

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link
          to="/"
          search={{ q: undefined, highlighted: undefined, search: undefined }}
          className="brand"
        >
          <span className="brand-mark">
            <img src="/clawd-logo.png" alt="" aria-hidden="true" />
          </span>
          <span className="brand-name">{siteName}</span>
        </Link>
        <nav className="nav-links">
          {isSoulMode ? <a href={clawHubUrl}>ClawHub</a> : null}
          {isSoulMode ? (
            <Link
              to="/souls"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                view: undefined,
                focus: undefined,
              }}
            >
              {t('header.souls')}
            </Link>
          ) : (
            <Link
              to="/skills"
              search={{
                q: undefined,
                sort: undefined,
                dir: undefined,
                highlighted: undefined,
                nonSuspicious: undefined,
                view: undefined,
                focus: undefined,
              }}
            >
              {t('header.skills')}
            </Link>
          )}
          <Link to="/upload" search={{ updateSlug: undefined }}>
            {t('header.upload')}
          </Link>
          {isSoulMode ? null : <Link to="/import">{t('header.import')}</Link>}
          <Link
            to={isSoulMode ? '/souls' : '/skills'}
            search={
              isSoulMode
                ? {
                    q: undefined,
                    sort: undefined,
                    dir: undefined,
                    view: undefined,
                    focus: 'search',
                  }
                : {
                    q: undefined,
                    sort: undefined,
                    dir: undefined,
                    highlighted: undefined,
                    nonSuspicious: undefined,
                    view: undefined,
                    focus: 'search',
                  }
            }
          >
            {t('header.search')}
          </Link>
          {me ? <Link to="/stars">{t('header.stars')}</Link> : null}
          {isStaff ? (
            <Link to="/management" search={{ skill: undefined }}>
              {t('header.management')}
            </Link>
          ) : null}
        </nav>
        <div className="nav-actions">
          <div className="nav-mobile">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="nav-mobile-trigger" type="button" aria-label={t('header.openMenu')}>
                  <Menu className="h-4 w-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isSoulMode ? (
                  <DropdownMenuItem asChild>
                    <a href={clawHubUrl}>ClawHub</a>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem asChild>
                  {isSoulMode ? (
                    <Link
                      to="/souls"
                      search={{
                        q: undefined,
                        sort: undefined,
                        dir: undefined,
                        view: undefined,
                        focus: undefined,
                      }}
                    >
                      {t('header.souls')}
                    </Link>
                  ) : (
                    <Link
                      to="/skills"
                      search={{
                        q: undefined,
                        sort: undefined,
                        dir: undefined,
                        highlighted: undefined,
                        nonSuspicious: undefined,
                        view: undefined,
                        focus: undefined,
                      }}
                    >
                      {t('header.skills')}
                    </Link>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/upload" search={{ updateSlug: undefined }}>
                    {t('header.upload')}
                  </Link>
                </DropdownMenuItem>
                {isSoulMode ? null : (
                  <DropdownMenuItem asChild>
                    <Link to="/import">{t('header.import')}</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link
                    to={isSoulMode ? '/souls' : '/skills'}
                    search={
                      isSoulMode
                        ? {
                            q: undefined,
                            sort: undefined,
                            dir: undefined,
                            view: undefined,
                            focus: 'search',
                          }
                        : {
                            q: undefined,
                            sort: undefined,
                            dir: undefined,
                            highlighted: undefined,
                            nonSuspicious: undefined,
                            view: undefined,
                            focus: 'search',
                          }
                    }
                  >
                    {t('header.search')}
                  </Link>
                </DropdownMenuItem>
                {me ? (
                  <DropdownMenuItem asChild>
                    <Link to="/stars">{t('header.stars')}</Link>
                  </DropdownMenuItem>
                ) : null}
                {isStaff ? (
                  <DropdownMenuItem asChild>
                    <Link to="/management" search={{ skill: undefined }}>
                      {t('header.management')}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme('system')}>
                  <Monitor className="h-4 w-4" aria-hidden="true" />
                  {t('header.system')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('light')}>
                  <Sun className="h-4 w-4" aria-hidden="true" />
                  {t('header.light')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTheme('dark')}>
                  <Moon className="h-4 w-4" aria-hidden="true" />
                  {t('header.dark')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}
                >
                  <Globe className="h-4 w-4" aria-hidden="true" />
                  {locale === 'en' ? '中文' : 'EN'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="theme-toggle" ref={toggleRef}>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(value) => {
                if (!value) return
                setTheme(value as 'system' | 'light' | 'dark')
              }}
              aria-label="Theme mode"
            >
              <ToggleGroupItem value="system" aria-label={t('header.systemTheme')}>
                <Monitor className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('header.system')}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="light" aria-label={t('header.lightTheme')}>
                <Sun className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('header.light')}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label={t('header.darkTheme')}>
                <Moon className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('header.dark')}</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="btn btn-ghost btn-sm" type="button" aria-label={t('header.language')}>
                <Globe className="h-4 w-4" />
                <span>{localeLabels[locale]}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setLocale('en')}>
                EN
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocale('zh-CN')}>
                中文
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isAuthenticated && me ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="user-trigger" type="button">
                  {avatar ? (
                    <img src={avatar} alt={me.displayName ?? me.name ?? t('header.userAvatar')} />
                  ) : (
                    <span className="user-menu-fallback">{initial}</span>
                  )}
                  <span className="mono">@{handle}</span>
                  <span className="user-menu-chevron">▾</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/dashboard">{t('header.dashboard')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/settings">{t('header.settings')}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()}>{t('header.signOut')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              disabled={isLoading}
              onClick={() =>
                void signIn(
                  'github',
                  signInRedirectTo ? { redirectTo: signInRedirectTo } : undefined,
                )
              }
            >
              <span className="sign-in-label">{t('header.signIn')}</span>
              <span className="sign-in-provider">{t('header.withGitHub')}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

function getCurrentRelativeUrl() {
  if (typeof window === 'undefined') return '/'
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}
