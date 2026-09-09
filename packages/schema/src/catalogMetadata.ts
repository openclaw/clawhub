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
    description:
      "Human-agent messaging transports and channel adapters. Choose this when the main purpose is letting people talk to the agent through a messaging service, even if the adapter also exposes workspace tools.",
  },
  {
    slug: "models",
    label: "Models",
    icon: "brain",
    description:
      "General model providers, inference backends, and model routing. Agent execution engines belong in Agent runtimes; specialized speech or media generators belong in Voice or Media when that is their main purpose.",
  },
  {
    slug: "agent-runtimes",
    label: "Agent runtimes",
    icon: "bot",
    description:
      "Agent execution engines and backends that run model/tool loops and manage native sessions, including Codex, ACP, and Copilot runtimes. Context assembly belongs in Context; coordinating work across agents belongs in Agent orchestration.",
  },
  {
    slug: "memory",
    label: "Memory",
    icon: "database",
    description:
      "Durable agent memory, embeddings, and retrieval across conversations. Building or compacting the active conversation context belongs in Context.",
  },
  {
    slug: "context",
    label: "Context",
    icon: "book-open",
    description:
      "Building, selecting, compacting, or managing the active conversation context. Durable memory belongs in Memory; an engine that runs the agent and owns its native sessions belongs in Agent runtimes.",
  },
  {
    slug: "voice",
    label: "Voice",
    icon: "message-square",
    description:
      "Speech synthesis, transcription, voice calls, and spoken interaction. Music and general media creation or analysis belong in Media.",
  },
  {
    slug: "web",
    label: "Web",
    icon: "globe",
    description:
      "General web search, browser control, and fetching web pages. A tool whose main purpose is a specific research or business workflow belongs in that workflow's category.",
  },
  {
    slug: "media",
    label: "Media",
    icon: "palette",
    description:
      "Creating, transforming, or understanding images, video, music, and other media. Spoken interaction and transcription belong in Voice.",
  },
  {
    slug: "security",
    label: "Security",
    icon: "shield",
    description:
      "Protecting access and enforcing trust through authentication, authorization, credential controls, security auditing, or policy. Authentication incidental to another purpose does not belong here.",
  },
  {
    slug: "integrations",
    label: "Integrations",
    icon: "plug",
    description:
      "General connectors, API bridges, and service integration platforms without a more specific user purpose. A connector to a particular workflow belongs in that workflow's category; exposing tools or MCP is not enough.",
  },
  {
    slug: "developer-tools",
    label: "Developer tools",
    icon: "code-xml",
    description:
      "Writing, reviewing, testing, and debugging software, development environments, and coding workflows. Plugins whose main purpose is providing the agent execution engine belong in Agent runtimes.",
  },
  {
    slug: "infrastructure",
    label: "Infrastructure",
    icon: "server",
    description:
      "Deploying, hosting, monitoring, and operating systems, networks, services, and execution environments. Engines that run the agent loop belong in Agent runtimes; coordinating agents belongs in Agent orchestration.",
  },
  {
    slug: "documents-files",
    label: "Documents & files",
    icon: "files",
    description:
      "Reading, creating, extracting, transferring, and managing documents and files. Software code review belongs in Developer tools; task and project management belongs in Productivity.",
  },
  {
    slug: "inbox-collaboration",
    label: "Inbox & collaboration",
    icon: "inbox",
    description:
      "Managing email, inboxes, team communication, and collaborative workspaces. Providing a transport for people to talk to the agent belongs in Channels.",
  },
  {
    slug: "productivity",
    label: "Productivity",
    icon: "list-todo",
    description:
      "Managing tasks, notes, projects, plans, and personal or team work. Appointments and availability belong in Scheduling; document processing belongs in Documents & files.",
  },
  {
    slug: "scheduling",
    label: "Scheduling",
    icon: "calendar-days",
    description:
      "Calendars, appointments, availability, and booking. Technical job scheduling belongs with the workflow it supports, or Infrastructure for general system scheduling.",
  },
  {
    slug: "finance-payments",
    label: "Finance & payments",
    icon: "wallet-cards",
    description:
      "Payments, billing, accounting, banking, trading, and financial workflows. General business reporting belongs in Data & analytics.",
  },
  {
    slug: "sales-marketing",
    label: "Sales & marketing",
    icon: "megaphone",
    description:
      "Customer relationships, sales, customer support, outreach, campaigns, and marketing operations. General email or chat management belongs in Inbox & collaboration.",
  },
  {
    slug: "data-analytics",
    label: "Data & analytics",
    icon: "chart-no-axes-combined",
    description:
      "Querying databases, processing datasets, analysis, reporting, and business intelligence. Agent memory storage belongs in Memory; operational telemetry belongs in Infrastructure.",
  },
  {
    slug: "agent-orchestration",
    label: "Agent orchestration",
    icon: "workflow",
    description:
      "Coordinating agents, delegating work, and running multi-step agent workflows. Engines and backends that execute the agent loop and manage its native sessions belong in Agent runtimes.",
  },
  {
    slug: "research",
    label: "Research",
    icon: "search",
    description:
      "Investigating topics, evaluating sources, working with scientific literature, and synthesizing evidence. General web search, browsing, and page fetching belong in Web.",
  },
  {
    slug: "other",
    label: "Other",
    icon: "package",
    description:
      "Use only when the plugin's main purpose does not fit another category or the available evidence is insufficient. Do not use this just because a plugin has several capabilities.",
  },
] as const;

// Published metadata and old category URLs must remain readable during reclassification.
// These values are accepted by readers, but are not offered for new browse discovery.
export const LEGACY_PLUGIN_CATEGORY_DEFINITIONS = [
  { slug: "tools", label: "Tools", icon: "wrench" },
  { slug: "runtime", label: "Runtime", icon: "git-branch" },
  { slug: "gateway", label: "Gateway", icon: "activity" },
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

export type PluginCategorySlug =
  | (typeof PLUGIN_CATEGORY_DEFINITIONS)[number]["slug"]
  | (typeof LEGACY_PLUGIN_CATEGORY_DEFINITIONS)[number]["slug"];
export type SkillCategorySlug = (typeof SKILL_CATEGORY_DEFINITIONS)[number]["slug"];

export const PLUGIN_CATEGORY_SLUGS = PLUGIN_CATEGORY_DEFINITIONS.map((category) => category.slug);
export const SKILL_CATEGORY_SLUGS = SKILL_CATEGORY_DEFINITIONS.map((category) => category.slug);

const PLUGIN_CATEGORY_SLUG_SET = new Set<string>([
  ...PLUGIN_CATEGORY_SLUGS,
  ...LEGACY_PLUGIN_CATEGORY_DEFINITIONS.map((category) => category.slug),
]);
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
