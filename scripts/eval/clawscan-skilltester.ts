import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractResponseText } from "../../convex/lib/openaiResponse.ts";
import {
  AGENTIC_RISK_CATEGORIES,
  assembleEvalUserMessage,
  assembleSkillEvalUserMessage,
  detectInjectionPatterns,
  getLlmEvalModel,
  getLlmEvalReasoningEffort,
  getLlmEvalServiceTier,
  LEGACY_SECURITY_EVALUATOR_SYSTEM_PROMPT,
  LLM_EVAL_MAX_OUTPUT_TOKENS,
  parseLlmEvalResponse,
  SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT,
  type ClawScanRiskBucket,
  type LlmEvalReasoningEffort,
  type LlmEvalResponse,
  type LlmEvalServiceTier,
  type SkillEvalContext,
} from "../../convex/lib/securityPrompt.ts";
import {
  getFrontmatterMetadata,
  getFrontmatterValue,
  parseClawdisMetadata,
  parseFrontmatter,
} from "../../convex/lib/skills.ts";

const HF_DATASET_ENV_VAR = "CLAWHUB_SECURITY_EVAL_HF_DATASET";
const DEFAULT_HF_CONFIG = "default";
const DEFAULT_HF_SPLIT = "eval_holdout";
const DEFAULT_OUTPUT_DIR = "eval/results/clawscan-skilltester";
const DEFAULT_CACHE_DIR = "eval/cache/clawscan-skilltester";
const DEFAULT_CONCURRENCY = 1;
const REPORT_SCHEMA_VERSION = "1.2";

type PromptKind = "old" | "new";
type NormalizedVerdict = LlmEvalResponse["verdict"] | "unknown";
type ReferenceBasis = "level" | "score" | "unknown";
type CacheStatus = "hit" | "miss" | "mock" | "disabled";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export type CorpusRow = {
  schema_version?: string;
  corpus?: "skilltester-clawhub";
  source: string;
  content_status: "fetched" | "missing" | string;
  resolved: {
    owner?: string;
    slug?: string;
    version?: string;
    canonical_url?: string;
  };
  artifact: {
    path?: string;
    skill_md_bytes?: number;
    skill_md_content?: string;
    missing_reason?: string;
  };
  skilltester: {
    summary: {
      skill_name?: string;
      full_name?: string;
      slug?: string;
      description?: string;
      security_level?: string | null;
    };
    detail_skill?: Record<string, unknown>;
    scores: {
      security?: number | null;
      security_level?: string | null;
    };
    security: {
      level?: string | null;
      score?: number | null;
    };
    source_urls: {
      skill_url?: string;
      result_url?: string;
      detail_api_url?: string;
    };
    timestamps: {
      summary_updated_at?: string;
      evaluation_timestamp?: string;
    };
  };
  reference_labels: {
    security_level?: string | null;
    security_score?: number | null;
  };
};

type HfDatasetRowsResponse = {
  rows?: Array<{ row?: unknown }>;
  num_rows_total?: number;
  error?: string;
};

type HfEvalHoldoutRow = {
  uuid?: string;
  skill?: string;
  label?: string;
  score_static?: number | null;
  score_vt?: number | null;
  score_llm?: number | null;
  score_consensus?: number | null;
  score_max?: number | null;
  data?: {
    labels?: Array<{
      label?: string;
      label_source?: string;
      label_confidence?: string | null;
      reason_codes?: string[];
      notes_redacted?: string | null;
    }>;
    scan_results?: Array<{
      scanner?: string;
      raw_status_family?: string;
      status?: string;
      verdict?: string | null;
      confidence?: string | null;
      summary_redacted?: string | null;
      reason_codes?: string[];
    }>;
    static_findings?: unknown[];
  };
  metadata?: {
    source?: {
      artifact_id?: string;
      source_kind?: string;
      source_table?: string;
      public_name?: string;
      public_slug?: string | null;
      version?: string;
      created_at?: string | number | null;
      created_at_ms?: number | null;
    };
    split?: { name?: string | null };
    label?: {
      source?: string | null;
      confidence?: string | null;
      scanner_agreement?: number | null;
    };
    content?: { present?: boolean; chars?: number };
  };
};

type RuntimeClaimMatch = {
  pattern: string;
  match: string;
};

type EvidenceQuality = {
  totalAgenticFindings: number;
  noteOrConcernFindings: number;
  evidenceBackedFindings: number;
  missingEvidenceFindings: number;
};

type PromptRunSummary = {
  prompt: PromptKind;
  parseOk: boolean;
  cache: CacheStatus;
  verdict?: LlmEvalResponse["verdict"];
  confidence?: LlmEvalResponse["confidence"];
  summary?: string;
  parseError?: string;
  unsupportedRuntimeClaims: RuntimeClaimMatch[];
  evidenceQuality: EvidenceQuality;
  asiFindings: Array<{
    categoryId: string;
    categoryLabel?: string;
    status: string;
    severity: string;
    confidence?: string;
    riskBucket?: ClawScanRiskBucket;
    evidencePath?: string;
    evidenceSnippet?: string;
    evidenceExplanation?: string;
    userImpact?: string;
    recommendation?: string;
  }>;
};

type RowComparison = {
  id: string;
  slug: string;
  source: string;
  reference: {
    verdict: NormalizedVerdict;
    basis: ReferenceBasis;
    securityLevel?: string;
    securityScore?: number;
  };
  old: PromptRunSummary;
  new: PromptRunSummary;
  promptDisagreement: boolean;
};

type SkippedRow = {
  id: string;
  slug: string;
  reason: string;
};

type PromptMetrics = {
  parsed: number;
  parseFailures: number;
  unsupportedRuntimeClaimRows: number;
  matchesReference: number;
  referenceAccuracy: number | null;
  riskyReferenceDetected: number;
  riskyReferenceRecall: number | null;
  falsePositivesOnBenign: number;
  verdicts: Record<LlmEvalResponse["verdict"], number>;
  evidenceQuality: EvidenceQuality;
};

type FalsePositiveThemeRow = {
  id: string;
  slug: string;
  verdict?: LlmEvalResponse["verdict"];
  summary?: string;
  categories: string[];
  snippets: string[];
};

type FalsePositiveTheme = {
  id: string;
  label: string;
  description: string;
  count: number;
  suggestedFewShotLesson: string;
  rows: FalsePositiveThemeRow[];
};

type FewShotCandidate = {
  rowId: string;
  slug: string;
  themeIds: string[];
  currentVerdict?: LlmEvalResponse["verdict"];
  referenceVerdict: NormalizedVerdict;
  summary?: string;
  lesson: string;
  categories: string[];
  snippets: string[];
};

type FalsePositiveAnalysisForPrompt = {
  themes: FalsePositiveTheme[];
  suggestedFewShotCandidates: FewShotCandidate[];
};

type FalsePositiveAnalysis = {
  old: FalsePositiveAnalysisForPrompt;
  new: FalsePositiveAnalysisForPrompt;
};

export type EvalReport = {
  schemaVersion: string;
  generatedAt: string;
  corpusFile: string;
  corpusSchemaVersion?: string;
  model: string;
  reasoningEffort: LlmEvalReasoningEffort;
  serviceTier: LlmEvalServiceTier;
  concurrency: number;
  counts: {
    corpusRows: number;
    evaluatedRows: number;
    skippedRows: number;
    referenceKnownRows: number;
    promptDisagreements: number;
  };
  prompts: {
    old: {
      label: "legacy";
      systemPrompt: "LEGACY_SECURITY_EVALUATOR_SYSTEM_PROMPT";
      systemPromptSha256: string;
      metrics: PromptMetrics;
    };
    new: {
      label: "owasp_asi";
      systemPrompt: "SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT";
      systemPromptSha256: string;
      metrics: PromptMetrics;
    };
  };
  falsePositiveExamples: {
    old: RowComparison[];
    new: RowComparison[];
  };
  falsePositiveAnalysis: FalsePositiveAnalysis;
  disagreements: RowComparison[];
  unsupportedRuntimeClaimRows: RowComparison[];
  rows: RowComparison[];
  skipped: SkippedRow[];
};

export type PromptRunRequest = {
  kind: PromptKind;
  row: CorpusRow;
  context: SkillEvalContext;
  model: string;
  reasoningEffort: LlmEvalReasoningEffort;
  serviceTier: LlmEvalServiceTier;
  instructions: string;
  input: string;
  cacheDir: string;
  useCache: boolean;
};

export type PromptRunResult = {
  raw: string;
  cache: CacheStatus;
};

type PromptRunner = (request: PromptRunRequest) => Promise<PromptRunResult>;

export type RunComparisonOptions = {
  corpusFile: string | null;
  hfDataset: string | null;
  hfConfig: string;
  outputDir: string;
  cacheDir: string;
  model: string;
  reasoningEffort: LlmEvalReasoningEffort;
  serviceTier?: LlmEvalServiceTier;
  concurrency?: number;
  limit?: number;
  targets?: string[];
  skilltesterRiskyOnly?: boolean;
  useCache: boolean;
  mock: boolean;
  writeReports: boolean;
  rows?: CorpusRow[];
};

type CliOptions = RunComparisonOptions;
const CLI_REASONING_EFFORTS = new Set<LlmEvalReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
const CLI_SERVICE_TIERS = new Set<LlmEvalServiceTier>(["auto", "default", "flex", "priority"]);

export function getNewPromptInstructions() {
  return SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT;
}

function getNewPromptSystemPromptName(): EvalReport["prompts"]["new"]["systemPrompt"] {
  return "SKILL_SECURITY_EVALUATOR_SYSTEM_PROMPT";
}

function parseReasoningEffort(value: string): LlmEvalReasoningEffort {
  if (CLI_REASONING_EFFORTS.has(value as LlmEvalReasoningEffort)) {
    return value as LlmEvalReasoningEffort;
  }
  throw new Error(
    `--reasoning-effort must be one of ${Array.from(CLI_REASONING_EFFORTS).join(", ")}`,
  );
}

function parseServiceTier(value: string): LlmEvalServiceTier {
  if (CLI_SERVICE_TIERS.has(value as LlmEvalServiceTier)) {
    return value as LlmEvalServiceTier;
  }
  throw new Error(`--service-tier must be one of ${Array.from(CLI_SERVICE_TIERS).join(", ")}`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const str = asString(value);
    if (str) return str;
  }
  return undefined;
}

function normalizeTarget(value: string) {
  return value.trim().toLowerCase();
}

function rowTargetKeys(row: CorpusRow) {
  const keys = new Set<string>();
  const owner = row.resolved.owner;
  const slug = row.resolved.slug;
  const version = row.resolved.version;
  const summary = row.skilltester.summary;
  const urls = row.skilltester.source_urls;

  if (owner && slug && version) keys.add(`${owner}/${slug}@${version}`);
  if (owner && slug) keys.add(`${owner}/${slug}`);
  if (slug && version) keys.add(`${slug}@${version}`);
  if (slug) keys.add(slug);
  if (summary.skill_name) keys.add(summary.skill_name);
  if (summary.full_name) keys.add(summary.full_name);
  if (row.resolved.canonical_url) keys.add(row.resolved.canonical_url);
  if (urls.skill_url) keys.add(urls.skill_url);
  if (urls.detail_api_url) keys.add(urls.detail_api_url);

  return new Set(Array.from(keys).map(normalizeTarget));
}

export function selectCorpusRowsByTargets(rows: CorpusRow[], targets: string[]) {
  if (targets.length === 0) return rows;

  const normalizedTargets = targets.map(normalizeTarget).filter(Boolean);
  const matchedTargets = new Set<string>();
  const selected = rows.filter((row) => {
    const keys = rowTargetKeys(row);
    const matched = normalizedTargets.filter((target) => keys.has(target));
    for (const target of matched) matchedTargets.add(target);
    return matched.length > 0;
  });

  const missing = normalizedTargets.filter((target) => !matchedTargets.has(target));
  if (missing.length > 0) {
    throw new Error(`No corpus row matched target(s): ${missing.join(", ")}`);
  }

  return selected;
}

export function selectCorpusRowsBySkillTesterRisk(rows: CorpusRow[], enabled: boolean) {
  if (!enabled) return rows;
  return rows.filter((row) => {
    const reference = normalizeReferenceVerdict(row);
    return reference.verdict !== "unknown" && reference.verdict !== "benign";
  });
}

function timestampFromRow(row: CorpusRow) {
  const raw = firstString(
    row.skilltester.timestamps.evaluation_timestamp,
    row.skilltester.timestamps.summary_updated_at,
  );
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function riskBucketForCategory(categoryId: string): ClawScanRiskBucket {
  if (categoryId === "ASI03") return "permission_boundary";
  if (categoryId === "ASI06" || categoryId === "ASI07") return "sensitive_data_protection";
  return "abnormal_behavior_control";
}

function scoreFromRow(row: CorpusRow) {
  return (
    asNumber(row.reference_labels.security_score) ??
    asNumber(row.skilltester.security.score) ??
    asNumber(row.skilltester.scores.security)
  );
}

export function normalizeReferenceVerdict(row: CorpusRow): {
  verdict: NormalizedVerdict;
  basis: ReferenceBasis;
  securityLevel?: string;
  securityScore?: number;
} {
  const securityLevel = firstString(
    row.reference_labels.security_level,
    row.skilltester.security.level,
    row.skilltester.scores.security_level,
    row.skilltester.summary.security_level,
  );
  const securityScore = scoreFromRow(row);

  if (securityLevel) {
    const label = securityLevel.toLowerCase().trim();
    if (
      /\b(malicious|dangerous|critical|severe|failed|fail)\b/.test(label) ||
      /\b(high|critical)\s+(risk|severity)\b/.test(label)
    ) {
      return { verdict: "malicious", basis: "level", securityLevel, securityScore };
    }
    if (/\b(suspicious|warning|caution|cautious|risky|moderate|review)\b/.test(label)) {
      return { verdict: "suspicious", basis: "level", securityLevel, securityScore };
    }
    if (/\b(benign|safe|clean|secure|passed|pass|excellent|good)\b/.test(label)) {
      return { verdict: "benign", basis: "level", securityLevel, securityScore };
    }
    if (/^high(?:\s+security)?$/.test(label)) {
      return { verdict: "benign", basis: "level", securityLevel, securityScore };
    }
    if (/^medium(?:\s+security)?$/.test(label)) {
      return { verdict: "suspicious", basis: "level", securityLevel, securityScore };
    }
    if (/^low(?:\s+security)?$/.test(label)) {
      return { verdict: "malicious", basis: "level", securityLevel, securityScore };
    }
  }

  if (typeof securityScore === "number") {
    if (securityScore >= 80) {
      return { verdict: "benign", basis: "score", securityLevel, securityScore };
    }
    if (securityScore >= 50) {
      return { verdict: "suspicious", basis: "score", securityLevel, securityScore };
    }
    return { verdict: "malicious", basis: "score", securityLevel, securityScore };
  }

  return { verdict: "unknown", basis: "unknown", securityLevel, securityScore };
}

export async function readCorpusJsonl(corpusFile: string): Promise<CorpusRow[]> {
  const text = await readFile(corpusFile, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as CorpusRow;
      } catch (error) {
        throw new Error(
          `Failed to parse ${corpusFile}:${index + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    });
}

function normalizedHfLabel(row: HfEvalHoldoutRow): NormalizedVerdict {
  const label = firstString(row.label, row.metadata?.label?.source)?.toLowerCase();
  if (label === "clean" || label === "benign") return "benign";
  if (label === "suspicious") return "suspicious";
  if (label === "malicious") return "malicious";
  return "unknown";
}

function securityLevelForHfLabel(label: NormalizedVerdict) {
  switch (label) {
    case "benign":
      return "high security";
    case "suspicious":
      return "moderate security";
    case "malicious":
      return "low security";
    case "unknown":
      return undefined;
  }
}

function securityScoreForHfRow(row: HfEvalHoldoutRow, label: NormalizedVerdict) {
  const score =
    asNumber(row.score_consensus) ??
    asNumber(row.score_max) ??
    asNumber(row.score_llm) ??
    asNumber(row.score_static) ??
    asNumber(row.score_vt);
  if (score !== undefined) return score;
  switch (label) {
    case "benign":
      return 100;
    case "suspicious":
      return 65;
    case "malicious":
      return 25;
    case "unknown":
      return undefined;
  }
}

export function corpusRowFromHfEvalHoldoutRow(row: HfEvalHoldoutRow, index = 0): CorpusRow {
  const source = row.metadata?.source ?? {};
  const label = normalizedHfLabel(row);
  const securityLevel = securityLevelForHfLabel(label);
  const securityScore = securityScoreForHfRow(row, label);
  const slug = firstString(source.public_slug, row.uuid, `hf-row-${index}`) ?? `hf-row-${index}`;
  const version = firstString(source.version) ?? "unknown";
  const skill = firstString(row.skill);
  const createdAtMs = asNumber(source.created_at_ms);
  const createdAt =
    firstString(source.created_at) ??
    (createdAtMs === undefined ? undefined : new Date(createdAtMs).toISOString());

  return {
    schema_version: "hf-clawhub-security-signals-eval-holdout-v1",
    corpus: "skilltester-clawhub",
    source: "HuggingFace",
    content_status: skill ? "fetched" : "missing",
    resolved: {
      owner: firstString(source.source_table) ?? "huggingface",
      slug,
      version,
      canonical_url: slug ? `https://clawhub.ai/${slug}` : undefined,
    },
    artifact: {
      path: "SKILL.md",
      skill_md_bytes: skill ? Buffer.byteLength(skill, "utf8") : undefined,
      skill_md_content: skill,
      missing_reason: skill ? undefined : "No skill text present in HF eval_holdout row.",
    },
    skilltester: {
      summary: {
        skill_name: slug,
        full_name: firstString(source.public_name, slug),
        description: undefined,
        security_level: securityLevel,
      },
      detail_skill: {},
      scores: {
        security: securityScore,
        security_level: securityLevel,
      },
      security: {
        level: securityLevel,
        score: securityScore,
      },
      source_urls: {
        detail_api_url: `hf://${DEFAULT_HF_SPLIT}/${index}`,
        skill_url: slug ? `https://clawhub.ai/${slug}` : undefined,
      },
      timestamps: {
        evaluation_timestamp: createdAt,
      },
    },
    reference_labels: {
      security_level: securityLevel,
      security_score: securityScore,
    },
  };
}

function hfAuthToken() {
  return (
    process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN ?? process.env.HUGGING_FACE_HUB_TOKEN
  );
}

async function fetchHfEvalHoldoutRows(options: {
  dataset: string;
  config: string;
  limit?: number;
  fetchAll: boolean;
}): Promise<CorpusRow[]> {
  const token = hfAuthToken();
  if (!token) {
    throw new Error(
      `HF_TOKEN, HUGGINGFACE_TOKEN, or HUGGING_FACE_HUB_TOKEN is required to load private dataset ${options.dataset} split ${DEFAULT_HF_SPLIT}. Pass --corpus <path> to use a local corpus instead.`,
    );
  }

  const rows: CorpusRow[] = [];
  let offset = 0;
  const pageSize = 100;
  let total: number | undefined;

  while (total === undefined || offset < total) {
    const length = options.fetchAll
      ? pageSize
      : Math.min(pageSize, Math.max(1, (options.limit ?? pageSize) - rows.length));
    const url = new URL("https://datasets-server.huggingface.co/rows");
    url.searchParams.set("dataset", options.dataset);
    url.searchParams.set("config", options.config);
    url.searchParams.set("split", DEFAULT_HF_SPLIT);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("length", String(length));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const body = (await response.json().catch(() => ({}))) as HfDatasetRowsResponse;
    if (!response.ok) {
      throw new Error(
        `Failed to load HF dataset ${options.dataset}/${DEFAULT_HF_SPLIT}: ${
          body.error ?? response.statusText
        }`,
      );
    }

    const pageRows = body.rows ?? [];
    total = body.num_rows_total ?? offset + pageRows.length;
    rows.push(
      ...pageRows.map((entry, index) =>
        corpusRowFromHfEvalHoldoutRow(entry.row as HfEvalHoldoutRow, offset + index),
      ),
    );
    offset += pageRows.length;

    if (
      pageRows.length === 0 ||
      (!options.fetchAll && options.limit && rows.length >= options.limit)
    ) {
      break;
    }
  }

  return options.limit && !options.fetchAll ? rows.slice(0, options.limit) : rows;
}

async function loadRows(
  options: RunComparisonOptions,
): Promise<{ rows: CorpusRow[]; source: string }> {
  if (options.rows) return { rows: options.rows, source: options.corpusFile ?? "inline rows" };
  if (options.corpusFile) {
    return { rows: await readCorpusJsonl(options.corpusFile), source: options.corpusFile };
  }
  if (!options.hfDataset) {
    throw new Error(`Set ${HF_DATASET_ENV_VAR}, pass --hf-dataset <id>, or pass --corpus <path>.`);
  }
  const fetchAll = Boolean(options.targets?.length) || options.limit === undefined;
  const rows = await fetchHfEvalHoldoutRows({
    dataset: options.hfDataset,
    config: options.hfConfig,
    limit: options.limit,
    fetchAll,
  });
  return {
    rows,
    source: `hf://${options.hfDataset}/${options.hfConfig}/${DEFAULT_HF_SPLIT}`,
  };
}

export function buildSkillEvalContextFromRow(row: CorpusRow): SkillEvalContext | null {
  const skillMdContent = row.artifact.skill_md_content;
  if (row.content_status !== "fetched" || !skillMdContent) return null;

  const frontmatter = parseFrontmatter(skillMdContent);
  const metadata = getFrontmatterMetadata(frontmatter);
  const clawdis = parseClawdisMetadata(frontmatter);
  const clawdisRecord = asRecord(clawdis) ?? {};
  const links = asRecord(clawdisRecord.links) ?? {};
  const summarySkill = asRecord(row.skilltester.summary);
  const detailSkill = asRecord(row.skilltester.detail_skill);
  const slug = row.resolved.slug ?? asString(summarySkill?.slug) ?? "unknown-skill";
  const displayName =
    firstString(
      getFrontmatterValue(frontmatter, "name"),
      row.resolved.slug,
      detailSkill?.display_name,
      detailSkill?.name,
      summarySkill?.full_name,
      summarySkill?.skill_name,
    ) ?? slug;
  const summary =
    getFrontmatterValue(frontmatter, "description") ??
    firstString(summarySkill?.description, detailSkill?.description);

  return {
    slug,
    displayName,
    ownerUserId: row.resolved.owner ?? "skilltester-corpus",
    version: row.resolved.version ?? "unknown",
    createdAt: timestampFromRow(row),
    summary,
    source:
      getFrontmatterValue(frontmatter, "source") ??
      firstString(row.skilltester.source_urls.skill_url, row.skilltester.source_urls.result_url),
    homepage:
      getFrontmatterValue(frontmatter, "homepage") ??
      getFrontmatterValue(frontmatter, "website") ??
      getFrontmatterValue(frontmatter, "url") ??
      firstString(clawdisRecord.homepage, links.homepage, row.skilltester.source_urls.skill_url),
    parsed: {
      frontmatter,
      metadata,
      clawdis,
    },
    files: [
      {
        path: row.artifact.path ?? "SKILL.md",
        size: row.artifact.skill_md_bytes ?? Buffer.byteLength(skillMdContent, "utf8"),
      },
    ],
    skillMdContent,
    fileContents: [],
    injectionSignals: detectInjectionPatterns(skillMdContent),
  };
}

const UNSUPPORTED_RUNTIME_CLAIM_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "claims code was executed", regex: /\b(?:i|we)\s+(?:ran|executed|launched)\b/i },
  { label: "claims a runtime probe", regex: /\b(?:runtime|sandbox)\s+(?:probe|test|execution)\b/i },
  {
    label: "claims observed runtime behavior",
    regex:
      /\bobserved\s+(?:at\s+)?runtime|\bruntime\s+behavior\s+(?:shows|showed|confirmed|found)\b/i,
  },
  {
    label: "claims observed network traffic",
    regex: /\bnetwork\s+traffic\s+(?:shows|showed|was\s+observed|confirmed)\b/i,
  },
  {
    label: "claims observed filesystem changes",
    regex: /\bfile\s+system\s+changes\s+were\s+observed\b/i,
  },
  {
    label: "uses execution caveat",
    regex:
      /\bnot\s+assessable\s+without\s+execution\b|\bcannot\s+be\s+assessed\s+without\s+execution\b/i,
  },
];

export function findUnsupportedRuntimeClaims(text: string): RuntimeClaimMatch[] {
  const claims: RuntimeClaimMatch[] = [];
  for (const pattern of UNSUPPORTED_RUNTIME_CLAIM_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match?.[0]) {
      claims.push({ pattern: pattern.label, match: match[0] });
    }
  }
  return claims;
}

export function assessEvidenceQuality(result: LlmEvalResponse | null): EvidenceQuality {
  const findings = result?.agenticRiskFindings ?? [];
  const noteOrConcernFindings = findings.filter(
    (finding) => finding.status === "note" || finding.status === "concern",
  );
  const evidenceBackedFindings = noteOrConcernFindings.filter(
    (finding) =>
      Boolean(finding.evidence?.path.trim()) &&
      Boolean(finding.evidence?.snippet.trim()) &&
      Boolean(finding.evidence?.explanation.trim()),
  ).length;

  return {
    totalAgenticFindings: findings.length,
    noteOrConcernFindings: noteOrConcernFindings.length,
    evidenceBackedFindings,
    missingEvidenceFindings: noteOrConcernFindings.length - evidenceBackedFindings,
  };
}

function cacheKeyForRequest(request: PromptRunRequest) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: request.kind,
        model: request.model,
        reasoningEffort: request.reasoningEffort,
        serviceTier: request.serviceTier,
        instructionsHash: sha256(request.instructions),
        inputHash: sha256(request.input),
      }),
    )
    .digest("hex");
}

async function defaultPromptRunner(request: PromptRunRequest): Promise<PromptRunResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for live evals. Pass --mock for a local smoke run.",
    );
  }

  const cacheKey = cacheKeyForRequest(request);
  const cacheFile = join(request.cacheDir, `${request.kind}-${cacheKey}.json`);
  if (request.useCache && existsSync(cacheFile)) {
    const cached = JSON.parse(await readFile(cacheFile, "utf8")) as { raw?: unknown };
    if (typeof cached.raw === "string") return { raw: cached.raw, cache: "hit" };
  }

  const body = JSON.stringify({
    model: request.model,
    service_tier: request.serviceTier,
    instructions: request.instructions,
    input: request.input,
    reasoning: {
      effort: request.reasoningEffort,
    },
    max_output_tokens: LLM_EVAL_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    });
    if (response.ok || (response.status !== 429 && response.status < 500)) break;
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 2000));
  }

  if (!response?.ok) {
    const errorText = response ? await response.text() : "No response";
    throw new Error(
      `OpenAI API error (${response?.status ?? "unknown"}): ${errorText.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as unknown;
  const raw = extractResponseText(payload);
  if (!raw) throw new Error("OpenAI response did not include output_text.");

  if (request.useCache) {
    await mkdir(request.cacheDir, { recursive: true });
    await writeFile(
      cacheFile,
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          serviceTier: request.serviceTier,
          raw,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  return { raw, cache: request.useCache ? "miss" : "disabled" };
}

function firstEvidenceSnippet(skillMdContent: string) {
  return skillMdContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 160);
}

function mockPromptRunner(request: PromptRunRequest): Promise<PromptRunResult> {
  const reference = normalizeReferenceVerdict(request.row);
  const verdict = reference.verdict === "unknown" ? "benign" : reference.verdict;
  const summary = `Mock ${request.kind} prompt result for ${request.context.slug}.`;
  const base = {
    verdict,
    confidence: "low",
    summary,
    dimensions: {
      purpose_capability: { status: "ok", detail: "Mock artifact-only comparison output." },
    },
    user_guidance: "Mock output only; run without --mock for real model comparison.",
  };

  if (request.kind === "old") {
    return Promise.resolve({ raw: JSON.stringify(base), cache: "mock" });
  }

  const risky = verdict !== "benign";
  const evidence = {
    path: request.context.files[0]?.path ?? "SKILL.md",
    snippet: firstEvidenceSnippet(request.context.skillMdContent) ?? request.context.slug,
    explanation: "Mock evidence used to exercise the harness evidence checks.",
  };
  const agenticRiskFindings = AGENTIC_RISK_CATEGORIES.map((category) => {
    const isMockFinding = risky && category.id === "ASI05";
    return {
      category_id: category.id,
      category_label: category.label,
      risk_bucket: riskBucketForCategory(category.id),
      status: isMockFinding ? "concern" : "none",
      severity: isMockFinding ? (verdict === "malicious" ? "high" : "medium") : "none",
      confidence: "low",
      evidence: isMockFinding ? evidence : undefined,
      user_impact: isMockFinding
        ? "Mock concern for harness validation."
        : "No artifact-backed concern in mock output.",
      recommendation: isMockFinding ? "Inspect the artifact evidence." : "No action needed.",
    };
  });

  return Promise.resolve({
    raw: JSON.stringify({
      ...base,
      agentic_risk_findings: agenticRiskFindings,
      risk_summary: {
        abnormal_behavior_control: {
          status: risky ? "concern" : "none",
          highest_severity: risky ? "medium" : "none",
          summary: risky ? "Mock abnormal behavior concern." : "No concern in mock output.",
        },
        permission_boundary: {
          status: "none",
          highest_severity: "none",
          summary: "No concern in mock output.",
        },
        sensitive_data_protection: {
          status: "none",
          highest_severity: "none",
          summary: "No concern in mock output.",
        },
      },
    }),
    cache: "mock",
  });
}

function summarizePromptRun(kind: PromptKind, result: PromptRunResult): PromptRunSummary {
  const parsed = parseLlmEvalResponse(result.raw);
  const unsupportedRuntimeClaims = findUnsupportedRuntimeClaims(result.raw);
  if (!parsed) {
    return {
      prompt: kind,
      parseOk: false,
      cache: result.cache,
      parseError: "Failed to parse ClawScan JSON output.",
      unsupportedRuntimeClaims,
      evidenceQuality: assessEvidenceQuality(null),
      asiFindings: [],
    };
  }

  return {
    prompt: kind,
    parseOk: true,
    cache: result.cache,
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    summary: parsed.summary,
    unsupportedRuntimeClaims,
    evidenceQuality: assessEvidenceQuality(parsed),
    asiFindings:
      parsed.agenticRiskFindings?.map((finding) => ({
        categoryId: finding.categoryId,
        categoryLabel: finding.categoryLabel,
        status: finding.status,
        severity: finding.severity,
        confidence: finding.confidence,
        riskBucket: finding.riskBucket,
        evidencePath: finding.evidence?.path,
        evidenceSnippet: finding.evidence?.snippet,
        evidenceExplanation: finding.evidence?.explanation,
        userImpact: finding.userImpact,
        recommendation: finding.recommendation,
      })) ?? [],
  };
}

function rowId(row: CorpusRow) {
  const owner = row.resolved.owner ?? "unknown-owner";
  const slug = row.resolved.slug ?? row.skilltester.summary.skill_name ?? "unknown-skill";
  const version = row.resolved.version ?? "unknown-version";
  return `${owner}/${slug}@${version}`;
}

export async function compareRow(
  row: CorpusRow,
  options: RunComparisonOptions,
  runner: PromptRunner,
): Promise<RowComparison> {
  const context = buildSkillEvalContextFromRow(row);
  if (!context) {
    throw new Error(`Cannot compare unresolved corpus row ${rowId(row)}`);
  }

  const oldInput = assembleEvalUserMessage(context);
  const newInput = assembleSkillEvalUserMessage(context);
  const newInstructions = getNewPromptInstructions();
  const [oldResult, newResult] = await Promise.all([
    runner({
      kind: "old",
      row,
      context,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      serviceTier: options.serviceTier ?? getLlmEvalServiceTier(),
      instructions: LEGACY_SECURITY_EVALUATOR_SYSTEM_PROMPT,
      input: oldInput,
      cacheDir: options.cacheDir,
      useCache: options.useCache,
    }),
    runner({
      kind: "new",
      row,
      context,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      serviceTier: options.serviceTier ?? getLlmEvalServiceTier(),
      instructions: newInstructions,
      input: newInput,
      cacheDir: options.cacheDir,
      useCache: options.useCache,
    }),
  ]);

  const oldSummary = summarizePromptRun("old", oldResult);
  const newSummary = summarizePromptRun("new", newResult);
  return {
    id: rowId(row),
    slug: context.slug,
    source: row.source,
    reference: normalizeReferenceVerdict(row),
    old: oldSummary,
    new: newSummary,
    promptDisagreement:
      Boolean(oldSummary.verdict && newSummary.verdict) &&
      oldSummary.verdict !== newSummary.verdict,
  };
}

function emptyEvidenceQuality(): EvidenceQuality {
  return {
    totalAgenticFindings: 0,
    noteOrConcernFindings: 0,
    evidenceBackedFindings: 0,
    missingEvidenceFindings: 0,
  };
}

function addEvidenceQuality(a: EvidenceQuality, b: EvidenceQuality) {
  return {
    totalAgenticFindings: a.totalAgenticFindings + b.totalAgenticFindings,
    noteOrConcernFindings: a.noteOrConcernFindings + b.noteOrConcernFindings,
    evidenceBackedFindings: a.evidenceBackedFindings + b.evidenceBackedFindings,
    missingEvidenceFindings: a.missingEvidenceFindings + b.missingEvidenceFindings,
  };
}

function buildPromptMetrics(rows: RowComparison[], prompt: PromptKind): PromptMetrics {
  const promptRows = rows.map((row) => row[prompt]);
  const referenceRows = rows.filter((row) => row.reference.verdict !== "unknown");
  const riskyReferenceRows = referenceRows.filter((row) => row.reference.verdict !== "benign");
  const matchesReference = referenceRows.filter(
    (row) => row[prompt].verdict === row.reference.verdict,
  ).length;
  const riskyReferenceDetected = riskyReferenceRows.filter(
    (row) => row[prompt].verdict !== "benign",
  ).length;
  const falsePositivesOnBenign = referenceRows.filter(
    (row) =>
      row.reference.verdict === "benign" && row[prompt].verdict && row[prompt].verdict !== "benign",
  ).length;
  const verdicts = {
    benign: promptRows.filter((row) => row.verdict === "benign").length,
    suspicious: promptRows.filter((row) => row.verdict === "suspicious").length,
    malicious: promptRows.filter((row) => row.verdict === "malicious").length,
  };
  const evidenceQuality = promptRows.reduce(
    (acc, row) => addEvidenceQuality(acc, row.evidenceQuality),
    emptyEvidenceQuality(),
  );

  return {
    parsed: promptRows.filter((row) => row.parseOk).length,
    parseFailures: promptRows.filter((row) => !row.parseOk).length,
    unsupportedRuntimeClaimRows: promptRows.filter((row) => row.unsupportedRuntimeClaims.length > 0)
      .length,
    matchesReference,
    referenceAccuracy: referenceRows.length > 0 ? matchesReference / referenceRows.length : null,
    riskyReferenceDetected,
    riskyReferenceRecall:
      riskyReferenceRows.length > 0 ? riskyReferenceDetected / riskyReferenceRows.length : null,
    falsePositivesOnBenign,
    verdicts,
    evidenceQuality,
  };
}

const FALSE_POSITIVE_THEME_RULES = [
  {
    id: "mandatory_workflow_language",
    label: "Mandatory workflow language",
    description:
      "Purpose-aligned skills are being escalated because their instructions use broad MUST/before-work language.",
    suggestedFewShotLesson:
      "Broad workflow language in a coherent helper skill should usually be a note unless it overrides higher-priority instructions, triggers hidden actions, or forces unrelated work.",
    patterns: [
      /\bmust\b/i,
      /\bmandatory\b/i,
      /\bbefore\s+(?:any|all|every)\s+(?:work|task|action)\b/i,
      /\bpre-?work\b/i,
    ],
  },
  {
    id: "cli_install_or_execution_surface",
    label: "CLI install or execution surface",
    description:
      "User-visible package-manager installs or external CLI usage are being treated as suspicious by default.",
    suggestedFewShotLesson:
      "A disclosed CLI/package install that is central to the skill purpose should usually be a note; escalate when it is hidden, auto-executed, unrelated, untrusted in provenance, or paired with unnecessary privilege.",
    patterns: [
      /\b(?:npm|pnpm|bun|pip|uv|brew|go)\s+(?:install|add)\b/i,
      /\bglobal\s+(?:npm|package|install)\b/i,
      /\bexternal\s+cli\b/i,
      /\bcli\b/i,
      /\bexecute|execution|run(?:ning)?\b/i,
    ],
  },
  {
    id: "referenced_helper_missing_from_artifacts",
    label: "Referenced helper missing from artifacts",
    description:
      "The scan flagged a skill because SKILL.md tells the agent to run relative helper scripts that are not present in the artifact set.",
    suggestedFewShotLesson:
      "Do not few-shot this away until the corpus includes full skill files. If the complete artifact set truly omits a referenced executable helper, a concern may be appropriate; if the corpus is incomplete, fix the corpus before tuning the prompt.",
    patterns: [
      /\bnot\s+included\b/i,
      /\bno\s+(?:such\s+)?(?:file|script|implementation)\b/i,
      /\bfile\s+manifest\s+contains\s+no\b/i,
      /\brelative\s+(?:script|path|file)\b/i,
      /\bscripts\/[A-Za-z0-9_.-]+\.(?:py|sh|js|ts|mjs|cjs)\b/i,
    ],
  },
  {
    id: "disclosed_provider_data_flow",
    label: "Disclosed provider data flow",
    description:
      "Disclosed LLM/API/provider processing or selected file context is being interpreted as exfiltration.",
    suggestedFewShotLesson:
      "Provider processing and selected file context should be notes when disclosed and purpose-aligned; escalate when transfer is hidden, unrelated, automatic, or materially misrepresented.",
    patterns: [
      /\bllm\b/i,
      /\bprovider\b/i,
      /\bsend(?:s|ing)?\b.*\b(?:provider|llm|external|server|cloud)\b/i,
      /\b(?:provider|llm|external|server|cloud)\b.*\bsend(?:s|ing)?\b/i,
      /\bfile contents?\b/i,
      /\bexfiltrat/i,
    ],
  },
  {
    id: "persistent_memory_or_sync",
    label: "Persistent memory or sync",
    description:
      "Expected memory, context storage, or optional sync behavior is being treated as poisoning risk by default.",
    suggestedFewShotLesson:
      "Persistent memory and sync are notes for memory/sync skills when disclosed and bounded; escalate when untrusted writes, cross-user leakage, hidden sync, or authority over current instructions is evidenced.",
    patterns: [
      /\bmemory\b/i,
      /\bcontext[-_\s]?tree\b/i,
      /\bstored?\s+(?:memory|knowledge|context)\b/i,
      /\bpersist/i,
      /\bsync\b/i,
      /\bpull\b/i,
      /\bpush\b/i,
      /\bpoison/i,
    ],
  },
  {
    id: "credential_setup",
    label: "Credential setup",
    description:
      "Expected API key, login, or token setup is being escalated without unrelated access evidence.",
    suggestedFewShotLesson:
      "Credential setup for the integrated service should usually be a note; escalate when credentials are unrelated, over-scoped, logged, transmitted unexpectedly, or requested outside the skill purpose.",
    patterns: [/\bapi[-_\s]?key\b/i, /\btoken\b/i, /\bcredential\b/i, /\blogin\b/i, /\bauth\b/i],
  },
  {
    id: "documentation_ambiguity",
    label: "Documentation ambiguity",
    description:
      "Ambiguous or mildly conflicting documentation is being treated like deceptive behavior.",
    suggestedFewShotLesson:
      "Documentation ambiguity should usually be a note unless the artifact contains a concrete false assurance, hidden transfer, or user-facing claim that materially misstates a sensitive behavior.",
    patterns: [
      /\bambiguous\b/i,
      /\bunclear\b/i,
      /\bconflict(?:ing|s)?\b/i,
      /\bcontradict/i,
      /\bmisleading\b/i,
      /\bno data\b/i,
    ],
  },
  {
    id: "untrusted_instructions_or_memory",
    label: "Untrusted instructions or memory",
    description:
      "Untrusted natural-language inputs are being flagged without concrete evidence they override policy or trigger unsafe actions.",
    suggestedFewShotLesson:
      "Untrusted natural-language context should be noted; escalate when artifacts instruct the agent to obey it over user/system instructions or route it into high-impact actions without review.",
    patterns: [
      /\buntrusted\b/i,
      /\bprompt[-_\s]?injection\b/i,
      /\boverride\b/i,
      /\bobey\b/i,
      /\btreat\b.*\buntrusted\b/i,
    ],
  },
] as const;

function falsePositiveText(row: RowComparison, prompt: PromptKind) {
  const summary = row[prompt].summary ?? "";
  const findingsText = row[prompt].asiFindings
    .filter((finding) => finding.status === "note" || finding.status === "concern")
    .map((finding) =>
      [
        finding.categoryId,
        finding.categoryLabel,
        finding.status,
        finding.severity,
        finding.evidencePath,
        finding.evidenceSnippet,
        finding.evidenceExplanation,
        finding.userImpact,
        finding.recommendation,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  return `${summary} ${findingsText}`;
}

function falsePositiveThemeRow(row: RowComparison, prompt: PromptKind): FalsePositiveThemeRow {
  const findings = row[prompt].asiFindings.filter(
    (finding) => finding.status === "note" || finding.status === "concern",
  );
  return {
    id: row.id,
    slug: row.slug,
    verdict: row[prompt].verdict,
    summary: row[prompt].summary,
    categories: findings.map(
      (finding) => `${finding.categoryId}:${finding.status}:${finding.severity}`,
    ),
    snippets: findings
      .map((finding) => finding.evidenceSnippet)
      .filter((snippet): snippet is string => Boolean(snippet))
      .slice(0, 3),
  };
}

function matchedThemeRules(row: RowComparison, prompt: PromptKind) {
  const text = falsePositiveText(row, prompt);
  return FALSE_POSITIVE_THEME_RULES.filter((rule) =>
    rule.patterns.some((pattern) => pattern.test(text)),
  );
}

function buildFalsePositiveAnalysisForPrompt(
  rows: RowComparison[],
  prompt: PromptKind,
): FalsePositiveAnalysisForPrompt {
  const falsePositiveRows = rows.filter(
    (row) =>
      row.reference.verdict === "benign" && row[prompt].verdict && row[prompt].verdict !== "benign",
  );
  const themeRows = new Map<string, FalsePositiveThemeRow[]>();
  const ruleById = new Map<string, (typeof FALSE_POSITIVE_THEME_RULES)[number]>(
    FALSE_POSITIVE_THEME_RULES.map((rule) => [rule.id, rule]),
  );
  const rowThemeIds = new Map<string, string[]>();

  for (const row of falsePositiveRows) {
    const matched = matchedThemeRules(row, prompt);
    const themeIds = matched.length ? matched.map((rule) => rule.id) : ["other_artifact_concern"];
    rowThemeIds.set(row.id, themeIds);
    for (const themeId of themeIds) {
      const existing = themeRows.get(themeId) ?? [];
      existing.push(falsePositiveThemeRow(row, prompt));
      themeRows.set(themeId, existing);
    }
  }

  const themes = Array.from(themeRows.entries())
    .map(([id, rowsForTheme]) => {
      const rule = ruleById.get(id);
      return {
        id,
        label: rule?.label ?? "Other artifact concern",
        description:
          rule?.description ??
          "False positive did not match one of the current deterministic theme rules.",
        count: rowsForTheme.length,
        suggestedFewShotLesson:
          rule?.suggestedFewShotLesson ??
          "Add a contrastive example that distinguishes this concern from a benign, purpose-aligned artifact surface.",
        rows: rowsForTheme.slice(0, 10),
      };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const suggestedFewShotCandidates = falsePositiveRows
    .map((row) => {
      const themeIds = rowThemeIds.get(row.id) ?? ["other_artifact_concern"];
      const firstTheme = themes.find((theme) => theme.id === themeIds[0]);
      const themeRow = falsePositiveThemeRow(row, prompt);
      return {
        rowId: row.id,
        slug: row.slug,
        themeIds,
        currentVerdict: row[prompt].verdict,
        referenceVerdict: row.reference.verdict,
        summary: row[prompt].summary,
        lesson:
          firstTheme?.suggestedFewShotLesson ??
          "Use this false positive as a contrastive benign example.",
        categories: themeRow.categories,
        snippets: themeRow.snippets,
      };
    })
    .sort((a, b) => b.themeIds.length - a.themeIds.length || a.rowId.localeCompare(b.rowId))
    .slice(0, 8);

  return { themes, suggestedFewShotCandidates };
}

function buildFalsePositiveAnalysis(rows: RowComparison[]): FalsePositiveAnalysis {
  return {
    old: buildFalsePositiveAnalysisForPrompt(rows, "old"),
    new: buildFalsePositiveAnalysisForPrompt(rows, "new"),
  };
}

export function buildEvalReport(params: {
  corpusFile: string;
  corpusSchemaVersion?: string;
  model: string;
  reasoningEffort: LlmEvalReasoningEffort;
  serviceTier: LlmEvalServiceTier;
  concurrency: number;
  totalRows: number;
  rows: RowComparison[];
  skipped: SkippedRow[];
}): EvalReport {
  const referenceKnownRows = params.rows.filter(
    (row) => row.reference.verdict !== "unknown",
  ).length;
  const disagreements = params.rows.filter((row) => row.promptDisagreement);
  const unsupportedRuntimeClaimRows = params.rows.filter(
    (row) =>
      row.old.unsupportedRuntimeClaims.length > 0 || row.new.unsupportedRuntimeClaims.length > 0,
  );
  const oldFalsePositiveExamples = params.rows.filter(
    (row) => row.reference.verdict === "benign" && row.old.verdict && row.old.verdict !== "benign",
  );
  const newFalsePositiveExamples = params.rows.filter(
    (row) => row.reference.verdict === "benign" && row.new.verdict && row.new.verdict !== "benign",
  );

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    corpusFile: params.corpusFile,
    corpusSchemaVersion: params.corpusSchemaVersion,
    model: params.model,
    reasoningEffort: params.reasoningEffort,
    serviceTier: params.serviceTier,
    concurrency: params.concurrency,
    counts: {
      corpusRows: params.totalRows,
      evaluatedRows: params.rows.length,
      skippedRows: params.skipped.length,
      referenceKnownRows,
      promptDisagreements: disagreements.length,
    },
    prompts: {
      old: {
        label: "legacy",
        systemPrompt: "LEGACY_SECURITY_EVALUATOR_SYSTEM_PROMPT",
        systemPromptSha256: sha256(LEGACY_SECURITY_EVALUATOR_SYSTEM_PROMPT),
        metrics: buildPromptMetrics(params.rows, "old"),
      },
      new: {
        label: "owasp_asi",
        systemPrompt: getNewPromptSystemPromptName(),
        systemPromptSha256: sha256(getNewPromptInstructions()),
        metrics: buildPromptMetrics(params.rows, "new"),
      },
    },
    falsePositiveExamples: {
      old: oldFalsePositiveExamples.slice(0, 20),
      new: newFalsePositiveExamples.slice(0, 20),
    },
    falsePositiveAnalysis: buildFalsePositiveAnalysis(params.rows),
    disagreements: disagreements.slice(0, 50),
    unsupportedRuntimeClaimRows: unsupportedRuntimeClaimRows.slice(0, 50),
    rows: params.rows,
    skipped: params.skipped,
  };
}

function formatPercent(value: number | null) {
  return value === null ? "n/a" : `${Math.round(value * 1000) / 10}%`;
}

function verdictLabel(value: string | undefined) {
  return value ?? "parse_failed";
}

function compactAsiFindings(row: RowComparison) {
  return row.new.asiFindings
    .filter((finding) => finding.status === "note" || finding.status === "concern")
    .map((finding) => `${finding.categoryId}:${finding.status}:${finding.severity}`)
    .join(", ");
}

function rowSummaryLine(row: RowComparison) {
  return `- ${row.id}: reference=${row.reference.verdict} old=${verdictLabel(
    row.old.verdict,
  )} new=${verdictLabel(row.new.verdict)} ASI=${compactAsiFindings(row) || "none"}`;
}

function formatThemeLines(analysis: FalsePositiveAnalysisForPrompt) {
  if (analysis.themes.length === 0) return ["- none"];
  return analysis.themes.flatMap((theme) => [
    `- ${theme.label} (${theme.count}): ${theme.description}`,
    `  Few-shot lesson: ${theme.suggestedFewShotLesson}`,
    `  Examples: ${theme.rows
      .slice(0, 3)
      .map((row) => row.id)
      .join(", ")}`,
  ]);
}

function formatFewShotCandidateLines(analysis: FalsePositiveAnalysisForPrompt) {
  if (analysis.suggestedFewShotCandidates.length === 0) return ["- none"];
  return analysis.suggestedFewShotCandidates.map(
    (candidate) =>
      `- ${candidate.rowId}: themes=${candidate.themeIds.join(", ")} lesson=${candidate.lesson}`,
  );
}

function generateMarkdownReport(report: EvalReport) {
  const oldMetrics = report.prompts.old.metrics;
  const newMetrics = report.prompts.new.metrics;
  const lines = [
    "# ClawScan Eval Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Corpus: ${report.corpusFile}`,
    ...(report.corpusSchemaVersion ? [`Corpus schema: ${report.corpusSchemaVersion}`] : []),
    `Model: ${report.model}`,
    `Reasoning effort: ${report.reasoningEffort}`,
    `Service tier: ${report.serviceTier}`,
    `Concurrency: ${report.concurrency}`,
    "",
    "## Summary",
    "",
    `- Corpus rows: ${report.counts.corpusRows}`,
    `- Evaluated rows: ${report.counts.evaluatedRows}`,
    `- Skipped rows: ${report.counts.skippedRows}`,
    `- Reference-known rows: ${report.counts.referenceKnownRows}`,
    `- Old/new verdict disagreements: ${report.counts.promptDisagreements}`,
    "",
    "## Reference Comparison",
    "",
    "| Prompt | Parsed | Parse failures | Accuracy | Risky recall | False positives on benign | Runtime claim rows |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| Old | ${oldMetrics.parsed} | ${oldMetrics.parseFailures} | ${formatPercent(
      oldMetrics.referenceAccuracy,
    )} | ${formatPercent(oldMetrics.riskyReferenceRecall)} | ${
      oldMetrics.falsePositivesOnBenign
    } | ${oldMetrics.unsupportedRuntimeClaimRows} |`,
    `| New | ${newMetrics.parsed} | ${newMetrics.parseFailures} | ${formatPercent(
      newMetrics.referenceAccuracy,
    )} | ${formatPercent(newMetrics.riskyReferenceRecall)} | ${
      newMetrics.falsePositivesOnBenign
    } | ${newMetrics.unsupportedRuntimeClaimRows} |`,
    "",
    "## Evidence Quality",
    "",
    "| Prompt | Agentic findings | Notes/concerns | Evidence-backed | Missing evidence |",
    "| --- | ---: | ---: | ---: | ---: |",
    `| Old | ${oldMetrics.evidenceQuality.totalAgenticFindings} | ${oldMetrics.evidenceQuality.noteOrConcernFindings} | ${oldMetrics.evidenceQuality.evidenceBackedFindings} | ${oldMetrics.evidenceQuality.missingEvidenceFindings} |`,
    `| New | ${newMetrics.evidenceQuality.totalAgenticFindings} | ${newMetrics.evidenceQuality.noteOrConcernFindings} | ${newMetrics.evidenceQuality.evidenceBackedFindings} | ${newMetrics.evidenceQuality.missingEvidenceFindings} |`,
    "",
    "## False Positive Examples",
    "",
    "Old prompt:",
    ...(report.falsePositiveExamples.old.length
      ? report.falsePositiveExamples.old.map(rowSummaryLine)
      : ["- none"]),
    "",
    "New prompt:",
    ...(report.falsePositiveExamples.new.length
      ? report.falsePositiveExamples.new.map(rowSummaryLine)
      : ["- none"]),
    "",
    "## False Positive Theme Clusters",
    "",
    "Old prompt:",
    ...formatThemeLines(report.falsePositiveAnalysis.old),
    "",
    "New prompt:",
    ...formatThemeLines(report.falsePositiveAnalysis.new),
    "",
    "## Suggested Few-Shot Candidates",
    "",
    "Old prompt:",
    ...formatFewShotCandidateLines(report.falsePositiveAnalysis.old),
    "",
    "New prompt:",
    ...formatFewShotCandidateLines(report.falsePositiveAnalysis.new),
    "",
    "## Disagreements",
    "",
    ...(report.disagreements.length ? report.disagreements.map(rowSummaryLine) : ["- none"]),
    "",
    "## Unsupported Runtime Claims",
    "",
    ...(report.unsupportedRuntimeClaimRows.length
      ? report.unsupportedRuntimeClaimRows.map((row) => {
          const claims = [...row.old.unsupportedRuntimeClaims, ...row.new.unsupportedRuntimeClaims]
            .map((claim) => `${claim.pattern}: "${claim.match}"`)
            .join("; ");
          return `- ${row.id}: ${claims}`;
        })
      : ["- none"]),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function writeReports(report: EvalReport, outputDir: string) {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "report.json");
  const mdPath = join(outputDir, "report.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdPath, generateMarkdownReport(report), "utf8");
  return { jsonPath, mdPath };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

export async function runComparison(
  options: RunComparisonOptions,
  runner: PromptRunner = options.mock ? mockPromptRunner : defaultPromptRunner,
): Promise<EvalReport> {
  const input = await loadRows(options);
  const allRows = input.rows;
  const corpusSchemaVersion = firstString(...allRows.map((row) => row.schema_version));
  const targetedRows = selectCorpusRowsByTargets(allRows, options.targets ?? []);
  const referenceFilteredRows = selectCorpusRowsBySkillTesterRisk(
    targetedRows,
    options.skilltesterRiskyOnly ?? false,
  );
  const rows =
    typeof options.limit === "number"
      ? referenceFilteredRows.slice(0, options.limit)
      : referenceFilteredRows;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const serviceTier = options.serviceTier ?? getLlmEvalServiceTier();
  const skipped: SkippedRow[] = [];
  const comparableRows: CorpusRow[] = [];

  for (const row of rows) {
    const context = buildSkillEvalContextFromRow(row);
    if (!context) {
      skipped.push({
        id: rowId(row),
        slug: row.resolved.slug ?? row.skilltester.summary.skill_name ?? "unknown-skill",
        reason: row.artifact.missing_reason ?? row.content_status,
      });
      continue;
    }
    comparableRows.push(row);
  }

  const comparisons = await mapWithConcurrency(comparableRows, concurrency, async (row) => {
    console.log(`[eval] ${rowId(row)}`);
    return await compareRow(row, { ...options, serviceTier }, runner);
  });

  const report = buildEvalReport({
    corpusFile: input.source,
    corpusSchemaVersion,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    serviceTier,
    concurrency,
    totalRows: rows.length,
    rows: comparisons,
    skipped,
  });

  if (options.writeReports) {
    const paths = await writeReports(report, options.outputDir);
    console.log(`Wrote ${paths.jsonPath}`);
    console.log(`Wrote ${paths.mdPath}`);
  }

  return report;
}

function printHelp() {
  console.log(`Usage: bun scripts/eval/clawscan-skilltester.ts [options]

Options:
  --corpus <path>       Local SkillTester corpus JSONL path. When omitted, loads HF ${HF_DATASET_ENV_VAR}/${DEFAULT_HF_SPLIT}.
  --hf-dataset <id>     Hugging Face dataset id (default: ${HF_DATASET_ENV_VAR})
  --hf-config <name>    Hugging Face dataset config (default: ${DEFAULT_HF_CONFIG})
  --output-dir <path>   Report output directory (default: ${DEFAULT_OUTPUT_DIR})
  --cache-dir <path>    Prompt response cache directory (default: ${DEFAULT_CACHE_DIR})
  --limit <n>           Evaluate only the first n corpus rows
  --concurrency <n>     Number of corpus rows to evaluate at once (default: ${DEFAULT_CONCURRENCY})
  --target <id>         Evaluate matching corpus row(s). Repeatable.
                        Matches owner/slug@version, owner/slug, slug@version, slug, SkillTester skill_name, or source URL.
  --risky-only
                        Evaluate only rows SkillTester labels suspicious/malicious or scores below 80
  --model <name>        OpenAI model (default: OPENAI_EVAL_MODEL or ${getLlmEvalModel()})
  --reasoning-effort <effort>
                        Reasoning effort (default: OPENAI_EVAL_REASONING_EFFORT or ${getLlmEvalReasoningEffort()})
  --service-tier <tier> OpenAI Responses service tier: auto, default, flex, or priority (default: OPENAI_EVAL_SERVICE_TIER or ${getLlmEvalServiceTier()})
  --no-cache            Disable response cache
  --mock                Use deterministic mock prompt outputs; no API calls
  --no-write            Do not write report files
  --help                Show this help
`);
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    corpusFile: null,
    hfDataset: process.env[HF_DATASET_ENV_VAR] ?? null,
    hfConfig: DEFAULT_HF_CONFIG,
    outputDir: DEFAULT_OUTPUT_DIR,
    cacheDir: DEFAULT_CACHE_DIR,
    model: getLlmEvalModel(),
    reasoningEffort: getLlmEvalReasoningEffort(),
    serviceTier: getLlmEvalServiceTier(),
    concurrency: DEFAULT_CONCURRENCY,
    targets: [],
    skilltesterRiskyOnly: false,
    useCache: true,
    mock: false,
    writeReports: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--corpus":
        if (!next) throw new Error("--corpus requires a path");
        options.corpusFile = next;
        i += 1;
        break;
      case "--hf-dataset":
        if (!next) throw new Error("--hf-dataset requires a dataset id");
        options.hfDataset = next;
        i += 1;
        break;
      case "--hf-config":
        if (!next) throw new Error("--hf-config requires a config name");
        options.hfConfig = next;
        i += 1;
        break;
      case "--output-dir":
        if (!next) throw new Error("--output-dir requires a path");
        options.outputDir = next;
        i += 1;
        break;
      case "--cache-dir":
        if (!next) throw new Error("--cache-dir requires a path");
        options.cacheDir = next;
        i += 1;
        break;
      case "--limit":
        if (!next) throw new Error("--limit requires a number");
        options.limit = Number.parseInt(next, 10);
        if (!Number.isFinite(options.limit) || options.limit < 1) {
          throw new Error("--limit must be a positive integer");
        }
        i += 1;
        break;
      case "--concurrency":
        if (!next) throw new Error("--concurrency requires a number");
        options.concurrency = Number.parseInt(next, 10);
        if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
          throw new Error("--concurrency must be a positive integer");
        }
        i += 1;
        break;
      case "--target":
      case "--row":
      case "--id":
        if (!next) throw new Error(`${arg} requires a target identifier`);
        options.targets = [...(options.targets ?? []), next];
        i += 1;
        break;
      case "--risky-only":
      case "--skilltester-risky-only":
      case "--reference-risky-only":
        options.skilltesterRiskyOnly = true;
        break;
      case "--model":
        if (!next) throw new Error("--model requires a model name");
        options.model = next;
        i += 1;
        break;
      case "--reasoning-effort":
        if (!next) throw new Error("--reasoning-effort requires an effort value");
        options.reasoningEffort = parseReasoningEffort(next);
        i += 1;
        break;
      case "--service-tier":
        if (!next) throw new Error("--service-tier requires a service tier");
        options.serviceTier = parseServiceTier(next);
        i += 1;
        break;
      case "--no-cache":
        options.useCache = false;
        break;
      case "--mock":
        options.mock = true;
        break;
      case "--no-write":
        options.writeReports = false;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runComparison(options);
  console.log(
    JSON.stringify(
      {
        evaluatedRows: report.counts.evaluatedRows,
        skippedRows: report.counts.skippedRows,
        promptDisagreements: report.counts.promptDisagreements,
        model: report.model,
        reasoningEffort: report.reasoningEffort,
        serviceTier: report.serviceTier,
        concurrency: report.concurrency,
        old: report.prompts.old.metrics,
        new: report.prompts.new.metrics,
        falsePositiveThemes: {
          old: report.falsePositiveAnalysis.old.themes.map((theme) => ({
            id: theme.id,
            count: theme.count,
          })),
          new: report.falsePositiveAnalysis.new.themes.map((theme) => ({
            id: theme.id,
            count: theme.count,
          })),
        },
      },
      null,
      2,
    ),
  );
}

function isMainModule(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
