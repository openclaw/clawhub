import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { type GlobalConfig, GlobalConfigSchema, parseArk } from './schema/index.js'

/**
 * Resolve config path with legacy fallback.
 * Checks for 'clawhub' first, falls back to legacy 'clawdhub' if it exists.
 */
function resolveConfigPath(baseDir: string): string {
  const clawhubPath = join(baseDir, 'clawhub', 'config.json')
  const clawdhubPath = join(baseDir, 'clawdhub', 'config.json')
  if (existsSync(clawhubPath)) return clawhubPath
  if (existsSync(clawdhubPath)) return clawdhubPath
  return clawhubPath
}

function isNonFatalChmodError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'EINVAL'
}

export function getGlobalConfigPath() {
  const override =
    process.env.CLAWHUB_CONFIG_PATH?.trim() ?? process.env.CLAWDHUB_CONFIG_PATH?.trim()
  if (override) return resolve(override)

  const home = homedir()

  if (process.platform === 'darwin') {
    return resolveConfigPath(join(home, 'Library', 'Application Support'))
  }

  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) {
    return resolveConfigPath(xdg)
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData) {
      return resolveConfigPath(appData)
    }
  }

  return resolveConfigPath(join(home, '.config'))
}

export async function readGlobalConfig(): Promise<GlobalConfig | null> {
  try {
    const raw = await readFile(getGlobalConfigPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parseArk(GlobalConfigSchema, parsed, 'Global config')
  } catch {
    return null
  }
}

export async function writeGlobalConfig(config: GlobalConfig) {
  const path = getGlobalConfigPath()
  const dir = dirname(path)

  // Create directory with restricted permissions (owner only)
  await mkdir(dir, { recursive: true, mode: 0o700 })

  // Write file with restricted permissions (owner read/write only)
  // This protects API tokens from being read by other users
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })

  // Ensure permissions on existing files (writeFile mode only applies on create)
  if (process.platform !== 'win32') {
    try {
      await chmod(path, 0o600)
    } catch (error) {
      if (!isNonFatalChmodError(error)) throw error
    }
  }
}
