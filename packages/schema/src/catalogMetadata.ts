export const CATALOG_CATEGORY_LIMIT = 3;
export const CATALOG_TOPIC_LIMIT = 5;
export const CATALOG_TOPIC_MAX_LENGTH = 48;
export const INTERNAL_UNCATEGORIZED_CATEGORY = "other";
export const RESERVED_CATALOG_TOPIC_SLUGS = [
  "approved",
  "audited",
  "certified",
  "clawhub",
  "community",
  "curated",
  "endorsed",
  "featured",
  "official",
  "officials",
  "openclaw",
  "recommended",
  "staff-pick",
  "trusted",
  "trusted-publisher",
  "verified",
] as const;
const CATALOG_TOPIC_FORMAT_CONTROL_RE = /\p{Cf}/u;

export const PLUGIN_CATEGORY_DEFINITIONS = [
  {
    slug: "channels",
    label: "Channels",
    icon: "message-circle",
    description: "Messaging and collaboration channel integrations.",
  },
  {
    slug: "models",
    label: "Models",
    icon: "brain",
    description: "Model providers, inference backends, and model routing.",
  },
  {
    slug: "memory",
    label: "Memory",
    icon: "database",
    description: "Memory providers, embeddings, and retrieval.",
  },
  {
    slug: "context",
    label: "Context",
    icon: "book-open",
    description: "Context engines and context management.",
  },
  {
    slug: "voice",
    label: "Voice",
    icon: "message-square",
    description: "Speech synthesis, transcription, voice calls, and audio interaction.",
  },
  {
    slug: "media",
    label: "Media",
    icon: "palette",
    description: "Image, video, audio, and other media understanding or generation.",
  },
  {
    slug: "web",
    label: "Web",
    icon: "globe",
    description: "Web search, browsing, fetching, research, and information retrieval.",
  },
  {
    slug: "tools",
    label: "Tools",
    icon: "wrench",
    description: "Agent tools, workflows, scheduled work, and service automation.",
  },
  {
    slug: "runtime",
    label: "Runtime",
    icon: "git-branch",
    description: "Developer tooling, agent runtimes, coding, testing, and execution backends.",
  },
  {
    slug: "gateway",
    label: "Gateway",
    icon: "activity",
    description: "Gateway extensions, deployment, observability, and operational tooling.",
  },
  {
    slug: "security",
    label: "Security",
    icon: "shield",
    description: "Authentication, authorization, security controls, and policy enforcement.",
  },
  {
    slug: "other",
    label: "Other",
    icon: "package",
    description: "Plugins that do not yet fit another browse category.",
  },
] as const;

export const SKILL_CATEGORY_DEFINITIONS = [
  {
    slug: "integrations",
    label: "Integrations",
    icon: "plug",
    description: "Connect services, fetch data, reconcile records, and operate APIs.",
    keywords: ["api", "data", "database", "integration", "fetch", "http", "graphql"],
  },
  {
    slug: "automation",
    label: "Automation",
    icon: "zap",
    description: "Build repeatable processes, scheduled jobs, pipelines, and orchestration.",
    keywords: [
      "automation",
      "automate",
      "workflow",
      "workflows",
      "cron",
      "schedule",
      "pipeline",
      "orchestrate",
    ],
  },
  {
    slug: "research",
    label: "Research",
    icon: "globe",
    description: "Search, browse, scrape, summarize, monitor, and extract web information.",
    keywords: ["web", "browser", "search", "scrape", "research", "crawl", "rss"],
  },
  {
    slug: "development",
    label: "Development",
    icon: "wrench",
    description: "Inspect, edit, test, build, debug, and operate codebases.",
    keywords: ["developer", "debug", "lint", "test", "build", "code", "git", "repo"],
  },
  {
    slug: "productivity",
    label: "Productivity",
    icon: "list-checks",
    description: "Manage tasks, calendars, email, meetings, projects, and business work.",
    keywords: ["task", "todo", "calendar", "email", "meeting", "project", "productivity"],
  },
  {
    slug: "communication",
    label: "Communication",
    icon: "message-circle",
    description: "Message, publish, and operate social or communication services.",
    keywords: ["message", "social", "discord", "slack", "telegram", "whatsapp", "chat"],
  },
  {
    slug: "creative",
    label: "Creative",
    icon: "palette",
    description: "Create and edit images, video, audio, music, design, and writing.",
    keywords: ["image", "video", "audio", "music", "design", "creative", "writing"],
  },
  {
    slug: "knowledge",
    label: "Knowledge",
    icon: "book-open",
    description: "Work with documents, notes, knowledge bases, teaching, and learning.",
    keywords: ["document", "docs", "pdf", "notes", "knowledge", "study", "learning"],
  },
  {
    slug: "agents",
    label: "Agents",
    icon: "brain",
    description: "Change how an agent plans, reflects, learns, remembers, or collaborates.",
    keywords: ["agent", "memory", "planning", "reflect", "reasoning", "context"],
  },
  {
    slug: "operations",
    label: "Operations",
    icon: "activity",
    description: "Inspect, monitor, deploy, and operate local systems or infrastructure.",
    keywords: [
      "deploy",
      "observability",
      "monitor",
      "infrastructure",
      "filesystem",
      "shell",
      "terminal",
    ],
  },
  {
    slug: "security",
    label: "Security",
    icon: "shield",
    description: "Audit, scan, authenticate, and protect systems or data.",
    keywords: ["security", "audit", "scan", "auth", "encrypt", "policy", "secret"],
  },
  {
    slug: "finance",
    label: "Finance",
    icon: "wallet-cards",
    description: "Work with payments, budgets, banking, shopping, markets, and commerce.",
    keywords: ["finance", "payment", "budget", "bank", "shopping", "market", "commerce"],
  },
  {
    slug: "lifestyle",
    label: "Lifestyle",
    icon: "shapes",
    description: "Travel, health, fitness, cooking, sports, home, and daily-life utilities.",
    keywords: ["travel", "health", "fitness", "cooking", "sports", "weather", "home"],
  },
  {
    slug: "other",
    label: "Other",
    icon: "package",
    description: "Skills that do not yet fit another browse category.",
    keywords: [],
  },
] as const;

export type PluginCategorySlug = (typeof PLUGIN_CATEGORY_DEFINITIONS)[number]["slug"];
export type SkillCategorySlug = (typeof SKILL_CATEGORY_DEFINITIONS)[number]["slug"];

export const PLUGIN_CATEGORY_SLUGS = PLUGIN_CATEGORY_DEFINITIONS.map((category) => category.slug);
export const SKILL_CATEGORY_SLUGS = SKILL_CATEGORY_DEFINITIONS.map((category) => category.slug);

const PLUGIN_CATEGORY_SLUG_SET = new Set<string>(PLUGIN_CATEGORY_SLUGS);
const SKILL_CATEGORY_SLUG_SET = new Set<string>(SKILL_CATEGORY_SLUGS);

export function isPluginCategorySlug(
  value: string | null | undefined,
): value is PluginCategorySlug {
  return Boolean(value && PLUGIN_CATEGORY_SLUG_SET.has(value));
}

export function isSkillCategorySlug(value: string | null | undefined): value is SkillCategorySlug {
  return Boolean(value && SKILL_CATEGORY_SLUG_SET.has(value));
}

function normalizeCategories<T extends string>(
  values: readonly string[] | null | undefined,
  kind: "plugin" | "skill",
  isCategorySlug: (value: string) => value is T,
): T[] {
  const normalized: T[] = [];
  const seen = new Set<T>();

  for (const rawValue of values ?? []) {
    const value = rawValue.trim();
    if (!isCategorySlug(value)) {
      throw new Error(`Unknown ${kind} category slug "${value}"`);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  const specificCategories = normalized.filter(
    (category) => category !== INTERNAL_UNCATEGORIZED_CATEGORY,
  );
  const exclusiveCategories = specificCategories.length ? specificCategories : normalized;
  if (exclusiveCategories.length > CATALOG_CATEGORY_LIMIT) {
    throw new Error(`Categories are limited to ${CATALOG_CATEGORY_LIMIT}`);
  }
  return exclusiveCategories;
}

export function normalizePluginCategories(
  values: readonly string[] | null | undefined,
): PluginCategorySlug[] {
  return normalizeCategories(values, "plugin", isPluginCategorySlug);
}

export function normalizeSkillCategories(
  values: readonly string[] | null | undefined,
): SkillCategorySlug[] {
  return normalizeCategories(values, "skill", isSkillCategorySlug);
}

function resolveCategories<T extends string>({
  declared,
  inferred,
  normalize,
}: {
  declared?: readonly string[] | null;
  inferred?: readonly string[] | null;
  normalize: (values: readonly string[] | null | undefined) => T[];
}): T[] {
  if (declared !== undefined) {
    const declaredCategories = normalize(declared);
    return declaredCategories.length > 0 ? declaredCategories : normalize(["other"]);
  }
  const inferredCategories = normalize(inferred);
  return inferredCategories.length > 0 ? inferredCategories : normalize(["other"]);
}

export function resolvePluginCategories(input: {
  declared?: readonly string[] | null;
  inferred?: readonly string[] | null;
}): PluginCategorySlug[] {
  return resolveCategories({ ...input, normalize: normalizePluginCategories });
}

export function resolveSkillCategories(input: {
  declared?: readonly string[] | null;
  inferred?: readonly string[] | null;
}): SkillCategorySlug[] {
  return resolveCategories({ ...input, normalize: normalizeSkillCategories });
}

function tokenizeCategoryText(value: string): string[] {
  return value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function tokenMatchesCategoryKeyword(token: string, keyword: string) {
  return token === keyword || token === `${keyword}s` || keyword === `${token}s`;
}

export function inferSkillCategories(input: {
  slug?: string | null;
  displayName?: string | null;
  summary?: string | null;
}): SkillCategorySlug[] {
  const tokens = tokenizeCategoryText([input.displayName, input.summary, input.slug].join(" "));
  return SKILL_CATEGORY_DEFINITIONS.filter((category) => category.slug !== "other")
    .map((category) => ({
      slug: category.slug,
      score: (category.keywords as readonly string[]).reduce(
        (score, keyword) =>
          score + (tokens.some((token) => tokenMatchesCategoryKeyword(token, keyword)) ? 1 : 0),
        0,
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, CATALOG_CATEGORY_LIMIT)
    .map((candidate) => candidate.slug);
}

export function normalizeCatalogTopic(value: string): string | undefined {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

export function normalizeCatalogTopics(values: readonly string[] | null | undefined): string[] {
  const normalized: string[] = [];
  const seenSlugs = new Set<string>();
  const reservedSlugs = new Set<string>(RESERVED_CATALOG_TOPIC_SLUGS);

  for (const rawValue of values ?? []) {
    if (CATALOG_TOPIC_FORMAT_CONTROL_RE.test(rawValue)) {
      throw new Error("Topics cannot include invisible format controls");
    }
    const label = rawValue.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!label) continue;
    if (label.length > CATALOG_TOPIC_MAX_LENGTH) {
      throw new Error(`Topics must be ${CATALOG_TOPIC_MAX_LENGTH} characters or fewer`);
    }
    const slug = normalizeCatalogTopic(label);
    if (!slug) throw new Error(`Invalid topic "${label}"`);
    if (reservedSlugs.has(slug)) {
      throw new Error(`Topic "${label}" is reserved by ClawHub`);
    }
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    normalized.push(label);
    if (normalized.length > CATALOG_TOPIC_LIMIT) {
      throw new Error(`Topics are limited to ${CATALOG_TOPIC_LIMIT}`);
    }
  }

  return normalized;
}

export function normalizeInferredCatalogTopics(
  values: readonly string[] | null | undefined,
): string[] {
  try {
    return normalizeCatalogTopics(values).slice(0, CATALOG_TOPIC_LIMIT);
  } catch {
    return [];
  }
}

export function resolveCatalogTopics(input: {
  declared?: readonly string[] | null;
  inferred?: readonly string[] | null;
  inferenceCurrent?: boolean;
}): string[] {
  if (input.declared !== undefined) return input.declared ? [...input.declared] : [];
  if (!input.inferenceCurrent) return [];
  return normalizeInferredCatalogTopics(input.inferred);
}

export function getCatalogTopicSlugs(values: readonly string[] | null | undefined): string[] {
  const slugs: string[] = [];
  const seenSlugs = new Set<string>();
  for (const value of values ?? []) {
    let normalized: string[];
    try {
      normalized = normalizeCatalogTopics([value]);
    } catch {
      continue;
    }
    const slug = normalizeCatalogTopic(normalized[0] ?? "");
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    slugs.push(slug);
    if (slugs.length >= CATALOG_TOPIC_LIMIT) break;
  }
  return slugs;
}

type SkillCategoryCandidate = {
  categories?: readonly string[] | null;
  inferredCategories?: readonly string[] | null;
  latestVersionId?: string | null;
  inferredFromVersionId?: string | null;
  slug: string;
  displayName: string;
  summary?: string | null;
};

export function resolveStoredSkillCategories(skill: SkillCategoryCandidate): SkillCategorySlug[] {
  let declared: SkillCategorySlug[] | undefined;
  try {
    declared =
      skill.categories === undefined ? undefined : normalizeSkillCategories(skill.categories);
  } catch {
    declared = undefined;
  }
  const inferenceCurrent =
    Boolean(skill.latestVersionId) && skill.latestVersionId === skill.inferredFromVersionId;
  return resolveSkillCategories({
    declared,
    inferred: inferenceCurrent ? skill.inferredCategories : undefined,
  });
}
