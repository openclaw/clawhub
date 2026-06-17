import {
  PLUGIN_CATEGORY_DEFINITIONS,
  resolveStoredSkillCategories,
  SKILL_CATEGORY_DEFINITIONS,
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
