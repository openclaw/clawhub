import { fail } from "./ui.js";

const SKILLS_SH_PREFIX = "skills-sh:";
const SKILLS_SH_LEGACY_PREFIX = "skills-sh/";
export const SKILLS_SH_UNSCANNED_LABEL = "Not scanned by ClawHub";
export const SKILLS_SH_SCANNED_LABEL = "Scanned by ClawHub";

export type SkillsShReference = {
  owner: string;
  repo: string;
  slug: string;
  sourceRef: string;
};

// Inspect and scan preserve published names, unlike install-time slug normalization.
export function parsePublishedSkillRef(raw: string) {
  const value = raw.trim();
  if (!value) fail("Skill required");
  const slashIndex = value.indexOf("/");
  if (slashIndex < 0) return { slug: value };
  if (value.indexOf("/", slashIndex + 1) >= 0) fail(`Invalid skill: ${value}`);
  const ownerHandle = value.slice(0, slashIndex).trim().replace(/^@+/, "");
  const slug = value.slice(slashIndex + 1).trim();
  if (!ownerHandle || !slug) fail(`Invalid skill: ${value}`);
  return { slug, ownerHandle };
}

export function parseSkillsShCliReference(raw: string): SkillsShReference | null {
  return parseSkillsShReference(raw, false);
}

export function parseStoredSkillsShReference(raw: string): SkillsShReference | null {
  return parseSkillsShReference(raw, true);
}

function parseSkillsShReference(raw: string, allowLegacySlash: boolean) {
  const value = raw.trim();
  const lower = value.toLowerCase();
  let payload: string;
  if (lower.startsWith(SKILLS_SH_PREFIX)) {
    payload = value.slice(SKILLS_SH_PREFIX.length);
  } else if (lower.startsWith(SKILLS_SH_LEGACY_PREFIX)) {
    if (!allowLegacySlash) {
      throw new Error(`Invalid skills.sh ref: use ${SKILLS_SH_PREFIX}owner/repo/slug`);
    }
    payload = value.slice(SKILLS_SH_LEGACY_PREFIX.length);
  } else {
    return null;
  }

  const segments = payload.split("/");
  if (segments.length !== 3) {
    throw new Error(`Invalid skills.sh ref: use ${SKILLS_SH_PREFIX}owner/repo/slug`);
  }
  const [rawOwner, rawRepo, rawSlug] = segments;
  const owner = normalizeSegment(rawOwner);
  const repo = normalizeSegment(rawRepo);
  const slug = normalizeSegment(rawSlug);
  if (!owner || !repo || !slug) {
    throw new Error(`Invalid skills.sh ref: use ${SKILLS_SH_PREFIX}owner/repo/slug`);
  }
  return {
    owner,
    repo,
    slug,
    sourceRef: `${SKILLS_SH_PREFIX}${owner}/${repo}/${slug}`,
  };
}

function normalizeSegment(raw: string | undefined) {
  const segment = raw?.trim().toLowerCase() ?? "";
  if (
    !segment ||
    !/^[a-z0-9._-]+$/.test(segment) ||
    segment === "." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes(":") ||
    segment.includes("..")
  ) {
    return null;
  }
  return segment;
}
