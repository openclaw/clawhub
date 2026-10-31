export type ParsedSkillFrontmatter = Record<string, unknown>;

export function getFrontmatterValue(frontmatter: ParsedSkillFrontmatter, key: string) {
  const raw = frontmatter[key];
  return typeof raw === "string" ? raw : undefined;
}
