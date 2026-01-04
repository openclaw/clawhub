import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  ApiCliPublishResponseSchema,
  ApiCliUploadUrlResponseSchema,
  ApiRoutes,
  ApiSkillMetaResponseSchema,
  ApiUploadFileResponseSchema,
  CliPublishRequestSchema,
  parseArk,
} from 'clawdhub-schema'
import semver from 'semver'
import { readGlobalConfig } from '../../config.js'
import { apiRequest } from '../../http.js'
import { listTextFiles, sha256Hex } from '../../skills.js'
import { getRegistry } from '../registry.js'
import { sanitizeSlug, titleCase } from '../slug.js'
import type { GlobalOpts } from '../types.js'
import { createSpinner, fail, formatError } from '../ui.js'

export async function cmdPublish(
  opts: GlobalOpts,
  folderArg: string,
  options: { slug?: string; name?: string; version?: string; changelog?: string; tags?: string },
) {
  const folder = folderArg ? resolve(opts.workdir, folderArg) : null
  if (!folder) fail('Path required')
  const folderStat = await stat(folder).catch(() => null)
  if (!folderStat || !folderStat.isDirectory()) fail('Path must be a folder')

  const cfg = await readGlobalConfig()
  const token = cfg?.token
  if (!token) fail('Not logged in. Run: clawdhub login')
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

  if (!slug) fail('--slug required')
  if (!displayName) fail('--name required')
  if (!version || !semver.valid(version)) fail('--version must be valid semver')

  const spinner = createSpinner(`Preparing ${slug}@${version}`)
  try {
    const meta = await apiRequest(
      registry,
      { method: 'GET', path: `/api/skill?slug=${encodeURIComponent(slug)}` },
      ApiSkillMetaResponseSchema,
    ).catch(() => null)
    const exists = Boolean(meta?.skill)
    if (exists && !changelog.trim()) fail('--changelog required for updates')

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

    const uploaded: Array<{
      path: string
      size: number
      storageId: string
      sha256: string
      contentType?: string
    }> = []

    let index = 0
    for (const file of filesOnDisk) {
      index += 1
      spinner.text = `Uploading ${file.relPath} (${index}/${filesOnDisk.length})`
      const { uploadUrl } = await apiRequest(
        registry,
        { method: 'POST', path: ApiRoutes.cliUploadUrl, token },
        ApiCliUploadUrlResponseSchema,
      )

      const storageId = await uploadFile(uploadUrl, file.bytes, file.contentType ?? 'text/plain')
      const sha256 = sha256Hex(file.bytes)
      uploaded.push({
        path: file.relPath,
        size: file.bytes.byteLength,
        storageId,
        sha256,
        contentType: file.contentType ?? undefined,
      })
    }

    spinner.text = `Publishing ${slug}@${version}`
    const body = parseArk(
      CliPublishRequestSchema,
      { slug, displayName, version, changelog, tags, files: uploaded },
      'Publish payload',
    )
    const result = await apiRequest(
      registry,
      { method: 'POST', path: ApiRoutes.cliPublish, token, body },
      ApiCliPublishResponseSchema,
    )

    spinner.succeed(`OK. Published ${slug}@${version} (${result.versionId})`)
  } catch (error) {
    spinner.fail(formatError(error))
    throw error
  }
}

async function uploadFile(uploadUrl: string, bytes: Uint8Array, contentType: string) {
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: Buffer.from(bytes),
  })
  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`)
  }
  const payload = parseArk(
    ApiUploadFileResponseSchema,
    (await response.json()) as unknown,
    'Upload response',
  )
  return payload.storageId
}
