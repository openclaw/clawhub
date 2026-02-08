import { readGlobalConfig } from '../../config.js'
import { apiRequest } from '../../http.js'
import { ApiRoutes } from '../../schema/index.js'
import { getRegistry } from '../registry.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError, isInteractive, promptConfirm } from '../ui.js'

async function requireToken() {
  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawhub login')
  return token
}

/**
 * Request to transfer a skill to another user.
 */
export async function cmdTransfer(
  opts: GlobalOpts,
  slugArg: string,
  toHandleArg: string,
  options: { message?: string; yes?: boolean },
  inputAllowed: boolean,
) {
  const slug = slugArg.trim().toLowerCase()
  const toHandle = toHandleArg.trim().toLowerCase().replace(/^@/, '')

  if (!slug) fail('Skill slug required')
  if (!toHandle) fail('Recipient handle required (e.g., @username)')

  const allowPrompt = isInteractive() && inputAllowed !== false

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(
      `Transfer ${slug} to @${toHandle}? They will need to accept.`,
    )
    if (!ok) return
  }

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`Requesting transfer of ${slug} to @${toHandle}`)

  try {
    const result = await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/transfer`,
        token,
        body: JSON.stringify({
          toUserHandle: toHandle,
          message: options.message,
        }),
      },
      undefined, // No schema validation for now
    )
    spinner.succeed(`Transfer requested. @${toHandle} must accept at clawhub.io/settings`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

/**
 * List incoming transfer requests.
 */
export async function cmdTransferList(opts: GlobalOpts, options: { outgoing?: boolean }) {
  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner('Fetching transfers')

  try {
    const path = options.outgoing
      ? '/api/v1/transfers/outgoing'
      : '/api/v1/transfers/incoming'

    const result = await apiRequest(
      registry,
      { method: 'GET', path, token },
      undefined,
    ) as { transfers: Array<{
      skill: { slug: string }
      fromUser?: { handle: string }
      toUser?: { handle: string }
      requestedAt: number
      expiresAt: number
    }> }

    spinner.stop()

    if (!result.transfers?.length) {
      console.log(options.outgoing ? 'No outgoing transfers.' : 'No incoming transfers.')
      return
    }

    console.log(options.outgoing ? 'Outgoing transfers:' : 'Incoming transfers:')
    for (const t of result.transfers) {
      const other = options.outgoing ? t.toUser?.handle : t.fromUser?.handle
      const expiresIn = Math.ceil((t.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))
      console.log(`  ${t.skill.slug} → @${other} (expires in ${expiresIn}d)`)
    }
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

/**
 * Accept an incoming transfer.
 */
export async function cmdTransferAccept(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  const slug = slugArg.trim().toLowerCase()
  if (!slug) fail('Skill slug required')

  const allowPrompt = isInteractive() && inputAllowed !== false

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(`Accept transfer of ${slug}? You will become the owner.`)
    if (!ok) return
  }

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`Accepting transfer of ${slug}`)

  try {
    await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/transfer/accept`,
        token,
      },
      undefined,
    )
    spinner.succeed(`You are now the owner of ${slug}`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

/**
 * Reject an incoming transfer.
 */
export async function cmdTransferReject(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  const slug = slugArg.trim().toLowerCase()
  if (!slug) fail('Skill slug required')

  const allowPrompt = isInteractive() && inputAllowed !== false

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(`Reject transfer of ${slug}?`)
    if (!ok) return
  }

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`Rejecting transfer of ${slug}`)

  try {
    await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/transfer/reject`,
        token,
      },
      undefined,
    )
    spinner.succeed(`Transfer of ${slug} rejected`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

/**
 * Cancel an outgoing transfer.
 */
export async function cmdTransferCancel(
  opts: GlobalOpts,
  slugArg: string,
  options: { yes?: boolean },
  inputAllowed: boolean,
) {
  const slug = slugArg.trim().toLowerCase()
  if (!slug) fail('Skill slug required')

  const allowPrompt = isInteractive() && inputAllowed !== false

  if (!options.yes) {
    if (!allowPrompt) fail('Pass --yes (no input)')
    const ok = await promptConfirm(`Cancel transfer of ${slug}?`)
    if (!ok) return
  }

  const token = await requireToken()
  const registry = await getRegistry(opts, { cache: true })
  const spinner = createSpinner(`Cancelling transfer of ${slug}`)

  try {
    await apiRequest(
      registry,
      {
        method: 'POST',
        path: `${ApiRoutes.skills}/${encodeURIComponent(slug)}/transfer/cancel`,
        token,
      },
      undefined,
    )
    spinner.succeed(`Transfer of ${slug} cancelled`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}
