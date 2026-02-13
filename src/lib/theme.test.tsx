import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getStoredTheme, useThemeMode } from './theme'

describe('theme', () => {
  let store: Record<string, string>

  function Harness() {
    const { mode, setMode } = useThemeMode()
    return (
      <div>
        <div data-testid="mode">{mode}</div>
        <button type="button" onClick={() => setMode('dark')}>
          dark
        </button>
      </div>
    )
  }

  beforeEach(() => {
    store = {}
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = String(value)
        },
        removeItem: (key: string) => {
          delete store[key]
        },
        clear: () => {
          store = {}
        },
      },
      configurable: true,
    })
  })

  afterEach(() => {
    document.documentElement.classList.remove('dark')
    delete document.documentElement.dataset.theme
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('reads stored theme with fallback', () => {
    expect(getStoredTheme()).toBe('system')
    window.localStorage.setItem('clawhub-theme', 'dark')
    expect(getStoredTheme()).toBe('dark')
    window.localStorage.setItem('clawhub-theme', 'nope')
    expect(getStoredTheme()).toBe('system')
    window.localStorage.setItem('clawdhub-theme', 'dark')
    expect(getStoredTheme()).toBe('dark')
  })

  it('applies theme and toggles dark class', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('resolves system theme via matchMedia', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('useThemeMode persists and applies mode', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    render(<Harness />)
    expect(screen.getByTestId('mode').textContent).toBe('system')
    fireEvent.click(screen.getByRole('button', { name: 'dark' }))
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark')
    })
    expect(window.localStorage.getItem('clawhub-theme')).toBe('dark')
  })
})
