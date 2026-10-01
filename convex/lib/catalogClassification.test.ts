import { describe, expect, it } from "vitest";
import {
  CATALOG_CATEGORY_CANDIDATE_STORAGE_LIMIT,
  CATALOG_TOPIC_CANDIDATE_STORAGE_LIMIT,
  CATALOG_UNKNOWN_SIGNAL_STORAGE_LIMIT,
  prepareCatalogClassificationResult,
  selectCatalogInference,
} from "./catalogClassification";

const baseResult = {
  categories: ["development"],
  topics: ["TypeScript", "Code Review"],
  rawCandidates: [
    {
      category: "development",
      score: 20,
      sources: ["skill-text"],
      evidence: ["software development"],
    },
  ],
  rawTopicCandidates: [
    {
      topic: "TypeScript",
      slug: "typescript",
      score: 12,
      sources: ["skill-text-primary"],
      evidence: ["skill primary: typescript"],
      primaryEvidence: true,
      primarySourceCount: 1,
      strongEvidence: true,
      confidence: "high" as const,
    },
  ],
  confidence: "high" as const,
  topicConfidence: "medium" as const,
  needsAi: false,
  topicsNeedAi: true,
  unknownSignals: [],
  classifierVersion: "taxonomy-prototype-v9",
  topicClassifierVersion: "topic-prototype-v1",
  inputHash: "category-hash",
  topicInputHash: "topic-hash",
};

describe("catalog classification persistence", () => {
  it("applies only confidence lanes accepted by the operator threshold", () => {
    expect(
      selectCatalogInference({
        currentSourceId: "version:1",
        resultSourceId: "version:1",
        result: baseResult,
        minimumConfidence: "high",
      }),
    ).toEqual({
      status: "applied",
      categories: ["development"],
      topics: undefined,
    });
    expect(
      selectCatalogInference({
        currentSourceId: "version:1",
        resultSourceId: "version:1",
        result: baseResult,
        minimumConfidence: "medium",
      }),
    ).toEqual({
      status: "applied",
      categories: ["development"],
      topics: ["TypeScript", "Code Review"],
    });
  });

  it("never overwrites author metadata and treats explicit empty topics as authoritative", () => {
    expect(
      selectCatalogInference({
        currentSourceId: "version:1",
        resultSourceId: "version:1",
        authorCategories: ["operations"],
        authorTopics: [],
        result: baseResult,
        minimumConfidence: "medium",
      }),
    ).toEqual({
      status: "skipped-author",
      categories: undefined,
      topics: undefined,
    });
  });

  it("rejects stale classifications before application", () => {
    expect(
      selectCatalogInference({
        currentSourceId: "version:2",
        resultSourceId: "version:1",
        result: baseResult,
        minimumConfidence: "medium",
      }),
    ).toEqual({
      status: "stale",
      categories: undefined,
      topics: undefined,
    });
  });

  it("bounds persisted candidates while retaining original counts", () => {
    const prepared = prepareCatalogClassificationResult({
      ...baseResult,
      rawCandidates: Array.from(
        { length: CATALOG_CATEGORY_CANDIDATE_STORAGE_LIMIT + 3 },
        (_, index) => ({
          category: `category-${index}`,
          score: index,
          sources: ["test"],
          evidence: ["test"],
        }),
      ),
      rawTopicCandidates: Array.from(
        { length: CATALOG_TOPIC_CANDIDATE_STORAGE_LIMIT + 7 },
        (_, index) => ({
          topic: `Topic ${index}`,
          slug: `topic-${index}`,
          score: index,
          sources: ["test"],
          evidence: ["test"],
          primaryEvidence: true,
          primarySourceCount: 1,
          strongEvidence: false,
          confidence: "medium" as const,
        }),
      ),
      unknownSignals: Array.from(
        { length: CATALOG_UNKNOWN_SIGNAL_STORAGE_LIMIT + 9 },
        (_, index) => `unknown-${index}`,
      ),
    });

    expect(prepared.categoryCandidates).toHaveLength(CATALOG_CATEGORY_CANDIDATE_STORAGE_LIMIT);
    expect(prepared.topicCandidates).toHaveLength(CATALOG_TOPIC_CANDIDATE_STORAGE_LIMIT);
    expect(prepared.categoryCandidateCount).toBe(CATALOG_CATEGORY_CANDIDATE_STORAGE_LIMIT + 3);
    expect(prepared.topicCandidateCount).toBe(CATALOG_TOPIC_CANDIDATE_STORAGE_LIMIT + 7);
    expect(prepared.unknownSignals).toHaveLength(CATALOG_UNKNOWN_SIGNAL_STORAGE_LIMIT);
  });

  it("stores only the declared bounded review evidence contract", () => {
    const prepared = prepareCatalogClassificationResult({
      ...baseResult,
      rawCandidates: [
        {
          ...baseResult.rawCandidates[0],
          sources: Array.from({ length: 20 }, (_, index) => `source-${index}`),
          evidence: Array.from({ length: 20 }, (_, index) => `evidence-${index}`),
          primaryEvidenceTerms: ["typescript"],
          bodyEvidenceTerms: ["development"],
        } as (typeof baseResult.rawCandidates)[number],
      ],
    });

    expect(prepared.categoryCandidates[0]).toEqual({
      category: "development",
      score: 20,
      sources: Array.from({ length: 8 }, (_, index) => `source-${index}`),
      evidence: Array.from({ length: 12 }, (_, index) => `evidence-${index}`),
    });
  });
});
