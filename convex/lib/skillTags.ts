const CONVEX_FIELD_NAME = /^[\x20-\x7e]+$/;

export function normalizeSkillTags(tags: readonly string[] | undefined): string[] | undefined {
  if (!tags) return undefined;

  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter(
          (tag) =>
            tag.length > 0 &&
            !tag.startsWith("$") &&
            !tag.startsWith("_") &&
            CONVEX_FIELD_NAME.test(tag),
        ),
    ),
  );
}
