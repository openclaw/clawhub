import {
  isPluginCategorySlug,
  isSkillCategorySlug,
  normalizeCatalogTopic,
  PLUGIN_CATEGORY_DEFINITIONS,
  resolveStoredSkillCategories,
  SKILL_CATEGORY_DEFINITIONS,
  type PluginCategorySlug,
  type SkillCategorySlug,
} from "clawhub-schema";

export type SkillCategory = {
  slug: string;
  label: string;
  icon: string;
  keywords: string[];
};

export type BrowseCategory = {
  slug: string;
  label: string;
  icon: string;
};

export const SKILL_CATEGORIES: SkillCategory[] = SKILL_CATEGORY_DEFINITIONS.map(
  ({ slug, label, icon, keywords }) => ({
    slug,
    label,
    icon,
    keywords: [...keywords],
  }),
);

export const PLUGIN_CATEGORIES: BrowseCategory[] = PLUGIN_CATEGORY_DEFINITIONS.map(
  ({ slug, label, icon }) => ({
    slug,
    label,
    icon,
  }),
);

export const ALL_CATEGORY_KEYWORDS = SKILL_CATEGORIES.flatMap((c) => c.keywords);

const LEGACY_PLUGIN_BROWSE_CATEGORY_ALIASES = {
  "mcp-tooling": "tools",
  data: "tools",
  observability: "gateway",
  automation: "tools",
  deployment: "gateway",
  "dev-tools": "runtime",
} as const satisfies Record<string, PluginCategorySlug>;

const LEGACY_SKILL_BROWSE_CATEGORY_ALIASES = {
  "mcp-tools": "integrations",
  prompts: "agents",
  workflows: "automation",
  "dev-tools": "development",
  data: "integrations",
} as const satisfies Record<string, SkillCategorySlug>;

const SKILL_CATEGORIES_BY_SLUG = new Map(
  SKILL_CATEGORIES.map((category) => [category.slug, category]),
);
const PLUGIN_CATEGORIES_BY_SLUG = new Map(
  PLUGIN_CATEGORIES.map((category) => [category.slug, category]),
);

export function resolvePluginBrowseCategorySlug(
  value: string | null | undefined,
): PluginCategorySlug | undefined {
  if (!value) return undefined;
  if (isPluginCategorySlug(value)) return value;
  if (!Object.hasOwn(LEGACY_PLUGIN_BROWSE_CATEGORY_ALIASES, value)) return undefined;
  return LEGACY_PLUGIN_BROWSE_CATEGORY_ALIASES[
    value as keyof typeof LEGACY_PLUGIN_BROWSE_CATEGORY_ALIASES
  ];
}

export function resolveSkillBrowseCategorySlug(
  value: string | null | undefined,
): SkillCategorySlug | undefined {
  if (!value) return undefined;
  if (isSkillCategorySlug(value)) return value;
  if (!Object.hasOwn(LEGACY_SKILL_BROWSE_CATEGORY_ALIASES, value)) return undefined;
  return LEGACY_SKILL_BROWSE_CATEGORY_ALIASES[
    value as keyof typeof LEGACY_SKILL_BROWSE_CATEGORY_ALIASES
  ];
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

type SkillIconCategoryCandidate = Pick<
  SkillCategoryCandidate,
  "categories" | "inferredCategories" | "latestVersionId" | "inferredFromVersionId"
>;

export function getSkillCategoryForSkill(skill: SkillCategoryCandidate): SkillCategory | null {
  return getSkillCategoriesForSkill(skill)[0] ?? null;
}

export function getSkillCategoriesForSkill(skill: SkillCategoryCandidate): SkillCategory[] {
  return resolveStoredSkillCategories(skill).flatMap((slug) => {
    const category = SKILL_CATEGORIES_BY_SLUG.get(slug);
    return category ? [category] : [];
  });
}

export function getSkillIconCategoryForSkill(
  skill: SkillIconCategoryCandidate,
): SkillCategory | null {
  const storedCategory = skill.categories?.find(isSkillCategorySlug);
  if (storedCategory) return SKILL_CATEGORIES_BY_SLUG.get(storedCategory) ?? null;

  const inferenceCurrent =
    Boolean(skill.latestVersionId) && skill.latestVersionId === skill.inferredFromVersionId;
  const inferredCategory = inferenceCurrent
    ? skill.inferredCategories?.find(isSkillCategorySlug)
    : null;
  return inferredCategory ? (SKILL_CATEGORIES_BY_SLUG.get(inferredCategory) ?? null) : null;
}

export function getSkillCategoryBySlug(slug: string | null | undefined) {
  if (!slug) return null;
  return SKILL_CATEGORIES.find((category) => category.slug === slug) ?? null;
}

export function getPluginCategoryBySlug(slug: string | null | undefined) {
  const resolvedSlug = resolvePluginBrowseCategorySlug(slug);
  return resolvedSlug ? (PLUGIN_CATEGORIES_BY_SLUG.get(resolvedSlug) ?? null) : null;
}

export function buildSkillCategoryBrowseHref(category: SkillCategory) {
  const params = new URLSearchParams({ category: category.slug });
  return `/skills?${params.toString()}`;
}

export function buildPluginCategoryBrowseHref(category: BrowseCategory) {
  const params = new URLSearchParams({ category: category.slug });
  return `/plugins?${params.toString()}`;
}

export function formatCatalogTopicLabel(topic: string) {
  const normalized = normalizeCatalogTopic(topic);
  return `#${normalized ?? topic.trim().normalize("NFKC").toLocaleLowerCase("en-US")}`;
}

export function buildSkillTopicBrowseHref(topic: string) {
  const normalized = normalizeCatalogTopic(topic);
  if (!normalized) return "/skills";
  const params = new URLSearchParams({ topic: normalized });
  return `/skills?${params.toString()}`;
}

export function buildPluginTopicBrowseHref(topic: string) {
  const normalized = normalizeCatalogTopic(topic);
  if (!normalized) return "/plugins";
  const params = new URLSearchParams({ topic: normalized });
  return `/plugins?${params.toString()}`;
}
