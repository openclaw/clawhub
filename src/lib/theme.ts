import { useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

const THEME_KEY = 'clawhub-theme'
const LEGACY_THEME_KEY = 'clawdhub-theme'

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  const legacy = window.localStorage.getItem(LEGACY_THEME_KEY)
  if (legacy === 'light' || legacy === 'dark' || legacy === 'system') return legacy
  return 'system'
}

function resolveTheme(mode: ThemeMode) {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return
  const resolved = resolveTheme(mode)
  document.documentElement.dataset.theme = resolved
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredTheme())

  useEffect(() => {
    applyTheme(mode)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_KEY, mode)
    }
    if (mode !== 'system' || typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme(mode)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [mode])

  return { mode, setMode }
}
