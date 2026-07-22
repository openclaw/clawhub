/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { CLASSIFIER_VERSION, TOPIC_CLASSIFIER_VERSION } from "../convex/lib/catalogClassifier.mjs";
import {
  buildSkillsShMirrorReplayRows,
  enrichSkillsShMirrorClassifications,
} from "./skillsShMirrorClassification";

const row = {
  externalId: "patrick-erichsen/skills/html",
  slug: "html",
  displayName: "HTML",
  sourceContentHash: "a".repeat(64),
  detail: {
    content: "# HTML\n\nBuild interactive HTML artifacts and frontend prototypes.",
  },
};

describe("skills.sh mirror classification enrichment", () => {
  it("classifies bounded mirror detail content with the native inference contract", () => {
    const [classified] = enrichSkillsShMirrorClassifications([row], [], 123);

    expect(classified).toMatchObject({
      externalId: row.externalId,
      inferredCategories: expect.any(Array),
      inferredTopics: expect.any(Array),
      inferredCategoryConfidence: expect.stringMatching(/^(high|medium|low)$/),
      inferredTopicConfidence: expect.stringMatching(/^(high|medium|low)$/),
      inferredClassifierVersion: CLASSIFIER_VERSION,
      inferredTopicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
      inferredInputHash: expect.any(String),
      inferredTopicInputHash: expect.any(String),
      inferredAt: 123,
    });
    expect(classified.inferredCategories.length).toBeGreaterThan(0);
  });

  it("reuses inference when source identity, content hash, and classifier versions match", () => {
    const classify = vi.fn();
    const inference = {
      inferredCategories: ["development"],
      inferredTopics: ["html"],
      inferredCategoryConfidence: "high" as const,
      inferredTopicConfidence: "medium" as const,
      inferredClassifierVersion: CLASSIFIER_VERSION,
      inferredTopicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
      inferredInputHash: "input-hash",
      inferredTopicInputHash: "topic-input-hash",
      inferredAt: 100,
    };

    const [classified] = enrichSkillsShMirrorClassifications(
      [row],
      [
        {
          externalId: row.externalId,
          slug: row.slug,
          displayName: row.displayName,
          sourceContentHash: row.sourceContentHash,
          ...inference,
        },
      ],
      200,
      classify,
    );

    expect(classified).toMatchObject(inference);
    expect(classify).not.toHaveBeenCalled();
  });

  it("reclassifies when the source content hash or classifier version changes", () => {
    const classify = vi.fn(() => ({
      categories: [],
      topics: [],
      confidence: "low" as const,
      topicConfidence: "low" as const,
      classifierVersion: CLASSIFIER_VERSION,
      topicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
      inputHash: "new-input",
      topicInputHash: "new-topic-input",
    }));
    const staleState = {
      externalId: row.externalId,
      slug: row.slug,
      displayName: row.displayName,
      sourceContentHash: "b".repeat(64),
      inferredCategories: ["development"],
      inferredTopics: ["html"],
      inferredCategoryConfidence: "high" as const,
      inferredTopicConfidence: "high" as const,
      inferredClassifierVersion: "taxonomy-old",
      inferredTopicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
      inferredInputHash: "old-input",
      inferredTopicInputHash: "old-topic-input",
      inferredAt: 100,
    };

    const [classified] = enrichSkillsShMirrorClassifications([row], [staleState], 200, classify);

    expect(classify).toHaveBeenCalledOnce();
    expect(classified).toMatchObject({
      inferredCategories: ["other"],
      inferredTopics: [],
      inferredClassifierVersion: CLASSIFIER_VERSION,
      inferredTopicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
      inferredAt: 200,
    });
  });

  it("reclassifies changed detail when a legacy state has no content hash", () => {
    const classify = vi.fn(() => ({
      categories: ["development"],
      topics: ["html"],
      confidence: "high" as const,
      topicConfidence: "high" as const,
      classifierVersion: CLASSIFIER_VERSION,
      topicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
      inputHash: "new-input",
      topicInputHash: "new-topic-input",
    }));
    const unhashedRow = {
      ...row,
      sourceContentHash: undefined,
      detail: { content: "# HTML\n\nChanged content." },
    };
    const state = {
      externalId: row.externalId,
      slug: row.slug,
      displayName: row.displayName,
      inferredCategories: ["other"],
      inferredTopics: [],
      inferredCategoryConfidence: "low" as const,
      inferredTopicConfidence: "low" as const,
      inferredClassifierVersion: CLASSIFIER_VERSION,
      inferredTopicClassifierVersion: TOPIC_CLASSIFIER_VERSION,
      inferredInputHash: "old-input",
      inferredTopicInputHash: "old-topic-input",
      inferredAt: 100,
    };

    const [classified] = enrichSkillsShMirrorClassifications([unhashedRow], [state], 200, classify);

    expect(classify).toHaveBeenCalledOnce();
    expect(classified).toMatchObject({
      inferredCategories: ["development"],
      inferredAt: 200,
    });
  });

  it("rebuilds bounded rows from the captured digest and detail snapshot", () => {
    const [replayed] = buildSkillsShMirrorReplayRows(
      [
        {
          digest: {
            ...row,
            sourceType: "github",
            upstreamSourceType: "github",
            owner: "patrick-erichsen",
            repo: "skills",
            sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
            canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
            upstreamInstalls: 42,
            upstreamScanners: {
              genAgentTrustHub: { status: "unavailable" },
              socket: { status: "unavailable" },
              snyk: { status: "unavailable" },
            },
          },
          detail: {
            contentKind: "skill-md",
            path: "skills/html/SKILL.md",
            content: row.detail.content,
            contentBytes: Buffer.byteLength(row.detail.content),
            sourceBytes: Buffer.byteLength(row.detail.content),
            sourceFileCount: 1,
            truncated: false,
          },
        },
      ],
      456,
    );

    expect(replayed).toMatchObject({
      externalId: row.externalId,
      owner: "patrick-erichsen",
      repo: "skills",
      detail: {
        path: "skills/html/SKILL.md",
        content: row.detail.content,
      },
      inferredCategories: expect.any(Array),
      inferredAt: 456,
    });
  });

  it("synthesizes the same bounded content hash while replaying legacy detail", () => {
    const [replayed] = buildSkillsShMirrorReplayRows(
      [
        {
          digest: {
            externalId: row.externalId,
            sourceType: "github",
            upstreamSourceType: "github",
            owner: "patrick-erichsen",
            repo: "skills",
            slug: row.slug,
            displayName: row.displayName,
            sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
            canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
            upstreamInstalls: 42,
            upstreamScanners: {
              genAgentTrustHub: { status: "unavailable" },
              socket: { status: "unavailable" },
              snyk: { status: "unavailable" },
            },
          },
          detail: {
            contentKind: "skill-md",
            path: "SKILL.md",
            content: "abc",
            contentBytes: 3,
            sourceBytes: 3,
            sourceFileCount: 1,
            truncated: false,
          },
        },
      ],
      456,
    );

    expect(replayed.sourceContentHash).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
