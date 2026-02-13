import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type PackageJson = { version?: string }

function readPackageVersion() {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
    const raw = readFileSync(path, 'utf8')
    const pkg = JSON.parse(raw) as PackageJson
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function shortCommit(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length <= 8) return trimmed
  return trimmed.slice(0, 8)
}

export function getCliCommit() {
  const candidates = [
    process.env.CLAWHUB_COMMIT,
    process.env.CLAWDHUB_COMMIT,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GITHUB_SHA,
    process.env.COMMIT_SHA,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const short = shortCommit(candidate)
    if (short) return short
  }
  return readGitCommitFromCwd()
}

export function getCliVersion() {
  return readPackageVersion()
}

export function getCliBuildLabel() {
  const version = getCliVersion()
  const commit = getCliCommit()
  return commit ? `v${version} (${commit})` : `v${version}`
}

function readGitCommitFromCwd() {
  try {
    const gitDir = findGitDir(process.cwd())
    if (!gitDir) return null
    const headPath = join(gitDir, 'HEAD')
    if (!existsSync(headPath)) return null
    const head = readFileSync(headPath, 'utf8').trim()
    if (!head) return null
    if (!head.startsWith('ref:')) return shortCommit(head)
    const ref = head.replace(/^ref:\s*/, '').trim()
    if (!ref) return null
    const refPath = join(gitDir, ref)
    if (!existsSync(refPath)) return null
    const sha = readFileSync(refPath, 'utf8').trim()
    return shortCommit(sha)
  } catch {
    return null
  }
}

function findGitDir(start: string) {
  let current = resolve(start)
  for (;;) {
    const dotGit = join(current, '.git')
    if (existsSync(dotGit)) {
      try {
        const stat = statSync(dotGit)
        if (stat.isDirectory()) return dotGit
      } catch {
        // ignore
      }
      try {
        const content = readFileSync(dotGit, 'utf8').trim()
        const match = content.match(/^gitdir:\s*(.+)$/)
        if (match?.[1]) return resolve(current, match[1])
      } catch {
        return dotGit
      }
      return dotGit
    }
    const parent = resolve(current, '..')
    if (parent === current) return null
    current = parent
  }
}
