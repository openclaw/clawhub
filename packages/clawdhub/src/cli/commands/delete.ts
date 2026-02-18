import { apiRequest } from '../../http.js'
import { ApiRoutes, ApiV1DeleteResponseSchema, parseArk } from '../../schema/index.js'
import { requireAuthToken } from '../authToken.js'
import { getRegistry } from '../registry.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from '../ui.js'

type SkillActionLabels = {
  verb: string
  progress: string
  past: string
  promptSuffix?: string
}

const deleteLabels: SkillActionLabels = {
  verb: 'Delete',
  progress: 'Deleting',
  past: 'Deleted',
  promptSuffix: 'soft delete, owner/moderator/admin',
}

const undeleteLabels: SkillActionLabels = {
  verb: 'Undelete',
  progress: 'Undeleting',
  past: 'Undeleted',
  promptSuffix: 'owner/moderator/admin',
}

const hideLabels: SkillActionLabels = {
  verb: 'Hide',
  progress: 'Hiding',
  past: 'Hidden',
  promptSuffix: 'owner/moderator/admin',
}

const unhideLabels: SkillActionLabels = {
  verb: 'Unhide',
  progress: 'Unhiding',
  past: 'Unhidden',
  promptSuffix: 'owner/moderator/admin',
}

export async function cmdDeleteSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
  labels: SkillActionLabels = deleteLabels,
) {
  const slug = slugArg.trim().toLowerCase()
  if (!slug) fail('Slug required')
  const allowPrompt = isInteractive() && inputAllowed !== false

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(formatPrompt(labels, slug))
    if (!ok) return
  }

  const token = await requireAuthToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`${labels.progress} ${slug}`)
  try {
    const result = await apiRequest(
      registry,
      { method: 'DELETE', path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}`, token },
      ApiV1DeleteResponseSchema,
    )
    spinner.succeed(`OK. ${labels.past} ${slug}`)
    return parseArk(ApiV1DeleteResponseSchema, result, 'Delete response')
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

export async function cmdUndeleteSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
  labels: SkillActionLabels = undeleteLabels,
) {
  const slug = slugArg.trim().toLowerCase()
  if (!slug) fail('Slug required')
  const allowPrompt = isInteractive() && inputAllowed !== false

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(formatPrompt(labels, slug))
    if (!ok) return
  }

  const token = await requireAuthToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`${labels.progress} ${slug}`)
  try {
    const result = await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/undelete`,
        token,
      },
      ApiV1DeleteResponseSchema,
    )
    spinner.succeed(`OK. ${labels.past} ${slug}`)
    return parseArk(ApiV1DeleteResponseSchema, result, 'Undelete response')
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

export async function cmdHideSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  return cmdDeleteSkill(opts, slugArg, options, inputAllowed, hideLabels)
}

export async function cmdUnhideSkill(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  return cmdUndeleteSkill(opts, slugArg, options, inputAllowed, unhideLabels)
}

function formatPrompt(labels: SkillActionLabels, slug: string) {
  const suffix = labels.promptSuffix ? ` (${labels.promptSuffix})` : ''
  return `${labels.verb} ${slug}?${suffix}`
}
