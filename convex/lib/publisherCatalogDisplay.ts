type DisplayManifest = {
  notGrouped?: "top" | "bottom";
  groupings: Array<{
    title: string;
    description?: string;
    skills: string[];
  }>;
};

export type GitHubSkillCatalogSource = {
  _id: string;
  repo: string;
  displayManifestStatus?: "ok" | "missing" | "invalid" | "failed";
  displayManifest?: DisplayManifest;
};

export type GitHubSkillCatalogItem = {
  _id: string;
  kind: "skill" | "plugin";
  displayName: string;
  slug?: string | null;
  sourceBacked?: boolean;
  sourceId?: string | null;
  sourceRepo?: string | null;
  sourcePath?: string | null;
  sourceVerifiedCommit?: string | null;
  summary: string | null;
  categories?: string[];
  inferredCategories?: string[];
  latestVersionId?: string;
  inferredFromVersionId?: string;
  icon: string | null;
  href: string;
  installs: number;
  /** Legacy response field retained while older frontend bundles are cached. */
  downloads: number;
  stars: number;
  isOfficial: boolean;
  updatedAt: number;
};

export type GitHubSkillCatalogSection = {
  key: string;
  title: string;
  description: string | null;
  sourceRepo: string | null;
  items: GitHubSkillCatalogItem[];
};

export type GitHubSkillCatalogDisplay = {
  mode: "grouped";
  sourceRepos: string[];
  sections: GitHubSkillCatalogSection[];
};

function normalizeManifestSkillKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getItemKeys(item: GitHubSkillCatalogItem) {
  const keys = new Set<string>();
  if (item.slug) keys.add(normalizeManifestSkillKey(item.slug));
  keys.add(normalizeManifestSkillKey(item.displayName));

  const sourcePathName = item.sourcePath?.split("/").filter(Boolean).at(-1);
  if (sourcePathName) keys.add(normalizeManifestSkillKey(sourcePathName));

  return keys;
}

function findManifestItem(
  candidates: GitHubSkillCatalogItem[],
  manifestEntry: string,
  usedItemIds: Set<string>,
) {
  const key = normalizeManifestSkillKey(manifestEntry);
  if (!key) return null;

  return (
    candidates.find((item) => !usedItemIds.has(item._id) && getItemKeys(item).has(key)) ?? null
  );
}

function isRenderableSource(source: GitHubSkillCatalogSource) {
  return (
    source.displayManifestStatus === "ok" &&
    Boolean(source.displayManifest) &&
    source.displayManifest!.groupings.length > 0
  );
}

export function buildGitHubSkillCatalogDisplay({
  sources,
  items,
}: {
  sources: GitHubSkillCatalogSource[];
  items: GitHubSkillCatalogItem[];
}): GitHubSkillCatalogDisplay | null {
  const renderableSources = sources.filter(isRenderableSource);
  if (renderableSources.length === 0) return null;

  const sourceRepos = Array.from(new Set(renderableSources.map((source) => source.repo)));
  const usedItemIds = new Set<string>();
  const sections: GitHubSkillCatalogSection[] = [];
  const otherPosition = renderableSources.some(
    (source) => source.displayManifest?.notGrouped === "top",
  )
    ? "top"
    : "bottom";

  for (const source of renderableSources) {
    const sourceItems = items.filter(
      (item) => item.kind === "skill" && item.sourceId === source._id,
    );
    if (sourceItems.length === 0) continue;

    for (const [groupIndex, group] of source.displayManifest!.groupings.entries()) {
      const groupItems = group.skills
        .map((entry) => findManifestItem(sourceItems, entry, usedItemIds))
        .filter((item): item is GitHubSkillCatalogItem => Boolean(item));

      if (groupItems.length === 0) continue;
      for (const item of groupItems) usedItemIds.add(item._id);

      sections.push({
        key: `${source._id}:${groupIndex}:${group.title}`,
        title: group.title,
        description: group.description ?? null,
        sourceRepo: source.repo,
        items: groupItems,
      });
    }
  }

  const otherItems = items.filter((item) => item.kind === "skill" && !usedItemIds.has(item._id));
  const otherSection =
    otherItems.length > 0
      ? {
          key: "other-skills",
          title: "Other skills",
          description: null,
          sourceRepo: null,
          items: otherItems,
        }
      : null;
  const orderedSections =
    otherPosition === "top" && otherSection
      ? [otherSection, ...sections]
      : [...sections, ...(otherSection ? [otherSection] : [])];

  if (orderedSections.length === 0) return null;
  return {
    mode: "grouped",
    sourceRepos,
    sections: orderedSections,
  };
}
