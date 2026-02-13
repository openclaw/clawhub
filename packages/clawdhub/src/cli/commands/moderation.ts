import { isCancel, select } from '@clack/prompts'
import { readGlobalConfig } from '../../config.js'
import { apiRequest } from '../../http.js'
import {
  ApiRoutes,
  ApiV1BanUserResponseSchema,
  ApiV1SetRoleResponseSchema,
  ApiV1UserSearchResponseSchema,
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
  options: { yes?: boolean; id?: boolean; fuzzy?: boolean; reason?: string },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim()
  if (!raw) fail('Handle or user id required')

  const reason = options.reason?.trim() || undefined

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const allowPrompt = isInteractive() && inputAllowed !== false
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  )
  if (!resolved) return
  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(
      `Ban ${resolved.label}? (requires moderator/admin; deletes owned skills)`,
    )
    if (!ok) return
  }

  const spinner = createSpinner(`Banning ${resolved.label}`)
  try {
    const result = await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.users}/ban`,
        token,
        body: resolved.userId
          ? { userId: resolved.userId, reason }
          : { handle: resolved.handle, reason },
      },
      ApiV1BanUserResponseSchema,
    )
    const parsed = parseArk(ApiV1BanUserResponseSchema, result, 'Ban user response')
    if (parsed.alreadyBanned) {
      spinner.succeed(`OK. ${resolved.label} already banned`)
      return parsed
    }
    spinner.succeed(`OK. Banned ${resolved.label} (${formatDeletedSkills(parsed.deletedSkills)})`)
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
  options: { yes?: boolean; id?: boolean; fuzzy?: boolean },
  inputAllowed: boolean,
) {
  const raw = identifierArg.trim()
  if (!raw) fail('Handle or user id required')
  const role = normalizeRole(roleArg)

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const allowPrompt = isInteractive() && inputAllowed !== false
  const resolved = await resolveUserIdentifier(
    registry,
    token,
    raw,
    { id: options.id, fuzzy: options.fuzzy },
    allowPrompt,
  )
  if (!resolved) return
  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(`Set role for ${resolved.label} to ${role}? (admin only)`)
    if (!ok) return
  }

  const spinner = createSpinner(`Setting role for ${resolved.label}`)
  try {
    const result = await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.users}/role`,
        token,
        body: resolved.userId
          ? { userId: resolved.userId, role }
          : { handle: resolved.handle, role },
      },
      ApiV1SetRoleResponseSchema,
    )
    const parsed = parseArk(ApiV1SetRoleResponseSchema, result, 'Set role response')
    spinner.succeed(`OK. ${resolved.label} is now ${parsed.role}`)
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

type ResolvedUser = {
  handle: string | null
  userId: string | null
  label: string
}

type UserSearchItem = {
  userId: string
  handle: string | null
  displayName?: string | null
  name?: string | null
  role?: 'admin' | 'moderator' | 'user' | null
}

async function resolveUserIdentifier(
  registry: string,
  token: string,
  raw: string,
  options: { id?: boolean; fuzzy?: boolean },
  allowPrompt: boolean,
): Promise<ResolvedUser | null> {
  const usesId = Boolean(options.id)
  if (usesId) {
    return { handle: null, userId: raw, label: raw }
  }

  const handle = normalizeHandle(raw)
  if (!options.fuzzy) {
    return { handle, userId: null, label: `@${handle}` }
  }

  const matches = await searchUsers(registry, token, raw)
  if (matches.items.length === 0) {
    fail(`No users matched "${raw}".`)
  }

  if (matches.items.length === 1) {
    const match = matches.items[0] as UserSearchItem
    return {
      handle: match.handle ?? null,
      userId: match.userId,
      label: formatUserLabel(match),
    }
  }

  if (!allowPrompt) {
    fail(`Multiple users matched "${raw}". Use --id.\n${formatUserList(matches.items)}`)
  }

  const choice = await select({
    message: `Select a user for "${raw}"`,
    options: matches.items.map((item) => ({
      value: item.userId,
      label: formatUserLabel(item),
    })),
  })
  if (isCancel(choice)) return null
  const selected = matches.items.find((item) => item.userId === choice)
  if (!selected) return null
  return {
    handle: selected.handle ?? null,
    userId: selected.userId,
    label: formatUserLabel(selected),
  }
}

async function searchUsers(registry: string, token: string, query: string) {
  const url = new URL(ApiRoutes.users, registry)
  url.searchParams.set('q', query.trim())
  url.searchParams.set('limit', '10')
  const result = await apiRequest(
    registry,
    { method: 'GET', path: `${url.pathname}?${url.searchParams.toString()}`, token },
    ApiV1UserSearchResponseSchema,
  )
  return parseArk(ApiV1UserSearchResponseSchema, result, 'User search response')
}

function formatUserLabel(user: UserSearchItem) {
  const handle = user.handle ? `@${user.handle}` : 'unknown'
  const name = user.displayName ?? user.name
  const role = user.role ? ` (${user.role})` : ''
  const label = name ? `${handle} — ${name}` : handle
  return `${label}${role} · ${user.userId}`
}

function formatUserList(users: UserSearchItem[]) {
  return users.map((user) => `- ${formatUserLabel(user)}`).join('\n')
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
