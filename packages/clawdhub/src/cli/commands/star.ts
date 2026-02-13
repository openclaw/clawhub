import { readGlobalConfig } from '../../config.js'
import { apiRequest } from '../../http.js'
import { ApiRoutes, ApiV1StarResponseSchema } from '../../schema/index.js'
import { getRegistry } from '../registry.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from '../ui.js'

async function requireToken() {
  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawhub login')
  return token
}

export async function cmdStarSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  const slug = slugArg.trim().toLowerCase()
  if (!slug) fail('Slug required')
  const allowPrompt = isInteractive() && inputAllowed !== false

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(`Star ${slug}?`)
    if (!ok) return
  }

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`Starring ${slug}`)
  try {
    const result = await apiRequest(
      registry,
      { method: 'POST', path: `${ApiRoutes.stars}/${encodeURIComponent(slug)}`, token },
      ApiV1StarResponseSchema,
    )
    spinner.succeed(result.alreadyStarred ? `OK. ${slug} already starred.` : `OK. Starred ${slug}`)
    return result
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}
