import { homedir } from 'node:os'
import { win32 } from 'node:path'

/**
 * Resolve the user's home directory, preferring environment variables over
 * os.homedir(). On Linux, os.homedir() reads from /etc/passwd which can
 * return a stale path after a user rename (usermod -l). The $HOME env var
 * is set by the login process and reflects the current session.
 */
export function resolveHome(): string {
  if (process.platform === 'win32') {
    return normalizeHome(process.env.USERPROFILE) || normalizeHome(process.env.HOME) || homedir()
  }
  return normalizeHome(process.env.HOME) || homedir()
}

function normalizeHome(value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return ''

  if (process.platform === 'win32') {
    const root = win32.parse(trimmed).root
    if (trimmed === root) return trimmed
    return trimmed.replace(/[\\/]+$/, '')
  }

  if (trimmed === '/') return '/'
  return trimmed.replace(/\/+$/, '')
}
