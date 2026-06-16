import {
  normalizeCatalogTopics,
  resolveStoredPluginPrimaryCategory,
  resolveStoredSkillPrimaryCategory,
} from "clawhub-schema";
import type { Doc } from "../_generated/dataModel";

type CatalogMetadataPatch = {
  primaryCategory?: string;
  topics?: string[];
};

function normalizedTopicsPatch(topics: string[] | undefined): Pick<CatalogMetadataPatch, "topics"> {
  if (!topics) return {};
  const normalized = normalizeCatalogTopics(topics);
  return JSON.stringify(normalized) === JSON.stringify(topics)
    ? {}
    : { topics: normalized.length ? normalized : undefined };
}

export function buildSkillCatalogMetadataBackfillPatch(
  skill: Pick<
    Doc<"skills">,
    "slug" | "displayName" | "summary" | "capabilityTags" | "primaryCategory" | "topics"
  >,
): CatalogMetadataPatch {
  const primaryCategory = resolveStoredSkillPrimaryCategory(skill);
  return {
    ...(skill.primaryCategory === primaryCategory ? {} : { primaryCategory }),
    ...normalizedTopicsPatch(skill.topics),
  };
}

export function buildPackageCatalogMetadataBackfillPatch(
  pkg: Pick<
    Doc<"packages">,
    | "family"
    | "name"
    | "displayName"
    | "runtimeId"
    | "summary"
    | "capabilityTags"
    | "primaryCategory"
    | "topics"
  >,
): CatalogMetadataPatch {
  const primaryCategory = resolveStoredPluginPrimaryCategory(pkg);
  return {
    ...(pkg.primaryCategory === primaryCategory ? {} : { primaryCategory }),
    ...normalizedTopicsPatch(pkg.topics),
  };
}
