export const CATALOG_CATEGORY_CANDIDATE_STORAGE_LIMIT = 32;
export const CATALOG_TOPIC_CANDIDATE_STORAGE_LIMIT = 100;
export const CATALOG_UNKNOWN_SIGNAL_STORAGE_LIMIT = 100;
const CATALOG_CANDIDATE_SOURCE_STORAGE_LIMIT = 8;
const CATALOG_CANDIDATE_EVIDENCE_STORAGE_LIMIT = 12;

export type CatalogClassificationConfidence = "high" | "medium" | "low";
export type CatalogClassificationApplyStatus =
  | "preview"
  | "applied"
  | "stale"
  | "skipped-author"
  | "error";

type CatalogCategoryCandidate = {
  category: string;
  score: number;
  sources: string[];
  evidence: string[];
  strongEvidence?: boolean;
  primaryEvidence?: boolean;
  strongPrimaryEvidence?: boolean;
  primaryEvidenceCount?: number;
};

type CatalogTopicCandidate = {
  topic: string;
  slug: string;
  score: number;
  sources: string[];
  evidence: string[];
  primaryEvidence: boolean;
  primarySourceCount: number;
  strongEvidence: boolean;
  confidence: CatalogClassificationConfidence;
  suppressedBy?: string;
};

export type CatalogClassifierResult = {
  categories: string[];
  topics: string[];
  rawCandidates: CatalogCategoryCandidate[];
  rawTopicCandidates: CatalogTopicCandidate[];
  confidence: CatalogClassificationConfidence;
  topicConfidence: CatalogClassificationConfidence;
  needsAi: boolean;
  topicsNeedAi: boolean;
  unknownSignals: string[];
  classifierVersion: string;
  topicClassifierVersion: string;
  inputHash: string;
  topicInputHash: string;
};

export function prepareCatalogClassificationResult(result: CatalogClassifierResult) {
  return {
    categories: result.categories,
    topics: result.topics,
    categoryCandidates: result.rawCandidates
      .slice(0, CATALOG_CATEGORY_CANDIDATE_STORAGE_LIMIT)
      .map((candidate) => ({
        category: candidate.category,
        score: candidate.score,
        sources: candidate.sources.slice(0, CATALOG_CANDIDATE_SOURCE_STORAGE_LIMIT),
        evidence: candidate.evidence.slice(0, CATALOG_CANDIDATE_EVIDENCE_STORAGE_LIMIT),
        ...(candidate.strongEvidence === undefined
          ? {}
          : { strongEvidence: candidate.strongEvidence }),
        ...(candidate.primaryEvidence === undefined
          ? {}
          : { primaryEvidence: candidate.primaryEvidence }),
        ...(candidate.strongPrimaryEvidence === undefined
          ? {}
          : { strongPrimaryEvidence: candidate.strongPrimaryEvidence }),
        ...(candidate.primaryEvidenceCount === undefined
          ? {}
          : { primaryEvidenceCount: candidate.primaryEvidenceCount }),
      })),
    topicCandidates: result.rawTopicCandidates
      .slice(0, CATALOG_TOPIC_CANDIDATE_STORAGE_LIMIT)
      .map((candidate) => ({
        topic: candidate.topic,
        slug: candidate.slug,
        score: candidate.score,
        sources: candidate.sources.slice(0, CATALOG_CANDIDATE_SOURCE_STORAGE_LIMIT),
        evidence: candidate.evidence.slice(0, CATALOG_CANDIDATE_EVIDENCE_STORAGE_LIMIT),
        primaryEvidence: candidate.primaryEvidence,
        primarySourceCount: candidate.primarySourceCount,
        strongEvidence: candidate.strongEvidence,
        confidence: candidate.confidence,
        ...(candidate.suppressedBy === undefined ? {} : { suppressedBy: candidate.suppressedBy }),
      })),
    categoryCandidateCount: result.rawCandidates.length,
    topicCandidateCount: result.rawTopicCandidates.length,
    categoryConfidence: result.confidence,
    topicConfidence: result.topicConfidence,
    categoryNeedsReview: result.needsAi,
    topicNeedsReview: result.topicsNeedAi,
    unknownSignals: result.unknownSignals.slice(0, CATALOG_UNKNOWN_SIGNAL_STORAGE_LIMIT),
    classifierVersion: result.classifierVersion,
    topicClassifierVersion: result.topicClassifierVersion,
    inputHash: result.inputHash,
    topicInputHash: result.topicInputHash,
  };
}

const CONFIDENCE_RANK: Record<CatalogClassificationConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function confidenceAtLeast(
  value: CatalogClassificationConfidence,
  minimum: CatalogClassificationConfidence,
) {
  return CONFIDENCE_RANK[value] >= CONFIDENCE_RANK[minimum];
}

export function selectCatalogInference(input: {
  currentSourceId?: string | null;
  resultSourceId?: string | null;
  authorCategories?: readonly string[] | null;
  authorTopics?: readonly string[] | null;
  result: Pick<CatalogClassifierResult, "categories" | "topics" | "confidence" | "topicConfidence">;
  minimumConfidence: CatalogClassificationConfidence;
}): {
  status: CatalogClassificationApplyStatus;
  categories?: string[];
  topics?: string[];
} {
  if (
    !input.currentSourceId ||
    !input.resultSourceId ||
    input.currentSourceId !== input.resultSourceId
  ) {
    return { status: "stale", categories: undefined, topics: undefined };
  }

  const categories =
    input.authorCategories === undefined &&
    confidenceAtLeast(input.result.confidence, input.minimumConfidence)
      ? [...input.result.categories]
      : undefined;
  const topics =
    input.authorTopics === undefined &&
    confidenceAtLeast(input.result.topicConfidence, input.minimumConfidence)
      ? [...input.result.topics]
      : undefined;
  const authorOwnsBoth = input.authorCategories !== undefined && input.authorTopics !== undefined;

  return {
    status:
      categories !== undefined || topics !== undefined
        ? "applied"
        : authorOwnsBoth
          ? "skipped-author"
          : "preview",
    categories,
    topics,
  };
}
