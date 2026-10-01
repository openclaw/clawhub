import { normalizeCatalogTopics, normalizePluginCategories } from "clawhub-schema";

export const DEFAULT_PUBLIC_CORPUS_FIXTURE = "fixtures/public-corpus/corpus.jsonl";

export type PublicCorpusSkillRow = {
  kind: "skill";
  slug: string;
  displayName: string;
  version: string;
  skillMd: string;
  summary?: string;
  createdAt?: number;
};

export type PublicCorpusPluginRow = {
  kind: "plugin";
  name: string;
  displayName: string;
  version: string;
  readme: string;
  summary?: string;
  categories?: string[];
  topics?: string[];
  family?: "skill" | "code-plugin" | "bundle-plugin";
  channel?: "official" | "community" | "private";
  sourceRepoHost?: string | null;
  createdAt?: number;
};

export type PublicCorpusRow = PublicCorpusSkillRow | PublicCorpusPluginRow;

export type CorpusValidationFinding = {
  line: number;
  reason:
    | "invalid_json"
    | "invalid_kind"
    | "missing_required_field"
    | "empty_skill_text"
    | "empty_plugin_text"
    | "disallowed_field"
    | "raw_convex_id"
    | "duplicate_slug"
    | "invalid_catalog_metadata"
    | "local_path"
    | "secret_like_text";
  field?: string;
  value?: string;
};

export type CorpusValidationResult = {
  ok: boolean;
  rowCount: number;
  skillCount: number;
  pluginCount: number;
  findings: CorpusValidationFinding[];
};

const DISALLOWED_FIELD_PATTERNS = [
  /^owner/i,
  /^publisher/i,
  /^user/i,
  /^email$/i,
  /^auth/i,
  /^token/i,
];

const RAW_CONVEX_ID_PATTERN =
  /\b(?:users|publishers|skills|skillVersions|packages|packageReleases):[A-Za-z0-9_-]+\b/;
const RAW_LOCAL_PATH_PATTERN =
  /(?:\/Users\/(?!\[REDACTED_USER\])|\/private\/tmp\/(?!\[REDACTED_PATH\])|\/var\/folders\/(?!\[REDACTED_PATH\])|\/mnt\/c\/Users\/(?!\[REDACTED_USER\])|C:\\Users\\(?!\[REDACTED_USER\]))/;

const SECRET_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:authorization|x-api-key)\s*[:=]\s*["']?(?:bearer|basic)?\s+[A-Za-z0-9._~+/=-]{12,}/i,
];

export function parseCorpusJsonl(text: string): PublicCorpusRow[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as PublicCorpusRow);
}

export function validateCorpusJsonl(text: string): CorpusValidationResult {
  const rows: PublicCorpusRow[] = [];
  const findings: CorpusValidationFinding[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim().length === 0) return;
    try {
      rows.push(JSON.parse(line) as PublicCorpusRow);
    } catch {
      findings.push({ line: index + 1, reason: "invalid_json" });
    }
  });

  return mergeValidationResults(validateCorpusRows(rows), findings);
}

export function validateCorpusRows(rows: PublicCorpusRow[]): CorpusValidationResult {
  const findings: CorpusValidationFinding[] = [];
  const seenKeys = new Set<string>();
  let skillCount = 0;
  let pluginCount = 0;

  rows.forEach((row, index) => {
    const line = index + 1;
    if (!isRecord(row) || (row.kind !== "skill" && row.kind !== "plugin")) {
      findings.push({ line, reason: "invalid_kind" });
      return;
    }

    collectDisallowedFieldFindings(row, line, findings);
    collectTextFindings(row, line, findings);

    if (row.kind === "skill") {
      skillCount += 1;
      requireString(row.slug, "slug", line, findings);
      requireString(row.displayName, "displayName", line, findings);
      requireString(row.version, "version", line, findings);
      if (!row.skillMd?.trim())
        findings.push({ line, reason: "empty_skill_text", field: "skillMd" });
      collectDuplicate("skill", row.slug, line, seenKeys, findings);
    } else {
      pluginCount += 1;
      requireString(row.name, "name", line, findings);
      requireString(row.displayName, "displayName", line, findings);
      requireString(row.version, "version", line, findings);
      if (!row.readme?.trim())
        findings.push({ line, reason: "empty_plugin_text", field: "readme" });
      collectPluginCatalogMetadataFindings(row, line, findings);
      collectDuplicate("plugin", row.name, line, seenKeys, findings);
    }
  });

  return {
    ok: findings.length === 0,
    rowCount: rows.length,
    skillCount,
    pluginCount,
    findings,
  };
}

function mergeValidationResults(
  result: CorpusValidationResult,
  findings: CorpusValidationFinding[],
): CorpusValidationResult {
  return {
    ...result,
    ok: result.ok && findings.length === 0,
    findings: [...findings, ...result.findings],
  };
}

function collectDuplicate(
  kind: "skill" | "plugin",
  slug: unknown,
  line: number,
  seenKeys: Set<string>,
  findings: CorpusValidationFinding[],
) {
  if (typeof slug !== "string" || !slug) return;
  const key = `${kind}:${slug}`;
  if (seenKeys.has(key)) findings.push({ line, reason: "duplicate_slug", value: key });
  seenKeys.add(key);
}

function requireString(
  value: unknown,
  field: string,
  line: number,
  findings: CorpusValidationFinding[],
) {
  if (typeof value === "string" && value.trim()) return;
  findings.push({ line, reason: "missing_required_field", field });
}

function collectPluginCatalogMetadataFindings(
  row: PublicCorpusPluginRow,
  line: number,
  findings: CorpusValidationFinding[],
) {
  if (row.categories !== undefined) {
    try {
      normalizePluginCategories(row.categories);
    } catch (error) {
      findings.push({
        line,
        reason: "invalid_catalog_metadata",
        field: "categories",
        value: error instanceof Error ? error.message : undefined,
      });
    }
  }

  if (row.topics !== undefined) {
    try {
      normalizeCatalogTopics(row.topics);
    } catch (error) {
      findings.push({
        line,
        reason: "invalid_catalog_metadata",
        field: "topics",
        value: error instanceof Error ? error.message : undefined,
      });
    }
  }
}

function collectDisallowedFieldFindings(
  value: unknown,
  line: number,
  findings: CorpusValidationFinding[],
  path = "",
) {
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const field = path ? `${path}.${key}` : key;
    if (DISALLOWED_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      findings.push({ line, reason: "disallowed_field", field });
    }
    collectDisallowedFieldFindings(nested, line, findings, field);
  }
}

function collectTextFindings(
  value: unknown,
  line: number,
  findings: CorpusValidationFinding[],
  path = "",
) {
  if (typeof value === "string") {
    if (RAW_CONVEX_ID_PATTERN.test(value)) {
      findings.push({ line, reason: "raw_convex_id", field: path, value: preview(value) });
    }
    if (RAW_LOCAL_PATH_PATTERN.test(value)) {
      findings.push({ line, reason: "local_path", field: path, value: preview(value) });
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      findings.push({ line, reason: "secret_like_text", field: path, value: preview(value) });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTextFindings(item, line, findings, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      collectTextFindings(nested, line, findings, path ? `${path}.${key}` : key);
    }
  }
}

function preview(value: string) {
  return value.slice(0, 120);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
