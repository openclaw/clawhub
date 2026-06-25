import { parse as parseYaml } from "yaml";

function parseMetadata(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value.replace(/,\s*([\]}])/g, "$1")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function truncateSkillPublishSummary(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength).trimEnd();
}

export function extractSkillFrontmatterDescription(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return undefined;
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return undefined;

  try {
    const parsed = parseYaml(normalized.slice(4, endIndex)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const frontmatter = parsed as Record<string, unknown>;
    const metadataDescription = parseMetadata(frontmatter.metadata)?.description;
    const description =
      typeof metadataDescription === "string" ? metadataDescription : frontmatter.description;
    return typeof description === "string" && description.trim() ? description.trim() : undefined;
  } catch {
    return undefined;
  }
}
