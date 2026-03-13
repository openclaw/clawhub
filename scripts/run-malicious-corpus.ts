import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  DEFAULT_MALICIOUS_ADMIN_PREFIX,
  DEFAULT_MALICIOUS_USER_PREFIX,
  resolveMaliciousCorpusCases,
  type MaliciousCorpusCase,
} from '../convex/lib/moderationTestingMaliciousCorpus'

type CliOptions = {
  caseIds?: string[]
  includeAdminVariants: boolean
  skipScans: boolean
  timeoutMs: number
  pollIntervalMs: number
  userPrefix: string
  adminPrefix: string
  outputPath: string
}

type ProdSkillResponse = {
  skill?: {
    displayName?: string
  } | null
  latestVersion?: {
    _id: string
    version: string
    changelog?: string | null
    files: Array<{
      path: string
      contentType?: string | null
    }>
  } | null
}

type FileTextResponse = {
  path: string
  text: string
}

type ReportItem = {
  caseId: string
  sourceSlug: string
  targetSlug: string
  ownerRole: 'admin' | 'moderator' | 'user'
  moderationVerdict: 'clean' | 'suspicious' | 'malicious' | null
  moderationSignals: Record<string, unknown> | null
  staticScan: Record<string, unknown> | null
  vtAnalysis: Record<string, unknown> | null
  llmAnalysis: Record<string, unknown> | null
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    includeAdminVariants: true,
    skipScans: false,
    timeoutMs: 10 * 60 * 1000,
    pollIntervalMs: 10_000,
    userPrefix: DEFAULT_MALICIOUS_USER_PREFIX,
    adminPrefix: DEFAULT_MALICIOUS_ADMIN_PREFIX,
    outputPath: '/tmp/clawhub-malicious-corpus-report.json',
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--case' || arg === '--cases') {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      options.caseIds = value.split(',').map((entry) => entry.trim()).filter(Boolean)
      continue
    }
    if (arg === '--no-admin') {
      options.includeAdminVariants = false
      continue
    }
    if (arg === '--skip-scans') {
      options.skipScans = true
      continue
    }
    if (arg === '--timeout-ms') {
      const value = Number(argv[++i])
      if (!Number.isFinite(value) || value <= 0) throw new Error('--timeout-ms must be > 0')
      options.timeoutMs = value
      continue
    }
    if (arg === '--poll-interval-ms') {
      const value = Number(argv[++i])
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--poll-interval-ms must be > 0')
      }
      options.pollIntervalMs = value
      continue
    }
    if (arg === '--user-prefix') {
      const value = argv[++i]?.trim().toLowerCase()
      if (!value) throw new Error('--user-prefix requires a value')
      options.userPrefix = value
      continue
    }
    if (arg === '--admin-prefix') {
      const value = argv[++i]?.trim().toLowerCase()
      if (!value) throw new Error('--admin-prefix requires a value')
      options.adminPrefix = value
      continue
    }
    if (arg === '--output') {
      const value = argv[++i]?.trim()
      if (!value) throw new Error('--output requires a value')
      options.outputPath = value
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function runConvexJson<T>(args: string[]): T {
  const result = spawnSync('bun', ['x', 'convex', 'run', ...args], {
    encoding: 'utf8',
    cwd: process.cwd(),
  })
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
  }
  return JSON.parse(result.stdout) as T
}

function fetchProdSkillBundle(entry: MaliciousCorpusCase) {
  const prodSkill = runConvexJson<ProdSkillResponse>([
    'skills:getBySlug',
    '--prod',
    JSON.stringify({ slug: entry.sourceSlug }),
  ])
  if (!prodSkill.latestVersion) {
    throw new Error(`Missing latestVersion for prod skill ${entry.sourceSlug}`)
  }

  const files = prodSkill.latestVersion.files.map((file) => {
    const fileText = runConvexJson<FileTextResponse>([
      'skills:getFileText',
      '--prod',
      JSON.stringify({
        versionId: prodSkill.latestVersion?._id,
        path: file.path,
      }),
    ])
    return {
      path: file.path,
      contentType: file.contentType ?? 'text/plain; charset=utf-8',
      base64: Buffer.from(fileText.text, 'utf8').toString('base64'),
    }
  })

  return {
    caseId: entry.caseId,
    sourceSlug: entry.sourceSlug,
    sourceVersion: prodSkill.latestVersion.version,
    sourceDisplayName: prodSkill.skill?.displayName?.trim() || entry.sourceSlug,
    sourceChangelog:
      prodSkill.latestVersion.changelog?.trim() || 'Imported from production bundle for moderation testing',
    files,
  }
}

function fetchMaliciousReport(options: CliOptions) {
  return runConvexJson<ReportItem[]>([
    'moderationTesting:getMaliciousCorpusReportInternal',
    JSON.stringify({
      caseIds: options.caseIds,
      includeAdminVariants: options.includeAdminVariants,
      userPrefix: options.userPrefix,
      adminPrefix: options.adminPrefix,
    }),
  ])
}

function pollVirusTotalQueue(batchSize: number) {
  return runConvexJson<{ processed: number; updated: number }>([
    'vt:pollPendingScans',
    JSON.stringify({ batchSize }),
  ])
}

function scansComplete(report: ReportItem[]) {
  return report.every((entry) => Boolean(entry.staticScan && entry.vtAnalysis && entry.llmAnalysis))
}

function assertMaliciousVerdicts(report: ReportItem[], cases: MaliciousCorpusCase[]) {
  const gatedCaseIds = new Set(
    cases.filter((entry) => entry.assertLiveMalicious).map((entry) => entry.caseId),
  )
  const failures = report.filter(
    (entry) =>
      gatedCaseIds.has(entry.caseId) && entry.moderationVerdict !== 'malicious',
  )
  if (failures.length === 0) return

  const lines = failures.map(
    (entry) =>
      `${entry.targetSlug} owner=${entry.ownerRole} verdict=${entry.moderationVerdict ?? 'null'}`,
  )
  throw new Error(`Malicious corpus regressions detected:\n${lines.join('\n')}`)
}

function summarize(report: ReportItem[]) {
  return report.map((entry) => ({
    caseId: entry.caseId,
    sourceSlug: entry.sourceSlug,
    targetSlug: entry.targetSlug,
    ownerRole: entry.ownerRole,
    moderationVerdict: entry.moderationVerdict,
    signalFamilies: entry.moderationSignals ? Object.keys(entry.moderationSignals) : [],
  }))
}

async function sleep(ms: number) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const cases = resolveMaliciousCorpusCases(options.caseIds)
  if (cases.length === 0) {
    throw new Error('No malicious corpus cases selected')
  }

  const entries = cases.map(fetchProdSkillBundle)
  const importResult = runConvexJson<{
    imported: number
    existing: number
    errors: number
  }>([
    'moderationTestingNode:importMaliciousCorpusFromBundles',
    JSON.stringify({
      entries,
      includeAdminVariants: options.includeAdminVariants,
      userPrefix: options.userPrefix,
      adminPrefix: options.adminPrefix,
    }),
  ])
  if (importResult.errors > 0) {
    throw new Error(`Import failed for ${importResult.errors} malicious corpus entries`)
  }

  if (!options.skipScans) {
    const scanResult = runConvexJson<{ errors: number }>([
      'moderationTestingNode:triggerMaliciousCorpusScans',
      JSON.stringify({
        caseIds: cases.map((entry) => entry.caseId),
        includeAdminVariants: options.includeAdminVariants,
        userPrefix: options.userPrefix,
        adminPrefix: options.adminPrefix,
      }),
    ])
    if (scanResult.errors > 0) {
      throw new Error(`Failed to trigger scans for ${scanResult.errors} malicious variants`)
    }

    const deadline = Date.now() + options.timeoutMs
    let report = fetchMaliciousReport(options)
    while (!scansComplete(report) && Date.now() < deadline) {
      pollVirusTotalQueue(Math.max(report.length, 10))
      await sleep(options.pollIntervalMs)
      report = fetchMaliciousReport(options)
    }
    if (!scansComplete(report)) {
      throw new Error(`Timed out waiting for malicious corpus scans after ${options.timeoutMs}ms`)
    }
    assertMaliciousVerdicts(report, cases)

    const output = {
      importedCases: cases.length,
      includeAdminVariants: options.includeAdminVariants,
      importResult,
      liveProviderGatedCaseIds: cases
        .filter((entry) => entry.assertLiveMalicious)
        .map((entry) => entry.caseId),
      summary: summarize(report),
      report,
    }
    mkdirSync(dirname(resolve(options.outputPath)), { recursive: true })
    writeFileSync(resolve(options.outputPath), `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(output, null, 2))
    return
  }

  const report = fetchMaliciousReport(options)
  const output = {
    importedCases: cases.length,
    includeAdminVariants: options.includeAdminVariants,
    importResult,
    liveProviderGatedCaseIds: cases
      .filter((entry) => entry.assertLiveMalicious)
      .map((entry) => entry.caseId),
    summary: summarize(report),
    report,
  }
  mkdirSync(dirname(resolve(options.outputPath)), { recursive: true })
  writeFileSync(resolve(options.outputPath), `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(output, null, 2))
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
