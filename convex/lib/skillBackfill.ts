import {
  getFrontmatterMetadata,
  getFrontmatterValue,
  type ParsedSkillFrontmatter,
  parseClawdisMetadata,
  parseFrontmatter,
} from "./skills";

const PLATFORM_SKILL_LICENSE = "MIT-0" as const;

export type ParsedSkillData = {
  frontmatter: ParsedSkillFrontmatter;
  metadata?: unknown;
  clawdis?: unknown;
  license?: typeof PLATFORM_SKILL_LICENSE;
};

export type SkillSummaryBackfillPatch = {
  summary?: string;
  parsed?: ParsedSkillData;
};

export function buildSkillSummaryBackfillPatch(args: {
  readmeText: string;
  currentSummary?: string;
  currentParsed?: ParsedSkillData;
}): SkillSummaryBackfillPatch {
  const frontmatter = parseFrontmatter(args.readmeText);
  const summary = getFrontmatterValue(frontmatter, "description") ?? undefined;
  const metadata = getFrontmatterMetadata(frontmatter);
  const clawdis = parseClawdisMetadata(frontmatter);
  const parsed: ParsedSkillData = {
    frontmatter,
    metadata,
    clawdis,
    license: PLATFORM_SKILL_LICENSE,
  };

  const patch: SkillSummaryBackfillPatch = {};
  if (summary && summary !== args.currentSummary) {
    patch.summary = summary;
  }
  if (!deepEqual(parsed, args.currentParsed)) {
    patch.parsed = parsed;
  }
  return patch;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
      const key = aKeys[i] as string;
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}
