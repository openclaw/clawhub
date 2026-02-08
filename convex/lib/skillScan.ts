import { ConvexError } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'

const SCANNER_URL = 'https://api.clawscanner.xyz'

export type ScanVerdict = 'clean' | 'flagged' | 'blocked'

export type ScanFinding = {
  rule_id: string
  engine: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  message: string
  file_path?: string
  line_number?: number
  evidence?: string
  metadata?: Record<string, unknown>
}

export type ScanResult = {
  verdict: ScanVerdict
  findings: ScanFinding[]
  scanned_at: string
  duration_ms: number
  files_scanned: number
  scanner_version: string
  summary: {
    critical: number
    high: number
    total: number
  }
}

export type SkillFileForScan = {
  path: string
  storageId: Id<'_storage'>
  sha256: string
  size: number
}

export async function scanSkillFiles(
  ctx: ActionCtx,
  files: SkillFileForScan[],
): Promise<ScanResult> {
  try {
    const formData = new FormData()
    let filesAdded = 0

    for (const file of files) {
      const blob = await ctx.storage.get(file.storageId)
      if (!blob) {
        console.warn(`File not found in storage: ${file.path}`)
        continue
      }

      formData.append('files', blob, file.path)
      filesAdded++
    }

    if (filesAdded === 0) {
      throw new Error('No files available for scanning')
    }

    const response = await fetch(`${SCANNER_URL}/api/scan`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Scanner API error: ${response.status} - ${errorText}`)
      throw new Error(`Scanner request failed: ${response.status}`)
    }

    const result = (await response.json()) as ScanResult
    return result
  } catch (error) {
    console.error('Security scan failed:', error)

    return {
      verdict: 'blocked',
      findings: [
        {
          rule_id: 'scanner/unavailable',
          engine: 'system',
          severity: 'critical',
          message: 'Security scanner unavailable - upload blocked for safety',
        },
      ],
      scanned_at: new Date().toISOString(),
      duration_ms: 0,
      files_scanned: 0,
      scanner_version: 'error',
      summary: { critical: 1, high: 0, total: 1 },
    }
  }
}

export async function checkScannerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${SCANNER_URL}/health`)
    if (!response.ok) return false
    const data = await response.json()
    return data.status === 'ok'
  } catch {
    return false
  }
}

export function handleScanResult(result: ScanResult): string[] {
  if (result.verdict === 'blocked') {
    const criticalFindings = result.findings
      .filter((f) => f.severity === 'critical' || f.severity === 'high')
      .slice(0, 5)
      .map((f) => `• ${f.message}${f.file_path ? ` (${f.file_path})` : ''}`)
      .join('\n')

    throw new ConvexError({
      code: 'SECURITY_BLOCKED',
      message: `Skill blocked due to security findings:\n${criticalFindings}`,
      findingsCount: result.findings.length,
      criticalCount: result.summary.critical,
      highCount: result.summary.high,
    })
  }

  if (result.verdict === 'flagged') {
    return result.findings.map((f) => f.rule_id)
  }

  return []
}
