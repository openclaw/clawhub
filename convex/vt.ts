import { v } from 'convex/values'
import { zipSync } from 'fflate'
import { internal } from './_generated/api'
import { action, internalAction } from './_generated/server'

type VTAIResult = {
  category: string
  verdict: string
  analysis?: string
  source?: string
}

type VTFileResponse = {
  data: {
    attributes: {
      sha256: string
      crowdsourced_ai_results?: VTAIResult[]
      last_analysis_stats?: {
        malicious: number
        suspicious: number
        undetected: number
        harmless: number
      }
    }
  }
}

export const fetchResults = action({
  args: {
    sha256hash: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    if (!args.sha256hash) {
      return { status: 'not_found' }
    }

    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      return { status: 'error', message: 'VT_API_KEY not configured' }
    }

    try {
      const response = await fetch(`https://www.virustotal.com/api/v3/files/${args.sha256hash}`, {
        method: 'GET',
        headers: {
          'x-apikey': apiKey,
        },
      })

      if (response.status === 404) {
        return { status: 'not_found' }
      }

      if (!response.ok) {
        return { status: 'error' }
      }

      const data = (await response.json()) as VTFileResponse
      const aiResult = data.data.attributes.crowdsourced_ai_results?.find(
        (r) => r.category === 'code_insight',
      )

      const stats = data.data.attributes.last_analysis_stats
      let status = 'pending'

      if (stats && stats.malicious > 0) {
        status = 'malicious'
      } else if (stats && stats.suspicious > 0) {
        status = 'suspicious'
      } else if (aiResult?.verdict) {
        status = aiResult.verdict.toLowerCase()
      } else if (stats && stats.undetected > 0) {
        status = 'clean'
      }

      return {
        status,
        url: `https://www.virustotal.com/gui/file/${args.sha256hash}`,
        metadata: {
          aiVerdict: aiResult?.verdict,
          aiAnalysis: aiResult?.analysis,
          aiSource: aiResult?.source,
          stats: stats,
        },
      }
    } catch (error) {
      console.error('Error fetching VT results:', error)
      return { status: 'error' }
    }
  },
})

export const scanWithVirusTotal = internalAction({
  args: {
    versionId: v.id('skillVersions'),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('VT_API_KEY not configured, skipping scan')
      return
    }

    // Get the version details and files
    const version = await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })

    if (!version) {
      console.error(`Version ${args.versionId} not found for scanning`)
      return
    }

    // Fetch skill and owner info for _meta.json
    const skill = await ctx.runQuery(internal.skills.getSkillByIdInternal, {
      skillId: version.skillId,
    })
    const owner = skill
      ? await ctx.runQuery(internal.users.getByIdInternal, {
        userId: skill.ownerUserId,
      })
      : null
    const versions = skill
      ? await ctx.runQuery(internal.skills.listVersionsInternal, {
        skillId: skill._id,
      })
      : []

    // Helper to get commit URL or placeholder
    const getCommit = () => {
      return 'https://github.com/clawdbot/skills'
    }

    // Build the ZIP in memory with deterministic settings
    // Sort files alphabetically by path for consistent order
    const sortedFiles = [...version.files].sort((a, b) => a.path.localeCompare(b.path))

    // Use fixed timestamp (Jan 1, 1980 00:00:00 UTC - valid ZIP date range)
    const fixedDate = new Date('1980-01-01T00:00:00Z')

    type ZipInput = Record<string, Uint8Array | [Uint8Array, { mtime?: Date }]>
    const zipData: ZipInput = {}

    for (const file of sortedFiles) {
      const content = await ctx.storage.get(file.storageId)
      if (content) {
        const buffer = new Uint8Array(await content.arrayBuffer())
        zipData[file.path] = [buffer, { mtime: fixedDate }]
      }
    }

    // Add _meta.json to the ZIP
    if (skill) {
      const metaFile = {
        owner: owner?.handle || owner?.displayName || 'unknown',
        slug: skill.slug,
        displayName: skill.displayName,
        latest: {
          version: version.version,
          publishedAt: version.createdAt,
          commit: getCommit(),
        },
        history: versions
          .filter((v: { version: string }) => v.version !== version.version)
          .map((v: any) => ({
            version: v.version,
            publishedAt: v.createdAt,
            commit: getCommit(),
          }))
          .sort(
            (a: { publishedAt: number }, b: { publishedAt: number }) =>
              b.publishedAt - a.publishedAt,
          ),
      }
      const metaContent = new TextEncoder().encode(JSON.stringify(metaFile, null, 2))
      zipData['_meta.json'] = [metaContent, { mtime: fixedDate }]
    }

    if (Object.keys(zipData).length === 0) {
      console.warn(`No files found for version ${args.versionId}, skipping scan`)
      return
    }

    // Use fixed compression level (same as downloads.ts)
    const zipped = zipSync(zipData, { level: 6 })
    const zipArray = Uint8Array.from(zipped)

    // Calculate SHA-256 of the ZIP (this hash includes _meta.json)
    const hashBuffer = await crypto.subtle.digest('SHA-256', zipArray)
    const sha256hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Update version with hash
    await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
      versionId: args.versionId,
      sha256hash,
    })

    // Check if file already exists in VT and has AI analysis
    try {
      const existingFile = await checkExistingFile(apiKey, sha256hash)

      if (existingFile) {
        const aiResult = existingFile.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (aiResult) {
          // File exists and has AI analysis - use the verdict
          const verdict = aiResult.verdict.toLowerCase()
          const isSafe = verdict === 'benign'
          const status = isSafe ? 'clean' : verdict === 'malicious' ? 'malicious' : 'suspicious'

          console.log(
            `Version ${args.versionId} found in VT with AI analysis. Hash: ${sha256hash}. Verdict: ${verdict}`,
          )

          // ONLY auto-approve if the AI verdict is explicitly 'benign'
          if (isSafe) {
            await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
              sha256hash,
              scanner: 'vt',
              status: 'clean',
              moderationStatus: 'active',
            })
          }
          return
        }

        // File exists but no AI analysis - need to upload for fresh scan
        console.log(
          `Version ${args.versionId} found in VT but no AI analysis. Hash: ${sha256hash}. Uploading...`,
        )
      } else {
        console.log(`Version ${args.versionId} not found in VT. Hash: ${sha256hash}. Uploading...`)
      }
    } catch (error) {
      console.error('Error checking existing file in VT:', error)
      // Continue to upload even if check fails
    }

    // Upload file to VirusTotal (v3 API)
    const formData = new FormData()
    const blob = new Blob([zipArray], { type: 'application/zip' })
    formData.append('file', blob, 'skill.zip')

    try {
      const response = await fetch('https://www.virustotal.com/api/v3/files', {
        method: 'POST',
        headers: {
          'x-apikey': apiKey,
        },
        body: formData,
      })

      if (!response.ok) {
        const error = await response.text()
        console.error('VirusTotal upload error:', error)
        return
      }

      const result = (await response.json()) as { data: { id: string } }
      console.log(
        `Successfully uploaded version ${args.versionId} to VT. Hash: ${sha256hash}. Analysis ID: ${result.data.id}`,
      )
    } catch (error) {
      console.error('Failed to upload to VirusTotal:', error)
    }
  },
})

/**
 * Check if a file already exists in VirusTotal by hash
 */
async function checkExistingFile(
  apiKey: string,
  sha256hash: string,
): Promise<VTFileResponse | null> {
  const response = await fetch(`https://www.virustotal.com/api/v3/files/${sha256hash}`, {
    method: 'GET',
    headers: {
      'x-apikey': apiKey,
    },
  })

  if (response.status === 404) {
    // File not found in VT
    return null
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`VT API error: ${response.status} - ${error}`)
  }

  return (await response.json()) as VTFileResponse
}
