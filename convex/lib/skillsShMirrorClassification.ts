import type { Infer } from "convex/values";
import type { skillsShMirrorStoredRowValidator } from "./skillsShMirrorContract";

export function getSkillsShMirrorClassificationState(
  digest: Infer<typeof skillsShMirrorStoredRowValidator> | null,
) {
  if (
    !digest ||
    !digest.inferredCategories ||
    !digest.inferredTopics ||
    !digest.inferredCategoryConfidence ||
    !digest.inferredTopicConfidence ||
    !digest.inferredClassifierVersion ||
    !digest.inferredTopicClassifierVersion ||
    !digest.inferredInputHash ||
    !digest.inferredTopicInputHash ||
    digest.inferredAt === undefined
  ) {
    return null;
  }
  return {
    externalId: digest.externalId,
    slug: digest.slug,
    displayName: digest.displayName,
    ...(digest.sourceContentHash ? { sourceContentHash: digest.sourceContentHash } : {}),
    inferredCategories: digest.inferredCategories,
    inferredTopics: digest.inferredTopics,
    inferredCategoryConfidence: digest.inferredCategoryConfidence,
    inferredTopicConfidence: digest.inferredTopicConfidence,
    inferredClassifierVersion: digest.inferredClassifierVersion,
    inferredTopicClassifierVersion: digest.inferredTopicClassifierVersion,
    inferredInputHash: digest.inferredInputHash,
    inferredTopicInputHash: digest.inferredTopicInputHash,
    inferredAt: digest.inferredAt,
  };
}

export type SkillsShMirrorClassificationState = NonNullable<
  ReturnType<typeof getSkillsShMirrorClassificationState>
>;
