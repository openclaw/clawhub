import type { CatalogClassifierResult } from "./catalogClassification";

export const CLASSIFIER_VERSION: string;
export const TOPIC_CLASSIFIER_VERSION: string;

export function classifySkill(input?: {
  slug?: string;
  text?: string;
  explicitCategories?: readonly string[];
  explicitTopics?: readonly string[];
  topicTags?: readonly string[];
}): CatalogClassifierResult;

export function classifyPlugin(input?: {
  manifest?: Record<string, unknown>;
  slug?: string;
  text?: string;
  topicText?: string;
  explicitCategories?: readonly string[];
  explicitTopics?: readonly string[];
  topicTags?: readonly string[];
}): CatalogClassifierResult;
