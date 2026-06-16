export const CATALOG_TOPIC_LIMIT = 8;
export const CATALOG_TOPIC_MAX_LENGTH = 32;
export const INTERNAL_UNCATEGORIZED_CATEGORY = "uncategorized";

export const SKILL_CATEGORY_DEFINITIONS = [
  {
    slug: "data-apis",
    label: "Data, APIs & Integrations",
    icon: "database",
    description: "Connect services, fetch data, reconcile records, or operate APIs.",
    keywords: ["api", "data", "database", "integration", "fetch", "http", "rest", "graphql"],
  },
  {
    slug: "agent-behavior",
    label: "Agent Behavior & Memory",
    icon: "brain",
    description: "Change how an agent plans, reflects, learns, remembers, or collaborates.",
    keywords: ["memory", "planning", "reflect", "learn", "reasoning", "context", "multiagent"],
  },
  {
    slug: "media-creative",
    label: "Media & Creative",
    icon: "palette",
    description: "Create or edit images, video, audio, music, design, and writing.",
    keywords: ["image", "video", "audio", "music", "design", "creative", "writing", "transcribe"],
  },
  {
    slug: "automation-workflows",
    label: "Automation & Workflows",
    icon: "git-branch",
    description: "Build repeatable processes, scheduled jobs, pipelines, and orchestration.",
    keywords: ["automation", "workflow", "cron", "schedule", "pipeline", "orchestrate", "approval"],
  },
  {
    slug: "finance-commerce",
    label: "Finance, Commerce & Crypto",
    icon: "wallet-cards",
    description: "Work with payments, budgets, banking, shopping, markets, and crypto.",
    keywords: [
      "finance",
      "payment",
      "budget",
      "bank",
      "subscription",
      "shopping",
      "market",
      "crypto",
    ],
  },
  {
    slug: "web-research",
    label: "Web, Browser & Research",
    icon: "globe",
    description: "Search, browse, scrape, summarize, monitor, or extract web information.",
    keywords: ["web", "browser", "search", "scrape", "research", "crawl", "rss", "extract"],
  },
  {
    slug: "docs-knowledge",
    label: "Docs, Knowledge & Notes",
    icon: "book-open",
    description: "Work with documents, PDFs, notes, wikis, and knowledge bases.",
    keywords: ["document", "docs", "pdf", "notes", "knowledge", "wiki", "markdown"],
  },
  {
    slug: "dev-tools",
    label: "Coding & Dev Tools",
    icon: "wrench",
    description: "Inspect, edit, test, build, debug, or operate codebases.",
    keywords: ["dev", "developer", "debug", "lint", "test", "build", "code", "git", "repo"],
  },
  {
    slug: "communication-social",
    label: "Communication & Social",
    icon: "message-circle",
    description: "Message, post, publish, or operate social and communication services.",
    keywords: ["message", "social", "discord", "slack", "telegram", "whatsapp", "chat", "post"],
  },
  {
    slug: "monitoring-ops",
    label: "Monitoring & Ops",
    icon: "activity",
    description: "Run status checks, deployments, logs, alerts, and diagnostics.",
    keywords: [
      "observability",
      "deploy",
      "deployment",
      "log",
      "alert",
      "diagnostic",
      "status",
      "uptime",
    ],
  },
  {
    slug: "productivity-tasks",
    label: "Productivity & Tasks",
    icon: "list-checks",
    description: "Manage tasks, calendars, email, meetings, planning, and lightweight work.",
    keywords: [
      "task",
      "todo",
      "calendar",
      "email",
      "planning",
      "project",
      "productivity",
      "meeting",
    ],
  },
  {
    slug: "security-review",
    label: "Security, Vetting & Trust",
    icon: "shield",
    description: "Audit, vet, scan, and review artifacts for security and trust risks.",
    keywords: [
      "security",
      "scan",
      "audit",
      "vulnerability",
      "malware",
      "secret",
      "vetting",
      "risk",
    ],
  },
  {
    slug: "education-learning",
    label: "Education & Learning",
    icon: "graduation-cap",
    description: "Tutor, study, practice, explain, and support learning.",
    keywords: [
      "tutor",
      "study",
      "exercise",
      "explain",
      "learning",
      "practice",
      "education",
      "quiz",
    ],
  },
  {
    slug: "local-system",
    label: "Local System & Files",
    icon: "folder-cog",
    description: "Operate local files, shells, desktop apps, backups, and system state.",
    keywords: ["filesystem", "shell", "terminal", "desktop", "macos", "windows", "backup", "local"],
  },
  {
    slug: "domain-utilities",
    label: "Domain Utilities",
    icon: "shapes",
    description: "Use specialized helpers for focused real-world domains.",
    keywords: ["weather", "travel", "transit", "health", "fitness", "cooking", "sports", "home"],
  },
] as const;

export type SkillCategorySlug = (typeof SKILL_CATEGORY_DEFINITIONS)[number]["slug"];

const SKILL_CATEGORY_SLUG_SET = new Set<string>(
  SKILL_CATEGORY_DEFINITIONS.map((category) => category.slug),
);

type SkillCategoryCandidate = {
  primaryCategory?: string | null;
  slug: string;
  displayName: string;
  summary?: string | null;
  capabilityTags?: string[] | null;
};

function normalizeCategoryText(value: string) {
  return value.trim().toLowerCase();
}

function tokenizeCategoryText(value: string) {
  return normalizeCategoryText(value).match(/[a-z0-9]+/g) ?? [];
}

function categoryTokenMatchesKeyword(token: string, keyword: string) {
  if (token === keyword) return true;
  if (keyword === "dev") {
    return token === "developer" || token === "development" || token === "devops";
  }
  if (keyword === "api") {
    return token === "apis";
  }
  return keyword.length >= 4 && token.includes(keyword);
}

function stripGeneratedSlugPrefixTokens(tokens: string[]) {
  if (tokens[0] !== "dev") return tokens;
  const maybeGeneratedId = tokens[1];
  if (!maybeGeneratedId || maybeGeneratedId.length < 7 || !/\d/.test(maybeGeneratedId)) {
    return tokens;
  }
  return tokens.slice(2);
}

export function isSkillCategorySlug(value: string | null | undefined): value is SkillCategorySlug {
  return Boolean(value && SKILL_CATEGORY_SLUG_SET.has(value));
}

export function deriveSkillPrimaryCategory(
  skill: Omit<SkillCategoryCandidate, "primaryCategory">,
): SkillCategorySlug | undefined {
  const primaryTokens = tokenizeCategoryText(
    [skill.displayName, skill.summary ?? "", ...(skill.capabilityTags ?? [])].join(" "),
  );
  const slugTokens = stripGeneratedSlugPrefixTokens(tokenizeCategoryText(skill.slug));
  let bestSlug: SkillCategorySlug | undefined;
  let bestScore = 0;

  for (const category of SKILL_CATEGORY_DEFINITIONS) {
    const score = category.keywords.reduce((total, keyword) => {
      const primaryScore = primaryTokens.some((token) =>
        categoryTokenMatchesKeyword(token, keyword),
      )
        ? 2
        : 0;
      const slugScore = slugTokens.some((token) => categoryTokenMatchesKeyword(token, keyword))
        ? 1
        : 0;
      return total + primaryScore + slugScore;
    }, 0);
    if (score > bestScore) {
      bestSlug = category.slug;
      bestScore = score;
    }
  }

  return bestSlug;
}

export function resolveSkillPrimaryCategory(
  skill: SkillCategoryCandidate,
): SkillCategorySlug | undefined {
  if (isSkillCategorySlug(skill.primaryCategory)) return skill.primaryCategory;
  return deriveSkillPrimaryCategory(skill);
}

export function resolveStoredSkillPrimaryCategory(
  skill: SkillCategoryCandidate,
): SkillCategorySlug | typeof INTERNAL_UNCATEGORIZED_CATEGORY {
  return resolveSkillPrimaryCategory(skill) ?? INTERNAL_UNCATEGORIZED_CATEGORY;
}

export function resolvePublishedSkillPrimaryCategory(
  skill: Omit<SkillCategoryCandidate, "primaryCategory"> & {
    requestedPrimaryCategory?: string;
    existingPrimaryCategory?: string | null;
  },
): SkillCategorySlug | typeof INTERNAL_UNCATEGORIZED_CATEGORY {
  const { requestedPrimaryCategory, existingPrimaryCategory, ...candidate } = skill;
  return resolveStoredSkillPrimaryCategory({
    ...candidate,
    primaryCategory:
      requestedPrimaryCategory === undefined
        ? existingPrimaryCategory
        : requestedPrimaryCategory || undefined,
  });
}

export function normalizeCatalogTopic(value: string): string | undefined {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || undefined;
}

export function normalizeCatalogTopics(values: readonly string[] | null | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const topic = normalizeCatalogTopic(value);
    if (!topic || seen.has(topic)) continue;
    if (topic.length > CATALOG_TOPIC_MAX_LENGTH) {
      throw new Error(`Topics must be ${CATALOG_TOPIC_MAX_LENGTH} characters or fewer`);
    }
    seen.add(topic);
    normalized.push(topic);
    if (normalized.length > CATALOG_TOPIC_LIMIT) {
      throw new Error(`Topics are limited to ${CATALOG_TOPIC_LIMIT}`);
    }
  }

  return normalized;
}

export function normalizeInferredCatalogTopics(
  values: readonly string[] | null | undefined,
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const topic = normalizeCatalogTopic(value);
    if (!topic || topic.length > CATALOG_TOPIC_MAX_LENGTH || seen.has(topic)) continue;
    seen.add(topic);
    normalized.push(topic);
    if (normalized.length === CATALOG_TOPIC_LIMIT) break;
  }

  return normalized;
}
