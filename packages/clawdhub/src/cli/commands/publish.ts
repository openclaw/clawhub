import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import semver from 'semver'
import { apiRequestForm } from '../../http.js'
import { ApiRoutes, ApiV1PublishResponseSchema } from '../../schema/index.js'
import { listTextFiles } from '../../skills.js'
import { requireAuthToken } from '../authToken.js'
import { getRegistry } from '../registry.js'
import { sanitizeSlug, titleCase } from '../slug.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError } from '../ui.js'

export async function cmdPublish(
  opts: GlobalOpts,
  folderArg: string,
  options: {
    slug?: string
    name?: string
    version?: string
    changelog?: string
    tags?: string
    forkOf?: string
  },
) {
  const folder = folderArg ? resolve(opts.workdir, folderArg) : null
  if (!folder) fail('Path required')
  const folderStat = await stat(folder).catch(() => null)
  if (!folderStat || !folderStat.isDirectory()) fail('Path must be a folder')

  const token = await requireAuthToken()
  const registry = await getRegistry(opts, { cache: true })

  const slug = options.slug ?? sanitizeSlug(basename(folder))
  const displayName = options.name ?? titleCase(basename(folder))
  const version = options.version
  const changelog = options.changelog ?? ''
  const tagsValue = options.tags ?? 'latest'
  const tags = tagsValue
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)

  const forkOfRaw = options.forkOf?.trim()
  const forkOf = forkOfRaw ? parseForkOf(forkOfRaw) : undefined

  if (!slug) fail('--slug required')
  if (!displayName) fail('--name required')
  if (!version || !semver.valid(version)) fail('--version must be valid semver')

  const spinner = createSpinner(`Preparing ${slug}@${version}`)
  try {
    const filesOnDisk = await listTextFiles(folder)
    if (filesOnDisk.length === 0) fail('No files found')
    if (
      !filesOnDisk.some((file) => {
        const lower = file.relPath.toLowerCase()
        return lower === 'skill.md' || lower === 'skills.md'
      })
    ) {
      fail('SKILL.md required')
    }

    const form = new FormData()
    form.set(
      'payload',
      JSON.stringify({
        slug,
        displayName,
        version,
        changelog,
        tags,
        ...(forkOf ? { forkOf } : {}),
      }),
    )

    let index = 0
    for (const file of filesOnDisk) {
      index += 1
      spinner.text = `Uploading ${file.relPath} (${index}/${filesOnDisk.length})`
      const blob = new Blob([Buffer.from(file.bytes)], { type: file.contentType ?? 'text/plain' })
      form.append('files', blob, file.relPath)
    }

    spinner.text = `Publishing ${slug}@${version}`
    const result = await apiRequestForm(
      registry,
      { method: 'POST', path: ApiRoutes.skills, token, form },
      ApiV1PublishResponseSchema,
    )

    spinner.succeed(`OK. Published ${slug}@${version} (${result.versionId})`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

function parseForkOf(value: string) {
  const trimmed = value.trim()
  const [slugRaw, versionRaw] = trimmed.split('@')
  const slug = (slugRaw ?? '').trim().toLowerCase()
  if (!slug) fail('--fork-of must be <slug> or <slug@version>')
  const version = (versionRaw ?? '').trim()
  if (version && !semver.valid(version)) fail('--fork-of version must be valid semver')
  return { slug, version: version || undefined }
}
