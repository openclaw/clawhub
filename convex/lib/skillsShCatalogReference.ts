export function parseSkillsShCatalogReference(value: string) {
  const normalized = value.trim().toLowerCase();
  const externalId = normalized.startsWith("skills-sh:")
    ? normalized.slice("skills-sh:".length)
    : normalized.startsWith("skills-sh/")
      ? normalized.slice("skills-sh/".length)
      : null;
  if (!externalId) return null;
  const segments = externalId.split("/").map((segment) => segment.trim().toLowerCase());
  if (segments.length !== 3) return null;
  const [owner, repo, slug] = segments;
  if (!owner || !repo || !slug || [owner, repo, slug].some((part) => part.includes(":"))) {
    return null;
  }
  return { owner, repo, slug, reference: `skills-sh:${owner}/${repo}/${slug}` };
}
