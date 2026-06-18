import {
  isPluginCategorySlug,
  isSkillCategorySlug,
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
  slug: string;
  displayName: string;
  summary?: string | null;
};

export function getSkillCategoryForSkill(skill: SkillCategoryCandidate): SkillCategory | null {
  return getSkillCategoriesForSkill(skill)[0] ?? null;
}

export function getSkillCategoriesForSkill(skill: SkillCategoryCandidate): SkillCategory[] {
  const categoriesBySlug = new Map(SKILL_CATEGORIES.map((category) => [category.slug, category]));
  return resolveStoredSkillCategories(skill).flatMap((slug) => {
    const category = categoriesBySlug.get(slug);
    return category ? [category] : [];
  });
}

export function getSkillCategoryBySlug(slug: string | null | undefined) {
  if (!slug) return null;
  return SKILL_CATEGORIES.find((category) => category.slug === slug) ?? null;
}

export function buildSkillCategoryBrowseHref(category: SkillCategory) {
  const params = new URLSearchParams({ category: category.slug });
  return `/skills?${params.toString()}`;
}
