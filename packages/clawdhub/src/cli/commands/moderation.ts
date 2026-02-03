import { readGlobalConfig } from '../../config.js'
import { apiRequest } from '../../http.js'
import {
  ApiRoutes,
  ApiV1BanUserResponseSchema,
  ApiV1SetRoleResponseSchema,
  parseArk,
} from '../../schema/index.js'
import { getRegistry } from '../registry.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from '../ui.js'

async function requireToken() {
  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawhub login')
  return token
}

export async function cmdBanUser(
  opts: GlobalOpts,
  identifierArg: string,
  options: { yes?: boolean; id?: boolean },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim()
  if (!raw) fail('Handle or user id required')
  const allowPrompt = isInteractive() && inputAllowed !== false
  const usesId = Boolean(options.id)
  const handle = usesId ? null : normalizeHandle(raw)
  const label = usesId ? raw : `@${handle}`

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(`Ban ${label}? (requires moderator/admin; deletes owned skills)`)
    if (!ok) return
  }

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`Banning ${label}`)
  try {
    const result = await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.users}/ban`,
        token,
        body: usesId ? { userId: raw } : { handle },
      },
      ApiV1BanUserResponseSchema,
    )
    const parsed = parseArk(ApiV1BanUserResponseSchema, result, 'Ban user response')
    if (parsed.alreadyBanned) {
      spinner.succeed(`OK. ${label} already banned`)
      return parsed
    }
    spinner.succeed(`OK. Banned ${label} (${formatDeletedSkills(parsed.deletedSkills)})`)
    return parsed
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

export async function cmdSetRole(
  opts: GlobalOpts,
  identifierArg: string,
  roleArg: string,
  options: { yes?: boolean; id?: boolean },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim()
  if (!raw) fail('Handle or user id required')
  const role = normalizeRole(roleArg)
  const allowPrompt = isInteractive() && inputAllowed !== false
  const usesId = Boolean(options.id)
  const handle = usesId ? null : normalizeHandle(raw)
  const label = usesId ? raw : `@${handle}`

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(`Set role for ${label} to ${role}? (admin only)`)
    if (!ok) return
  }

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`Setting role for ${label}`)
  try {
    const result = await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.users}/role`,
        token,
        body: usesId ? { userId: raw, role } : { handle, role },
      },
      ApiV1SetRoleResponseSchema,
    )
    const parsed = parseArk(ApiV1SetRoleResponseSchema, result, 'Set role response')
    spinner.succeed(`OK. ${label} is now ${parsed.role}`)
    return parsed
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

function normalizeHandle(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith('@') ? trimmed.slice(1).toLowerCase() : trimmed.toLowerCase()
}

function normalizeRole(value: string) {
  const role = value.trim().toLowerCase()
  if (role === 'user' || role === 'moderator' || role === 'admin') return role
  fail('Role must be user|moderator|admin')
}

function formatDeletedSkills(count: number) {
  if (!Number.isFinite(count)) return 'deleted skills unknown'
  if (count === 1) return 'deleted 1 skill'
  return `deleted ${count} skills`
}
